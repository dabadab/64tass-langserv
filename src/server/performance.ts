export interface PerformanceMetrics {
    operation: string;
    durationMs: number;
    details?: Record<string, any>;
}

export class PerformanceMonitor {
    private metrics: PerformanceMetrics[] = [];
    private enabled: boolean = false;

    enable(): void {
        this.enabled = true;
        this.metrics = [];
    }

    disable(): void {
        this.enabled = false;
    }

    measure<T>(operation: string, fn: () => T, details?: Record<string, any>): T {
        if (!this.enabled) {
            return fn();
        }

        const start = performance.now();
        const result = fn();
        const durationMs = performance.now() - start;

        this.metrics.push({ operation, durationMs, details });
        return result;
    }

    async measureAsync<T>(operation: string, fn: () => Promise<T>, details?: Record<string, any>): Promise<T> {
        if (!this.enabled) {
            return await fn();
        }

        const start = performance.now();
        const result = await fn();
        const durationMs = performance.now() - start;

        this.metrics.push({ operation, durationMs, details });
        return result;
    }

    getMetrics(): PerformanceMetrics[] {
        return [...this.metrics];
    }

    getSummary(): Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number }> {
        const summary: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number }> = {};

        for (const metric of this.metrics) {
            if (!summary[metric.operation]) {
                summary[metric.operation] = {
                    count: 0,
                    totalMs: 0,
                    avgMs: 0,
                    minMs: Infinity,
                    maxMs: -Infinity
                };
            }

            const s = summary[metric.operation];
            s.count++;
            s.totalMs += metric.durationMs;
            s.minMs = Math.min(s.minMs, metric.durationMs);
            s.maxMs = Math.max(s.maxMs, metric.durationMs);
        }

        for (const op in summary) {
            summary[op].avgMs = summary[op].totalMs / summary[op].count;
        }

        return summary;
    }

    clear(): void {
        this.metrics = [];
    }
}

// Global instance
export const perfMonitor = new PerformanceMonitor();
