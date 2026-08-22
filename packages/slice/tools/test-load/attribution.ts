/**
 * Why a red test is red: the change under test, or the machine it ran on.
 *
 * Under a wave of parallel lanes this workspace runs at several times its core
 * count, and at that point vitest's 5s default stops being a hang detector and
 * starts being a queueing measurement. The observed shape is always the same: a
 * different file each wave, always passing alone. The cost is not the flake, it
 * is that the agent who reads the red has to spend a round of work proving the
 * failure has nothing to do with the log layer they just changed.
 *
 * So a timeout says which one it was, in the message itself. This module is the
 * judgment; `reporter.ts` is the sampling and the wiring. It is split that way
 * because the judgment is the part worth testing and the sampling is the part
 * that needs a clock and a running vitest.
 *
 * Nothing here changes what any test is allowed to spend. A timeout still fires
 * at exactly the budget its call site states, and a test that has genuinely
 * become slow still goes red; it now goes red with the reason attached.
 */

/** Vitest's own wording, from `@vitest/runner`: `Test timed out in 5000ms.` */
const TIMED_OUT = /\b(?:Test|Hook) timed out in (\d+)ms\b/;

/**
 * The budget a timeout fired against, or `null` when the error is an ordinary
 * failure.
 *
 * Read out of the message rather than off the task, because the message is what
 * survives serialization from the worker to the reporter and because it is the
 * one place the runner states the number it actually applied.
 */
export function timedOutAtMs(message: string | undefined): number | null {
  if (message === undefined) return null;
  const match = TIMED_OUT.exec(message);
  if (match === null) return null;
  const budget = Number(match[1]);
  return Number.isFinite(budget) ? budget : null;
}

/** A reading of how busy the machine was, taken in the main vitest process. */
export interface LoadSample {
  /** `Date.now()` when the sample was taken. */
  readonly at: number;
  /**
   * The 1-minute load average. It lags by a minute, which is the price of it
   * being the only signal here that can see the other four lanes' processes.
   */
  readonly load1: number;
  /**
   * How late a timer in this process fired against its nominal interval.
   *
   * The instantaneous half of the pair. The main process collates results and
   * is otherwise idle, so it should be scheduled the moment its timer is due;
   * anything above a few milliseconds is somebody else holding every core.
   */
  readonly lagMs: number;
  /** Test files this run had in flight when the sample was taken. */
  readonly runningFiles: number;
}

/** What the samples taken during one test's lifetime add up to. */
export interface LoadWindow {
  readonly peakLoad1: number;
  readonly peakLagMs: number;
  readonly peakRunningFiles: number;
  /** How many samples fell inside the window; 0 means the nearest was borrowed. */
  readonly samples: number;
}

/**
 * The load over `[from, to]`, or `null` when nothing was ever sampled.
 *
 * A test shorter than the sampling interval can contain no sample at all, and
 * reporting nothing for it would be worse than reporting the reading either
 * side of it: the load average moves over a minute, so the nearest sample is a
 * fair account of a window a few hundred milliseconds wide. That case is marked
 * by `samples: 0` and the caller says so rather than passing it off.
 */
export function loadOver(samples: readonly LoadSample[], from: number, to: number): LoadWindow | null {
  if (samples.length === 0) return null;
  const inside = samples.filter((sample) => sample.at >= from && sample.at <= to);
  const used = inside.length > 0 ? inside : [nearest(samples, (from + to) / 2)];
  let peakLoad1 = 0;
  let peakLagMs = 0;
  let peakRunningFiles = 0;
  for (const sample of used) {
    peakLoad1 = Math.max(peakLoad1, sample.load1);
    peakLagMs = Math.max(peakLagMs, sample.lagMs);
    peakRunningFiles = Math.max(peakRunningFiles, sample.runningFiles);
  }
  return { peakLoad1, peakLagMs, peakRunningFiles, samples: inside.length };
}

function nearest(samples: readonly LoadSample[], at: number): LoadSample {
  let best = samples[0];
  if (best === undefined) throw new Error('nearest needs at least one sample');
  for (const sample of samples) {
    if (Math.abs(sample.at - at) < Math.abs(best.at - at)) best = sample;
  }
  return best;
}

/**
 * How hard the machine was being shared while a test ran, and by whom.
 *
 * Four rather than three, because the three were a category error. The load
 * average is a reading of the whole box, this run's own forks are on that box,
 * and the verdict reasoned about the total as though the run were not part of
 * it. On 16 cores a full `--project unit` run holds the machine at a 1-minute
 * load of 15.6 by itself, and every window inside it reads well under the
 * one-thread-per-core line, so a timeout in the middle of a 524-file run was
 * told **`NOT LOAD. The machine was quiet while this ran.`** while fourteen of
 * this run's own test files were on the cores. That is the worst thing a
 * diagnostic can do: it is confident, it is wrong, and it sends the reader to
 * look for a defect that is not there.
 *
 * So `crowded` is the state the old vocabulary could not say — nothing outside
 * this run was taking cores, and the run was still crowding itself.
 */
export type Contention = 'saturated' | 'contended' | 'crowded' | 'quiet';

/**
 * Runnable work per core past which a test on the default budget is expected to
 * fail on time rather than on merit.
 *
 * Measured under mtg-bc2.107 and recorded in `vitest.config.ts`: 24 CPU hogs
 * against 16 cores triples the wall clock and fails nothing, while 48 pushes a
 * test that takes 91ms on a quiet box past 5s. Two is the boundary that
 * measurement drew, so it is the boundary this reads against.
 */
export const SATURATED_LOAD_PER_CORE = 2;

/** One runnable thread per core: busy, and not yet the documented failure zone. */
export const CONTENDED_LOAD_PER_CORE = 1;

/**
 * Timer lateness in the main process that means the same thing as a saturated
 * load average, a minute sooner.
 *
 * A quarter second is roughly a twentieth of the default budget. A collator
 * that cannot get onto a core for that long is not a machine on which a
 * five-second test tells you anything about the code.
 */
export const SATURATED_LAG_MS = 250;

/** Lateness that says the cores are shared, without saying the run is doomed. */
export const CONTENDED_LAG_MS = 50;

/**
 * Test files this run had in flight, as a share of the cores, past which the
 * run is competing with itself hard enough that a default budget measures the
 * queue.
 *
 * Half, and it is measured rather than picked. On this box (16 cores) a
 * `--project unit` run reproduced both of mtg-w45's predicted failures with 14
 * and 9 files in flight and a peak 1-minute load of 9.4 — `packages/slice`'s
 * public-boundary scan takes 3,189ms alone and did not finish inside 5,000ms
 * there, a 1.6x stretch at 0.6 threads per core. The load average cannot see
 * why: a fork's own threads come and go inside the minute it averages over, and
 * a sim pool opened inside one of those forks takes a quarter of the cores
 * without moving the reading at all. So the honest floor is the run's own
 * fan-out, and at half the cores in files one default-width sim pool inside any
 * one of them already puts the run's own threads at three quarters of the box.
 */
export const SELF_CROWD_CORE_SHARE = 0.5;

/**
 * An upper bound on how much of the load came from somewhere other than this
 * run.
 *
 * Each test file in flight is a fork executing, so the file count is a lower
 * bound on the run's own runnable threads and never counts a thread twice —
 * which makes the subtraction an upper bound on the outside, and errs toward
 * blaming the machine rather than toward the `quiet` verdict that sends a
 * reader hunting. It is a lower bound and not the whole of the run's own load:
 * the sim pools those forks open are invisible here, which is the other half of
 * why a total was never a safe thing to reason from.
 */
export function outsideLoad(window: LoadWindow): number {
  return Math.max(0, window.peakLoad1 - window.peakRunningFiles);
}

/** Whether this run's own fan-out was enough to make a default budget a queue. */
export function crowdedByItself(cores: number, window: LoadWindow): boolean {
  return window.peakRunningFiles >= cores * SELF_CROWD_CORE_SHARE;
}

/**
 * Either signal is enough. They fail in opposite directions — the load average
 * lags a minute behind a wave that just started, and timer lateness cannot see
 * a neighbor that is blocked on IO rather than CPU — so reading them as an OR
 * costs a few false `contended` verdicts and buys the case each one covers.
 *
 * `saturated` reads the total, because past twice the cores a timeout measures
 * the queue whoever filled it. Everything under that line is attributed:
 * `contended` is load this run cannot account for, and `crowded` is load it
 * can. Only a window with neither is `quiet`, and only `quiet` tells a reader
 * to treat the red as real.
 */
export function contentionOf(cores: number, window: LoadWindow): Contention {
  if (window.peakLoad1 >= cores * SATURATED_LOAD_PER_CORE || window.peakLagMs >= SATURATED_LAG_MS)
    return 'saturated';
  if (outsideLoad(window) >= cores * CONTENDED_LOAD_PER_CORE || window.peakLagMs >= CONTENDED_LAG_MS)
    return 'contended';
  if (crowdedByItself(cores, window)) return 'crowded';
  return 'quiet';
}

/** One test that ran out of time, with the machine it ran out of time on. */
export interface TimeoutFinding {
  /** Path relative to the workspace root. */
  readonly file: string;
  readonly name: string;
  /** The budget the runner applied, read off the timeout message. */
  readonly budgetMs: number;
  readonly load: LoadWindow | null;
}

/** One test that finished, having spent most of what it was allowed. */
export interface NearLimitFinding {
  readonly file: string;
  readonly name: string;
  readonly budgetMs: number;
  readonly durationMs: number;
}

const VERDICTS: Readonly<Record<Exclude<Contention, 'crowded'>, string>> = {
  saturated:
    'LOAD. The machine was past the point where a timeout measures the queue rather than the code. ' +
    'Re-run this file alone before attributing it to anything you changed.',
  contended:
    'MAYBE LOAD, FROM OUTSIDE THIS RUN. The cores were shared but not saturated. Re-run this file alone: ' +
    'passing alone makes it load, failing alone makes it yours.',
  quiet:
    'NOT LOAD. Nothing outside this run was taking cores and the run itself was not filling them. ' +
    'Treat it as a real failure.',
};

/**
 * The sentence a window earns.
 *
 * The `crowded` verdict states the count it was reached on, because "this run
 * was crowding itself" is the claim a reader is most likely to disbelieve and
 * the number is the whole of the evidence for it.
 */
export function verdictOf(cores: number, window: LoadWindow): string {
  const contention = contentionOf(cores, window);
  if (contention !== 'crowded') return VERDICTS[contention];
  return (
    'MAYBE LOAD, FROM THIS RUN ITSELF. Nothing outside this run was taking cores, but the run had ' +
    `${window.peakRunningFiles} of its own test files in flight on ${cores} cores, and a 1-minute average ` +
    'cannot see the threads inside them. Re-run this file alone: ' +
    'passing alone makes it load, failing alone makes it yours.'
  );
}

/** The block a timed-out test prints, verdict first. */
export function describeTimeout(cores: number, finding: TimeoutFinding): string {
  const lines = [`  ${finding.file} > ${finding.name}`, `    timed out at its ${finding.budgetMs}ms budget`];
  if (finding.load === null) {
    lines.push('    no load was sampled, so this run cannot say whether the machine was busy');
    return lines.join('\n');
  }
  const { peakLoad1, peakLagMs, peakRunningFiles, samples } = finding.load;
  const perCore = (peakLoad1 / cores).toFixed(1);
  const borrowed = samples === 0 ? ' (nearest sample; the test was shorter than one interval)' : '';
  lines.push(
    `    peak load ${peakLoad1.toFixed(1)} on ${cores} cores, ${perCore}x per core${borrowed}`,
    `    this run had ${peakRunningFiles} test files in flight; the collator was ${peakLagMs}ms late`,
    `    so at most ${outsideLoad(finding.load).toFixed(1)} of that load came from outside this run`,
    `    verdict: ${verdictOf(cores, finding.load)}`,
  );
  return lines.join('\n');
}

/**
 * Whether a duration measured over this window says anything about the test.
 *
 * The near-limit list below is a claim about a test, not about the evening, so
 * it has to be built from readings the evening did not distort. It cannot ask
 * `contentionOf`: a run's own fifteen workers put a sixteen-core box at a load
 * of fifteen on their own, so every full suite would be thrown out as
 * contended and the list would never be built at all.
 *
 * Timer lateness is the signal that separates the two. The collating process is
 * idle whether the cores are busy with this run or with four others, and it is
 * only held off one when something outside this run is taking them.
 */
export function durationIsMeaningful(window: LoadWindow): boolean {
  return window.peakLagMs < CONTENDED_LAG_MS;
}

/**
 * The marker that makes the appended verdict recognizable.
 *
 * It is what stops a retried test being annotated twice, and it is the string
 * `packages/slice/test/test-load-reporter.test.ts` searches for when it checks
 * that the annotation reached the error a reader actually sees.
 */
export const VERDICT_MARKER = 'machine at the moment it timed out:';

/**
 * The one line that rides on the timeout error itself.
 *
 * The end-of-run block below it is fuller, but vitest prints the failure dump
 * last and that dump is what an agent reads first. A verdict that lives only in
 * a block further up the scrollback is a verdict that gets scrolled past, so
 * the short form goes where the red is.
 */
export function annotateTimeout(cores: number, load: LoadWindow | null): string {
  if (load === null) return `\n${VERDICT_MARKER} not sampled.`;
  const perCore = (load.peakLoad1 / cores).toFixed(1);
  return (
    `\n${VERDICT_MARKER} peak load ${load.peakLoad1.toFixed(1)} on ${cores} cores (${perCore}x per core), ` +
    `${load.peakRunningFiles} test files in flight from this run, so at most ` +
    `${outsideLoad(load).toFixed(1)} of that load came from outside it, collator ${load.peakLagMs}ms late.\n` +
    verdictOf(cores, load)
  );
}

/**
 * The fraction of its budget a test may spend before it is worth naming.
 *
 * Half, because the recorded failure zone starts at twice the cores and a
 * doubled wall clock is what that buys. A test at half its budget on a quiet
 * machine is a test that fails the next time a second lane starts a suite.
 */
export const NEAR_LIMIT_FRACTION = 0.5;

/** The line a test prints when it passed but has little left over. */
export function describeNearLimit(finding: NearLimitFinding): string {
  const spent = ((finding.durationMs / finding.budgetMs) * 100).toFixed(0);
  return (
    `  ${finding.file} > ${finding.name}\n` +
    `    ${Math.round(finding.durationMs)}ms of a ${finding.budgetMs}ms budget (${spent}%)`
  );
}
