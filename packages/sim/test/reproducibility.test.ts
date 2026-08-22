/**
 * Seed reproducibility.
 *
 * The claim being tested is the one the balance CI depends on: the same run
 * seed produces identical aggregate statistics, every time, on any number of
 * threads. It is asserted, not assumed — including across the serial/parallel
 * boundary, which is where a shared generator or an order-dependent aggregation
 * would show up.
 *
 * The seed is not the only input. A run is a function of the seed *and* the bot
 * profile, so the same boundary is asserted under a non-default profile too: a
 * profile that failed to reach the workers would leave every default-profile
 * assertion here passing.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateFingerprint,
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  gameSeed,
  greedyConfig,
  greedySpec,
  randomSpec,
  runMatch,
  runMatchSerial,
  startingPlayerFor,
  withSimPool,
} from '@mtg/sim';
import type { GreedyBotConfig, MatchRun, MatchSpec } from '@mtg/sim';

function spec(runSeed: string, games = 24): MatchSpec {
  return {
    runSeed,
    games,
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    bots: [greedySpec('greedy-rw'), greedySpec('greedy-ub')],
  };
}

/**
 * Race awareness switched off: the purely local policy the race term replaced
 * under bead `mtg-bc2.35`. Every weight differs from the default, so a run that
 * silently fell back to `DEFAULT_GREEDY_CONFIG.race` cannot coincide with one
 * that honored this.
 */
const LOCAL_ONLY: GreedyBotConfig = greedyConfig({
  race: {
    holdBackWhileWinning: true,
    racingTradeLoss: 0,
    racingBlockPremium: 0,
    losingBlockDiscount: 0,
    threatWeight: 0,
    attackerRemovalBonus: 0,
    blockerRemovalBonus: 0,
  },
});

/**
 * Games of the two runs that played out differently. Compared game by game
 * rather than as a summary, because two runs can reach the same win totals down
 * different lines and a summary would call that "no change".
 */
function divergentGames(a: MatchRun, b: MatchRun): number {
  const line = (run: MatchRun): readonly string[] =>
    run.outcomes.map((outcome) => `${String(outcome.winner)}/${String(outcome.turns)}/${outcome.reason}`);
  const left = line(a);
  const right = line(b);
  return left.filter((entry, index) => entry !== right[index]).length;
}

/**
 * How many of the 48 games must diverge before the profile counts as having
 * reached the workers. The measured figure is 10; the bound sits below it so
 * ordinary retuning does not trip the test, but far enough above zero that a
 * single coincidental difference cannot pass for a profile being honored.
 */
const MINIMUM_DIVERGENT_GAMES = 5;

/**
 * Seven of the eight tests below play whole games — 48 to 192 of them, serially
 * or across four workers — so this file is CPU-bound by nature rather than
 * instant, and it states the budget it actually wants instead of riding
 * vitest's 5s default.
 *
 * Measured on a quiet 16-core box: 0.6s to 2.8s for those seven. The same tests
 * under 24 competing CPU hogs, which is roughly what several agent worktrees
 * running suites at once produce: 1.1s to 6.4s. Under 48: 3.5s to 13.4s.
 *
 * The budget sits on the describe because the three worker tests carried it
 * individually and the four serial ones did not, which was a distinction in how
 * they were written rather than in what they cost. The 24-hog measurement is
 * what settles it: the budgeted worker tests were already over 5s there
 * (6352ms, 5933ms) while their unbudgeted siblings sat at 3164ms and 3546ms,
 * and at 48 hogs those two failed on the default (mtg-bc2.107). Same work, same
 * ceiling.
 *
 * Nothing here raises the default in vitest.config.ts, so a genuine hang
 * anywhere else in the suite still fails in 5s rather than in a minute.
 */
const SIM_BUDGET_MS = 60_000;

describe('seed reproducibility', { timeout: SIM_BUDGET_MS }, () => {
  it('produces identical aggregates across repeats of the same run seed', () => {
    const first = runMatchSerial(spec('repeat'));
    const second = runMatchSerial(spec('repeat'));
    expect(aggregateFingerprint(second.aggregate)).toBe(aggregateFingerprint(first.aggregate));
  });

  it('reproduces every individual game outcome, not just the totals', () => {
    const first = runMatchSerial(spec('per-game'));
    const second = runMatchSerial(spec('per-game'));
    const strip = (run: typeof first): unknown => run.outcomes.map((outcome) => ({ ...outcome, log: null }));
    expect(strip(second)).toEqual(strip(first));
  });

  it('a different run seed produces a different run', () => {
    const a = runMatchSerial(spec('seed-a'));
    const b = runMatchSerial(spec('seed-b'));
    expect(aggregateFingerprint(a.aggregate)).not.toBe(aggregateFingerprint(b.aggregate));
  });

  it('is reproducible with the random-policy bots too', ({ task }) => {
    // Reads back the budget the runner applied: drop the describe option above
    // and this is 5000, so the docblock cannot outlive what it describes.
    expect(task.timeout, 'the games this file plays need their own budget under load').toBe(SIM_BUDGET_MS);

    const random = (runSeed: string): MatchSpec => ({
      ...spec(runSeed, 16),
      bots: [randomSpec('r0'), randomSpec('r1')],
    });
    const first = runMatchSerial(random('random-seed'));
    const second = runMatchSerial(random('random-seed'));
    expect(aggregateFingerprint(second.aggregate)).toBe(aggregateFingerprint(first.aggregate));
    // And a different seed really does move the random bots.
    const other = runMatchSerial(random('random-other'));
    expect(aggregateFingerprint(other.aggregate)).not.toBe(aggregateFingerprint(first.aggregate));
  });

  it('derives game seeds from position, not from run order', () => {
    expect(gameSeed('run', 7)).toBe('run/game/7');
    expect(startingPlayerFor(0, true)).toBe(0);
    expect(startingPlayerFor(1, true)).toBe(1);
    expect(startingPlayerFor(1, false)).toBe(0);
  });

  it('a worker-parallel run aggregates exactly like a serial one', async () => {
    const serial = runMatchSerial(spec('parallel', 48));
    const parallel = await runMatch(spec('parallel', 48), { workers: 4 });
    expect(aggregateFingerprint(parallel.aggregate)).toBe(aggregateFingerprint(serial.aggregate));
    expect(parallel.outcomes.map((outcome) => outcome.index)).toEqual(
      serial.outcomes.map((outcome) => outcome.index),
    );
    expect(parallel.outcomes.map((outcome) => outcome.winner)).toEqual(
      serial.outcomes.map((outcome) => outcome.winner),
    );
  });

  it('shard count does not change the result', async () => {
    const two = await runMatch(spec('shards', 32), { workers: 2 });
    const five = await runMatch(spec('shards', 32), { workers: 5 });
    expect(aggregateFingerprint(five.aggregate)).toBe(aggregateFingerprint(two.aggregate));
  });

  it('carries the opt-in kernel event trace across workers without changing it', async () => {
    const traced: MatchSpec = { ...spec('event-trace', 8), collectEvents: true, collectLogs: true };
    const serial = runMatchSerial(traced);
    const parallel = await runMatch(traced, { workers: 2 });
    expect(parallel.outcomes.map((outcome) => outcome.events)).toEqual(
      serial.outcomes.map((outcome) => outcome.events),
    );
    expect(serial.outcomes.every((outcome) => (outcome.events?.length ?? 0) > 0)).toBe(true);
  });

  /**
   * The race profile is part of the bot's profile, so it crosses the worker
   * boundary inside the `BotSpec` like every other weight. Both halves are
   * asserted together because either alone is satisfiable by a bug: agreement
   * alone holds trivially when both sides quietly run the default profile, and
   * a difference alone would not prove the workers saw the profile the serial
   * run did.
   */
  it('carries a non-default race profile into the workers and still agrees with serial', async () => {
    const base = spec('race-profile', 48);
    const tuned: MatchSpec = {
      ...base,
      bots: [greedySpec('greedy-rw', LOCAL_ONLY), greedySpec('greedy-ub', LOCAL_ONLY)],
    };
    const serialDefault = runMatchSerial(base);
    const serialTuned = runMatchSerial(tuned);
    const pooled: readonly MatchRun[] = await withSimPool({ workers: 4 }, (pool) =>
      pool.runMatches([base, tuned]),
    );
    const [pooledDefault, pooledTuned] = pooled;
    if (pooledDefault === undefined || pooledTuned === undefined) {
      throw new Error('the pool did not return both runs');
    }

    expect(aggregateFingerprint(pooledDefault.aggregate)).toBe(aggregateFingerprint(serialDefault.aggregate));
    expect(aggregateFingerprint(pooledTuned.aggregate)).toBe(aggregateFingerprint(serialTuned.aggregate));
    expect(divergentGames(pooledDefault, pooledTuned)).toBeGreaterThanOrEqual(MINIMUM_DIVERGENT_GAMES);
  });
});
