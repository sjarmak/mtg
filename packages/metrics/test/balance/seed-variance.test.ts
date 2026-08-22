/**
 * The seed seam under `packages/metrics/tools/seed-variance.ts`.
 *
 * That tool exists to say how much of a balance reading is the dice, and the
 * numbers it produced are now written into `round-robin.ts` and into
 * `@mtg/setgen`'s `archetype/assign.ts` as the reason a flagship attribution is
 * believed. All of it rests on one thing being true: that the seed argument
 * reaches the sweep. A `runRoundRobin` that quietly ignored it would report a
 * standard deviation of zero, which reads as "the statistic is perfectly stable"
 * — the most confident possible version of exactly the wrong answer, and one
 * nothing else in the suite would notice.
 *
 * So this asserts the two halves of that seam: different seeds play different
 * games, and one seed still plays the same games twice. Deliberately tiny (two
 * games a matchup against the pinned 223) because it is testing wiring, not
 * format health; the gate next door is the one that measures a pool.
 */
import { describe, expect, it } from 'vitest';
import { seedsFor, summarize } from '../../tools/seed-variance';
import { BALANCE_RUN_SEED, decksFor, runRoundRobin } from './round-robin';
import { loadSet } from './set';
import { COMMITTED_SET_PATH } from './subjects';

const GAMES = 2;
const subject = loadSet(COMMITTED_SET_PATH);
const decks = decksFor(subject.pool, subject.label);

/** Winners in play order: the cheapest thing that changes when the dice do. */
function outcomes(logs: readonly { readonly extras: { readonly sim_winner: unknown } }[]): string {
  return logs.map((log) => String(log.extras.sim_winner)).join(',');
}

describe('seed variance', () => {
  it('starts at the gate’s own seed, so the first reading is comparable', () => {
    const seeds = seedsFor(4);
    expect(seeds[0]).toBe(BALANCE_RUN_SEED);
    expect(new Set(seeds).size).toBe(4);
  });

  it('refuses to report a variance over one reading as a range', () => {
    expect(summarize([])).toBe('no readings');
    expect(summarize([0.1, 0.1])).toContain('sd 0.0000');
    expect(summarize([0.1, 0.2])).toContain('mean 0.1500');
  });

  it('plays different games under a different seed', async () => {
    const first = await runRoundRobin(decks, GAMES, BALANCE_RUN_SEED);
    const second = await runRoundRobin(decks, GAMES, `${BALANCE_RUN_SEED}#1`);
    expect(outcomes(second.logs)).not.toBe(outcomes(first.logs));
  });

  it('plays the same games twice under one seed, so a reading is reproducible', async () => {
    const first = await runRoundRobin(decks, GAMES, BALANCE_RUN_SEED);
    const again = await runRoundRobin(decks, GAMES, BALANCE_RUN_SEED);
    expect(outcomes(again.logs)).toBe(outcomes(first.logs));
  });

  it('defaults to the seed the gate pins, so an omitted argument is not a new run', async () => {
    const explicit = await runRoundRobin(decks, GAMES, BALANCE_RUN_SEED);
    const defaulted = await runRoundRobin(decks, GAMES);
    expect(outcomes(defaulted.logs)).toBe(outcomes(explicit.logs));
  });
});
