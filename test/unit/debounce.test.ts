import { describe, it, expect, vi } from 'vitest';
import { Debouncer } from '../../src/server/debounce';

/** A controllable clock, so the behaviour is tested without waiting on real time. */
function fakeTimers() {
    let now = 0;
    let nextHandle = 1;
    const scheduled = new Map<number, { at: number; fn: () => void }>();

    const schedule = (fn: () => void, ms: number) => {
        const handle = nextHandle++;
        scheduled.set(handle, { at: now + ms, fn });
        return handle as unknown as ReturnType<typeof setTimeout>;
    };
    const unschedule = (handle: ReturnType<typeof setTimeout>) => {
        scheduled.delete(handle as unknown as number);
    };
    const advance = (ms: number) => {
        now += ms;
        for (const [handle, entry] of [...scheduled]) {
            if (entry.at <= now) {
                scheduled.delete(handle);
                entry.fn();
            }
        }
    };
    return { schedule, unschedule, advance, pendingCount: () => scheduled.size };
}

describe('Debouncer', () => {
    it('runs the action after the delay', () => {
        const timers = fakeTimers();
        const d = new Debouncer(250, timers.schedule, timers.unschedule);
        const action = vi.fn();

        d.run('a', action);
        expect(action).not.toHaveBeenCalled();
        timers.advance(249);
        expect(action).not.toHaveBeenCalled();
        timers.advance(1);
        expect(action).toHaveBeenCalledTimes(1);
    });

    it('collapses a burst into a single run, keeping the latest action', () => {
        const timers = fakeTimers();
        const d = new Debouncer(250, timers.schedule, timers.unschedule);
        const first = vi.fn(), second = vi.fn(), third = vi.fn();

        d.run('doc', first);
        timers.advance(100);
        d.run('doc', second);
        timers.advance(100);
        d.run('doc', third);
        timers.advance(250);

        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();
        expect(third).toHaveBeenCalledTimes(1);
    });

    it('keeps keys independent', () => {
        const timers = fakeTimers();
        const d = new Debouncer(250, timers.schedule, timers.unschedule);
        const a = vi.fn(), b = vi.fn();

        d.run('a', a);
        d.run('b', b);
        timers.advance(250);

        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('cancels a pending run, e.g. when a document closes', () => {
        const timers = fakeTimers();
        const d = new Debouncer(250, timers.schedule, timers.unschedule);
        const action = vi.fn();

        d.run('doc', action);
        expect(d.isPending('doc')).toBe(true);
        d.cancel('doc');
        expect(d.isPending('doc')).toBe(false);
        timers.advance(500);

        expect(action).not.toHaveBeenCalled();
    });

    it('cancelling an unknown key is harmless', () => {
        const timers = fakeTimers();
        const d = new Debouncer(250, timers.schedule, timers.unschedule);
        expect(() => d.cancel('nope')).not.toThrow();
    });

    it('cancels every pending run', () => {
        const timers = fakeTimers();
        const d = new Debouncer(250, timers.schedule, timers.unschedule);
        const a = vi.fn(), b = vi.fn();

        d.run('a', a);
        d.run('b', b);
        d.cancelAll();
        timers.advance(500);

        expect(a).not.toHaveBeenCalled();
        expect(b).not.toHaveBeenCalled();
        expect(timers.pendingCount()).toBe(0);
    });

    it('stops reporting a key as pending once it has run', () => {
        const timers = fakeTimers();
        const d = new Debouncer(250, timers.schedule, timers.unschedule);
        d.run('doc', () => { /* no-op */ });
        timers.advance(250);
        expect(d.isPending('doc')).toBe(false);
    });

    it('can be reused after running', () => {
        const timers = fakeTimers();
        const d = new Debouncer(250, timers.schedule, timers.unschedule);
        const action = vi.fn();

        d.run('doc', action);
        timers.advance(250);
        d.run('doc', action);
        timers.advance(250);

        expect(action).toHaveBeenCalledTimes(2);
    });
});
