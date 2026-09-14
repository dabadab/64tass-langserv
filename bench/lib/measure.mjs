/**
 * One benchmark run: a server process driven through the same sequence of
 * exchanges every time, each one timed.
 *
 * The sequence is fixed so every version is asked the same things in the same
 * order: startup, the background workspace scan, a cold open of the root file,
 * edits, then each request family in turn. Requests are only sent when the
 * server declared the capability; a metric is null when it did not, and the
 * run FAILS (rather than recording null) when the server stops answering.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { LspClient } from './client.mjs';
import { summarize, medianOfMedians } from './stats.mjs';
import { METRICS } from './results.mjs';

const SCAN_LOG = /^Indexed (\d+) workspace file\(s\) in (\d+)ms$/;

/** Each request family: capability that gates it, how to build its params, and a sanity check on the answer. */
const REQUESTS = [
    { metric: 'completionMs', method: 'textDocument/completion', capability: 'completionProvider',
      params: c => c.at('completion'), check: r => Array.isArray(r) ? r.length > 0 : Array.isArray(r?.items) && r.items.length > 0 },
    { metric: 'hoverMs', method: 'textDocument/hover', capability: 'hoverProvider',
      params: c => c.at('hover'), check: r => r !== null && r !== undefined },
    { metric: 'definitionMs', method: 'textDocument/definition', capability: 'definitionProvider',
      params: c => c.at('definition'), check: r => r !== null && r !== undefined },
    { metric: 'referencesMs', method: 'textDocument/references', capability: 'referencesProvider',
      params: c => ({ ...c.at('references'), context: { includeDeclaration: true } }), check: r => Array.isArray(r) && r.length > 1 },
    { metric: 'renameMs', method: 'textDocument/rename', capability: 'renameProvider',
      params: c => ({ ...c.at('rename'), newName: c.probes.rename.newName }), check: r => r !== null && typeof r === 'object' },
    { metric: 'documentSymbolMs', method: 'textDocument/documentSymbol', capability: 'documentSymbolProvider',
      params: c => ({ textDocument: { uri: c.uriOf(c.probes.document) } }), check: r => Array.isArray(r) && r.length > 0 },
    { metric: 'workspaceSymbolMs', method: 'workspace/symbol', capability: 'workspaceSymbolProvider',
      params: c => ({ query: c.probes.workspaceSymbolQuery }), check: r => Array.isArray(r) && r.length > 0 },
    { metric: 'semanticTokensMs', method: 'textDocument/semanticTokens/full', capability: 'semanticTokensProvider',
      params: c => ({ textDocument: { uri: c.uriOf(c.probes.document) } }), check: r => Array.isArray(r?.data) && r.data.length % 5 === 0 && r.data.length > 0 },
    { metric: 'foldingRangeMs', method: 'textDocument/foldingRange', capability: 'foldingRangeProvider',
      params: c => ({ textDocument: { uri: c.uriOf(c.probes.document) } }), check: r => Array.isArray(r) && r.length > 0 },
    { metric: 'formattingMs', method: 'textDocument/formatting', capability: 'documentFormattingProvider',
      params: c => ({ textDocument: { uri: c.uriOf(c.probes.document) }, options: { tabSize: 8, insertSpaces: true } }), check: r => Array.isArray(r) },
    { metric: 'signatureHelpMs', method: 'textDocument/signatureHelp', capability: 'signatureHelpProvider',
      params: c => c.at('signatureHelp'), check: r => Array.isArray(r?.signatures) && r.signatures.length > 0 },
    // No capability exists for the custom request; MethodNotFound is the only signal.
    { metric: 'cycleCountsMs', method: '64tass/cycleCounts', capability: null,
      params: c => ({ uri: c.uriOf(c.probes.document) }), check: r => Array.isArray(r) && r.length > 0 },
];

export class RunError extends Error {
    constructor(message, { stderr = [], log = [] } = {}) {
        super(message);
        this.stderr = stderr;
        this.log = log;
    }
}

/**
 * One server process, start to finish.
 * @returns {{ samples: Record<string, number[] | null>, capabilities: Record<string, boolean>, errors: Record<string, string> }}
 */
export async function runOnce({ serverPath, cwd, workload, workloadDir, reps, warmup, scanWait = 'auto', onProgress = () => {} }) {
    const samples = Object.fromEntries(METRICS.map(m => [m, null]));
    const errors = {};
    const capabilities = {};
    // Startup is spawn-to-initialize-answered, so the clock starts before the spawn.
    const t0 = performance.now();
    const client = LspClient.spawn({ serverPath, cwd, rootDir: workloadDir });
    const probes = workload.probes;
    const ctx = {
        probes,
        uriOf: rel => client.uriOf(rel),
        at: name => ({ textDocument: { uri: client.uriOf(probes[name].file) }, position: { line: probes[name].line, character: probes[name].character } }),
    };
    const read = rel => readFileSync(path.join(workloadDir, rel), 'utf8');

    try {
        // 1. Startup: spawn to initialize answered.
        await client.initialize();
        samples.startupMs = [performance.now() - t0];
        await client.initialized();
        for (const name of ['hover', 'definition', 'references', 'rename', 'completion', 'documentSymbol', 'workspaceSymbol',
            'semanticTokens', 'foldingRange', 'documentFormatting', 'signatureHelp']) {
            capabilities[name] = client.hasCapability(`${name}Provider`);
        }
        onProgress('initialized');

        // 2. Workspace scan, observed through the server's own log line. The scan
        //    and workspace symbols arrived in the same release, so a server
        //    without the one has no scan to wait for.
        const expectScan = scanWait === 'always' || (scanWait === 'auto' && capabilities.workspaceSymbol);
        capabilities.scan = false;
        if (expectScan && scanWait !== 'never') {
            const timeoutMs = 3000 + 20 * workload.files.length;
            try {
                const { match, entry } = await client.waitLog(SCAN_LOG, timeoutMs);
                samples['scan.reportedMs'] = [Number(match[2])];
                samples['scan.wallMs'] = [entry.t - client.initializedAt];
                capabilities.scan = true;
            } catch (error) {
                if (scanWait === 'always') throw error;
                errors.scan = `no scan log within ${timeoutMs}ms`;
            }
        }
        const rssAfterScan = client.rssMB();
        if (rssAfterScan !== null) samples['rss.afterScanMB'] = [rssAfterScan];
        onProgress('scanned');

        // 3. Cold open of the root. A hover sent straight after didOpen queues
        //    behind the synchronous indexing, so its latency is the index cost
        //    without the diagnostic debounce.
        const root = await client.open(workload.root, read(workload.root), {
            after: () => client.request('textDocument/hover', ctx.at('hover')),
        });
        samples['open.toDiagnosticsMs'] = [root.toDiagnosticsMs];
        samples['open.indexMs'] = [root.after.ms];

        // The documents the probes live in, opened untimed.
        for (const rel of new Set([probes.document, probes.hover.file, probes.references.file])) {
            if (rel !== workload.root) await client.open(rel, read(rel));
        }
        onProgress('opened');

        // 4. Edits: insert a line at the end of the root, then take it out again.
        const { file, line, text } = probes.changeInsert;
        const changes = [];
        for (let i = 0; i < warmup + reps; i++) {
            const insert = i % 2 === 0;
            const edit = insert
                ? { range: { start: { line, character: 0 }, end: { line, character: 0 } }, text }
                : { range: { start: { line, character: 0 }, end: { line: line + 1, character: 0 } }, text: '' };
            const { toDiagnosticsMs } = await client.change(file, edit);
            if (i >= warmup) changes.push(toDiagnosticsMs);
        }
        samples['change.toDiagnosticsMs'] = changes;
        onProgress('edited');

        // 5. Each request family: warm up, then measure.
        for (const family of REQUESTS) {
            if (family.capability && !client.hasCapability(family.capability)) continue;
            const params = family.params(ctx);
            const first = await client.request(family.method, params);
            if (first.unsupported) continue;
            if (!family.check(first.result)) {
                errors[family.metric] = `unexpected answer: ${JSON.stringify(first.result)?.slice(0, 120)}`;
                continue;
            }
            for (let i = 1; i < warmup; i++) await client.request(family.method, params);
            const times = [];
            for (let i = 0; i < reps; i++) times.push((await client.request(family.method, params)).ms);
            samples[family.metric] = times;
            onProgress(family.metric);
        }
        capabilities.cycleCounts = samples.cycleCountsMs !== null;

        const rssEnd = client.rssMB();
        if (rssEnd !== null) samples['rss.endMB'] = [rssEnd];
    } catch (error) {
        throw new RunError(`${error.message}`, { stderr: client.exited?.stderr ?? client.stderr, log: client.log.map(l => l.message) });
    } finally {
        await client.shutdown();
    }
    return { samples, capabilities, errors, unsolicitedDiagnostics: client.unsolicitedDiagnostics };
}

/** Per-run summaries of every metric. */
export function summarizeRun(samples) {
    return Object.fromEntries(METRICS.map(m => [m, samples[m] === null ? null : summarize(samples[m])]));
}

/**
 * Several processes; the headline per metric is the median of the per-run
 * medians, which one bad process (JIT tiering, a cold page cache) cannot move.
 */
export async function benchmark(options) {
    const { runs, onProgress = () => {} } = options;
    const perRun = [];
    let capabilities = {};
    const errors = {};
    for (let i = 0; i < runs; i++) {
        onProgress(`run ${i + 1}/${runs}`);
        const result = await runOnce({ ...options, onProgress: step => onProgress(`run ${i + 1}/${runs}: ${step}`) });
        perRun.push(summarizeRun(result.samples));
        capabilities = result.capabilities;
        Object.assign(errors, result.errors);
    }
    const metrics = Object.fromEntries(METRICS.map(m => [m, medianOfMedians(perRun.map(r => r[m]))]));
    return { metrics, runs: perRun, capabilities, errors };
}
