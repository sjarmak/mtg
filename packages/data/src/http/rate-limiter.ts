/**
 * Per-host minimum-interval limiter.
 *
 * Scryfall's documented limits are per-endpoint-class, not per-connection, and
 * they warn that ignoring 429s risks a permanent ban. A serialized queue per
 * host is the simplest thing that cannot exceed the documented rate: each
 * acquisition waits until `minIntervalMs` has elapsed since the previous one.
 */
import { DEFAULT_MIN_INTERVAL_MS, HOST_MIN_INTERVAL_MS } from '../config';

export interface Limiter {
  /** Resolves when the caller may issue its request to `host`. */
  acquire(host: string): Promise<void>;
  /** Delays every future acquisition on `host` by at least `ms`. */
  penalize(host: string, ms: number): void;
}

interface HostState {
  /** Wall-clock ms after which the next request may go out. */
  nextAllowedAt: number;
  /** Tail of the serialized queue for this host. */
  chain: Promise<void>;
}

export function minIntervalFor(host: string): number {
  return HOST_MIN_INTERVAL_MS[host] ?? DEFAULT_MIN_INTERVAL_MS;
}

const delay = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param sleep injectable for tests; defaults to real `setTimeout`.
 * @param clock injectable monotonic-ish source; defaults to `Date.now`.
 */
export function createLimiter(
  sleep: (ms: number) => Promise<void> = delay,
  clock: () => number = Date.now,
): Limiter {
  const hosts = new Map<string, HostState>();

  const stateFor = (host: string): HostState => {
    const existing = hosts.get(host);
    if (existing !== undefined) return existing;
    const created: HostState = { nextAllowedAt: 0, chain: Promise.resolve() };
    hosts.set(host, created);
    return created;
  };

  return {
    acquire(host: string): Promise<void> {
      const state = stateFor(host);
      const interval = minIntervalFor(host);
      const gated = state.chain.then(async () => {
        const wait = state.nextAllowedAt - clock();
        if (wait > 0) await sleep(wait);
        state.nextAllowedAt = clock() + interval;
      });
      // Swallow rejections on the chain itself so one failure cannot poison the
      // queue for later callers; the awaited promise still surfaces to them.
      state.chain = gated.then(
        () => undefined,
        () => undefined,
      );
      return gated;
    },

    penalize(host: string, ms: number): void {
      const state = stateFor(host);
      state.nextAllowedAt = Math.max(state.nextAllowedAt, clock() + ms);
    },
  };
}
