/**
 * The apportionment helpers this package adds to `@mtg/dsl`'s `apportion`.
 *
 * The largest-remainder implementation itself was duplicated here and in
 * `@mtg/deckbuild` until mtg-bc2.134 merged both into `@mtg/dsl`, the one
 * package they both already depend on. What stays is what only a design
 * profile needs: the tuple form callers destructure, and the two roundings
 * that turn a profile's fractional ranges into slot counts.
 */
import { apportion } from '@mtg/dsl';

/** Two-way apportionment with the tuple shape callers actually destructure. */
export function apportionPair(total: number, weights: readonly [number, number]): [number, number] {
  const [first, second] = apportion(total, weights);
  if (first === undefined || second === undefined) {
    throw new Error('apportionPair: apportion returned fewer parts than weights');
  }
  return [first, second];
}

/** Half-up rounding, independent of `Math.round`'s negative-value behavior. */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/** Midpoint of an inclusive range; profile ranges encode rotating slots. */
export function midpoint(min: number, max: number): number {
  return (min + max) / 2;
}

/**
 * `total` seats spread over `capacities`, filled from the last entry down.
 *
 * The counterpart to `apportion` for a total too small for the list it is being
 * spread over. Largest remainder answers "what shape is this", and it cannot
 * answer that at all when the total is smaller than the number of parts:
 * something has to be dropped, and apportionment drops the smallest weights,
 * which are the ends. A curve's ends are its cheapest and its dearest entries,
 * so what comes back is copies of the mode. This fills from the far end
 * instead, so the entries that survive are the dear ones and the front is what
 * gets dropped.
 *
 * Two consumers, both curves, both for one reason: at the tier a set may print
 * a card that wins the game on its own, the end to drop is the cheap one.
 * `skeleton-lite`'s `topOfCurve` seats a color's published creature-curve bucket
 * counts; `@mtg/setgen`'s `spellCurve` seats the published spell-curve weights.
 * A second copy of this walk would be a second answer to which end survives, and
 * a body converted out of a spell slot crosses from one to the other.
 *
 * Nothing is invented: every entry and every ceiling is the caller's own
 * published curve, read from the other end. A remainder the capacities cannot
 * hold goes to the last entry, because a total function needs an answer and that
 * is the end this rule exists to protect. Both callers gate on
 * `total < capacities.length`, which makes the remainder unreachable while every
 * capacity is at least one.
 */
export function seatFromTop(total: number, capacities: readonly number[]): number[] {
  const counts = capacities.map(() => 0);
  let remaining = total;
  for (let index = capacities.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const take = Math.min(remaining, capacities[index] ?? 0);
    counts[index] = take;
    remaining -= take;
  }
  const top = capacities.length - 1;
  if (remaining > 0 && top >= 0) counts[top] = (counts[top] ?? 0) + remaining;
  return counts;
}
