/**
 * The vitest reporter that puts the machine's condition next to the red test.
 *
 * It reports; it never decides. No test's budget changes, no test is retried
 * and nothing is suppressed — the run's exit code is exactly what it was
 * before this file existed. What it adds is the one fact a timeout has never
 * carried: whether the box was carrying five other suites at the moment the
 * clock ran out. That is the difference between an agent re-running one file
 * and an agent spending a round of work proving their diff is innocent.
 *
 * Two signals, sampled here in the main process rather than in the worker that
 * timed out, because a starved worker is the last place that can report on its
 * own starvation:
 *
 *   - the 1-minute load average, which is the only reading that can see the
 *     other lanes' processes at all, and which lags a minute behind them;
 *   - how late this process's own timer fires, which sees only this instant and
 *     needs no minute to say so.
 *
 * `attribution.ts` holds the thresholds and the wording and is where the
 * reasoning is written down. This file is the clock, the counter and the wiring.
 */
import { availableParallelism, loadavg } from 'node:os';
import { relative } from 'node:path';
import type { Reporter, TestCase, TestModule, Vitest } from 'vitest/node';
import type { LoadSample, NearLimitFinding, TimeoutFinding } from './attribution';
import {
  NEAR_LIMIT_FRACTION,
  VERDICT_MARKER,
  annotateTimeout,
  describeNearLimit,
  describeTimeout,
  durationIsMeaningful,
  loadOver,
  timedOutAtMs,
} from './attribution';

/**
 * How often the machine is read.
 *
 * A quarter second costs a few hundred samples over a unit run and is fine
 * enough that the shortest test carrying its own budget still contains one. The
 * same interval is the baseline the timer's lateness is measured against.
 */
const SAMPLE_INTERVAL_MS = 250;

/**
 * A ceiling on the ring buffer, so the balance project's ten-minute sweep
 * cannot turn a diagnostic into a leak. At a quarter second apiece this holds
 * the last twenty minutes, which outlasts every run in this workspace.
 */
const MAX_SAMPLES = 4_800;

/** Enough of the near-limit list to act on, without burying the run summary. */
const MAX_NEAR_LIMIT_REPORTED = 12;

/**
 * The budget the runner applied, or `null`.
 *
 * Vitest's public `TaskOptions` does not carry the timeout, so this reaches the
 * runner task underneath it through a structural check rather than a cast: the
 * field is read if it is there and the near-limit report is skipped if it ever
 * is not. Nothing else in this file depends on it, so a future vitest that
 * moves it costs one section of the report and no failures.
 */
function budgetOf(testCase: TestCase): number | null {
  const task: unknown = (testCase as { readonly task?: unknown }).task;
  if (typeof task !== 'object' || task === null) return null;
  const timeout: unknown = (task as { readonly timeout?: unknown }).timeout;
  return typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : null;
}

/** A serialized error as this file touches it: a message it may rewrite. */
interface WritableError {
  message?: string;
}

/**
 * The errors of a failed test, as the objects the later failure dump prints.
 *
 * The reference matters. `annotate` below writes the verdict back onto the
 * message, which is the only way to get it into the block vitest prints last;
 * a copy would be annotated and thrown away.
 */
function errorsOf(testCase: TestCase): readonly WritableError[] {
  const result = testCase.result();
  if (result.state !== 'failed') return [];
  return result.errors ?? [];
}

export default class TestLoadReporter implements Reporter {
  private readonly cores = availableParallelism();
  private readonly samples: LoadSample[] = [];
  private timeouts: TimeoutFinding[] = [];
  private nearLimit: NearLimitFinding[] = [];
  private running = 0;
  private peakRunning = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private startedAt = 0;
  private workers: number | null = null;

  /**
   * The pool size this run settled on. `vitest.config.ts` sizes it against the
   * load that was already on the machine, so a reader comparing two runs needs
   * to be told which one they are looking at.
   */
  onInit(vitest: Vitest): void {
    const configured: unknown = (vitest.config as { readonly maxWorkers?: unknown }).maxWorkers;
    this.workers = typeof configured === 'number' ? configured : null;
  }

  /**
   * Findings are dropped here rather than after the report, because `vitest`
   * in watch mode calls this again for every rerun and a report that carried
   * the previous pass's timeouts would say a test is still red after it was
   * fixed. The load samples deliberately survive: the machine is continuous
   * even when the run is not.
   */
  onTestRunStart(): void {
    this.timeouts = [];
    this.nearLimit = [];
    this.running = 0;
    this.peakRunning = 0;
    this.startedAt = Date.now();
    this.lastTickAt = this.startedAt;
    this.sample();
    this.tick();
  }

  onTestModuleStart(_module: TestModule): void {
    this.running += 1;
    this.peakRunning = Math.max(this.peakRunning, this.running);
  }

  onTestModuleEnd(_module: TestModule): void {
    this.running = Math.max(0, this.running - 1);
  }

  onTestCaseResult(testCase: TestCase): void {
    const diagnostic = testCase.diagnostic();
    if (diagnostic === undefined) return;
    const from = diagnostic.startTime;
    const to = from + diagnostic.duration;
    const window = loadOver(this.samples, from, to);
    const file = relative(process.cwd(), testCase.module.moduleId);

    for (const error of errorsOf(testCase)) {
      const message = error.message;
      const budgetMs = timedOutAtMs(message);
      if (budgetMs === null || message === undefined) continue;
      // Written back onto the runner's own error rather than reported beside
      // it. The failure dump is the last thing vitest prints and the first
      // thing anybody reads, so that is where the verdict has to be. Guarded
      // against a second pass so a retried test is not annotated twice.
      if (!message.includes(VERDICT_MARKER)) error.message = message + annotateTimeout(this.cores, window);
      this.timeouts.push({ file, name: testCase.fullName, budgetMs, load: window });
      return;
    }

    // A test that spent most of its budget is the next timeout, so it is worth
    // naming now. Only where the reading holds: under outside load every test
    // looks near its limit, and a list that says so on a borrowed box says
    // nothing about any test on it.
    if (testCase.result().state !== 'passed') return;
    if (window === null || !durationIsMeaningful(window)) return;
    const budgetMs = budgetOf(testCase);
    if (budgetMs === null) return;
    if (diagnostic.duration < budgetMs * NEAR_LIMIT_FRACTION) return;
    this.nearLimit.push({ file, name: testCase.fullName, budgetMs, durationMs: diagnostic.duration });
  }

  onTestRunEnd(): void {
    this.stop();
    this.report();
  }

  /** Reads the machine once. Cheap enough to run beside a saturated box. */
  private sample(): void {
    const at = Date.now();
    const load = loadavg()[0] ?? 0;
    this.samples.push({
      at,
      load1: load,
      lagMs: Math.max(0, at - this.lastTickAt - SAMPLE_INTERVAL_MS),
      runningFiles: this.running,
    });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    this.lastTickAt = at;
  }

  private tick(): void {
    // `unref` so a diagnostic can never be the reason a run refuses to exit.
    this.timer = setTimeout(() => {
      this.sample();
      this.tick();
    }, SAMPLE_INTERVAL_MS);
    this.timer.unref();
  }

  private stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private report(): void {
    const peak = this.samples
      .filter((sample) => sample.at >= this.startedAt)
      .reduce((worst, sample) => Math.max(worst, sample.load1), 0);
    const perCore = (peak / this.cores).toFixed(1);
    const pool = this.workers === null ? '' : `, ${this.workers} test workers`;
    // The peak is a reading of the whole box and this run is on it, so the line
    // says how much of the box was this run's own doing. Printing the total
    // alone is the same category error the `quiet` verdict used to make one
    // level down: a run that fills the machine reads as a busy machine.
    const outside = Math.max(0, peak - this.peakRunning).toFixed(1);
    console.log(
      `\n  machine: ${this.cores} cores${pool}, peak 1-minute load ${peak.toFixed(1)} during this run (${perCore}x per core),` +
        ` up to ${this.peakRunning} of this run's own test files in flight, so at most ${outside} of that load came from outside it`,
    );

    if (this.timeouts.length > 0) {
      console.log(`\n  ${this.timeouts.length} test(s) ran out of time. What the machine was doing:\n`);
      for (const finding of this.timeouts) console.log(`${describeTimeout(this.cores, finding)}\n`);
    }

    if (this.nearLimit.length > 0) {
      const worst = [...this.nearLimit]
        .sort((a, b) => b.durationMs / b.budgetMs - a.durationMs / a.budgetMs)
        .slice(0, MAX_NEAR_LIMIT_REPORTED);
      const more = this.nearLimit.length - worst.length;
      console.log(
        `\n  ${this.nearLimit.length} test(s) spent over half their budget while nothing outside this run` +
          ' was holding the cores, so they are what times out next:\n',
      );
      for (const finding of worst) console.log(describeNearLimit(finding));
      if (more > 0) console.log(`  ...and ${more} more.`);
      console.log('');
    }
  }
}
