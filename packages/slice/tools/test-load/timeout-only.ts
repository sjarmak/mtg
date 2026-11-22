/**
 * The arithmetic a red run does not do for you: how many of the failed files
 * failed only because a clock ran out.
 *
 * `attribution.ts` explains one timeout, and explains it well — the load, the
 * collator's lateness, the verdict, written onto the error a reader sees first.
 * What no part of the run says is what the reader actually asks next, which is
 * a question about the summary line rather than about any one test.
 *
 * Recorded 2026-08-28 on main at 2814e943, a full `--project unit` run while
 * the DSL/kernel lane was on the same sixteen cores (mtg-8qhy):
 *
 *   Test Files  9 failed | 1393 passed (1402)
 *   Tests       8 failed | 12369 passed (12377)
 *
 * Four of those nine were red only because a test exceeded its own budget, and
 * three of the four were re-run together on the same commit immediately
 * afterwards and passed. So a third of the red was the machine, and the only
 * way to learn it was to re-run each file by hand and read nine failure blocks
 * to work out which were which. The information was all on screen; the
 * subtraction was not.
 *
 * This does the subtraction. It reports and never decides: it moves no budget,
 * retries nothing, and does not touch the exit code in either direction. A
 * timeout-only file is still a failed file, and a run that ends red still ends
 * red. What changes is which file the reader opens first.
 *
 * ## Why "every failed test under it timed out" is the rule
 *
 * A file with one assertion failure and one timeout is not a file the machine
 * broke; it is a file with a defect that also ran slowly, and calling it
 * timeout-only would send a reader to blame the box for something their diff
 * did. A file with an error attached to the module or a suite that is not
 * itself a timeout failed to collect or threw outside a test, which is not a
 * clock either. And a failed file with neither a failed test nor an attached
 * error is `unaccounted.ts`'s subject, not this one — the two are disjoint by
 * construction, so a file is never named by both.
 *
 * ## A hook that ran out of time is a clock
 *
 * A `beforeAll` or `afterAll` that exceeds `hookTimeout` is recorded by vitest
 * as an error on the suite (or the file, when the hook sits outside every
 * `describe`), not as a failed test: the tests under a dead `beforeAll` are
 * skipped, so the file can hold no failed test at all. Read as "any attached
 * error disqualifies", that is a file that failed on merit however loaded the
 * box was. Recorded 2026-09-18 on 69018acd at a peak 1-minute load of 41.7 on 16
 * cores, three test files of one package each died on a 10s `beforeAll`,
 * were classified as asserted, and the gate stored a red base verdict for a
 * tree where one file of twelve was red; all three passed together under
 * `MTG_TEST_WORKERS=1` (mtg-melhj). So an attached error is a clock exactly
 * when the runner's own "Hook timed out in Nms" is its whole message, and the
 * same all-or-nothing rule applies to it as to a test: one ordinary error
 * beside one timeout is an ordinary failure.
 */

/** One failed test, reduced to the only thing this judgment reads. */
export interface FailedTestShape {
  readonly name: string;
  /** The budget a timeout fired against, or `null` for an ordinary failure. */
  readonly budgetMs: number | null;
}

/**
 * One error attached to a module or to a suite inside it rather than to a test,
 * reduced to the only thing this judgment reads.
 */
export interface ScopeErrorShape {
  /** The suite's full name, or `null` for an error on the file itself. */
  readonly scope: string | null;
  /** The budget a hook timeout fired against, or `null` for any other error. */
  readonly budgetMs: number | null;
}

/** One module's failures, as plain data a test can build. */
export interface RedModuleShape {
  /** The module id vitest reports, or a path already made relative. */
  readonly moduleId: string;
  /** `passed`, `skipped`, `failed`, `pending` or `queued`. */
  readonly state: string;
  /** Every error attached to the module or to any suite inside it. */
  readonly scopeErrors: readonly ScopeErrorShape[];
  /** Every failed test under it, in collection order. */
  readonly failedTests: readonly FailedTestShape[];
}

/** A failed file whose every failure was a clock. */
export interface TimeoutOnlyModule {
  readonly moduleId: string;
  /** Each timed-out hook or test, named, with the budget it fired against. */
  readonly timeouts: readonly FailedTestShape[];
}

/**
 * What the run should say about the share of its red that was the clock.
 *
 * `clean` prints nothing, and covers both a green run and a red one where every
 * failed file failed on merit. There is nothing to subtract in either case.
 */
export type TimeoutOnlyVerdict =
  | { readonly kind: 'clean' }
  | {
      readonly kind: 'timeout-only';
      /** Every failed file in the run, so the share can be stated as a share. */
      readonly redFiles: number;
      readonly modules: readonly TimeoutOnlyModule[];
    };

/**
 * The machine the run had, restated beside the subtraction.
 *
 * The reporter prints these numbers once already, several blocks up. They are
 * repeated here because this block is the one a reader acts on, and "four of
 * your nine red files were the clock" is a much weaker sentence without the
 * load that made the clock run out.
 */
export interface MachineSummary {
  readonly cores: number;
  readonly peakLoad1: number;
  /** The most test files this run had in flight at once. */
  readonly peakRunningFiles: number;
}

/**
 * A hook timeout, named the way a timed-out test is.
 *
 * The runner's message says "Hook timed out" and nothing about which of
 * `beforeAll` or `afterAll` it was, so neither does this.
 */
function hookTimeout(error: ScopeErrorShape): FailedTestShape {
  const where = error.scope === null ? 'at file level' : `in ${error.scope}`;
  return { name: `a hook ${where}`, budgetMs: error.budgetMs };
}

/** A failed module whose failures are all timeouts, or `null`. */
function timeoutOnlyModule(module: RedModuleShape): TimeoutOnlyModule | null {
  if (module.state !== 'failed') return null;
  if (module.scopeErrors.some((error) => error.budgetMs === null)) return null;
  if (module.failedTests.some((test) => test.budgetMs === null)) return null;
  const timeouts = [...module.scopeErrors.map(hookTimeout), ...module.failedTests];
  // Nothing timed out and nothing failed is a file that lost its results, which
  // is `unaccounted.ts`'s subject.
  if (timeouts.length === 0) return null;
  return { moduleId: module.moduleId, timeouts };
}

export function classifyTimeoutOnly(modules: readonly RedModuleShape[]): TimeoutOnlyVerdict {
  const found = modules.map(timeoutOnlyModule).filter((module) => module !== null);
  if (found.length === 0) return { kind: 'clean' };
  return {
    kind: 'timeout-only',
    redFiles: modules.filter((module) => module.state === 'failed').length,
    modules: found,
  };
}

/**
 * The marker that makes the block greppable in a CI log as much as in a
 * scrollback. `packages/slice/test/timeout-only.test.ts` searches for it.
 */
export const TIMEOUT_ONLY_MARKER = 'reporter timeout-only files:';

/**
 * The command that settles it, printed rather than described.
 *
 * The bead's own record is that three of the four suspect files were re-run
 * together and passed, so the suggestion is one command over all of them rather
 * than one per file. `MTG_TEST_WORKERS=1` is on it because the point of the
 * re-run is to take the contention out of the reading, and the run's own
 * fan-out is contention the run controls.
 */
function rerunCommand(modules: readonly TimeoutOnlyModule[]): string {
  return `MTG_TEST_WORKERS=1 npx vitest run ${modules.map((module) => module.moduleId).join(' ')}`;
}

/** The block the run prints. Empty unless the clock explains a whole file. */
export function describeTimeoutOnly(verdict: TimeoutOnlyVerdict, machine: MachineSummary | null): string {
  if (verdict.kind !== 'timeout-only') return '';
  const { modules, redFiles } = verdict;
  const total = modules.reduce((sum, module) => sum + module.timeouts.length, 0);
  const named = modules
    .map(
      (module) =>
        `    ${module.moduleId}\n` +
        module.timeouts.map((test) => `      ${test.name} (${test.budgetMs ?? '?'}ms budget)`).join('\n'),
    )
    .join('\n');
  const load =
    machine === null
      ? '  The machine was not sampled, so this run cannot say how busy it was.\n'
      : `  The box: ${machine.cores} cores, peak 1-minute load ${machine.peakLoad1.toFixed(1)} ` +
        `(${(machine.peakLoad1 / machine.cores).toFixed(1)}x per core), up to ${machine.peakRunningFiles} ` +
        "of this run's own test files in flight. A timeout under load is a fact about the box.\n";
  return (
    `\n  ${TIMEOUT_ONLY_MARKER} ${modules.length} of ${redFiles} failed test file(s) failed ONLY because` +
    ` a test or a hook ran out of time. ${total} timeout(s), no assertion failure and no other error among them.\n` +
    `${named}\n` +
    load +
    '  The exit code is unchanged and these are still failures. Settle them before reading the red as a' +
    ' fact about the diff:\n' +
    `    ${rerunCommand(modules)}\n` +
    '  Passing there makes them the machine (mtg-8qhy); failing there makes them yours.\n'
  );
}
