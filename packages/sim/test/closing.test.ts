/**
 * The regression guard for bead `mtg-bc2.35` — "greedy v0 bots do not close
 * games" — plus the determinism claim the whole balance gate rests on.
 *
 * Two things are asserted here that no unit test can reach:
 *
 *  1. The shipped default profile, playing the balance gate's own decks on the
 *     balance gate's own seed, closes games inside the bands `@mtg/metrics`
 *     grades against. The bands are restated as constants below rather than
 *     imported, because `@mtg/metrics` depends on this package and the cycle is
 *     not worth the convenience; `support/closure-sweep.ts` documents which
 *     gate each constant mirrors and `closure-stats.test.ts` pins the
 *     arithmetic.
 *  2. The same seed produces the same aggregate twice. That is asserted rather
 *     than assumed: a policy that read a clock, a `Set` iteration order or an
 *     unsorted board would pass every unit test in this package and quietly
 *     make the balance gate non-reproducible.
 *
 * The volume is a fraction of the pinned sweep so this stays a unit-suite test.
 * The full 10,035-game numbers come from
 * `npx tsx packages/sim/test/support/control-run.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SimPool } from '@mtg/sim';
import { aggregateFingerprint, createSimPool, DEFAULT_GREEDY_CONFIG, greedyConfig } from '@mtg/sim';
import type { SweepResult } from './support/closure-sweep';
import { closureStats, formatClosure, sweep, sweepOutcomes } from './support/closure-sweep';

/** `DEFAULT_LENGTH_BANDS.maxLongGameShare`. */
const MAX_LONG_GAME_SHARE = 0.15;
/** `DEFAULT_DECISIVENESS_BANDS.maxStallRate`. */
const MAX_STALL_RATE = 0.05;
/** `DEFAULT_DECISIVENESS_BANDS.minDecidedByRound`. */
const MIN_DECIDED_BY_ROUND = 0.9;
/** `DEFAULT_LENGTH_BANDS.medianRounds`. */
const MEDIAN_ROUNDS = { min: 6, max: 13 };

/** 45 matchups, so 900 games: enough to move all three shares off zero. */
const GAMES = 20;

let pool: SimPool;
let shipped: SweepResult;
/** The same profile with the old hold-back-while-winning behavior restored. */
let held: SweepResult;

beforeAll(async () => {
  pool = await createSimPool({});
  shipped = await sweep(DEFAULT_GREEDY_CONFIG, { gamesPerMatchup: GAMES, pool });
  held = await sweep(greedyConfig({ race: { holdBackWhileWinning: true } }), {
    gamesPerMatchup: GAMES,
    pool,
  });
}, 180_000);

afterAll(async () => {
  await pool.close();
});

describe('the default profile closes games', () => {
  it('lands the three mtg-bc2.35 gates inside their bands on the gate decks', () => {
    const stats = closureStats(sweepOutcomes(shipped));
    const detail = formatClosure('default', stats);
    expect(stats.games).toBe(shipped.matchups * GAMES);
    expect(stats.longTail, detail).toBeLessThanOrEqual(MAX_LONG_GAME_SHARE);
    expect(stats.stall, detail).toBeLessThanOrEqual(MAX_STALL_RATE);
    expect(stats.decided, detail).toBeGreaterThanOrEqual(MIN_DECIDED_BY_ROUND);
    expect(stats.medianRounds, detail).toBeGreaterThanOrEqual(MEDIAN_ROUNDS.min);
    expect(stats.medianRounds, detail).toBeLessThanOrEqual(MEDIAN_ROUNDS.max);
  });

  it('closes faster than the profile that holds blockers back while ahead', () => {
    // The control that identified the cause: keeping bodies home on a winning
    // board is what produced the stalled games. Turning that one behavior back
    // on has to make the tail worse, or the fix is somewhere else and this
    // suite is measuring the wrong thing.
    const stubborn = closureStats(sweepOutcomes(held));
    const now = closureStats(sweepOutcomes(shipped));
    const detail = `${formatClosure('shipped', now)} vs ${formatClosure('held', stubborn)}`;
    expect(now.longTail, detail).toBeLessThan(stubborn.longTail);
    expect(now.meanRounds, detail).toBeLessThan(stubborn.meanRounds);
  });
});

describe('the policy change did not cost determinism', () => {
  it('replays the sweep game for game on the same seed', async () => {
    const again = await sweep(DEFAULT_GREEDY_CONFIG, { gamesPerMatchup: GAMES, pool });
    expect(again.runs.map((run) => aggregateFingerprint(run.aggregate))).toEqual(
      shipped.runs.map((run) => aggregateFingerprint(run.aggregate)),
    );
    const strip = (result: SweepResult): unknown =>
      sweepOutcomes(result).map((outcome) => [outcome.seed, outcome.winner, outcome.turns, outcome.reason]);
    expect(strip(again)).toEqual(strip(shipped));
  }, 180_000);

  it('still moves when the race profile moves, so the seed is not the only input', () => {
    expect(held.runs.map((run) => aggregateFingerprint(run.aggregate))).not.toEqual(
      shipped.runs.map((run) => aggregateFingerprint(run.aggregate)),
    );
  });
});
