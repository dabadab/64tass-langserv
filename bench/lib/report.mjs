/**
 * Tables over saved results: metrics down, versions across, each cell the
 * headline median and its change from the column before.
 *
 * Only records from one machine and one workload ever share a table - the
 * numbers mean nothing side by side otherwise - so anything else in the file
 * gets a table of its own.
 */
import { METRICS, latestPerVersion, seriesKey } from './results.mjs';
import { pctChange } from './stats.mjs';

const FOOTNOTES = [
    'open.toDiagnosticsMs and change.toDiagnosticsMs include the 250 ms diagnostic debounce from v0.9.2 on.',
    'scan.* is null before v0.9.2, which is when the background workspace scan arrived.',
    'open.indexMs is meaningful from v0.9.2 on; earlier servers answered the probing hover before or without indexing.',
    '"-" means the capability is absent in that version; every metric is lower-is-better, RSS included.',
];

function fmt(value, digits = 1) {
    if (value === null || value === undefined) return '-';
    return value >= 100 ? value.toFixed(0) : value.toFixed(digits);
}

function pct(change) {
    if (change === null) return '';
    const sign = change > 0 ? '+' : '';
    return ` (${sign}${(change * 100).toFixed(1)}%)`;
}

/** Group records by machine and workload, newest workload hash first. */
export function groupSeries(records) {
    const groups = new Map();
    for (const record of latestPerVersion(records)) {
        const key = seriesKey(record);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
    }
    return [...groups.values()];
}

/** Markdown for one series (one machine, one workload). */
export function markdownTable(series, { last = 6 } = {}) {
    const shown = last > 0 ? series.slice(-last) : series;
    const first = shown[0];
    const { env, harness } = first;
    const lines = [];
    lines.push(`Machine ${env.machineId}${env.label ? ` (${env.label})` : ''}: ${env.cpuModel}, ${env.cores} cores, ${env.totalMemGB} GB, node ${env.node}`);
    lines.push(`Workload ${harness.workload.name} @${harness.workload.scale} (${harness.workload.hash.slice(0, 12)}), ${harness.workload.files} files, ${harness.workload.lines} lines`);
    lines.push('');
    const header = ['metric', ...shown.map(r => r.target.describe)];
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`|---|${shown.map(() => '---:').join('|')}|`);
    for (const metric of METRICS) {
        const cells = shown.map((record, i) => {
            const value = record.metrics[metric]?.median ?? null;
            const previous = i > 0 ? shown[i - 1].metrics[metric]?.median ?? null : null;
            return fmt(value) + (i > 0 && value !== null ? pct(pctChange(previous, value)) : '');
        });
        lines.push(`| ${metric} | ${cells.join(' | ')} |`);
    }
    lines.push('');
    for (const note of FOOTNOTES) lines.push(`- ${note}`);
    return lines.join('\n');
}

/** Long-format CSV over every series, one row per (version, metric). */
export function csv(records) {
    const rows = ['machineId,label,workloadHash,version,commit,timestamp,metric,n,median,p90,min'];
    for (const series of groupSeries(records)) {
        for (const record of series) {
            for (const metric of METRICS) {
                const m = record.metrics[metric];
                rows.push([
                    record.env.machineId, JSON.stringify(record.env.label ?? ''), record.harness.workload.hash.slice(0, 12),
                    record.target.describe, (record.target.commit ?? '').slice(0, 12), record.env.timestamp, metric,
                    m?.n ?? '', m?.median ?? '', m?.p90 ?? '', m?.min ?? '',
                ].join(','));
            }
        }
    }
    return rows.join('\n') + '\n';
}

/** The whole report: one Markdown table per series, or CSV. */
export function report(records, { format = 'md', last = 6, machineId = null } = {}) {
    const selected = machineId ? records.filter(r => r.env.machineId === machineId) : records;
    if (selected.length === 0) return machineId ? `No results for machine ${machineId}.\n` : 'No results.\n';
    if (format === 'csv') return csv(selected);
    return groupSeries(selected).map(series => markdownTable(series, { last })).join('\n\n');
}

/** A one-record table, for `run` output. */
export function runTable(record) {
    const lines = ['| metric | median | p90 | min | n |', '|---|---:|---:|---:|---:|'];
    for (const metric of METRICS) {
        const m = record.metrics[metric];
        lines.push(m ? `| ${metric} | ${fmt(m.median)} | ${fmt(m.p90)} | ${fmt(m.min)} | ${m.n} |` : `| ${metric} | - | - | - | - |`);
    }
    return lines.join('\n');
}
