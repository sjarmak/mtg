/**
 * The check that separates the red the machine caused from the red the diff did.
 *
 * The silent direction is the one worth guarding, and it is the opposite of
 * `unaccounted.test.ts`'s. There, a missing sentence costs a reader a re-run.
 * Here, a WRONG sentence costs them the bug: a file called timeout-only that
 * held a real assertion failure tells an agent their diff is innocent when it is
 * not. So every clause of `timeoutOnlyModule` has a case below, and each one is
 * a way a failed file earns its red on merit.
 *
 * It lives in `packages/slice` for the reason `test-load.test.ts` and
 * `unaccounted.test.ts` do: it judges the repository's test runner rather than
 * any one package.
 */
import { describe, expect, it } from 'vitest';
import type { TestModule } from 'vitest/node';
import { redShapeOf } from '../tools/test-load/reporter';
import {
  TIMEOUT_ONLY_MARKER,
  classifyTimeoutOnly,
  describeTimeoutOnly,
} from '../tools/test-load/timeout-only';
import type { MachineSummary, RedModuleShape } from '../tools/test-load/timeout-only';

function module(overrides: Partial<RedModuleShape> = {}): RedModuleShape {
  return {
    moduleId: 'packages/kernel/test/vignette.test.ts',
    state: 'passed',
    scopeErrors: [],
    failedTests: [],
    ...overrides,
  };
}

/** The shape mtg-8qhy recorded: red, and red only at the clock. */
const CLOCKED = module({
  moduleId: 'packages/kernel/test/block-enumeration.test.ts',
  state: 'failed',
  failedTests: [{ name: 'enumerates every legal block', budgetMs: 20_000 }],
});

/**
 * The shape mtg-melhj recorded: a 10s `beforeAll` died, so the suite carries the
 * error and the tests under it were skipped. No test failed at all.
 */
const HOOK_CLOCKED = module({
  moduleId: 'packages/kernel/test/hook-clocked.test.ts',
  state: 'failed',
  scopeErrors: [{ scope: 'quirion dryad', budgetMs: 10_000 }],
});

/** Red on merit, so the subtraction must leave it alone. */
const ASSERTED = module({
  moduleId: 'packages/kernel/test/crop.test.ts',
  state: 'failed',
  failedTests: [{ name: 'crops to the art window', budgetMs: null }],
});

const BOX: MachineSummary = { cores: 16, peakLoad1: 31.6, peakRunningFiles: 8 };

describe('a failed file whose every failure was a clock', () => {
  it('is named, with the budget each test ran out of', () => {
    const verdict = classifyTimeoutOnly([module(), CLOCKED]);
    expect(verdict.kind).toBe('timeout-only');
    if (verdict.kind !== 'timeout-only') return;
    expect(verdict.modules).toEqual([{ moduleId: CLOCKED.moduleId, timeouts: CLOCKED.failedTests }]);
  });

  it('states the share against every failed file, not against the whole run', () => {
    const verdict = classifyTimeoutOnly([module(), module(), CLOCKED, ASSERTED]);
    if (verdict.kind !== 'timeout-only') throw new Error('expected a timeout-only verdict');
    expect(verdict.redFiles).toBe(2);
    expect(describeTimeoutOnly(verdict, BOX)).toContain('1 of 2 failed test file(s)');
  });

  it('prints the marker, the path, the box and the command that settles it', () => {
    const text = describeTimeoutOnly(classifyTimeoutOnly([CLOCKED]), BOX);
    expect(text).toContain(TIMEOUT_ONLY_MARKER);
    expect(text).toContain(CLOCKED.moduleId);
    expect(text).toContain('20000ms budget');
    expect(text).toContain('16 cores, peak 1-minute load 31.6 (2.0x per core)');
    expect(text).toContain(`MTG_TEST_WORKERS=1 npx vitest run ${CLOCKED.moduleId}`);
    expect(text).toContain('exit code is unchanged');
    expect(text).toContain('mtg-8qhy');
  });

  it('offers one re-run over all of them, because that is how the finding was made', () => {
    const second = module({
      moduleId: 'packages/kernel/test/m13-turn-block-rules.test.ts',
      state: 'failed',
      failedTests: [{ name: 'ends the turn', budgetMs: 20_000 }],
    });
    const text = describeTimeoutOnly(classifyTimeoutOnly([CLOCKED, second]), BOX);
    expect(text).toContain(`npx vitest run ${CLOCKED.moduleId} ${second.moduleId}`);
  });

  it('names a file whose beforeAll ran out of time, though no test in it failed', () => {
    const verdict = classifyTimeoutOnly([module(), HOOK_CLOCKED]);
    if (verdict.kind !== 'timeout-only') throw new Error('expected a timeout-only verdict');
    expect(verdict.modules).toEqual([
      { moduleId: HOOK_CLOCKED.moduleId, timeouts: [{ name: 'a hook in quirion dryad', budgetMs: 10_000 }] },
    ]);
    expect(describeTimeoutOnly(verdict, BOX)).toContain('a hook in quirion dryad (10000ms budget)');
  });

  it('names a hook that sits outside every describe as the file the hook is in', () => {
    const verdict = classifyTimeoutOnly([
      module({ state: 'failed', scopeErrors: [{ scope: null, budgetMs: 10_000 }] }),
    ]);
    if (verdict.kind !== 'timeout-only') throw new Error('expected a timeout-only verdict');
    expect(verdict.modules[0]?.timeouts).toEqual([{ name: 'a hook at file level', budgetMs: 10_000 }]);
  });

  it('counts a hook timeout and a test timeout in one file as one clock', () => {
    const both = module({
      state: 'failed',
      scopeErrors: [{ scope: 'draws', budgetMs: 10_000 }],
      failedTests: [{ name: 'draws seven', budgetMs: 5_000 }],
    });
    const verdict = classifyTimeoutOnly([both]);
    if (verdict.kind !== 'timeout-only') throw new Error('expected a timeout-only verdict');
    expect(verdict.modules[0]?.timeouts).toHaveLength(2);
    expect(describeTimeoutOnly(verdict, BOX)).toContain('2 timeout(s)');
  });

  it('counts a file whose afterAll ran out of time while every test passed', () => {
    const teardown = module({ state: 'failed', scopeErrors: [{ scope: 'draws', budgetMs: 30_000 }] });
    expect(classifyTimeoutOnly([teardown]).kind).toBe('timeout-only');
  });

  it('says so plainly when nothing sampled the box', () => {
    const text = describeTimeoutOnly(classifyTimeoutOnly([CLOCKED]), null);
    expect(text).toContain('not sampled');
    expect(text).not.toContain('peak 1-minute load');
  });
});

describe('a failed file that earned its red', () => {
  it('is left alone when one of its failures was an assertion', () => {
    expect(classifyTimeoutOnly([ASSERTED])).toEqual({ kind: 'clean' });
  });

  it('is left alone when a timeout sits beside an assertion failure in one file', () => {
    const mixed = module({
      state: 'failed',
      failedTests: [
        { name: 'times out', budgetMs: 20_000 },
        { name: 'asserts wrongly', budgetMs: null },
      ],
    });
    expect(classifyTimeoutOnly([mixed])).toEqual({ kind: 'clean' });
  });

  it('is left alone when an error that is not a timeout is attached to the module or a suite', () => {
    const threw = module({
      state: 'failed',
      scopeErrors: [{ scope: 'draws', budgetMs: null }],
      failedTests: [{ name: 'x', budgetMs: 5_000 }],
    });
    expect(classifyTimeoutOnly([threw])).toEqual({ kind: 'clean' });
  });

  it('is left alone when a file that failed to collect has no test to blame', () => {
    const syntax = module({ state: 'failed', scopeErrors: [{ scope: null, budgetMs: null }] });
    expect(classifyTimeoutOnly([syntax])).toEqual({ kind: 'clean' });
  });

  it('is left alone when a hook timeout sits beside an error that is not one', () => {
    // One suite whose beforeAll timed out and whose afterAll threw is a suite
    // with a defect that also ran slowly, the same rule a test with two errors
    // follows.
    const mixed = module({
      state: 'failed',
      scopeErrors: [
        { scope: 'draws', budgetMs: 10_000 },
        { scope: 'draws', budgetMs: null },
      ],
    });
    expect(classifyTimeoutOnly([mixed])).toEqual({ kind: 'clean' });
  });

  it('is left alone when a hook timeout sits beside an assertion failure in the same file', () => {
    const mixed = module({
      state: 'failed',
      scopeErrors: [{ scope: 'draws', budgetMs: 10_000 }],
      failedTests: [{ name: 'asserts wrongly', budgetMs: null }],
    });
    expect(classifyTimeoutOnly([mixed])).toEqual({ kind: 'clean' });
  });

  it('leaves the file with no failed test and no error at all to the accounting check', () => {
    // `unaccounted.ts`'s subject. The two are disjoint by construction, and a
    // file named by both would be a run explaining one fact twice. A hook
    // timeout is the error that moves a file from that check to this one, so
    // without it there is nothing here to name.
    const lost = module({ state: 'failed', failedTests: [] });
    expect(classifyTimeoutOnly([lost])).toEqual({ kind: 'clean' });
  });

  it('says nothing at all about a green run', () => {
    expect(classifyTimeoutOnly([module(), module()])).toEqual({ kind: 'clean' });
    expect(describeTimeoutOnly({ kind: 'clean' }, BOX)).toBe('');
  });
});

/** The runner's own words for a hook that ran out of time, as vitest 3 writes them. */
const HOOK_TIMED_OUT =
  'Hook timed out in 10000ms.\nIf this is a long-running hook, pass a timeout value as the last argument.';

interface StubSuite {
  readonly fullName: string;
  readonly errors: readonly string[];
}

/** Only the parts of a vitest module `redShapeOf` touches, so no run is needed. */
function stubModule(moduleErrors: readonly string[], suites: readonly StubSuite[]): TestModule {
  const stub = {
    moduleId: `${process.cwd()}/packages/kernel/test/hook-clocked.test.ts`,
    state: () => 'failed',
    errors: () => moduleErrors.map((message) => ({ message })),
    children: {
      allSuites: () =>
        suites.map((suite) => ({
          fullName: suite.fullName,
          errors: () => suite.errors.map((message) => ({ message })),
        })),
      allTests: () => [],
    },
  };
  return stub as unknown as TestModule;
}

describe('the shape read off a real module', () => {
  it('keeps the budget of a hook timeout and the suite it was attached to', () => {
    const shape = redShapeOf(stubModule([], [{ fullName: 'quirion dryad', errors: [HOOK_TIMED_OUT] }]));
    expect(shape.scopeErrors).toEqual([{ scope: 'quirion dryad', budgetMs: 10_000 }]);
    expect(shape.moduleId).toBe('packages/kernel/test/hook-clocked.test.ts');
    expect(classifyTimeoutOnly([shape]).kind).toBe('timeout-only');
  });

  it('reads an error on the file itself as file-level', () => {
    const shape = redShapeOf(stubModule([HOOK_TIMED_OUT], []));
    expect(shape.scopeErrors).toEqual([{ scope: null, budgetMs: 10_000 }]);
  });

  it('gives an error that is not a timeout no budget, so the file stays red on merit', () => {
    const shape = redShapeOf(
      stubModule([], [{ fullName: 'quirion dryad', errors: [HOOK_TIMED_OUT, 'fixture missing'] }]),
    );
    expect(shape.scopeErrors.map((error) => error.budgetMs)).toEqual([10_000, null]);
    expect(classifyTimeoutOnly([shape])).toEqual({ kind: 'clean' });
  });
});
