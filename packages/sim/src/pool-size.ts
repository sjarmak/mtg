/**
 * How wide a sim pool opens when nobody states a width.
 *
 * `availableParallelism()` is the right answer for a run that owns the machine
 * — `npm run slice`, the CLI, a sweep an operator started — and it is the wrong
 * answer for a run that is already one worker inside somebody else's pool.
 *
 * Measured on this box (16 cores) with the process tree of a single `npm test`
 * sampled four times a second (mtg-czt). At the busiest instant the run held
 * **103 to 130 runnable threads of its own** over four runs: two vitest
 * instances (the outer run, plus the nested one `gate-wiring.test.ts` spawns)
 * with 15 forks each, and four of those forks each holding a 16-thread pool.
 * Sixty-four sim threads and about fifteen test forks, on sixteen cores, from
 * one command and before any other lane starts. The four pools are not one
 * caller being greedy; they are four files that each asked for the whole
 * machine and were each told yes:
 *
 *   - `packages/metrics/test/balance/format-health.test.ts` (the pinned sweep)
 *   - `packages/metrics/test/balance/broken-set.test.ts` (control + boosted)
 *   - the nested gate run `gate-wiring.test.ts` starts as a child process
 *   - `packages/sim/test/closing.test.ts` and `closure-stats.test.ts`, over in
 *     the unit project, running concurrently with all of the above
 *
 * So the default is conditioned on where the caller is standing. Inside a
 * vitest worker a pool takes a share of the cores; anywhere else it takes the
 * machine, exactly as before. Nothing here changes what a sim computes: the
 * pool is a scheduling detail because `playIndex` is a pure function of (spec,
 * index), which is what `packages/sim/test/reproducibility.test.ts` asserts and
 * what makes a width safe to move at all.
 *
 * **Re-measured 2026-08-16 under mtg-es2**, with `pool-census.ts` rather than a
 * process-tree sample, and it moves where the share is worth arguing about:
 *
 *   - `npx vitest run --project unit` (524 files, 16 cores): 44 pools opened,
 *     **2** of them at the unstated default, and never two of those live at
 *     once. Every other caller states its own width — 1, 2, 4 and 5 wide — so
 *     in the project that actually times out, this share governs 4 threads.
 *   - both projects together: 57 pools, 15 at the default, all 4 wide, **5 of
 *     them live at once for 20 threads**, and 8 pools of any width live at once
 *     for 27. The five are the balance harness's sweeps and the nested gate
 *     run, plus `closing.test.ts`.
 *
 * Two of the five names above were wrong and are corrected here rather than
 * left to rot: `closure-stats.test.ts` opens no pool at all (it grades
 * hand-built outcomes), and the fifth default-width holder is
 * `packages/ui/test/analysis/round-trip.test.ts`.
 *
 * The quarter stands, and mtg-es2's two ways to derive it instead were both
 * measured and neither survives. Passing the run's width down cannot work:
 * `maxWorkers` is 15 for `npm test` and 15 for `npm run test:balance`, and
 * those are exactly the two runs whose measured best widths differ (4 and 8),
 * so the channel carries no information about the thing it would decide. A
 * shared budget cannot work cheaply: the five concurrent pools sit in five
 * vitest forks and one of them in a second vitest instance, so the budget needs
 * an out-of-process rendezvous, and sizing each pool against whoever booted
 * first hands the widest share to the earliest — measured, the pools boot at
 * +0.0s, +1.6s, +1.6s, +1.7s and +5.7s, so the sweep that wanted more room gets
 * whatever is left, and two runs of one gate no longer use the same widths.
 */

/**
 * The share of the cores one sim pool may claim while it is running inside a
 * test worker.
 *
 * A quarter, because up to four pools were measured live at once and a quarter
 * each puts their total back at one thread per core, which is the line
 * `packages/slice/tools/test-load/workers.ts` sizes the test pool against from
 * the other side. It is a share rather than a count so a smaller box does not
 * end up more oversubscribed than this one.
 *
 * The count has since been five rather than four (see above), which puts the
 * total at 1.25 threads per core rather than one. The arithmetic of the
 * derivation therefore no longer closes, and the constant is left where it is
 * anyway: the only run whose wall clock would settle a narrower share is the
 * balance gate, and a width nobody has timed is a worse number than a width
 * whose premise has drifted by a quarter of a thread per core.
 */
export const TEST_WORKER_CORE_SHARE = 0.25;

/**
 * The narrowest a share may make a pool.
 *
 * Two rather than one: at one worker the pool is a thread that plays every
 * game in series, and the balance gate's 10,035 games take minutes rather than
 * seconds. The reduction is meant to stop four callers from claiming the same
 * sixteen cores, not to turn the sweep back into the serial run the pool was
 * introduced to replace.
 */
export const MIN_TEST_WORKER_POOL = 2;

export interface DefaultPoolInput {
  /** `availableParallelism()`. */
  readonly cores: number;
  /** Is this process itself a worker of some other pool? */
  readonly insideTestWorker: boolean;
  /** `MTG_SIM_WORKERS`, when somebody pinned it. */
  readonly override?: string | undefined;
}

/**
 * The width of a pool whose caller stated none.
 *
 * An explicit override wins outright, for the same two reasons
 * `MTG_TEST_WORKERS` exists: a measurement has to be reproducible, and a
 * container whose core count lies needs an exit. A value that is not a positive
 * integer is a mistake rather than a preference and says so.
 */
export function defaultSimWorkers({ cores, insideTestWorker, override }: DefaultPoolInput): number {
  if (override !== undefined && override !== '') {
    const pinned = Number(override);
    if (!Number.isInteger(pinned) || pinned < 1) {
      throw new Error(`MTG_SIM_WORKERS must be a positive integer, got ${JSON.stringify(override)}`);
    }
    return pinned;
  }
  if (!insideTestWorker) return Math.max(1, cores);
  // The floor first, then the cores over it: a one-core box has no share to
  // take and must not be handed two workers by a floor meant for sixteen.
  const share = Math.max(MIN_TEST_WORKER_POOL, Math.round(cores * TEST_WORKER_CORE_SHARE));
  return Math.max(1, Math.min(cores, share));
}

/**
 * Whether this process is a worker of a test run.
 *
 * Read from the environment vitest gives every worker it forks. The nested
 * vitest that `gate-wiring.test.ts` starts inherits it and sets it again for
 * its own forks, so a pool two levels down is still recognized as being inside
 * one. Sim worker threads inherit it too and that is harmless: a worker never
 * opens a pool of its own.
 */
export function insideTestWorker(env: Readonly<Record<string, string | undefined>>): boolean {
  return env['VITEST_WORKER_ID'] !== undefined || env['VITEST_POOL_ID'] !== undefined;
}
