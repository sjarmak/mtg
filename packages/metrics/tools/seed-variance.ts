/**
 * How much of a balance reading is the pool, and how much is the dice.
 *
 * The format-health gate runs one sweep at one pinned seed, which is right for a
 * gate: it has to be reproducible, and a gate that rolled its own dice every run
 * would go red on a Tuesday. It is wrong for an *attribution*. A docblock that
 * says "this card cost 0.02 of spread" is comparing two single-seed readings,
 * and until somebody measures the seed-to-seed variance of the statistic there
 * is no way to know whether 0.02 is a card or a coin.
 *
 * So this replays the gate's own sweep — same decks, same volume, same bots,
 * through `round-robin.ts` rather than a second copy of its settings — over N
 * run seeds, and reads every gate the way the gate reads it. It is a measuring
 * instrument, not a gate: it asserts nothing and exits 0.
 *
 *   npx tsx packages/metrics/tools/seed-variance.ts <set.json> [more.json ...]
 *   MTG_SEED_VARIANCE_RUNS=8 npx tsx packages/metrics/tools/seed-variance.ts a.json b.json
 *
 * **Every gate, not two.** It used to print the spread and the ten pair rates,
 * which was exactly the two entries `src/seed-noise.ts` carried, so the one
 * instrument that could add a third could not measure one. It now builds the
 * same `formatHealth` the balance suite builds and records every gate's
 * `observed`, so `length.median`, the mana checkpoints, the decisiveness rates
 * and the ability floors come out of the same run at no extra cost. Each
 * deviation is in that gate's own units — rounds stay rounds, rates stay rates
 * — because that is the unit `gateMargin`'s miss is in and therefore the unit
 * `seedDeviation` has to answer in.
 *
 * The first seed is always `BALANCE_RUN_SEED`, so line one of every pool
 * reproduces what the gate reports for it and a run that disagrees there is a
 * harness problem rather than a variance measurement. Set widths with
 * `MTG_SIM_WORKERS` when other work is on the machine; the sweep takes the whole
 * box by default, which is correct for a deliberate measurement and rude during
 * a wave.
 *
 * Findings recorded from it live where they are argued from: the seed-to-seed
 * standard deviation of `balance.spread` is in `round-robin.ts` beside the seed
 * it varies, the per-gate table it prints is what `src/seed-noise.ts`'s
 * constants come from, and the flagship attribution it was written for is in
 * `@mtg/setgen`'s `archetype/assign.ts`.
 *
 * **It prints three numbers per gate and only one of them is the rule.** The
 * `sd` column is the sample standard deviation of the readings; the `95%`
 * column is the upper confidence bound on the deviation those readings
 * estimate; `rule` is that bound rounded up to `DEVIATION_FIGURES` significant
 * figures, and `rule` is
 * what belongs in `src/seed-noise.ts`. Rounding up the `sd` column instead is
 * the bug `mtg-l81i` filed: an estimate off 24 readings carries about 15% of
 * relative error, so a floor built from it is under the real one about half the
 * time. `deviationBound` is the correction and `BOUND_MIN_READINGS` is where it
 * refuses rather than guessing.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abilityPool, colorPairWinRates, formatHealth } from '@mtg/metrics';
import { BALANCE_RUN_SEED, decksFor, gamesPerMatchup, runRoundRobin } from '../test/balance/round-robin';
import { loadSet } from '../test/balance/set';

const DEFAULT_RUNS = 8;

function runCount(env: NodeJS.ProcessEnv): number {
  const raw = env['MTG_SEED_VARIANCE_RUNS'];
  if (raw === undefined) return DEFAULT_RUNS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`MTG_SEED_VARIANCE_RUNS must be a positive integer, got ${raw}`);
  }
  return parsed;
}

/** The gate's seed first, then derivations of it, so line one is comparable. */
export function seedsFor(runs: number): readonly string[] {
  return Array.from({ length: runs }, (_value, index) =>
    index === 0 ? BALANCE_RUN_SEED : `${BALANCE_RUN_SEED}#${String(index)}`,
  );
}

export function summarize(values: readonly number[]): string {
  if (values.length === 0) return 'no readings';
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return `mean ${mean.toFixed(4)}  sd ${Math.sqrt(variance).toFixed(4)}  ${Math.min(...values).toFixed(4)}-${Math.max(...values).toFixed(4)}`;
}

/**
 * The standard deviation of a set of readings, or `null` under two.
 *
 * Divided by `n - 1`, because these readings are a *sample* of a distribution
 * that has more seeds in it than anybody ran, and the quantity wanted is that
 * distribution's sigma rather than this handful's spread. Dividing by `n`
 * describes the handful exactly and biases the estimate low by
 * `sqrt((n-1)/n)`, which is 2% at 24 seeds and 6% at 8 — small, and in the one
 * direction `../src/seed-noise.ts` says a noise floor must never err.
 */
export function deviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

/** The confidence the deviation bound below is stated at. */
export const BOUND_CONFIDENCE = 0.95;

/**
 * The lower tail of a chi-square distribution, by Wilson-Hilferty.
 *
 * Wanted because a standard deviation computed from `n` readings is itself a
 * draw: at 24 seeds the estimate carries about 15% of relative error, so two
 * honest sweeps of the same pool can report 0.0120 and 0.0155 with nothing
 * having moved. A noise floor set from a point estimate is therefore a floor
 * that is too low about half the time, and too low is the direction that turns
 * the dice into a claim about the set.
 *
 * The exact quantile needs an incomplete-gamma inverse. This is the cube-root
 * normal approximation instead, which is three lines and, measured against the
 * published table at the 5% point, reads 0.03% low at 23 degrees of freedom,
 * 0.6% low at 7 and 2.9% low at 4. `test/balance/seed-variance.test.ts` checks
 * those rather than taking them on faith. Low is the safe side: the quantile is
 * a denominator under the square root, so understating it overstates the bound.
 *
 * It falls apart under about 4 degrees of freedom — at 1 it is off by five
 * orders of magnitude — which is why `deviationBound` refuses to answer there
 * rather than clamping. Five readings is not a lot to bound a sigma from and
 * the right answer at four is that nobody knows.
 */
export function chiSquareLowerQuantile(df: number, tail: number): number {
  if (df < 1) throw new Error(`chiSquareLowerQuantile: df must be at least 1, got ${String(df)}`);
  const z = normalQuantile(tail);
  const h = 2 / (9 * df);
  return df * Math.max(0, 1 - h + z * Math.sqrt(h)) ** 3;
}

/**
 * The standard normal quantile, by Acklam's rational approximation.
 *
 * Six significant figures over the whole line, which is four more than the
 * chi-square approximation above needs. Here rather than from a dependency
 * because `@mtg/metrics` carries none and one constant table is cheaper than
 * one package.
 */
function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new Error(`normalQuantile: p must be in (0, 1), got ${String(p)}`);
  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472,
    2.50662827745924,
  ];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497,
    2.93816398269878,
  ];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const at = (table: readonly number[], index: number): number => table[index] ?? 0;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((at(c, 0) * q + at(c, 1)) * q + at(c, 2)) * q + at(c, 3)) * q + at(c, 4)) * q + at(c, 5)) /
      ((((at(d, 0) * q + at(d, 1)) * q + at(d, 2)) * q + at(d, 3)) * q + 1)
    );
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((at(a, 0) * r + at(a, 1)) * r + at(a, 2)) * r + at(a, 3)) * r + at(a, 4)) * r + at(a, 5)) * q) /
    (((((at(b, 0) * r + at(b, 1)) * r + at(b, 2)) * r + at(b, 3)) * r + at(b, 4)) * r + 1)
  );
}

/** Readings under this bound nothing, because the approximation above cannot. */
export const BOUND_MIN_READINGS = 5;

/**
 * The upper end of the confidence interval on sigma, from `n` readings.
 *
 * `sd * sqrt((n - 1) / chi2_{1-confidence, n-1})`, the textbook interval for a
 * normal sample's variance. What it buys is a floor that survives the next
 * sweep: at 24 seeds the factor is about 1.33, at 8 seeds about 1.80, so a
 * thin study is made to pay for its own thinness instead of quietly reporting
 * a tighter floor than it earned.
 *
 * `null` under `BOUND_MIN_READINGS`, which is the same answer `deviation` gives
 * under two and for the same reason: an estimate nobody can stand behind is not
 * improved by printing it.
 */
export function deviationBound(
  values: readonly number[],
  confidence: number = BOUND_CONFIDENCE,
): number | null {
  const sd = deviation(values);
  if (sd === null || values.length < BOUND_MIN_READINGS) return null;
  const df = values.length - 1;
  return sd * Math.sqrt(df / chiSquareLowerQuantile(df, 1 - confidence));
}

/**
 * The rule `src/seed-noise.ts` states, applied rather than remembered.
 *
 * A rule stated in prose beside a hand-typed number is a rule with nothing
 * checking it, which is how `PAIR_DEVIATION` came to be about twice what its
 * own sentence produced (`mtg-l81i`). Printing the rule's answer next to the
 * measurement means the next person to add an entry copies a computed number
 * instead of estimating one.
 *
 * The rule takes `deviationBound`, not the raw deviation. Rounding up a point
 * estimate was the old sentence and it is the wrong arithmetic: it treats a
 * standard deviation read off 8 or 24 seeds as if it were the parameter rather
 * than an estimate of one, so it produces a floor that the next sweep of the
 * same pool clears about half the time.
 *
 * # Two figures, not a fixed step
 *
 * It used to round up to a flat 0.005, which is a sensible size for a win rate
 * and nothing else. The moment this tool started reporting every gate rather
 * than two, the table began carrying quantities two orders of magnitude apart:
 * `abilities.triggers` is triggers per card drawn, its whole band floor on a
 * quarter-triggered pool is 0.0125, and its measured bound is 0.00108. Rounding
 * that up to 0.005 does not add caution — it hands the gate a noise floor 40%
 * the size of the band it guards, and at any volume under about 1,600 games the
 * gate can no longer fail at all. An absolute step cannot be conservative for
 * two units at once, and the direction it errs in is the one this whole module
 * exists to prevent.
 *
 * So: **round up to two significant figures.** The claim is then the same claim
 * at every scale — this number is good to about a part in twenty — which is
 * also about the resolution a 24-seed estimate has (15% of relative error), and
 * it caps what the rounding itself can inflate a bound by at 11%. The flat step
 * could inflate one by 360%.
 *
 * Ceiling rather than nearest, and the epsilon is why: a bound that lands
 * exactly on two figures is already the answer, and floating error alone should
 * not push 0.01900000000000000004 up to 0.020.
 */
export const DEVIATION_FIGURES = 2;

export function roundedUpToFigures(value: number, figures: number = DEVIATION_FIGURES): number {
  // Zero has no significant figures and `log10(0)` is `-Infinity`; a deviation
  // of zero is a real reading here (four gates report one) and it rounds to
  // itself. Negatives cannot occur — a standard deviation is a square root —
  // and are folded in with it rather than given a branch of their own.
  if (!(value > 0)) return 0;
  const scale = 10 ** (figures - 1 - Math.floor(Math.log10(value)));
  return Math.ceil(value * scale - 1e-9) / scale;
}

/** Every gate's readings across the seeds, keyed by gate id, in gate order. */
export type GateReadings = ReadonlyMap<string, { readonly label: string; readonly values: number[] }>;

/**
 * One row of the per-gate table, in the gate's own units.
 *
 * `unreadable` counts the seeds where the gate had no observation at all —
 * `underSampled` or `notApplicable` — because a deviation over three of eight
 * readings and a deviation over eight are not the same claim and the row has
 * to say which it is. That is also why `bound` and `rounded` can be `null` on a
 * row whose `deviation` is not: under `BOUND_MIN_READINGS` there is a spread to
 * report and no sigma to bound, and `readings` is the column that says so.
 */
export interface DeviationRow {
  readonly id: string;
  readonly label: string;
  readonly readings: number;
  readonly unreadable: number;
  readonly mean: number | null;
  readonly deviation: number | null;
  /** The upper end of the confidence interval on that deviation. */
  readonly bound: number | null;
  readonly rounded: number | null;
}

export function deviationRows(readings: GateReadings, seeds: number): readonly DeviationRow[] {
  return [...readings].map(([id, entry]) => {
    const sd = deviation(entry.values);
    const bound = deviationBound(entry.values);
    const mean =
      entry.values.length === 0
        ? null
        : entry.values.reduce((sum, value) => sum + value, 0) / entry.values.length;
    return {
      id,
      label: entry.label,
      readings: entry.values.length,
      unreadable: seeds - entry.values.length,
      mean,
      deviation: sd,
      bound,
      rounded: bound === null ? null : roundedUpToFigures(bound),
    };
  });
}

/**
 * Five decimals on the three deviation columns, not three or four.
 *
 * The rule rounds to two significant figures and the table spans two orders of
 * magnitude, so three decimals prints `decisiveness.inertTurns`' 0.00068 as
 * 0.001 — a number 47% larger than the rule's answer, in the column whose whole
 * job is to be copied into `src/seed-noise.ts`. A printed table that cannot
 * represent its own rule is the shape of bug this tool was written to end.
 */
function formatRow(row: DeviationRow): string {
  const mean = row.mean === null ? '     n/a' : row.mean.toFixed(4).padStart(8);
  const sd = row.deviation === null ? '      n/a' : row.deviation.toFixed(5).padStart(9);
  const bound = row.bound === null ? '      n/a' : row.bound.toFixed(5).padStart(9);
  const rounded = row.rounded === null ? '      n/a' : row.rounded.toFixed(5).padStart(9);
  const unread = row.unreadable === 0 ? '' : `  (${String(row.unreadable)} seed(s) unreadable)`;
  return `  ${row.id.padEnd(28)} n ${String(row.readings).padStart(2)}  mean ${mean}  sd ${sd}  95% ${bound}  rule ${rounded}${unread}`;
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    throw new Error('seed-variance: give it at least one path to a DSL set file');
  }
  const seeds = seedsFor(runCount(process.env));
  const games = gamesPerMatchup();
  for (const path of paths) {
    const subject = loadSet(path);
    const decks = decksFor(subject.pool, subject.label);
    const pool = abilityPool(subject.pool);
    console.log(`\n${subject.label}  ${String(seeds.length)} seeds x ${String(games)} games/matchup`);
    const spreads: number[] = [];
    const readings = new Map<string, { label: string; values: number[] }>();
    for (const seed of seeds) {
      const run = await runRoundRobin(decks, games, seed);
      const report = colorPairWinRates(run.logs);
      if (report.spread !== null) spreads.push(report.spread);
      const pairs = report.records
        .map(
          (entry) =>
            `${entry.pair} ${entry.winRate.value === null ? 'n/a' : (entry.winRate.value * 100).toFixed(1)}`,
        )
        .join(' ');
      console.log(`  ${seed.padEnd(20)} spread ${report.spread?.toFixed(4) ?? 'n/a'}  ${pairs}`);
      // The same call `format-health.test.ts` makes, so every deviation below
      // is of the statistic the gate reads rather than of a lookalike computed
      // here. `includeMatchups` stays off: the matrix is O(pairs^2) rows and no
      // gate reads it.
      for (const gate of formatHealth(run.logs, { pool, label: subject.label }).gates) {
        const entry = readings.get(gate.id) ?? { label: gate.label, values: [] };
        if (gate.observed !== null) entry.values.push(gate.observed);
        readings.set(gate.id, entry);
      }
    }
    console.log(`  balance.spread over ${String(spreads.length)} seeds: ${summarize(spreads)}`);
    console.log(
      `\n  per-gate seed deviation, each in its own units` +
        ` (rule: 95% upper bound on sigma, rounded up to ${String(DEVIATION_FIGURES)} significant figures)`,
    );
    for (const row of deviationRows(readings, seeds.length)) console.log(formatRow(row));
  }
}

/**
 * `seedsFor` and `summarize` are the two things worth a unit test, and the test
 * that holds them imports this module. Sweeping the committed set on import
 * would make that test a fifteen-second gate on a file it does not exercise, so
 * the run is gated on this being the process's entry point.
 */
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) void main();
