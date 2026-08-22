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
 * What this is not: it is not a timeout, and it moves no test's budget. Every
 * test still fails at exactly the number its call site states, and a test that
 * has genuinely become slow still goes red at the same threshold it always did.
 * This changes how much of the machine the run asks for, which is the one lever
 * that makes tests finish sooner rather than letting them run longer.
 */

/** Vitest's own choice, from `createForksPool`: one worker short of the cores. */
export function vitestDefaultWorkers(cores: number): number {
  return Math.max(1, cores - 1);
}

/**
 * The share that minimized loaded wall clock without weakening any timeout.
 */
export const WORKER_SHARE = 0.5;

export interface WorkerCountInput {
  /** `availableParallelism()`. */
  readonly cores: number;
  /** `MTG_TEST_WORKERS`, when somebody pinned it. */
  readonly override?: string | undefined;
}

/**
 * The pool size for this run.
 *
 * An explicit override wins outright, because reproducing the measurement above
 * needs a way to pin the number. A value that is not a positive integer is a
 * mistake rather than a preference and says so.
 */
export function testWorkerCount({ cores, override }: WorkerCountInput): number {
  if (override !== undefined && override !== '') {
    const pinned = Number(override);
    if (!Number.isInteger(pinned) || pinned < 1)
      throw new Error(`MTG_TEST_WORKERS must be a positive integer, got ${JSON.stringify(override)}`);
    return pinned;
  }
  return Math.max(1, Math.min(vitestDefaultWorkers(cores), Math.round(cores * WORKER_SHARE)));
}
