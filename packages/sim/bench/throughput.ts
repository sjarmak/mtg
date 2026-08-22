/**
 * Throughput benchmark: games/sec for the tier-1 bots on this hardware.
 *
 * This is one of the two numbers the engine ADR's kill-test is written against
 * (`docs/research/decision-synthesis.md` §4.2): if kernel throughput cannot
 * support 10^4 seeded games per set revision on lab hardware, the pre-authorized
 * native-core escape hatch triggers. So the number this prints is evidence, not
 * decoration — run it and quote the output, do not estimate.
 *
 * Four configurations are measured because they cost very differently:
 *
 *   serial, no log      — the raw kernel + bot loop
 *   serial, with log    — what a metrics run actually pays
 *   parallel, no log    — the mass-sim configuration
 *   parallel, with log  — the balance-CI configuration
 *   serial, fast caps   — the same, with declaration enumeration skipped
 *
 * Usage: `npx tsx packages/sim/bench/throughput.ts [games] [workers]`
 */
import { availableParallelism, cpus } from 'node:os';
import { greedySpec } from '../src/bots';
import { FAST_CAPS } from '../src/driver';
import { FIXTURE_DECK_RW, FIXTURE_DECK_UB } from '../src/fixtures';
import type { MatchSpec } from '../src/match';
import type { MatchRun } from '../src/runner';
import { runMatch, runMatchSerial } from '../src/runner';

const games = Number.parseInt(process.argv[2] ?? '2000', 10);
const workers = Number.parseInt(process.argv[3] ?? String(availableParallelism()), 10);

function baseSpec(runSeed: string, collectLogs: boolean): MatchSpec {
  return {
    runSeed,
    games,
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    bots: [greedySpec('greedy-rw'), greedySpec('greedy-ub')],
    collectLogs,
  };
}

function report(label: string, run: MatchRun): void {
  const perGame = run.elapsedMillis / run.outcomes.length;
  console.log(
    `${label.padEnd(22)} ${run.gamesPerSecond.toFixed(1).padStart(8)} games/sec` +
      `  ${perGame.toFixed(2).padStart(7)} ms/game` +
      `  ${run.elapsedMillis.toString().padStart(6)} ms total` +
      `  meanTurns=${run.aggregate.meanTurns.toFixed(1)}` +
      `  meanDecisions=${run.aggregate.meanDecisions.toFixed(0)}`,
  );
}

async function main(): Promise<void> {
  const model = cpus()[0]?.model ?? 'unknown CPU';
  console.log(`node ${process.version} · ${model} · ${availableParallelism()} logical cores`);
  console.log(`${games} games per configuration, ${workers} workers for the parallel runs\n`);

  // Warm the JIT so the first configuration is not charged for compilation.
  runMatchSerial({ ...baseSpec('warmup', false), games: 50 });

  report('serial, no log', runMatchSerial(baseSpec('bench', false)));
  report('serial, with log', runMatchSerial(baseSpec('bench', true)));
  report('parallel, no log', await runMatch(baseSpec('bench', false), { workers }));
  report('parallel, with log', await runMatch(baseSpec('bench', true), { workers }));
  report('serial, fast caps', runMatchSerial({ ...baseSpec('bench', false), caps: FAST_CAPS }));
  report(
    'parallel, fast caps',
    await runMatch({ ...baseSpec('bench', false), caps: FAST_CAPS }, { workers }),
  );
}

await main();
