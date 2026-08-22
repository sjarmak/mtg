/**
 * How wide an unstated sim pool opens, and the wiring that makes the answer
 * reach a real pool.
 *
 * The arithmetic here is cheap to assert and easy to get wrong in the direction
 * that costs a whole gate: a pool that narrows itself on a machine it owns
 * would turn `npm run slice` into the serial run the pool was introduced to
 * replace. So both directions are asserted, and the last block checks the
 * detection against the runner this file is running under rather than against a
 * fixture of it — a sizing rule that never recognizes a test worker is a rule
 * that changes nothing and reports success.
 */
import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  MIN_TEST_WORKER_POOL,
  TEST_WORKER_CORE_SHARE,
  defaultSimWorkers,
  insideTestWorker,
  poolSize,
} from '@mtg/sim';

describe('the width of a pool nobody sized', () => {
  it('takes the whole machine when the caller owns the machine', () => {
    expect(defaultSimWorkers({ cores: 16, insideTestWorker: false })).toBe(16);
    expect(defaultSimWorkers({ cores: 4, insideTestWorker: false })).toBe(4);
  });

  it('takes a share of it when the caller is already a worker of some other pool', () => {
    expect(defaultSimWorkers({ cores: 16, insideTestWorker: true })).toBe(4);
    expect(defaultSimWorkers({ cores: 32, insideTestWorker: true })).toBe(8);
  });

  /**
   * The floor is what keeps the reduction from becoming a serial run: at one
   * worker the balance gate's 10,035 games take minutes. A small box therefore
   * stops narrowing rather than narrowing to nothing.
   */
  it('never narrows past the floor, and never past the cores it was given', () => {
    expect(defaultSimWorkers({ cores: 4, insideTestWorker: true })).toBe(MIN_TEST_WORKER_POOL);
    expect(defaultSimWorkers({ cores: 1, insideTestWorker: true })).toBe(1);
    expect(defaultSimWorkers({ cores: 2, insideTestWorker: true })).toBe(2);
  });

  it('states its share rather than hiding a number in the arithmetic', () => {
    const cores = 64;
    expect(defaultSimWorkers({ cores, insideTestWorker: true })).toBe(cores * TEST_WORKER_CORE_SHARE);
  });

  it('lets a pinned value win outright, so a measurement can be reproduced', () => {
    expect(defaultSimWorkers({ cores: 16, insideTestWorker: true, override: '11' })).toBe(11);
    expect(defaultSimWorkers({ cores: 16, insideTestWorker: false, override: '1' })).toBe(1);
    expect(defaultSimWorkers({ cores: 16, insideTestWorker: true, override: '' })).toBe(4);
  });

  it('refuses a pin that is not a positive whole number of workers', () => {
    for (const bad of ['0', '-2', '2.5', 'eight']) {
      expect(() => defaultSimWorkers({ cores: 16, insideTestWorker: true, override: bad })).toThrow(
        /MTG_SIM_WORKERS/,
      );
    }
  });
});

describe('recognizing a test worker', () => {
  it('reads the variables the runner sets on every worker it forks', () => {
    expect(insideTestWorker({ VITEST_WORKER_ID: '3' })).toBe(true);
    expect(insideTestWorker({ VITEST_POOL_ID: '1' })).toBe(true);
    expect(insideTestWorker({})).toBe(false);
    expect(insideTestWorker({ PATH: '/usr/bin' })).toBe(false);
  });

  /**
   * The assertion that cannot be satisfied by a fixture: this file is running
   * inside the runner the rule is about, so the rule either recognizes it here
   * or recognizes nothing anywhere.
   */
  it('recognizes the runner this test is running under', () => {
    expect(insideTestWorker(process.env)).toBe(true);
  });
});

describe('the rule reaches a real pool', () => {
  it('sizes an unstated pool through it', () => {
    expect(poolSize(undefined)).toBe(
      defaultSimWorkers({
        cores: availableParallelism(),
        insideTestWorker: insideTestWorker(process.env),
        override: process.env['MTG_SIM_WORKERS'],
      }),
    );
  });

  it('leaves a width the caller stated exactly where the caller put it', () => {
    expect(poolSize(4)).toBe(4);
    expect(poolSize(1)).toBe(1);
    expect(poolSize(64)).toBe(64);
  });
});
