/**
 * The red that carries no diagnostic: a test file marked failed while nothing
 * in it failed and nothing was thrown.
 *
 * Recorded 2026-08-18 on the main checkout with five concurrent agent vitest
 * invocations on the box, twice, from two runs of one command with no source
 * change between them (mtg-jc05):
 *
 *   run 1:  Test Files  3 failed | 29 passed (32) / Tests  484 passed (484)
 *   run 2:  Test Files 32 passed (32) / Tests 517 passed (517), exit 0
 *
 * The arithmetic in run 1 is the whole bug. Three files failed while zero tests
 * failed, and 484 against 517 means the 33 tests in those files never reported
 * at all. Grepping the captured output for `FAIL`, `Error`, `Unhandled` and the
 * rule that heads a failure block found nothing: no failure block, no Failed
 * Suites section, no stack trace for any of the three. A reader is handed a red
 * run and no sentence about it, and the only way to learn whether the tree is
 * broken is to run it again.
 *
 * That signature is consistent with a worker whose channel closes before it
 * drains its last task updates — completed results are lost, the module is
 * marked failed because no result ever arrived, and there is no error object to
 * print because nothing was thrown. The box was carrying 11 GB of 23 GB swap
 * during the session, so an OOM-killed worker is at least as likely as a
 * protocol bug, and this file does not claim to know which. It claims only what
 * it can see: the module failed, no test under it failed, no error is attached.
 *
 * **This reporter reports and only ever hardens.** It can turn a 0 into a 1 and
 * never a 1 into a 0, which is the opposite direction from `rpc-timeout.ts` and
 * the safe one for a check whose subject is a result that went missing. In
 * practice vitest has already set the exit code when a module is failed; the
 * write is here so the claim does not depend on that staying true.
 *
 * It defers rather than competes when a birpc transport timeout is in the same
 * run. `mtg-bj9c` and `mtg-c9bc` are the overdue-timer and lost-channel paths,
 * they print their own name, and `rpc-timeout.ts` decides that run's exit code.
 * Two reporters explaining one run with two different stories is worse than one
 * of them saying which file to read.
 */
import type { Reporter, TestModule } from 'vitest/node';
import { rpcTimeoutMethod } from './rpc-timeout';

/** One module's accounting, as plain data a test can build. */
export interface ModuleShape {
  /** The module id vitest reports, which is usually an absolute path. */
  readonly moduleId: string;
  /** `passed`, `skipped`, `failed`, `pending` or `queued`. */
  readonly state: string;
  /** Errors attached to the module or to any suite inside it. */
  readonly errorCount: number;
  /** Each collected test's result state, in collection order. */
  readonly testStates: readonly string[];
}

/** Everything the verdict is allowed to read. */
export interface AccountingShape {
  readonly modules: readonly ModuleShape[];
  /** Every unhandled error's message, in the order vitest collected them. */
  readonly unhandledMessages: readonly string[];
}

/**
 * What the run should say about the files it could not account for.
 *
 * `clean` prints nothing, because a run with nothing missing has nothing to
 * explain. `deferred` prints nothing either: the transport-timeout reporter
 * owns that run and is about to explain it.
 */
export type AccountingVerdict =
  | { readonly kind: 'clean' }
  | { readonly kind: 'deferred'; readonly method: string }
  | { readonly kind: 'unaccounted'; readonly modules: readonly UnaccountedModule[] };

/** A failed module and the count that shows nothing in it actually failed. */
export interface UnaccountedModule {
  readonly moduleId: string;
  /** Tests collected from the module, none of which reported a failure. */
  readonly collected: number;
  /** Of those, how many never reported a result at all. */
  readonly missing: number;
}

const MISSING_TEST_STATES: readonly string[] = ['pending'];

/**
 * A failed module with no failed test and no error under it, or `null`.
 *
 * Every clause is a way the module could have earned its red honestly, so
 * anything this cannot rule out keeps the ordinary reporting. A module that
 * failed collection has errors; a module with a failing assertion has a failed
 * test; a skipped or passing module is not red at all.
 */
function unaccountedModule(module: ModuleShape): UnaccountedModule | null {
  if (module.state !== 'failed') return null;
  if (module.errorCount > 0) return null;
  if (module.testStates.some((state) => state === 'failed')) return null;
  return {
    moduleId: module.moduleId,
    collected: module.testStates.length,
    missing: module.testStates.filter((state) => MISSING_TEST_STATES.includes(state)).length,
  };
}

export function classifyAccounting(shape: AccountingShape): AccountingVerdict {
  for (const message of shape.unhandledMessages) {
    const method = rpcTimeoutMethod(message);
    if (method !== null) return { kind: 'deferred', method };
  }
  const modules = shape.modules.map(unaccountedModule).filter((found) => found !== null);
  return modules.length === 0 ? { kind: 'clean' } : { kind: 'unaccounted', modules };
}

/**
 * The marker that makes the diagnostic greppable in a CI log as much as in a
 * scrollback. `packages/slice/test/unaccounted.test.ts` searches for it.
 */
export const UNACCOUNTED_MARKER = 'reporter unaccounted files:';

/** The block the run prints. Empty unless something went missing. */
export function describeAccounting(verdict: AccountingVerdict): string {
  if (verdict.kind !== 'unaccounted') return '';
  const total = verdict.modules.reduce((sum, module) => sum + module.missing, 0);
  const named = verdict.modules
    .map((module) => `    ${module.moduleId} (${module.missing} of ${module.collected} unreported)`)
    .join('\n');
  return (
    `\n  ${UNACCOUNTED_MARKER} ${verdict.modules.length} test file(s) are marked failed while no test` +
    ` in them failed and no error was attached, and ${total} collected test(s) never reported a result.\n` +
    `${named}\n` +
    '  THIS IS NOT A VERDICT ON THE TREE. Nothing above failed an assertion; their results went missing,' +
    ' which a worker losing its channel or being killed under memory pressure both look like (mtg-jc05).\n' +
    '  Re-run those files alone before reading the red as a fact about the diff, and check the load and' +
    ' swap on the box.\n'
  );
}

/** Errors attached to the module itself or to any suite inside it. */
function errorCountOf(module: TestModule): number {
  let count = module.errors().length;
  for (const suite of module.children.allSuites()) count += suite.errors().length;
  return count;
}

function shapeOf(module: TestModule): ModuleShape {
  const testStates: string[] = [];
  for (const test of module.children.allTests()) testStates.push(test.result().state);
  return {
    moduleId: module.moduleId,
    state: module.state(),
    errorCount: errorCountOf(module),
    testStates,
  };
}

export default class UnaccountedReporter implements Reporter {
  onTestRunEnd(
    modules: readonly TestModule[],
    unhandledErrors: readonly { readonly message?: string }[],
  ): void {
    const verdict = classifyAccounting({
      modules: modules.map(shapeOf),
      unhandledMessages: unhandledErrors.map((error) => error.message ?? ''),
    });
    if (verdict.kind !== 'unaccounted') return;
    console.log(describeAccounting(verdict));
    // Hardening only. Vitest has already set this when a module is failed, so
    // this is a floor under the claim rather than a change to the run.
    process.exitCode = process.exitCode === 0 || process.exitCode === undefined ? 1 : process.exitCode;
  }
}
