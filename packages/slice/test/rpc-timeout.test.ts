/**
 * The verdict that decides whether a lost reporting channel is allowed to be a
 * run's exit code.
 *
 * Both directions are gated here and the second one is the load-bearing half.
 * A gate that excuses a transport timeout is worth having only if it still
 * fails a run where anything at all is wrong, so every refusal in
 * `rpc-timeout.ts` has a case below, and each of them stands for a way a
 * dropped result could otherwise ride out of the run as a pass.
 *
 * It lives in `packages/slice` for the reason `test-load.test.ts` does: this
 * judges the repository's test runner rather than any one package.
 */
import { describe, expect, it } from 'vitest';
import {
  RPC_TIMEOUT_MARKER,
  classifyRun,
  describeRpcTimeout,
  rpcTimeoutMethod,
} from '../tools/test-load/rpc-timeout';
import type { RunShape } from '../tools/test-load/rpc-timeout';

/** The message vitest's worker actually wrote, three times, on 2026-08-20. */
const RECORDED = '[vitest-worker]: Timeout calling "onTaskUpdate"';

/** A run that passed everything and lost the reporting channel on the way out. */
function healthyRun(overrides: Partial<RunShape> = {}): RunShape {
  return {
    reason: 'passed',
    unhandledMessages: [RECORDED],
    moduleStates: ['passed', 'passed'],
    testStates: ['passed', 'passed', 'skipped'],
    ...overrides,
  };
}

describe('reading a transport timeout off its error', () => {
  it('takes the method from each of the three shapes vitest writes', () => {
    expect(rpcTimeoutMethod(RECORDED)).toBe('onTaskUpdate');
    expect(rpcTimeoutMethod('[vitest-api]: Timeout calling "onCollected"')).toBe('onCollected');
    expect(rpcTimeoutMethod('[birpc] timeout on calling "fetch"')).toBe('fetch');
    // The worker's error reaches the collating process serialized, and a
    // rejection arrives with its class in front of the message.
    expect(rpcTimeoutMethod(`Error: ${RECORDED}`)).toBe('onTaskUpdate');
  });

  it('says nothing about any other error, so a real one is never reclassified', () => {
    expect(rpcTimeoutMethod('expected 3 to be 4')).toBeNull();
    expect(rpcTimeoutMethod('Test timed out in 5000ms.')).toBeNull();
    expect(rpcTimeoutMethod('the request timed out')).toBeNull();
    expect(rpcTimeoutMethod(undefined)).toBeNull();
  });
});

describe('a run that lost only its reporting channel', () => {
  it('is excused, which is the whole of mtg-c9bc', () => {
    const verdict = classifyRun(healthyRun());
    expect(verdict.kind).toBe('excused');
    if (verdict.kind !== 'excused') return;
    expect(verdict.methods).toEqual(['onTaskUpdate']);
    const block = describeRpcTimeout(verdict);
    expect(block).toContain(RPC_TIMEOUT_MARKER);
    expect(block).toContain('NOT A TEST FAILURE');
    expect(block).toContain('"onTaskUpdate"');
  });

  it('says nothing at all when no channel was lost, so an ordinary run is quiet', () => {
    const verdict = classifyRun(healthyRun({ unhandledMessages: [] }));
    expect(verdict.kind).toBe('none');
    expect(describeRpcTimeout(verdict)).toBe('');
  });
});

describe('every way the exit code keeps standing', () => {
  function stands(shape: RunShape): string {
    const verdict = classifyRun(shape);
    expect(verdict.kind).toBe('stands');
    return describeRpcTimeout(verdict);
  }

  it('refuses when any other unhandled error came with it', () => {
    const block = stands(
      healthyRun({ unhandledMessages: [RECORDED, 'Cannot read properties of undefined'] }),
    );
    expect(block).toContain('THE EXIT CODE STANDS');
    expect(block).toContain('1 other unhandled error(s)');
  });

  it('refuses when a test failed, so a broken set still fails the gate', () => {
    const block = stands(healthyRun({ reason: 'failed', testStates: ['passed', 'failed'] }));
    expect(block).toContain('ended "failed"');
  });

  it('refuses an interrupted run, which measured only as far as the interrupt', () => {
    expect(stands(healthyRun({ reason: 'interrupted' }))).toContain('ended "interrupted"');
  });

  // A timeout on the channel that loads modules is a module that never ran. The
  // reporting channel is the only one whose loss is purely a lost sentence.
  it('refuses a timeout on the module-loading channel', () => {
    const block = stands(healthyRun({ unhandledMessages: ['[vitest-worker]: Timeout calling "fetch"'] }));
    expect(block).toContain('loads modules rather than reports results');
  });

  // The reverse risk the bead names: the call that timed out is the one that
  // carries results, so a run that cannot account for every result it collected
  // is exactly the run that must not be excused.
  it('refuses when a module never settled', () => {
    expect(stands(healthyRun({ moduleStates: ['passed', 'queued'] }))).toContain('never settled');
    expect(stands(healthyRun({ moduleStates: ['passed', 'pending'] }))).toContain('never settled');
  });

  it('refuses when a collected test never reported a result', () => {
    const block = stands(healthyRun({ testStates: ['passed', 'pending'] }));
    expect(block).toContain('1 collected test(s) never reported a result');
  });

  it('refuses a run that reported no tests, which has nothing to be a function of', () => {
    expect(stands(healthyRun({ moduleStates: [], testStates: [] }))).toContain('reported no tests at all');
  });
});
