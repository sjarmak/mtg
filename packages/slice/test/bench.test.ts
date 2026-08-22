/**
 * The benchmark stage: run once, asked three questions.
 *
 * `runBenchStage` plays three whole kernel games, walks 120 decisions into a
 * fourth to get a mid-game position, forks it 500 times, deep-copies it five and
 * reduces 50,000 branches off it (`packages/slice/src/stages/bench.ts`). The
 * three cases below were each calling it with the same `OPTIONS`, so the file
 * measured one thing three times: 1052ms, 968ms and 890ms of a 2913ms file, all
 * three of them the same run. Under a lane wave the first two came back at
 * 3021ms and 2232ms of vitest's 5s default, which is what put this file at the
 * top of mtg-w45's near-limit list.
 *
 * So the stage runs once and the three cases read that one result. **Nothing is
 * checked fewer times**: the three cases read disjoint fields, so every
 * assertion below was already made exactly once and still is. The repeats were
 * not a three-sample check on the timings either — no assertion compared one run
 * to another, and the timing claims are inequalities inside a single result
 * (`deepCopyNanos > forkNanos`, `forkSpeedup > 10`).
 *
 * It is memoized behind a call rather than assigned at module scope, which is
 * the difference between moving the cost and hiding it. Module evaluation
 * happens during collection, where no test budget applies and vitest's 5s clock
 * cannot reach; a stage that hung there would hang the run instead of failing it
 * in five seconds, and that fast failure is the reason AGENTS.md gives for
 * keeping the default in the first place. This way whichever case runs first
 * pays the stage inside its own budget.
 *
 * Both figures were measured on a contended box, three other lanes running, at a
 * 1-minute load average of about 14 on 16 cores — the reporter's own annotation
 * for each run is in mtg-w45. Before: 2913ms across the file. After: 537ms on the
 * first case and under the reporter's print threshold on the other two, 538ms
 * across the file, against the 5,000ms default. What is left is one real game
 * loop, so this file states no budget of its own.
 */
import { describe, expect, it } from 'vitest';
import { FIXTURE_DECK_RW, FIXTURE_DECK_UB } from '@mtg/sim';
import type { BenchStageResult } from '@mtg/slice';
import { runBenchStage, secondsPerRevision } from '@mtg/slice';

const OPTIONS = {
  decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB] as const,
  seed: 'bench-test',
  games: 3,
  forkIterations: 500,
  copyIterations: 5,
};

let measured: BenchStageResult | null = null;

function benchResult(): BenchStageResult {
  measured ??= runBenchStage(OPTIONS);
  return measured;
}

describe('the benchmark stage', () => {
  it('measures throughput on a real game loop', () => {
    const result = benchResult();
    expect(result.benchGames).toBe(3);
    expect(result.kernelGamesPerSecond).toBeGreaterThan(0);
    expect(result.meanTurnsPerGame).toBeGreaterThan(0);
    expect(result.meanDecisionsPerGame).toBeGreaterThan(0);
  });

  it('forks a mid-game position, not an opening one', () => {
    const result = benchResult();
    expect(result.positionTurn).toBeGreaterThan(1);
    expect(result.positionObjects).toBeGreaterThan(0);
    expect(result.positionBytes).toBeGreaterThan(1000);
  });

  it('shows fork costing far less than a detached deep copy', () => {
    const result = benchResult();
    expect(result.forkNanos).toBeGreaterThan(0);
    expect(result.deepCopyNanos).toBeGreaterThan(result.forkNanos);
    expect(result.forkSpeedup).toBeGreaterThan(10);
    expect(result.branchReduceNanos).toBeGreaterThan(0);
  });

  it('reports an unmeasured revision cost as null rather than Infinity', () => {
    expect(secondsPerRevision(0)).toBeNull();
    expect(secondsPerRevision(-1)).toBeNull();
    expect(secondsPerRevision(1000)).toBe(10);
  });
});
