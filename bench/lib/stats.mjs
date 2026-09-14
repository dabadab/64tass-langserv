/**
 * Summary statistics for benchmark samples.
 *
 * Medians throughout: a single GC pause or a scheduler hiccup moves the p90,
 * never the headline. A mean would let one outlier claim a regression.
 */

/** Sorted copy, ascending. */
function sorted(xs) {
    return [...xs].sort((a, b) => a - b);
}

export function median(xs) {
    if (xs.length === 0) return null;
    const s = sorted(xs);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Nearest-rank percentile, p in [0, 1]. */
export function percentile(xs, p) {
    if (xs.length === 0) return null;
    const s = sorted(xs);
    const rank = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
    return s[rank];
}

/** @returns {{ n: number, median: number, p90: number, min: number, max: number } | null} */
export function summarize(xs) {
    const values = xs.filter(x => typeof x === 'number' && Number.isFinite(x));
    if (values.length === 0) return null;
    return {
        n: values.length,
        median: round(median(values)),
        p90: round(percentile(values, 0.9)),
        min: round(Math.min(...values)),
        max: round(Math.max(...values)),
    };
}

/**
 * Headline across several whole-process runs: the median of the per-run
 * medians, the WORST per-run p90 (conservative), and the best min.
 */
export function medianOfMedians(summaries) {
    const present = summaries.filter(s => s !== null && s !== undefined);
    if (present.length === 0) return null;
    return {
        n: present.reduce((sum, s) => sum + s.n, 0),
        median: round(median(present.map(s => s.median))),
        p90: round(Math.max(...present.map(s => s.p90))),
        min: round(Math.min(...present.map(s => s.min))),
    };
}

/** Relative change from `prev` to `cur`, or null when either is missing or prev is 0. */
export function pctChange(prev, cur) {
    if (prev === null || prev === undefined || cur === null || cur === undefined || prev === 0) return null;
    return (cur - prev) / prev;
}

/** Three decimals is plenty for milliseconds and megabytes. */
export function round(x) {
    return Math.round(x * 1000) / 1000;
}
