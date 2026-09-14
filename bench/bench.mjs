/**
 * Run-time benchmark of the language server, driven over LSP against the
 * built bundle - the way the editor uses it, and the only interface that has
 * stayed the same across releases.
 *
 *   node bench/bench.mjs run       [--scale 10] [--runs 3] [--reps 20] [--warmup 3]
 *                                  [--server out/server/server.js] [--cwd .]
 *                                  [--save] [--force] [--label NAME] [--smoke] [--json]
 *                                  [--scan-wait auto|always|never]
 *   node bench/bench.mjs history   [REF...] [--runs N] [--reps N] [--scale N] [--save] [--keep] [--label NAME]
 *   node bench/bench.mjs report    [--machine ID] [--format md|csv] [--last N] [--out FILE]
 *   node bench/bench.mjs compare   A.json B.json | --baseline DESCRIBE   [--threshold 0.2] [--min-delta 0.5]
 *   node bench/bench.mjs workload  [--scale N] [--out DIR] [--verify]
 *
 * Results are comparable only on one machine and one workload; `report` and
 * `compare` refuse to mix them. Saved records go to bench/results.jsonl, and
 * only `--save` writes there. See bench/README.md.
 */
import { parseArgs } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWorkload, generateWorkload, verifyWorkload, checkProbes } from './lib/workload.mjs';
import { benchmark, RunError } from './lib/measure.mjs';
import { describeRepo, machineInfo, dependencyVersions, warnIfLoaded } from './lib/env.mjs';
import { SCHEMA_VERSION, HARNESS_VERSION, RESULTS_FILE, appendResult, loadResults, latestPerVersion } from './lib/results.mjs';
import { report, runTable } from './lib/report.mjs';
import { compareRecords, compareTable, CompareError } from './lib/compare.mjs';
import { history } from './lib/history.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OPTIONS = {
    scale: { type: 'string' }, runs: { type: 'string' }, reps: { type: 'string' }, warmup: { type: 'string' },
    server: { type: 'string' }, cwd: { type: 'string' }, save: { type: 'boolean' }, force: { type: 'boolean' },
    label: { type: 'string' }, smoke: { type: 'boolean' }, json: { type: 'boolean' }, 'scan-wait': { type: 'string' },
    keep: { type: 'boolean' }, machine: { type: 'string' }, format: { type: 'string' }, last: { type: 'string' },
    out: { type: 'string' }, baseline: { type: 'string' }, threshold: { type: 'string' }, 'min-delta': { type: 'string' }, verify: { type: 'boolean' },
    'build-script': { type: 'string' }, help: { type: 'boolean', short: 'h' },
};

function usage() {
    return readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].split('\n')
        .filter(l => l.startsWith(' *   node')).map(l => l.slice(4)).join('\n');
}

const int = (value, fallback) => (value === undefined ? fallback : Number.parseInt(value, 10));

/**
 * Measure one server and build the record for it. Shared by `run`, `history`
 * and `compare --baseline`.
 */
export async function measureTarget({ serverPath, cwd, scale, runs, reps, warmup, scanWait, label, buildScript, log = console.error }) {
    if (!existsSync(serverPath)) throw new Error(`server bundle not found at ${serverPath} - run yarn compile:prod first`);
    const workloadDir = mkdtempSync(path.join(os.tmpdir(), 'bench-workload-'));
    try {
        const workload = generateWorkload(workloadDir, { scale });
        const env = machineInfo();
        warnIfLoaded(env, log);
        const result = await benchmark({
            serverPath: path.resolve(serverPath), cwd: path.resolve(cwd), workload, workloadDir,
            runs, reps, warmup, scanWait,
            onProgress: step => log(`  ${step}`),
        });
        for (const [metric, message] of Object.entries(result.errors)) log(`  note: ${metric}: ${message}`);
        const target = describeRepo(cwd);
        const { files, lines, ...workloadMeta } = workload;
        return {
            schema: SCHEMA_VERSION,
            harness: { version: HARNESS_VERSION, workload: { name: workloadMeta.name, scale: workloadMeta.scale, seed: workloadMeta.seed, hash: workloadMeta.hash, files: files.length, lines } },
            target: { ...target, serverPath: path.relative(path.resolve(cwd), path.resolve(serverPath)), buildScript: buildScript ?? null, dependencies: dependencyVersions(cwd) },
            env: { timestamp: new Date().toISOString(), label: label ?? null, ...env },
            settings: { runs, reps, warmup },
            capabilities: result.capabilities,
            metrics: result.metrics,
            errors: result.errors,
            runs: result.runs,
        };
    } finally {
        rmSync(workloadDir, { recursive: true, force: true });
    }
}

async function run(values) {
    const smoke = values.smoke === true;
    const options = {
        serverPath: values.server ?? path.join(REPO, 'out', 'server', 'server.js'),
        cwd: values.cwd ?? REPO,
        scale: int(values.scale, smoke ? 1 : 10),
        runs: int(values.runs, smoke ? 1 : 3),
        reps: int(values.reps, smoke ? 3 : 20),
        warmup: int(values.warmup, smoke ? 1 : 3),
        scanWait: values['scan-wait'] ?? 'auto',
        label: values.label,
        buildScript: values['build-script'] ?? null,
    };
    if (smoke) smokeChecks(options.scale);

    const record = await measureTarget(options);

    if (smoke) {
        // Every capability the server declared must have produced a number.
        const missing = Object.entries(record.capabilities)
            .filter(([name, declared]) => declared && !['scan', 'cycleCounts'].includes(name))
            .map(([name]) => `${name === 'documentFormatting' ? 'formatting' : name}Ms`)
            .filter(metric => record.metrics[metric] === null);
        if (missing.length > 0) throw new Error(`smoke: declared capabilities answered nothing: ${missing.join(', ')}`);
        if (Object.keys(record.errors).length > 0) throw new Error(`smoke: ${JSON.stringify(record.errors)}`);
        console.log('smoke: ok');
    }

    if (values.json) console.log(JSON.stringify(record, null, 2));
    else {
        console.log(`${record.target.describe} on ${record.env.machineId} (${record.env.cpuModel}), workload ${record.harness.workload.hash.slice(0, 12)} @${record.harness.workload.scale}`);
        console.log(runTable(record));
    }

    if (values.save && !smoke) {
        if (record.target.dirty && !values.force) {
            throw new Error('refusing to save from a dirty tree (a number nobody can reproduce); commit first or pass --force');
        }
        appendResult(record);
        console.error(`saved ${record.target.describe} to ${path.relative(process.cwd(), RESULTS_FILE)}`);
    }
}

/** Generator sanity: deterministic, and every probe points at what it claims. */
function smokeChecks(scale) {
    const first = buildWorkload({ scale });
    const second = buildWorkload({ scale });
    if (first.workload.hash !== second.workload.hash) throw new Error('smoke: workload generation is not deterministic');
    const failures = checkProbes(first.files, first.workload.probes);
    if (failures.length > 0) throw new Error(`smoke: probes off target: ${failures.join(', ')}`);
}

function workload(values) {
    const scale = int(values.scale, 10);
    const dir = values.out ?? mkdtempSync(path.join(os.tmpdir(), 'bench-workload-'));
    mkdirSync(dir, { recursive: true });
    const wl = generateWorkload(dir, { scale });
    console.log(`${wl.name} @${scale}: ${wl.files.length} files, ${wl.lines} lines, hash ${wl.hash} -> ${dir}`);
    if (values.verify) {
        verifyWorkload(dir, wl);
        console.log('assembles with zero errors and zero warnings');
    }
}

function doReport(values) {
    const text = report(loadResults(), {
        format: values.format ?? 'md',
        last: int(values.last, 6),
        machineId: values.machine ?? null,
    });
    if (values.out) writeFileSync(values.out, text);
    else process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

async function compare(values, positionals) {
    const threshold = values.threshold === undefined ? 0.2 : Number(values.threshold);
    const minDelta = values['min-delta'] === undefined ? 0.5 : Number(values['min-delta']);
    let a;
    let b;
    if (values.baseline) {
        const me = machineInfo().machineId;
        const candidates = latestPerVersion(loadResults())
            .filter(r => r.env.machineId === me && r.target.describe === values.baseline);
        if (candidates.length === 0) throw new CompareError(`no saved result for ${values.baseline} on this machine (${me})`);
        a = candidates[candidates.length - 1];
        b = await measureTarget({
            serverPath: values.server ?? path.join(REPO, 'out', 'server', 'server.js'),
            cwd: values.cwd ?? REPO,
            scale: a.harness.workload.scale, runs: a.settings.runs, reps: a.settings.reps, warmup: a.settings.warmup,
            scanWait: values['scan-wait'] ?? 'auto', label: values.label,
        });
    } else {
        if (positionals.length !== 2) throw new CompareError('compare needs two record files, or --baseline DESCRIBE');
        [a, b] = positionals.map(file => JSON.parse(readFileSync(file, 'utf8')));
    }
    const comparison = compareRecords(a, b, { threshold, minDelta });
    console.log(compareTable(a, b, comparison));
    if (comparison.regressed.length > 0) {
        console.error(`regressed beyond ${(threshold * 100).toFixed(0)}% (and ${minDelta} ms/MB): ${comparison.regressed.join(', ')}`);
        process.exitCode = 1;
    }
}

async function main() {
    const { values, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true });
    const [command, ...rest] = positionals;
    if (values.help || !command) {
        console.log(usage());
        return;
    }
    switch (command) {
        case 'run': return run(values);
        case 'workload': return workload(values);
        case 'report': return doReport(values);
        case 'compare': return compare(values, rest);
        case 'history': return history(rest, {
            repo: REPO, runs: int(values.runs, 3), reps: int(values.reps, 20), warmup: int(values.warmup, 3),
            scale: int(values.scale, 10), save: values.save === true, keep: values.keep === true, label: values.label,
            scanWait: values['scan-wait'] ?? 'auto', measureTarget,
        });
        default: throw new Error(`unknown command '${command}'\n${usage()}`);
    }
}

main().catch(error => {
    if (error instanceof RunError) {
        console.error(`benchmark run failed: ${error.message}`);
        if (error.stderr.length > 0) console.error('server stderr:\n' + error.stderr.join('\n'));
    } else if (error instanceof CompareError) {
        console.error(error.message);
        process.exitCode = 2;
        return;
    } else {
        console.error(error.message);
    }
    process.exitCode = process.exitCode || 1;
});
