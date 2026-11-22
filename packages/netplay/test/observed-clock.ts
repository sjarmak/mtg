/**
 * A clock the observed table's tests drive by hand.
 *
 * `ObservedTable` takes its timers through `ObservedClock` so the seating and
 * disconnect deadlines (thirty and ten minutes) can be crossed in a test by
 * one call rather than waited for. Shared by `observed-table.test.ts` and
 * `observed-server.test.ts`.
 */
import type { ObservedClock } from '@mtg/netplay';

export interface FakeClock extends ObservedClock {
  advance(ms: number): void;
}

export function fakeClock(): FakeClock {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { readonly at: number; readonly callback: () => void }>();
  return {
    now: () => now,
    setTimeout: (callback, ms) => {
      next += 1;
      timers.set(next, { at: now + ms, callback });
      return next;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    advance: (ms) => {
      now += ms;
      for (const [handle, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue;
        timers.delete(handle);
        timer.callback();
      }
    },
  };
}
