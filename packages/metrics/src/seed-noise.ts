/**
 * How far a statistic moves on the seed alone, at the volume a run bought.
 *
 * A win rate measured over one seed is a draw from a distribution, and the
 * balance suite measured that distribution rather than guessing at it. So a
 * spread that missed its band by 0.01 missed it by less than the dice move it,
 * and reporting that as a fact about the *set* is reporting the seed.
 *
 * The measurement is `tools/seed-variance.ts`, which replays the gate's own
 * sweep at N run seeds and reads every gate the way the gate reads it. The
 * table below is that tool's output; `SEED_DEVIATION` says which run and states
 * the rule that turns a column of readings into a constant.
 *
 * The early readings were taken over six to eight seeds and they were noisy in
 * a way nobody accounted for. `mtg-3o1r` recorded the flagship at 0.008 on
 * 2026-08-14 and 0.016 two days later, and read the move as content and builder
 * drift because the prototype reproduced its own earlier number. Half of it was
 * neither: a standard deviation estimated from six readings carries about 30% of
 * relative error, so two honest sweeps of one unchanged pool can differ by that
 * much on the dice alone. That is the bug `mtg-l81i` filed from the other side —
 * the constant looked like twice its own stated rule — and the fix was to stop
 * treating an eight-seed reading as the parameter it estimates.
 *
 * Prose is not the record. The per-subject spread readings are asserted in
 * `test/balance/subjects.ts` and checked by `spreadDrift`, because this docblock
 * had no way to notice it had gone wrong and did not.
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
 * The seeds each deviation below was estimated from.
 *
 * Stated because the rule depends on it. A deviation read off `n` seeds is an
 * estimate, its own error falls as `n` grows, and the bound the rule takes is a
 * function of both — so a table that named its volume and not its sample size
 * would be naming half of what produced it.
 */
export const DEVIATION_MEASURED_OVER_SEEDS = 24;

/**
 * The measured deviations, keyed by gate id.
 *
 * # The rule
 *
 * Each entry is the **95% upper confidence bound** on the statistic's seed-to-
 * seed standard deviation, taken over the worst of the measured subjects and
 * rounded up to two significant figures. Not the standard deviation itself,
 * which is what the old sentence said and what `mtg-l81i` filed as a bug
 * against it.
 *
 * The difference is the whole of that bug. A standard deviation computed from
 * 24 readings carries about 15% of relative error and from 8 readings about
 * 30%, so the estimate is a draw too, and rounding up a draw produces a floor
 * the next sweep of the same unchanged pool clears roughly half the time. The
 * bound charges a thin study for its thinness — the factor is 1.33 at 24 seeds
 * and 1.80 at 8 — which is the same asymmetry `scaledSeedDeviation` argues for
 * volume, applied to the sample instead: a noise floor is allowed to be too
 * wide and is not allowed to be too narrow, because too narrow is the direction
 * that turns the dice into a claim about the set.
 *
 * Worst subject rather than per subject, because a caller holding one run does
 * not know which subject's dice it drew.
 *
 * Two significant figures rather than a step, because these are not all the
 * same unit. The rule used to round up to a flat 0.005, which is a sensible
 * size for a win rate and nothing else, and the table has carried nothing but
 * win rates until now. `abilities.triggers` is triggers per card drawn: its
 * bound is 0.0023 and the whole band floor it guards on a quarter-triggered
 * pool is 0.0125, so a flat step would have handed it a noise floor 40% the
 * size of its band and stopped it failing at all under about 1,600 games.
 * Rounding to figures makes the same claim at every scale — good to about a
 * part in twenty, which is roughly what 24 seeds buy — and caps what the
 * rounding itself inflates a bound by at 11%. `tools/seed-variance.ts`'s
 * `roundedUpToFigures` is the rule, and it is applied rather than remembered:
 * the tool prints what belongs here.
 *
 * # The run
 *
 * 2026-08-27, `MTG_SEED_VARIANCE_RUNS=24` over three pools at 223 games a
 * matchup, which is `DEVIATION_MEASURED_AT_GAMES` apiece: Tideglass Reach (90
 * cards), the flagship set's 79-card build and its 371-card build. The three
 * `balance.spread` bounds came in at 0.0155, 0.0185 and 0.0162, and the worst
 * of the thirty per-pair bounds at 0.0184. The constant this replaces was
 * 0.020, guessed at before anything measured it and then given a derivation
 * that did not produce it; the measurement puts it at 0.019, so it was right to
 * within the rounding and wrong in every word that said why. That is the
 * outcome `mtg-l81i` left open.
 *
 * # Reading a zero
 *
 * A `0` here is a measurement: the statistic did not move across 24 seeds, and
 * four of them did not. It behaves identically to an absent entry — a miss is
 * never smaller than zero, so the gate never abstains — but it claims something
 * an absent entry does not.
 *
 * Everything absent is still `null`: not "zero noise", but "nobody has measured
 * it". The table now covers every gate `formatHealth` emits under the balance
 * config, so the remaining `null`s are a gate added since this run and the mana
 * checkpoints of some other config, whose ids are built from their own turn and
 * land counts (`mana.screw.t3.l2` and the like). Adding an entry means running
 * `packages/metrics/tools/seed-variance.ts` over it first.
 *
 * Two of these were read on two subjects rather than three: Tideglass Reach
 * prints no activated and no triggered ability, so both `abilities.*` arms come
 * back `notApplicable` on it for all 24 seeds. That is the gate working, and it
 * is why those two entries are the thinnest evidence in the table.
 *
 * Units are the gate's own, because that is the unit `gateMargin`'s miss is in.
 * `length.median` and `length.spread` are in rounds and the rest are rates.
 */
const SEED_DEVIATION: Readonly<Record<string, number>> = {
  'length.median': 0,
  'length.spread': 0,
  'length.longTail': 0.0036,
  'onPlay.winRate': 0.0087,
  'mana.screw.t4.l3': 0.0015,
  'mana.screw.t6.l4': 0.0025,
  'mana.flood.t6.l6': 0.0045,
  'decisiveness.stall': 0.0014,
  'decisiveness.deckOut': 0,
  'decisiveness.decided': 0.0026,
  'decisiveness.inertTurns': 0.00068,
  'balance.spread': 0.019,
  'balance.noDominantStrategy': 0,
  'abilities.usage': 0.0017,
  'abilities.triggers': 0.0024,
};

/**
 * A per-pair win rate carries its own deviation; the ids are set-dependent.
 *
 * One number for all ten pairs and all three subjects, by the same rule and for
 * the same reason as the table above: the worst of the thirty bounds measured
 * was 0.0184, on the flagship set's 79-card build at `UB`.
 *
 * The old docblock said a pair "moves about half as much" as the spread does,
 * on the argument that a max minus a min over ten rates inherits the noise of
 * both ends. The 24-seed run contradicts both halves: the worst pair bound is
 * 0.0184 against the worst spread bound of 0.0185, and on Tideglass Reach the
 * worst pair is the noisier of the two. The rates are not independent — every
 * pair plays every other, so a seed that favors racing lifts several at once
 * and a difference of two of them cancels most of what it lifted.
 * `test/balance/round-robin.ts` carries the same correction where it made the
 * same argument.
 */
const PAIR_DEVIATION = 0.019;

/**
 * Every gate id the table above carries, so the rule can be checked against it.
 *
 * The ids and not the numbers: `seedDeviation` stays the one way to read a
 * deviation, and `test/balance/seed-variance.test.ts` walks this list through
 * it to assert that each entry is what `roundedUpToFigures` would have
 * produced. A rule stated in prose beside a hand-typed number is a rule with
 * nothing checking it, which is how `PAIR_DEVIATION` came to be about twice
 * what its own sentence said (`mtg-l81i`). This is the check that was missing.
 *
 * It cannot verify the sweep — nothing short of re-running 24 seeds can — but
 * it catches the two ways an entry goes wrong by hand: a number typed to the
 * old flat step, and a number typed with more precision than the rule admits.
 */
export const MEASURED_DEVIATION_IDS: readonly string[] = Object.keys(SEED_DEVIATION);

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
 * **What counts as a game here is a distinct trajectory.** The square root is
 * the standard error of a sample, and a sample is independent observations, so
 * a caller judging a run that has already happened passes the distinct count
 * (`./sample` `countGames`) and not the total. `./gates` `abstainWithinNoise`
 * is that caller and its parameter is named for it. The one caller that cannot
 * is `tools/set-ab.ts`, which reads a floor for a sweep it has not run yet;
 * what it gets is the floor that volume will have if every game is different,
 * which is the optimistic end and is stated there.
 *
 * Scaling up only. A sweep larger than the pinned one is not given a deviation
 * smaller than the one anybody measured — the study sampled 24 seeds at one
 * volume, and extrapolating it downward past its own resolution would be
 * inventing precision rather than reporting it. That asymmetry is also what keeps the
 * pinned gate sharp: buying more games never widens the band a miss has to
 * clear.
 */
export function scaledSeedDeviation(gateId: string, games: number): number | null {
  const base = seedDeviation(gateId);
  if (base === null) return null;
  if (games <= 0) return base;
  return base * Math.max(1, Math.sqrt(DEVIATION_MEASURED_AT_GAMES / games));
}
