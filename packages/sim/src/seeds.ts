/**
 * Seed derivation.
 *
 * Every random draw in a run traces back to one run seed. Game seeds are
 * derived by string composition rather than by advancing a shared generator, so
 * game N's seed does not depend on how many games ran before it — which is what
 * makes a sharded, worker-parallel run produce exactly the aggregates a serial
 * run produces.
 */
import type { PlayerId } from '@mtg/kernel';

/** The kernel RNG seed for game `index` of a run. */
export function gameSeed(runSeed: string, index: number): string {
  return `${runSeed}/game/${index}`;
}

/** The agent-side seed for one seat of one game; never touches the game RNG. */
export function agentSeed(runSeed: string, index: number, seat: PlayerId): string {
  return `${runSeed}/game/${index}/seat/${seat}`;
}

/**
 * Which seat is on the play in game `index`.
 *
 * Alternating keeps the play/draw split even over a run, so the aggregate
 * on-play win rate is a measurement of the format rather than of the pairing.
 */
export function startingPlayerFor(index: number, alternate: boolean): PlayerId {
  if (!alternate) return 0;
  return index % 2 === 0 ? 0 : 1;
}
