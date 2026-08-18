/**
 * Collapses rapid repeated work per key.
 *
 * Used for diagnostics: validation is by far the most expensive part of reacting
 * to a keystroke, and squiggles lagging a fraction of a second is invisible,
 * whereas indexing stays immediate so go-to-definition and completion never see a
 * stale index.
 *
 * Timer functions are injectable so the behaviour can be tested without real time.
 */
export class Debouncer {
    private pending = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        private readonly delayMs: number,
        private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
        private readonly unschedule: (handle: ReturnType<typeof setTimeout>) => void = clearTimeout
    ) {}

    /**
     * Run `action` after the delay, replacing any run still pending for `key`.
     * Only the most recent action for a key ever executes.
     */
    run(key: string, action: () => void): void {
        this.cancel(key);
        const handle = this.schedule(() => {
            this.pending.delete(key);
            action();
        }, this.delayMs);
        this.pending.set(key, handle);
    }

    /** Drop any pending run for `key`, e.g. when its document is closed. */
    cancel(key: string): void {
        const handle = this.pending.get(key);
        if (handle !== undefined) {
            this.unschedule(handle);
            this.pending.delete(key);
        }
    }

    /** Drop every pending run. */
    cancelAll(): void {
        for (const key of [...this.pending.keys()]) this.cancel(key);
    }

    /** Whether a run is currently scheduled for `key`. */
    isPending(key: string): boolean {
        return this.pending.has(key);
    }
}
