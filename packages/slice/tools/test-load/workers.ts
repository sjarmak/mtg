/**
 * How many test workers this run takes.
 *
 * The problem this answers is not that any test is slow. Measured on this box
 * (16 cores) during a five-lane wave, with every duration taken from the same
 * `--project unit` run:
 *
 * | workers          | wall clock | timeout failures |
 * | ---------------- | ---------- | ---------------- |
 * | 15 (Vitest base) | 151s       | 0                |
 * | 12               | 128s       | 0                |
 * | 8                | 120s       | 0                |
 * | 4                | 265s       | 0                |
 *
 * Half the cores was the fastest arm under contention; a quarter more than
 * doubled the wall clock. The prior load-at-start heuristic still chose fifteen
 * workers at a 1-minute load of 10.1, and that run was 26% slower than eight.
 * A worker under contention is not a unit of throughput, it is one more claim
 * on cores already spoken for, and the queueing lands on whichever test happens
 * to be holding the 5s default.
 *
 * **What that table covers, and what it does not** (`mtg-a3ix4`). Each row is
 * one measured run's pool size against whatever else the box was carrying, and
 * that was other lanes' runs from before any cap existed. So it says what one
 * capped run gains against neighbors that are not capped.
 * It does not say what a half-machine cap does when every neighbor applies the
 * same cap, because then the box carries the sum of the caps and each run
 * believes it has half the cores to itself. Three worker slots each taking
 * eight is twenty-four workers on sixteen cores, before the Chrome and Xvfb
 * each browser file starts; the batch-6 gate ran at load 84 and reported
 * twenty-three red files, seventeen of them outside the base's recorded red
 * list and all seventeen green alone at load 16 to 26. The table is no
 * evidence for how many workers one run should take beside two others, and
 * nothing here measures that case. What follows from it is the budget: half the
 * cores, once, divided among the runs sharing them.
 *
 * What this is not: it is not a timeout, and it moves no test's budget. Every
 * test still fails at exactly the number its call site states, and a test that
 * has genuinely become slow still goes red at the same threshold it always did.
 * This changes how much of the machine the run asks for, which is the one lever
 * that makes tests finish sooner rather than letting them run longer.
 */
import { type ForgeRequiredEnv, isForgeRequiredRun } from './host-lock';

/** Vitest's own choice, from `createForksPool`: one worker short of the cores. */
export function vitestDefaultWorkers(cores: number): number {
  return Math.max(1, cores - 1);
}

/**
 * The share of the machine that minimized loaded wall clock without weakening
 * any timeout. It is the whole host's share for test workers, not one run's:
 * `testWorkerCount` divides it among the runs that are on the box.
 */
export const WORKER_SHARE = 0.5;

export interface WorkerCountInput {
  /** `availableParallelism()`. */
  readonly cores: number;
  /** `MTG_TEST_WORKERS`, when somebody pinned it. */
  readonly override?: string | undefined;
  /** Runs splitting the worker budget, this one included (`runSharers`). One when the run has the box to itself. */
  readonly sharers?: number | undefined;
}

/**
 * The pool size for this run.
 *
 * An explicit override wins outright, because reproducing the measurement above
 * needs a way to pin the number. A value that is not a positive integer is a
 * mistake rather than a preference and says so.
 *
 * Otherwise the budget, `WORKER_SHARE` of the cores, is divided by `sharers` and
 * rounded down, never below one worker: the box's budget is the ceiling, so
 * rounding a share up would put the sum of the shares over it.
 */
export function testWorkerCount({ cores, override, sharers = 1 }: WorkerCountInput): number {
  if (override !== undefined && override !== '') {
    const pinned = Number(override);
    if (!Number.isInteger(pinned) || pinned < 1)
      throw new Error(`MTG_TEST_WORKERS must be a positive integer, got ${JSON.stringify(override)}`);
    return pinned;
  }
  if (!Number.isInteger(sharers) || sharers < 1)
    throw new Error(`sharers must be a positive integer, got ${JSON.stringify(sharers)}`);
  const budget = Math.round(cores * WORKER_SHARE);
  return Math.max(1, Math.min(vitestDefaultWorkers(cores), Math.floor(budget / sharers)));
}

export interface SharersInput {
  /** `MTG_TEST_SLOTS`: how many runs the worker pool can have going at once. */
  readonly slots?: string | undefined;
  /** Other runs live on this host right now (`liveRunCount`). */
  readonly liveOthers: number;
}

/**
 * How many runs split the worker budget, this one included.
 *
 * `MTG_TEST_SLOTS` is the pool saying how many runs it can start, which is the
 * fact a run cannot learn for itself: every slot sizes its pool the same way
 * and none is aware of the others. The claims a run can read (`run-claims.ts`)
 * only show the siblings that were already going when it started. The larger of
 * the two wins, so a pool's ceiling is never argued down by claims that have not
 * been written yet, and a run that is not in a pool at all is still sized against
 * whoever it finds.
 */
export function runSharers({ slots, liveOthers }: SharersInput): number {
  let declared = 1;
  if (slots !== undefined && slots !== '') {
    declared = Number(slots);
    if (!Number.isInteger(declared) || declared < 1)
      throw new Error(`MTG_TEST_SLOTS must be a positive integer, got ${JSON.stringify(slots)}`);
  }
  return Math.max(declared, 1 + liveOthers);
}

/**
 * The `override` to size this run's pool by, once the second clause of
 * The playtester's lane ruling (2026-09-18 15:44Z) is folded in: a Forge-required
 * run (`isForgeRequiredRun`, `host-lock.ts`) takes exactly one worker,
 * whatever `MTG_TEST_WORKERS` says, so it never runs two JVM-backed cases at
 * once while `forge-lock-setup.ts` holds the host-wide Forge lock for it. A
 * run that is not Forge-required is unaffected — its own `MTG_TEST_WORKERS`,
 * if any, passes through unchanged.
 */
export function testWorkerOverride(
  env: ForgeRequiredEnv & { readonly MTG_TEST_WORKERS?: string | undefined },
): string | undefined {
  return isForgeRequiredRun(env) ? '1' : env.MTG_TEST_WORKERS;
}
