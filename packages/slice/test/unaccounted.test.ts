/**
 * The check that names a file the run failed without saying why.
 *
 * Both directions matter and the second is the load-bearing one. A check that
 * calls a red diagnostic-free is only useful if it stays silent on every red
 * that carries a diagnostic, because a run told twice that something went
 * missing will stop reading the sentence. So every clause in
 * `unaccountedModule` has a case below, and each stands for a way a file earns
 * its red honestly.
 *
 * It lives in `packages/slice` for the reason `test-load.test.ts` does: it
 * judges the repository's test runner rather than any one package.
 */
import { describe, expect, it } from 'vitest';
import { UNACCOUNTED_MARKER, classifyAccounting, describeAccounting } from '../tools/test-load/unaccounted';
import type { AccountingShape, ModuleShape } from '../tools/test-load/unaccounted';

function module(overrides: Partial<ModuleShape> = {}): ModuleShape {
  return {
    // The accounting mechanism is package-agnostic, so its sample path names a
    // package the public tree actually carries.
    moduleId: '/repo/packages/kernel/test/vignette.test.ts',
    state: 'passed',
    errorCount: 0,
    testStates: ['passed', 'passed'],
    ...overrides,
  };
}

function run(overrides: Partial<AccountingShape> = {}): AccountingShape {
  return { modules: [module()], unhandledMessages: [], ...overrides };
}

/**
 * The shape recorded on 2026-08-18: the file is red, its tests are not, and
 * nothing is attached to explain either fact.
 */
const LOST = module({ state: 'failed', testStates: ['pending', 'pending', 'pending'] });

describe('a file marked failed with nothing under it that failed', () => {
  it('is named, with the count of results that never arrived', () => {
    const verdict = classifyAccounting(run({ modules: [module(), LOST] }));
    expect(verdict.kind).toBe('unaccounted');
    if (verdict.kind !== 'unaccounted') return;
    expect(verdict.modules).toEqual([{ moduleId: LOST.moduleId, collected: 3, missing: 3 }]);
  });

  it('prints the marker, the path and what the reader should do instead of trusting the red', () => {
    const text = describeAccounting(classifyAccounting(run({ modules: [LOST] })));
    expect(text).toContain(UNACCOUNTED_MARKER);
    expect(text).toContain(LOST.moduleId);
    expect(text).toContain('3 of 3 unreported');
    expect(text).toContain('mtg-jc05');
    expect(text).toContain('NOT A VERDICT ON THE TREE');
  });

  it('counts the run once even when several files went missing together', () => {
    const other = module({
      moduleId: '/repo/packages/kernel/test/crop.test.ts',
      state: 'failed',
      testStates: ['pending'],
    });
    const text = describeAccounting(classifyAccounting(run({ modules: [LOST, other] })));
    expect(text).toContain('2 test file(s)');
    expect(text).toContain('4 collected test(s) never reported');
  });
});

describe('every red that carries a diagnostic', () => {
  it('says nothing when a test in the file actually failed', () => {
    const real = module({ state: 'failed', testStates: ['passed', 'failed'] });
    expect(classifyAccounting(run({ modules: [real] })).kind).toBe('clean');
  });

  it('says nothing when the file failed to collect, because that error prints itself', () => {
    const syntax = module({ state: 'failed', errorCount: 1, testStates: [] });
    expect(classifyAccounting(run({ modules: [syntax] })).kind).toBe('clean');
  });

  it('says nothing about a file that is not red at all', () => {
    for (const state of ['passed', 'skipped', 'pending', 'queued']) {
      expect(classifyAccounting(run({ modules: [module({ state })] })).kind).toBe('clean');
    }
  });

  it('prints nothing on a clean run', () => {
    expect(describeAccounting(classifyAccounting(run()))).toBe('');
  });
});

describe('the two load failures stay separately classified', () => {
  // mtg-c9bc and mtg-bj9c print their own name from `rpc-timeout.ts`, which
  // also owns that run's exit code. Two reporters telling one run two stories
  // is worse than one of them naming the file to read.
  it('defers to the transport-timeout verdict when one is in the same run', () => {
    const verdict = classifyAccounting(
      run({ modules: [LOST], unhandledMessages: ['[vitest-worker]: Timeout calling "onTaskUpdate"'] }),
    );
    expect(verdict.kind).toBe('deferred');
    if (verdict.kind !== 'deferred') return;
    expect(verdict.method).toBe('onTaskUpdate');
    expect(describeAccounting(verdict)).toBe('');
  });

  it('still speaks when the unhandled error is anything else, so a real one is never a shield', () => {
    const verdict = classifyAccounting(run({ modules: [LOST], unhandledMessages: ['expected 3 to be 4'] }));
    expect(verdict.kind).toBe('unaccounted');
  });
});
