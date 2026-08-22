/**
 * Stage 5 — the two numbers the engine ADR's kill-tests are written against.
 *
 * `decision-synthesis.md` §4.2 pre-commits to publishing measured TS-kernel
 * throughput and fork cost alongside the Forge spike, and §7.3 makes the
 * threshold (10^4 seeded games per set revision on lab hardware) a written gate
 * before the go/no-go memo. So these are measured on every slice run and
 * carried into the summary, not estimated in prose afterwards.
 *
 * Two throughput numbers exist for a reason and must not be conflated: this
 * stage measures the *raw kernel* loop (scoring agent, no replay logging), and
 * the simulation stage measures what a balance revision actually pays (greedy
 * bots, logging on). The kill-test is written against the workload, so the memo
 * quotes the simulation number and this one as its ceiling.
 */
import type { DeckList, GameState } from '@mtg/kernel';
import { createGame, deepCopy, fork, pendingDecision, playGame, reduce, simpleAgent } from '@mtg/kernel';
import { failStage } from '../errors';

export interface BenchStageResult {
  readonly benchGames: number;
  /** Single-threaded, no replay logging, kernel's own scoring agent. */
  readonly kernelGamesPerSecond: number;
  readonly meanTurnsPerGame: number;
  readonly meanDecisionsPerGame: number;
  /** The forked position, so the numbers below can be read in context. */
  readonly positionTurn: number;
  readonly positionObjects: number;
  readonly positionBytes: number;
  readonly forkNanos: number;
  readonly deepCopyNanos: number;
  /** How many times cheaper `fork` is than a detached deep copy. */
  readonly forkSpeedup: number;
  /** First reduction on a branch: where structural sharing pays off or does not. */
  readonly branchReduceNanos: number;
}

export interface BenchStageOptions {
  readonly decks: readonly [DeckList, DeckList];
  readonly seed: string;
  readonly games: number;
  readonly forkIterations: number;
  readonly copyIterations: number;
}

const POSITION_DECISIONS = 120;
const BRANCH_REDUCE_ITERATIONS = 50_000;

function timeNanos(iterations: number, run: () => number): number {
  if (iterations <= 0) failStage('bench', 'a timing loop needs at least one iteration');
  let sink = 0;
  const warmup = Math.min(iterations, 1_000);
  for (let index = 0; index < warmup; index += 1) sink += run();
  const started = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) sink += run();
  const elapsed = Number(process.hrtime.bigint() - started);
  // `sink` exists so the optimizer cannot delete the work being timed.
  if (!Number.isFinite(sink)) failStage('bench', 'the timing loop produced a non-finite result');
  return elapsed / iterations;
}

/** Plays partway so the fork benchmark branches a realistic mid-game position. */
function midGamePosition(options: BenchStageOptions): GameState {
  const agents = [simpleAgent('bench-a'), simpleAgent('bench-b')] as const;
  let state = createGame({ seed: `${options.seed}/position`, decks: options.decks, maximumTurns: 60 }).state;
  for (let index = 0; index < POSITION_DECISIONS; index += 1) {
    const decision = pendingDecision(state);
    if (decision === null) break;
    const agent = agents[decision.player];
    state = reduce(state, agent.decide({ state, player: decision.player, decision })).state;
  }
  return state;
}

function throughput(options: BenchStageOptions): {
  readonly gamesPerSecond: number;
  readonly meanTurns: number;
  readonly meanDecisions: number;
} {
  const agents = [simpleAgent('bench-a'), simpleAgent('bench-b')] as const;
  let turns = 0;
  let decisions = 0;
  const started = process.hrtime.bigint();
  for (let index = 0; index < options.games; index += 1) {
    const run = playGame(
      { seed: `${options.seed}/bench-${index}`, decks: options.decks, maximumTurns: 60 },
      agents,
    );
    turns += run.result?.endedOnTurn ?? 0;
    decisions += run.decisions;
  }
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  if (seconds <= 0) failStage('bench', 'the throughput loop measured zero elapsed time');
  return {
    gamesPerSecond: options.games / seconds,
    meanTurns: turns / options.games,
    meanDecisions: decisions / options.games,
  };
}

export function runBenchStage(options: BenchStageOptions): BenchStageResult {
  const position = midGamePosition(options);
  const bytes = Buffer.byteLength(JSON.stringify(position), 'utf8');

  const forkNanos = timeNanos(options.forkIterations, () => fork(position).turn.number);
  const deepCopyNanos = timeNanos(options.copyIterations, () => deepCopy(position).turn.number);

  const priority = position.turn.priority;
  const branchReduceNanos =
    priority === null
      ? 0
      : timeNanos(
          BRANCH_REDUCE_ITERATIONS,
          () => reduce(fork(position), { type: 'passPriority', player: priority }).state.turn.number,
        );

  const measured = throughput(options);
  return {
    benchGames: options.games,
    kernelGamesPerSecond: measured.gamesPerSecond,
    meanTurnsPerGame: measured.meanTurns,
    meanDecisionsPerGame: measured.meanDecisions,
    positionTurn: position.turn.number,
    positionObjects: Object.keys(position.objects).length,
    positionBytes: bytes,
    forkNanos,
    deepCopyNanos,
    forkSpeedup: forkNanos === 0 ? 0 : deepCopyNanos / forkNanos,
    branchReduceNanos,
  };
}
