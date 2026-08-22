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
 * run seeds, and prints every pair's win rate and the spread for each. It is a
 * measuring instrument, not a gate: it asserts nothing and exits 0.
 *
 *   npx tsx packages/metrics/tools/seed-variance.ts <set.json> [more.json ...]
 *   MTG_SEED_VARIANCE_RUNS=8 npx tsx packages/metrics/tools/seed-variance.ts a.json b.json
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
 * it varies, and the flagship attribution it was written for is in
 * `@mtg/setgen`'s `archetype/assign.ts`.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { colorPairWinRates } from '@mtg/metrics';
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
    console.log(`\n${subject.label}  ${String(seeds.length)} seeds x ${String(games)} games/matchup`);
    const spreads: number[] = [];
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
    }
    console.log(`  balance.spread over ${String(spreads.length)} seeds: ${summarize(spreads)}`);
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
