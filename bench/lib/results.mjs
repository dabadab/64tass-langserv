/**
 * The saved record of a run, and the file that holds them all.
 *
 * One JSON object per line in bench/results.jsonl, appended only by `--save`.
 * Nothing in `yarn test` writes here - the previous incarnation appended a line
 * on every test run, which is how it came to hold four hundred unattributable
 * measurements.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export const SCHEMA_VERSION = 1;
export const HARNESS_VERSION = '1.0.0';
export const RESULTS_FILE = path.resolve(new URL('../results.jsonl', import.meta.url).pathname);

/** Metric keys in the order the report shows them. */
export const METRICS = [
    'startupMs',
    'scan.reportedMs',
    'scan.wallMs',
    'rss.afterScanMB',
    'open.toDiagnosticsMs',
    'open.indexMs',
    'change.toDiagnosticsMs',
    'completionMs',
    'hoverMs',
    'definitionMs',
    'referencesMs',
    'renameMs',
    'documentSymbolMs',
    'workspaceSymbolMs',
    'semanticTokensMs',
    'foldingRangeMs',
    'formattingMs',
    'signatureHelpMs',
    'cycleCountsMs',
    'rss.endMB',
];

export function appendResult(record, file = RESULTS_FILE) {
    appendFileSync(file, JSON.stringify(record) + '\n');
}

/** Every record in the file, oldest first. Malformed lines are skipped with a warning. */
export function loadResults(file = RESULTS_FILE, log = console.error) {
    if (!existsSync(file)) return [];
    const records = [];
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        if (line.trim() === '') return;
        try {
            records.push(JSON.parse(line));
        } catch {
            log(`warning: ${path.basename(file)}:${i + 1} is not valid JSON, skipped`);
        }
    });
    return records;
}

/** The key two records must share to be the same measurement. */
export function seriesKey(record) {
    return `${record.env.machineId}|${record.harness.workload.hash}`;
}

/**
 * The latest record per (machine, workload, target), so a version measured
 * twice shows once. Sorted by version.
 */
export function latestPerVersion(records) {
    const latest = new Map();
    for (const record of records) {
        const key = `${seriesKey(record)}|${record.target.describe}`;
        const existing = latest.get(key);
        if (!existing || existing.env.timestamp < record.env.timestamp) latest.set(key, record);
    }
    return [...latest.values()].sort((a, b) => compareVersions(a.target.describe, b.target.describe));
}

/**
 * Parse `git describe` output: `v0.12.0`, `v0.12.0-3-gabc1234`, either with
 * `-dirty`, or a bare sha when no tag is reachable.
 */
export function parseDescribe(describe) {
    const dirty = describe.endsWith('-dirty');
    const base = dirty ? describe.slice(0, -'-dirty'.length) : describe;
    const m = base.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(\d+)-g[0-9a-f]+)?$/);
    if (!m) return { version: null, distance: Infinity, dirty, raw: describe };
    return {
        version: [Number(m[1]), Number(m[2]), Number(m[3])],
        distance: m[4] === undefined ? 0 : Number(m[4]),
        dirty,
        raw: describe,
    };
}

/** Release order: semver, then commits past the tag, dirty last; untagged shas at the end. */
export function compareVersions(a, b) {
    const pa = parseDescribe(a);
    const pb = parseDescribe(b);
    if (pa.version === null || pb.version === null) {
        if (pa.version === null && pb.version === null) return a.localeCompare(b);
        return pa.version === null ? 1 : -1;
    }
    for (let i = 0; i < 3; i++) {
        if (pa.version[i] !== pb.version[i]) return pa.version[i] - pb.version[i];
    }
    if (pa.distance !== pb.distance) return pa.distance - pb.distance;
    if (pa.dirty !== pb.dirty) return pa.dirty ? 1 : -1;
    return 0;
}
