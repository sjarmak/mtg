/**
 * The one failure in this workspace that nobody wrote and no assertion can
 * catch: the channel a worker reports its results over running out of time.
 *
 * Vitest's worker talks to the collating process over birpc, and every call it
 * makes carries a 60-second deadline that is compiled into
 * `node_modules/vitest/dist/chunks/index.B521nVV-.js` as `DEFAULT_TIMEOUT`.
 * Neither `createForksRpcOptions` nor `createThreadsRpcOptions` passes a
 * `timeout`, and 3.2.7 exposes no config option that reaches it — checked
 * against the installed dist rather than assumed, because the obvious fix here
 * is a number in `vitest.config.ts` and there is no number to write. When the
 * deadline passes the worker throws `[vitest-worker]: Timeout calling
 * "onTaskUpdate"`, vitest collects it as an unhandled error, and
 * `_checkUnhandledErrors` sets the exit code to 1 without any test having
 * failed.
 *
 * That is how `npm run test:balance` came to exit 1 while printing 105 passed
 * assertions and a fair verdict on the flagship set, three times on 2026-08-20
 * at three different commits (mtg-c9bc). The balance gate runs single cases of
 * 200 to 400 seconds, so one worker holds a task open far past the deadline,
 * and whether the collating process answers in time is a reading of how busy
 * the box was — which makes the gate's exit code a function of the machine
 * rather than of the format. A gate whose exit code is not a function of its
 * own tracked state is worth less than no gate.
 *
 * **The reverse direction is the reason this file is narrow.** Vitest's own
 * message says an unhandled error "might cause false positive tests", and it is
 * right: the call that timed out is the one that carries results, so a lost
 * update is a failing test the collating process never heard about. Excusing
 * every unhandled error — which is what `dangerouslyIgnoreUnhandledErrors`
 * does — would trade a gate that fails when the box is busy for a gate that
 * passes when the code is broken, and that is the worse of the two. So the
 * excuse is granted only when all six of these hold, and the run says which one
 * it failed when it is not granted:
 *
 *   - every unhandled error is a birpc transport timeout, so nothing else is
 *     being swept up with it;
 *   - every one of them timed out on the reporting channel rather than the
 *     module-loading channel, because a `fetch` or `transform` that never
 *     answered means a module never ran;
 *   - vitest's own end-of-run verdict over the modules is `passed`;
 *   - every module settled as passed or skipped, so none is still queued or
 *     pending because its final update went missing;
 *   - no collected test is still pending, which is the same check one level
 *     down and the one that catches a dropped result directly;
 *   - the run reported at least one test, so an empty run is never excused.
 *
 * Anything else and the exit code is left exactly where vitest put it. This
 * file can turn a 1 into a 0 and never a 0 into a 1, and coverage thresholds
 * are evaluated after reporters, so they can still fail a run this excused.
 *
 * One limit to know before a run is quoted as evidence: `--reporter` on the
 * command line replaces the configured list rather than adding to it, so a run
 * given one gets vitest's own exit code and never this verdict. `npm test` and
 * `npm run test:balance` name no reporter, which is what makes the gate the
 * thing this covers.
 */
import type { Reporter, TestModule, TestRunEndReason } from 'vitest/node';

/**
 * The birpc methods a worker uses to tell the collating process what happened.
 *
 * A timeout on one of these is a lost sentence about a run that already
 * finished. A timeout on `fetch`, `transform` or `resolveId` is a module that
 * never loaded, which is a real failure however quiet the box was, so those
 * names are deliberately absent and reaching one keeps the exit code.
 */
export const REPORTING_METHODS: readonly string[] = [
  'onTaskUpdate',
  'onTaskAnnotate',
  'onUserConsoleLog',
  'onCollected',
  'onQueued',
  'onUnhandledError',
];

/**
 * The two shapes vitest gives a transport timeout, and the raw birpc one under
 * them. `rpc.-pEldfrD.js` writes the first from the worker, `cli-api` writes
 * the second from the websocket side, and `index.B521nVV-.js` writes the third
 * when neither wrapper is in the way. All three name the method in quotes,
 * which is the part this file needs.
 */
const TIMEOUT_PATTERNS: readonly RegExp[] = [
  /\[vitest-(?:worker|api)\]: Timeout calling "([^"]+)"/,
  /\[birpc\] timeout on calling "([^"]+)"/,
];

/**
 * The method a transport timeout names, or `null` for any other error.
 *
 * Null is the answer that keeps the exit code, so every message this cannot
 * parse is treated as a real unhandled error. That is the safe direction.
 */
export function rpcTimeoutMethod(message: string | undefined): string | null {
  if (message === undefined) return null;
  for (const pattern of TIMEOUT_PATTERNS) {
    const found = pattern.exec(message);
    if (found?.[1] !== undefined) return found[1];
  }
  return null;
}

/** Everything the verdict is allowed to read, as plain data a test can build. */
export interface RunShape {
  /** Vitest's own end-of-run verdict over the test modules. */
  readonly reason: TestRunEndReason;
  /** Every unhandled error's message, in the order vitest collected them. */
  readonly unhandledMessages: readonly string[];
  /** Each module's final state: `passed`, `skipped`, `failed`, `pending`, `queued`. */
  readonly moduleStates: readonly string[];
  /** Each collected test's result state: `passed`, `skipped`, `failed`, `pending`. */
  readonly testStates: readonly string[];
}

/**
 * What the run should do about the transport timeouts it saw.
 *
 * `none` is the ordinary case and prints nothing: a run with no transport
 * timeout in it has nothing to explain. The other two both print, because the
 * bead asks the run to say which of the two happened rather than to be quiet
 * about the one it excused.
 */
export type RpcTimeoutVerdict =
  | { readonly kind: 'none' }
  | { readonly kind: 'excused'; readonly methods: readonly string[] }
  | { readonly kind: 'stands'; readonly methods: readonly string[]; readonly because: string };

const SETTLED_MODULE_STATES: readonly string[] = ['passed', 'skipped'];

export function classifyRun(shape: RunShape): RpcTimeoutVerdict {
  const methods: string[] = [];
  let unparsed = 0;
  for (const message of shape.unhandledMessages) {
    const method = rpcTimeoutMethod(message);
    if (method === null) unparsed += 1;
    else methods.push(method);
  }
  if (methods.length === 0) return { kind: 'none' };

  const because = refusalReason(shape, methods, unparsed);
  return because === null ? { kind: 'excused', methods } : { kind: 'stands', methods, because };
}

/**
 * Why this run does not get the excuse, or `null` when it does.
 *
 * Ordered so the reader is told the most informative thing first: another error
 * beside the timeout, then a failing assertion, then the two ways a result can
 * go missing. Each string finishes the sentence "the exit code stands because".
 */
function refusalReason(shape: RunShape, methods: readonly string[], unparsed: number): string | null {
  if (unparsed > 0) {
    return `${unparsed} other unhandled error(s) came with it, and those are not a transport failure`;
  }
  if (shape.reason !== 'passed') {
    return `the run itself ended "${shape.reason}", so the exit code is already the assertions'`;
  }
  const loading = methods.filter((method) => !REPORTING_METHODS.includes(method));
  if (loading.length > 0) {
    return `it timed out on ${loading.join(', ')}, which loads modules rather than reports results`;
  }
  const unsettled = shape.moduleStates.filter((state) => !SETTLED_MODULE_STATES.includes(state));
  if (unsettled.length > 0) {
    return `${unsettled.length} test module(s) never settled (${[...new Set(unsettled)].join(', ')}), so a result may have been dropped`;
  }
  const pending = shape.testStates.filter((state) => state === 'pending').length;
  if (pending > 0) {
    return `${pending} collected test(s) never reported a result, so a result may have been dropped`;
  }
  if (shape.testStates.length === 0) {
    return 'the run reported no tests at all, so there is nothing for the exit code to be a function of';
  }
  return null;
}

/**
 * The marker that makes the diagnostic greppable, in a CI log as much as in a
 * scrollback. `packages/slice/test/rpc-timeout.test.ts` searches for it.
 */
export const RPC_TIMEOUT_MARKER = 'reporter RPC timeout:';

/** The block the run prints. Empty for `none`, because silence is the report. */
export function describeRpcTimeout(verdict: RpcTimeoutVerdict): string {
  if (verdict.kind === 'none') return '';
  const named = verdict.methods.map((method) => `"${method}"`).join(', ');
  const seen =
    `\n  ${RPC_TIMEOUT_MARKER} the worker waited 60s for the collating process to answer ${named}` +
    ' and gave up. That is the reporting channel between the two processes, not a test.\n';
  if (verdict.kind === 'excused') {
    return (
      seen +
      '  NOT A TEST FAILURE. Every module settled, every collected test reported, and vitest judged the' +
      ' run passed, so the exit code belongs to the assertions and this run exits 0.\n'
    );
  }
  return `${seen}  THE EXIT CODE STANDS, because ${verdict.because}.\n`;
}

/** The states of every test under a module, flattened for `classifyRun`. */
function testStatesOf(modules: readonly TestModule[]): string[] {
  const states: string[] = [];
  for (const module of modules)
    for (const test of module.children.allTests()) states.push(test.result().state);
  return states;
}

export default class RpcTimeoutReporter implements Reporter {
  onTestRunEnd(
    modules: readonly TestModule[],
    unhandledErrors: readonly { readonly message?: string }[],
    reason: TestRunEndReason,
  ): void {
    const verdict = classifyRun({
      reason,
      unhandledMessages: unhandledErrors.map((error) => error.message ?? ''),
      moduleStates: modules.map((module) => module.state()),
      testStates: testStatesOf(modules),
    });
    if (verdict.kind === 'none') return;
    console.log(describeRpcTimeout(verdict));
    // The only write to the exit code in this workspace, and it only ever
    // clears one vitest set for a reason that is not an assertion. Reporters
    // run after `_checkUnhandledErrors` and after `TestRun.end` has already
    // decided the run passed, and coverage thresholds are evaluated after
    // reporters, so nothing this touches can hide a failing test.
    if (verdict.kind === 'excused') process.exitCode = 0;
  }
}
