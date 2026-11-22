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
import {
  chiSquareLowerQuantile,
  deviation,
  deviationBound,
  roundedUpToFigures,
  seedsFor,
  summarize,
} from '../../tools/seed-variance';
import { MEASURED_DEVIATION_IDS, seedDeviation } from '../../src/seed-noise';
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

  it('estimates the distribution’s sigma, not the handful’s spread', () => {
    // n - 1. Over [1, 2, 3] the sample deviation is 1 and the population one is
    // 0.8165, and the difference is the whole reason this is asserted: the
    // second answers "how spread out are these three numbers", which is not the
    // question a noise floor asks.
    expect(deviation([1, 2, 3])).toBeCloseTo(1, 12);
    expect(deviation([0.1, 0.1, 0.1])).toBeCloseTo(0, 12);
    expect(deviation([0.1])).toBeNull();
    expect(deviation([])).toBeNull();
  });

  it('matches the published chi-square table at four widths', () => {
    // Wilson-Hilferty is an approximation and this is the check that it is a
    // good enough one, at the widths this tool reaches. Exact lower 5% points,
    // from the standard table. The error grows as the sample thins, so the
    // tolerance is per width rather than one number covering all three.
    //
    for (const [df, exact, tolerance] of [
      [4, 0.7107, 0.03],
      [7, 2.167, 0.007],
      [23, 13.091, 0.001],
      [100, 77.929, 0.001],
    ] as const) {
      const error = (chiSquareLowerQuantile(df, 0.05) - exact) / exact;
      expect(Math.abs(error), `df ${String(df)} is ${(error * 100).toFixed(3)}% off`).toBeLessThan(tolerance);
    }

    // The sign matters where the error is big enough to have one. The quantile
    // is a denominator under a square root in `deviationBound`, so reading low
    // makes the bound wider, and wide is the direction a noise floor is allowed
    // to be wrong in. That holds at the thin widths, which is where the error
    // is worth caring about; by 100 df the approximation agrees with the table
    // to five parts per million, which is finer than the table is printed, so
    // its sign there is the table's rounding rather than the method's bias.
    for (const df of [4, 7, 23]) {
      const exact = df === 4 ? 0.7107 : df === 7 ? 2.167 : 13.091;
      expect(chiSquareLowerQuantile(df, 0.05), `df ${String(df)} reads high`).toBeLessThan(exact);
    }
    expect(() => chiSquareLowerQuantile(0, 0.05)).toThrow(/at least 1/);
  });

  it('makes a thin study pay for its own thinness', () => {
    // The bound is sd times a factor that depends only on how many readings
    // bought it, so the same measured spread earns a wider floor at 8 seeds
    // than at 24. That ordering is the point: a study nobody repeated should
    // not report the same confidence as one somebody did.
    const spread = (n: number): number[] => Array.from({ length: n }, (_v, i) => (i % 2 === 0 ? 0.1 : 0.2));
    const eight = deviationBound(spread(8)) ?? 0;
    const twentyFour = deviationBound(spread(24)) ?? 0;
    const sd = deviation(spread(24)) ?? 0;
    expect(eight).toBeGreaterThan(twentyFour);
    expect(twentyFour).toBeGreaterThan(sd);
    expect(twentyFour / sd).toBeCloseTo(1.33, 1);
    // Four readings is where the approximation stops being one, so the bound
    // refuses rather than returning the number it would have computed.
    expect(deviationBound(spread(4))).toBeNull();
    expect(deviation(spread(4))).not.toBeNull();
    expect(deviationBound([0.1])).toBeNull();
  });

  it('rounds a bound up to two figures, and leaves one already on two alone', () => {
    expect(roundedUpToFigures(0.0136)).toBeCloseTo(0.014, 12);
    expect(roundedUpToFigures(0.014)).toBeCloseTo(0.014, 12);
    expect(roundedUpToFigures(0.0141)).toBeCloseTo(0.015, 12);
    expect(roundedUpToFigures(0)).toBe(0);
  });

  it('claims the same relative precision of a rate and of a rate a hundredth its size', () => {
    // The reason the rule is figures and not a step. `abilities.triggers` is
    // triggers per card drawn and its bound is 0.00108; a flat 0.005 would have
    // inflated it by 360% and handed the gate a noise floor 40% the size of the
    // band it guards. Two figures costs at most 11% at any scale.
    for (const bound of [0.0185, 0.00108, 0.867, 4.03]) {
      const rounded = roundedUpToFigures(bound);
      expect(rounded, `${String(bound)} rounded down`).toBeGreaterThanOrEqual(bound);
      expect(rounded / bound, `${String(bound)} inflated too far`).toBeLessThan(1.12);
    }
  });

  it('rounds a bound that is already an exact power of ten to itself', () => {
    // `log10` is exact on these and the ceiling has nothing to do, which is the
    // input most likely to come back one step high off a floating error.
    expect(roundedUpToFigures(0.01)).toBeCloseTo(0.01, 12);
    expect(roundedUpToFigures(0.1)).toBeCloseTo(0.1, 12);
    expect(roundedUpToFigures(1)).toBeCloseTo(1, 12);
  });

  it('holds every entry in the noise table to the rule the table states', () => {
    // The check `mtg-l81i` found missing. It cannot re-run the sweep, so it
    // cannot say an entry is the right measurement; it says every entry is a
    // number the rule could have produced, which is what rules out both ways a
    // hand-typed one goes wrong — a leftover from the flat 0.005 step, and a
    // bound copied over at more precision than 24 seeds buy.
    expect(MEASURED_DEVIATION_IDS.length).toBeGreaterThan(0);
    for (const id of [...MEASURED_DEVIATION_IDS, 'balance.pair.WU']) {
      const entry = seedDeviation(id);
      expect(entry, `${id} is in the table and reads back null`).not.toBeNull();
      if (entry === null) continue;
      expect(entry, `${id} is negative`).toBeGreaterThanOrEqual(0);
      expect(roundedUpToFigures(entry), `${id} is not on two significant figures`).toBeCloseTo(entry, 12);
    }
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
