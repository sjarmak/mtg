/**
 * Sweep benchmark: the wall clock of a full round robin at a chosen volume.
 *
 * This is the number ADR-0001 §6.1's throughput kill-test is written against —
 * "10 color-pair matchups times 1,000 seeded games, which is 10^4 games,
 * worker-parallel, on the slice mechanic subset, with the 17lands-superset
 * logger enabled". Ten decks make 45 unordered matchups, so the pinned 10^4
 * total is 223 games per matchup, which is what `--total` defaults to.
 *
 * It plays the balance gate's own decks, built by `buildDeckForPair` from the
 * gate's frozen set, so the wall clock printed here is the wall clock the gate
 * would pay at that volume rather than an analogy to it.
 *
 * Usage:
 *   npx tsx packages/sim/bench/round-robin.ts                    # pinned 10^4 sweep, both modes
 *   npx tsx packages/sim/bench/round-robin.ts --total 10000
 *   npx tsx packages/sim/bench/round-robin.ts --games 120        # today's gate default
 *   npx tsx packages/sim/bench/round-robin.ts --mode pooled --workers 8
 *   npx tsx packages/sim/bench/round-robin.ts --repeat 2         # determinism: same digest twice
 *   npx tsx packages/sim/bench/round-robin.ts --logs off
 */
import { createHash } from 'node:crypto';
import { availableParallelism, cpus } from 'node:os';
import type { DeckList } from '@mtg/kernel';
import { aggregateFingerprint } from '../src/aggregate';
import type { RoundRobinOptions, RoundRobinRun } from '../src/round-robin';
import {
  gamesPerMatchupFor,
  matchupCount,
  PINNED_SWEEP_GAMES,
  runRoundRobin,
  runRoundRobinSerial,
} from '../src/round-robin';
import { withSimPool } from '../src/pool';
import { boolArg, choiceArg, intArg, parseBenchArgs, stringArg } from './args';
import { buildBenchDecks, DEFAULT_SET_PATH, loadSet } from './decks';

const OPTIONS = ['games', 'total', 'workers', 'mode', 'set', 'logs', 'repeat', 'seed'] as const;
const args = parseBenchArgs(process.argv.slice(2), OPTIONS);

const setPath = stringArg(args, 'set', DEFAULT_SET_PATH);
const benchSet = loadSet(setPath);
const decks: readonly DeckList[] = buildBenchDecks(benchSet.pool);

const matchups = matchupCount(decks.length);
const total = intArg(args, 'total', PINNED_SWEEP_GAMES);
const games = intArg(args, 'games', gamesPerMatchupFor(decks.length, total));
const workers = intArg(args, 'workers', availableParallelism());
const mode = choiceArg(args, 'mode', ['serial', 'pooled', 'both'] as const, 'both');
const collectLogs = boolArg(args, 'logs', true);
const repeat = intArg(args, 'repeat', 1);
const runSeed = stringArg(args, 'seed', 'mtg-balance/v0');

const options: RoundRobinOptions = { runSeed, gamesPerMatchup: games, collectLogs };

/**
 * A digest over every match aggregate in schedule order. Two sweeps of the same
 * seed must print the same digest, whatever path or thread count produced them;
 * that is the determinism claim, checked rather than asserted.
 */
function digest(run: RoundRobinRun): string {
  const hash = createHash('sha256');
  for (const match of run.runs) hash.update(aggregateFingerprint(match.aggregate));
  return hash.digest('hex').slice(0, 16);
}

function report(label: string, run: RoundRobinRun): void {
  const seconds = run.elapsedMillis / 1000;
  console.log(
    `${label.padEnd(24)} ${seconds.toFixed(1).padStart(7)} s` +
      `  ${run.gamesPerSecond.toFixed(0).padStart(6)} games/sec` +
      `  ${((run.elapsedMillis * 1000) / run.games).toFixed(0).padStart(6)} us/game` +
      `  ${String(run.games).padStart(6)} games` +
      `  digest=${digest(run)}`,
  );
}

async function main(): Promise<void> {
  const model = cpus()[0]?.model ?? 'unknown CPU';
  console.log(`node ${process.version} · ${model} · ${availableParallelism()} logical cores`);
  console.log(`set ${benchSet.label} · ${benchSet.path}`);
  console.log(
    `${decks.length} decks · ${matchups} matchups x ${games} games = ${matchups * games} games` +
      ` · logs ${collectLogs ? 'on' : 'off'} · ${workers} workers · seed ${runSeed}`,
  );
  console.log('');

  for (let pass = 1; pass <= repeat; pass += 1) {
    const suffix = repeat > 1 ? ` #${pass}` : '';
    if (mode !== 'pooled') report(`serial${suffix}`, runRoundRobinSerial(decks, options));
    if (mode !== 'serial') {
      // Boot cost is measured separately so the sweep number is not a blend of
      // two very different things.
      const booted = Date.now();
      await withSimPool({ workers }, async (pool) => {
        const bootMillis = Date.now() - booted;
        const run = await runRoundRobin(decks, { ...options, pool });
        report(`pooled${suffix}`, run);
        console.log(
          `${''.padEnd(24)} ${(bootMillis / 1000).toFixed(2).padStart(7)} s  pool boot (once per sweep)`,
        );
      });
    }
  }
}

await main();
