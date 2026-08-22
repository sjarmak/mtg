/**
 * Fork-cost and throughput benchmark.
 *
 * The engine decision (docs/research/decision-synthesis.md §4.2) pre-commits to
 * publishing measured TS-kernel numbers alongside the Forge spike. This script
 * produces two of them:
 *
 *   1. fork cost — how expensive it is to branch a mid-game position, measured
 *      against a real deep copy as the control;
 *   2. throughput — seeded bot-vs-bot games per second, single-threaded.
 *
 * Run: `npx tsx packages/kernel/bench/fork-bench.ts`
 */
import type { Card } from '@mtg/dsl';
import { BASIC_LANDS, exampleCard } from '@mtg/dsl';
import type { DeckList, GameState } from '../src/index';
import { createGame, deepCopy, fork, pendingDecision, playGame, reduce, simpleAgent } from '../src/index';

const MOUNTAIN = BASIC_LANDS[3];
if (MOUNTAIN === undefined) throw new Error('missing Mountain fixture');

function deck(): DeckList {
  const cards: Card[] = [
    ...Array.from({ length: 17 }, () => MOUNTAIN),
    ...Array.from({ length: 10 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
    ...Array.from({ length: 5 }, () => exampleCard('slc-ironclad-golem')),
  ];
  return { name: 'Bench Red', cards };
}

/** Plays a game partway so the benchmark forks a realistic mid-game position. */
function midGameState(decisions: number): GameState {
  const agents = [simpleAgent('a'), simpleAgent('b')] as const;
  let state = createGame({ seed: 'bench-position', decks: [deck(), deck()], maximumTurns: 60 }).state;
  for (let index = 0; index < decisions; index += 1) {
    const decision = pendingDecision(state);
    if (decision === null) break;
    const agent = agents[decision.player];
    state = reduce(state, agent.decide({ state, player: decision.player, decision })).state;
  }
  return state;
}

function describeState(state: GameState): string {
  const objects = Object.keys(state.objects).length;
  const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
  return `turn ${state.turn.number}, ${objects} objects, ${state.battlefield.length} permanents, ${bytes} bytes of JSON`;
}

function timeNs(label: string, iterations: number, run: () => void): number {
  // Warm-up, so the number is steady-state rather than first-call JIT cost.
  for (let index = 0; index < Math.min(iterations, 1000); index += 1) run();
  const started = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) run();
  const elapsed = Number(process.hrtime.bigint() - started);
  const perOp = elapsed / iterations;
  console.log(`${label.padEnd(28)} ${perOp.toFixed(1)} ns/op  (${iterations} iterations)`);
  return perOp;
}

function throughput(games: number): void {
  const started = process.hrtime.bigint();
  let turns = 0;
  let events = 0;
  for (let index = 0; index < games; index += 1) {
    const run = playGame({ seed: `bench-${index}`, decks: [deck(), deck()], maximumTurns: 60 }, [
      simpleAgent('a'),
      simpleAgent('b'),
    ]);
    turns += run.result?.endedOnTurn ?? 0;
    events += run.events.length;
  }
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(`throughput: ${(games / seconds).toFixed(0)} games/sec single-threaded`);
  console.log(
    `            ${(turns / games).toFixed(1)} turns/game, ${(events / games).toFixed(0)} events/game`,
  );
}

function main(): void {
  // `--throughput` measures games/sec in a clean process: the micro-benchmarks
  // below allocate hard enough that GC pressure depresses a number measured
  // after them, so the two are reported separately rather than blended.
  if (process.argv.includes('--throughput')) {
    throughput(1000);
    return;
  }

  const state = midGameState(120);
  console.log(`position: ${describeState(state)}`);
  console.log('');

  let sink = 0;
  const forkNs = timeNs('fork(state)', 5_000_000, () => {
    sink += fork(state).turn.number;
  });
  const copyNs = timeNs('deepCopy(state)', 2_000, () => {
    sink += deepCopy(state).turn.number;
  });
  console.log(`fork is ${(copyNs / forkNs).toFixed(0)}x cheaper than a detached deep copy`);
  console.log('');

  // `fork` itself is free by construction, so the number that actually matters
  // for a rollout is the first reduction on the branch: that is where
  // structural sharing either pays off or does not.
  const priority = state.turn.priority;
  if (priority !== null) {
    timeNs('first reduce on a branch', 200_000, () => {
      sink += reduce(fork(state), { type: 'passPriority', player: priority }).state.turn.number;
    });
  }
  console.log('');
  throughput(200);
  console.log('(run with --throughput in a clean process for the un-GC-taxed number)');
  if (sink === Number.MIN_SAFE_INTEGER) console.log('unreachable');
}

main();
