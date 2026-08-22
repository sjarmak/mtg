/**
 * How far a statistic moves on the seed alone, at the volume a run bought.
 *
 * A win rate measured over one seed is a draw from a distribution, and the
 * balance suite measured that distribution rather than guessing at it: across
 * six to eight seeds at the pinned volume, the win-rate spread moved with a
 * standard deviation of 0.008 to 0.019 depending on the subject and on when it
 * was asked, and a single color pair's win rate with a standard deviation of
 * about 0.01. So a spread that missed its band by 0.01 missed it by less than
 * the dice move it, and reporting that as a fact about the *set* is reporting
 * the seed.
 *
 * The range widened on 2026-08-16 under `mtg-3o1r`, and how it widened is worth
 * keeping: the low end, 0.008, was the flagship's reading on 2026-08-14, and
 * re-measuring the same fixture path two days later gave 0.016 around a mean
 * that had moved from 0.117 to 0.165. The prototype pool reproduced its earlier
 * reading exactly over the same six seeds, so this is content and builder
 * movement rather than the sweep getting louder. The constants below did not
 * have to change — 0.019 still rounds up to 0.02 — which is the only reason a
 * stale derivation went two days without consequences. Do not read that as the
 * derivation being safe to leave in prose: the numbers here are now asserted
 * per subject in `test/balance/subjects.ts` and checked by `spreadDrift`,
 * because this docblock had no way to notice it had gone wrong.
 *
 * This module holds only the numbers and the scaling. What a run does with them
 * is `./gates`' `abstainWithinNoise`, and why it does that is written there.
 * The split is an import direction rather than a preference: `./fairness`
 * reads `./gates`, so the arithmetic both of them need cannot live in either.
 * The exports are re-exported from `./fairness`, where every caller has always
 * found them.
 */

/**
 * The sweep volume the deviations below were measured over.
 *
 * The balance suite runs 10,035 games, and that is the run its seed-variance
 * study sampled. The number matters because the deviations are not properties
 * of the statistic alone — they are properties of the statistic at a sample
 * size, and a smaller sweep moves further on the same dice.
 */
export const DEVIATION_MEASURED_AT_GAMES = 10_035;

/**
 * The measured deviations, keyed by gate id.
 *
 * Two entries, because two are what anybody has measured. `balance.spread` is
 * an extreme order statistic over ten pair win rates and moves most; a single
 * pair's rate moves about half as much. Both are rounded up from the measured
 * standard deviations to the nearest 0.005 and stated as one number rather
 * than per subject, because a caller holding one run does not know which
 * subject's dice it drew.
 *
 * Everything absent from this table is `null`: not "zero noise", but "nobody
 * has measured it", which is a different claim and the only defensible one.
 * Adding an entry means running `packages/metrics/tools/seed-variance.ts` over
 * it first.
 */
const SEED_DEVIATION: Readonly<Record<string, number>> = {
  'balance.spread': 0.02,
};

/** A per-pair win rate carries its own deviation; the ids are set-dependent. */
const PAIR_DEVIATION = 0.02;

/** The baseline deviation of a statistic, at `DEVIATION_MEASURED_AT_GAMES`. */
export function seedDeviation(gateId: string): number | null {
  if (gateId.startsWith('balance.pair.')) return PAIR_DEVIATION;
  return SEED_DEVIATION[gateId] ?? null;
}

/**
 * The same deviation, at the volume this run actually bought.
 *
 * A rate's standard error falls as the square root of the sample, so a sweep a
 * quarter the size moves twice as far on the seed alone. Stating the pinned
 * number over a smaller run understates the dice by exactly that factor, and
 * understating them is the direction that hurts: it marks a miss as a fact
 * about the *set* when another seed would have put it either way. `npm run
 * analyze` defaults to 2,700 games, well under the pinned volume, so this is
 * the ordinary case rather than the exotic one.
 *
 * Scaling up only. A sweep larger than the pinned one is not given a deviation
 * smaller than the one anybody measured — the study sampled eight seeds, and
 * extrapolating it downward past its own resolution would be inventing
 * precision rather than reporting it. That asymmetry is also what keeps the
 * pinned gate sharp: buying more games never widens the band a miss has to
 * clear.
 */
export function scaledSeedDeviation(gateId: string, games: number): number | null {
  const base = seedDeviation(gateId);
  if (base === null) return null;
  if (games <= 0) return base;
  return base * Math.max(1, Math.sqrt(DEVIATION_MEASURED_AT_GAMES / games));
}
