/**
 * Snapshot and fork.
 *
 * Because `reduce` never mutates its input, a fork is a *reference*: two
 * callers holding the same `GameState` cannot interfere with each other, and
 * every subsequent reduction rebuilds only the spine of the objects it touched.
 * That makes forking O(1) in state size, which is what rollouts and any future
 * search need (the property Argentum's `gym` module is built around; see
 * `docs/research/prior-art-engines.md` §4).
 *
 * `packages/kernel/bench/fork-bench.ts` measures it against a deep copy so the
 * claim is a number, not an assertion.
 */
import { createHash } from 'node:crypto';
import type { GameState } from './state';

export interface Snapshot {
  readonly label: string;
  readonly state: GameState;
  readonly turn: number;
}

/** O(1): captures the immutable state by reference. */
export function snapshot(state: GameState, label = ''): Snapshot {
  return { label, state, turn: state.turn.number };
}

export function restore(taken: Snapshot): GameState {
  return taken.state;
}

/**
 * O(1): an independent line of play from this position. The returned state is
 * the same object — safe precisely because nothing in the kernel mutates it.
 */
export function fork(state: GameState): GameState {
  return state;
}

/**
 * A genuinely detached copy. Nothing in the kernel needs this — it exists as
 * the benchmark's control and as a debugging aid when an external caller has
 * reached into state and mutated it.
 */
export function deepCopy(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

/** JSON with recursively sorted keys, so hashing is key-order independent. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, entry]) => [key, canonicalize(entry)]));
}

/**
 * Stable hash of a whole position. Two states with the same fingerprint are
 * the same game position; used by tests to prove `reduce` left its input alone.
 */
export function stateFingerprint(state: GameState): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(state)), 'utf8')
    .digest('hex');
}
