/**
 * Two records side by side, with a verdict: did anything get slower than the
 * threshold allows? Meant for the moment before a release tag, against the
 * last saved release on the same machine.
 */
import { METRICS } from './results.mjs';
import { pctChange } from './stats.mjs';

export class CompareError extends Error {}

/**
 * @returns {{ rows: {metric, a, b, change, regressed}[], regressed: string[], skipped: string[] }}
 */
/**
 * A regression is a relative change above `threshold` AND an absolute change of
 * at least `minDelta` (ms or MB): a hover going from 0.2 to 0.3 ms is scheduler
 * noise, not a finding, however large the percentage.
 */
export function compareRecords(a, b, { threshold = 0.2, minDelta = 0.5 } = {}) {
    if (a.harness.workload.hash !== b.harness.workload.hash) {
        throw new CompareError(`workloads differ (${a.harness.workload.hash.slice(0, 12)} vs ${b.harness.workload.hash.slice(0, 12)}); the numbers are not comparable`);
    }
    if (a.env.machineId !== b.env.machineId) {
        throw new CompareError(`machines differ (${a.env.machineId} vs ${b.env.machineId}); the numbers are not comparable`);
    }
    const rows = [];
    const skipped = [];
    for (const metric of METRICS) {
        const va = a.metrics[metric]?.median ?? null;
        const vb = b.metrics[metric]?.median ?? null;
        if (va === null || vb === null) {
            skipped.push(metric);
            continue;
        }
        const change = pctChange(va, vb);
        rows.push({ metric, a: va, b: vb, change, regressed: change !== null && change > threshold && vb - va >= minDelta });
    }
    return { rows, regressed: rows.filter(r => r.regressed).map(r => r.metric), skipped };
}

export function compareTable(a, b, comparison) {
    const f = v => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
    const lines = [
        `| metric | ${a.target.describe} | ${b.target.describe} | change | |`,
        '|---|---:|---:|---:|:--|',
    ];
    for (const row of comparison.rows) {
        const sign = row.change > 0 ? '+' : '';
        lines.push(`| ${row.metric} | ${f(row.a)} | ${f(row.b)} | ${sign}${(row.change * 100).toFixed(1)}% | ${row.regressed ? 'REGRESSED' : ''} |`);
    }
    if (comparison.skipped.length > 0) lines.push('', `Not compared (absent on one side): ${comparison.skipped.join(', ')}`);
    return lines.join('\n');
}
