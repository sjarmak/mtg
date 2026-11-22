/**
 * The two halves of load attribution, and the wiring that makes either of them
 * reach a reader.
 *
 * A diagnostic that is not wired in is worse than no diagnostic: it looks like
 * the question was answered. So the last block here reads the root
 * `vitest.config.ts` and fails when the reporter is dropped out of `reporters`
 * or the pool sizing is dropped out of `maxWorkers`, and the first two blocks
 * check that the judgment those two make is the judgment they were measured
 * into making.
 *
 * It lives in `packages/slice` for the reason the workspace roster and the
 * spelling scan do: this is a gate over the repository rather than over one
 * package, and a repo-root test directory would sit outside `eslint packages`,
 * outside the prettier glob and outside vitest's own include.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LoadSample } from '../tools/test-load/attribution';
import {
  CONTENDED_LAG_MS,
  NEAR_LIMIT_FRACTION,
  SATURATED_LAG_MS,
  SATURATED_LOAD_PER_CORE,
  SELF_CROWD_CORE_SHARE,
  VERDICT_MARKER,
  annotateTimeout,
  contentionOf,
  describeNearLimit,
  describeTimeout,
  durationIsMeaningful,
  loadOver,
  outsideLoad,
  timedOutAtMs,
} from '../tools/test-load/attribution';
import { WORKER_SHARE, runSharers, testWorkerCount, testWorkerOverride } from '../tools/test-load/workers';

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORES = 16;

function sample(at: number, load1: number, lagMs = 0, runningFiles = 1): LoadSample {
  return { at, load1, lagMs, runningFiles };
}

describe('reading a timeout off its error', () => {
  // Vitest builds this string in `@vitest/runner`; the number in it is the
  // budget the runner actually applied, which is the one fact a docblock about
  // a budget can get wrong.
  const REAL = 'Test timed out in 5000ms.\nIf this is a long-running test, pass a timeout value';

  it('takes the budget from the message the runner wrote', () => {
    expect(timedOutAtMs(REAL)).toBe(5000);
    expect(timedOutAtMs('Hook timed out in 30000ms.')).toBe(30_000);
  });

  it('says nothing about an ordinary failure, so an assertion is never reclassified', () => {
    expect(timedOutAtMs('expected 3 to be 4')).toBeNull();
    expect(timedOutAtMs('the request timed out')).toBeNull();
    expect(timedOutAtMs(undefined)).toBeNull();
  });
});

describe('what the machine was doing', () => {
  it('summarizes only the samples inside the test that failed', () => {
    const samples = [sample(0, 60, 400, 40), sample(1_000, 8, 1, 2), sample(2_000, 9, 2, 3)];
    const window = loadOver(samples, 900, 2_100);
    expect(window).not.toBeNull();
    expect(window?.peakLoad1).toBe(9);
    expect(window?.peakLagMs).toBe(2);
    expect(window?.peakRunningFiles).toBe(3);
    expect(window?.samples).toBe(2);
  });

  it('borrows the nearest reading for a test shorter than one interval, and marks it', () => {
    const window = loadOver([sample(0, 40), sample(1_000, 5)], 1_100, 1_150);
    expect(window?.peakLoad1).toBe(5);
    // Zero is how the caller knows to say the reading came from beside the test
    // rather than during it.
    expect(window?.samples).toBe(0);
  });

  it('reports nothing when nothing was sampled, rather than an invented quiet machine', () => {
    expect(loadOver([], 0, 1_000)).toBeNull();
  });
});

describe('the verdict', () => {
  it('calls a machine past twice its cores load, which is where the recorded failures start', () => {
    const window = loadOver([sample(0, CORES * SATURATED_LOAD_PER_CORE)], -1, 1);
    expect(window).not.toBeNull();
    if (window === null) return;
    expect(contentionOf(CORES, window)).toBe('saturated');
  });

  it('calls a quiet machine a real failure, so a genuine break is never excused', () => {
    const window = loadOver([sample(0, 2, 3, 4)], -1, 1);
    expect(window).not.toBeNull();
    if (window === null) return;
    expect(contentionOf(CORES, window)).toBe('quiet');
    expect(describeTimeout(CORES, { file: 'a.test.ts', name: 'x', budgetMs: 5_000, load: window })).toContain(
      'NOT LOAD',
    );
  });

  // The reading that produced the wrong verdict, taken from a reproduction of
  // mtg-w45's two predicted failures on this box: 9.4 on 16 cores with 14 of
  // this run's own test files in flight. The old vocabulary had nothing to say
  // about a run that fills the machine itself, so it called that quiet and told
  // the reader to go find a defect.
  it('does not call a machine quiet while this run was the one filling it', () => {
    const window = loadOver([sample(0, 9.4, 14, 14)], -1, 1);
    expect(window).not.toBeNull();
    if (window === null) return;
    expect(outsideLoad(window)).toBe(0);
    expect(contentionOf(CORES, window)).toBe('crowded');

    const line = annotateTimeout(CORES, window);
    expect(line).not.toContain('NOT LOAD');
    expect(line).toContain('FROM THIS RUN ITSELF');
    // The count is the evidence for the claim, so it is stated rather than implied.
    expect(line).toContain('14 of its own test files in flight on 16 cores');
    expect(line).toContain('at most 0.0 of that load came from outside it');
  });

  it('still blames the outside when the load cannot be this run', () => {
    // Two files in flight and a load of 20: eighteen of that is somebody else's.
    const window = loadOver([sample(0, 20, 3, 2)], -1, 1);
    expect(window).not.toBeNull();
    if (window === null) return;
    expect(outsideLoad(window)).toBe(18);
    expect(contentionOf(CORES, window)).toBe('contended');
    expect(annotateTimeout(CORES, window)).toContain('FROM OUTSIDE THIS RUN');
  });

  it('draws the self-crowding line at half the cores in files', () => {
    expect(SELF_CROWD_CORE_SHARE).toBe(0.5);
    const at = loadOver([sample(0, 1, 0, CORES * SELF_CROWD_CORE_SHARE)], -1, 1);
    const under = loadOver([sample(0, 1, 0, CORES * SELF_CROWD_CORE_SHARE - 1)], -1, 1);
    expect(at === null || under === null).toBe(false);
    if (at === null || under === null) return;
    expect(contentionOf(CORES, at)).toBe('crowded');
    expect(contentionOf(CORES, under)).toBe('quiet');
  });

  it('keeps calling a saturated box saturated whoever saturated it', () => {
    // Past twice the cores a timeout measures the queue, and which run filled
    // the queue does not change what the number means or what to do about it.
    const window = loadOver([sample(0, CORES * SATURATED_LOAD_PER_CORE, 3, 15)], -1, 1);
    expect(window).not.toBeNull();
    if (window === null) return;
    expect(contentionOf(CORES, window)).toBe('saturated');
  });

  // The load average lags a minute behind a wave that just started, so a
  // reading taken from this process's own lateness has to be able to reach the
  // verdict on its own.
  it('reads a starved collator as load even while the load average is still catching up', () => {
    const lagging = loadOver([sample(0, 1, SATURATED_LAG_MS)], -1, 1);
    expect(lagging).not.toBeNull();
    if (lagging === null) return;
    expect(contentionOf(CORES, lagging)).toBe('saturated');

    const mild = loadOver([sample(0, 1, CONTENDED_LAG_MS)], -1, 1);
    expect(mild).not.toBeNull();
    if (mild === null) return;
    expect(contentionOf(CORES, mild)).toBe('contended');
  });

  it('says so when it has no reading at all, instead of guessing', () => {
    const block = describeTimeout(CORES, { file: 'a.test.ts', name: 'x', budgetMs: 5_000, load: null });
    expect(block).toContain('no load was sampled');
    expect(annotateTimeout(CORES, null)).toContain('not sampled');
  });
});

describe('the line that rides on the error itself', () => {
  // Vitest prints its failure dump last and that dump is the first thing an
  // agent reads. A verdict that lives only in a block further up the scrollback
  // is a verdict that gets scrolled past, so this is the load-bearing half.
  it('carries the numbers and the verdict, under a marker the reporter can recognize', () => {
    const window = loadOver([sample(0, 62, 410, 38)], -1, 1);
    expect(window).not.toBeNull();
    const line = annotateTimeout(CORES, window);
    expect(line).toContain(VERDICT_MARKER);
    expect(line).toContain('62.0 on 16 cores');
    expect(line).toContain('38 test files in flight');
    expect(line).toContain('410ms late');
    expect(line).toContain('LOAD');
  });

  it('is recognizable in an already-annotated message, so a retry is not annotated twice', () => {
    const window = loadOver([sample(0, 62, 410, 38)], -1, 1);
    const once = `Test timed out in 5000ms.${annotateTimeout(CORES, window)}`;
    expect(once.includes(VERDICT_MARKER)).toBe(true);
  });
});

describe('the tests that time out next', () => {
  it('names what a test spent as a share of what it was allowed', () => {
    const line = describeNearLimit({
      file: 'packages/slice/test/bench.test.ts',
      name: 'measures throughput',
      budgetMs: 5_000,
      durationMs: 3_021,
    });
    expect(line).toContain('3021ms of a 5000ms budget (60%)');
  });

  it('draws the line at half a budget, which is what a doubled wall clock spends', () => {
    expect(NEAR_LIMIT_FRACTION).toBe(0.5);
  });

  // The list is a claim about a test, so it is built only from readings the
  // evening did not distort. It cannot use the load average for that: a run's
  // own fifteen workers put a sixteen-core box at fifteen by themselves, and a
  // filter on load would throw out every full suite and build no list at all.
  it('keeps a reading taken while this run had the machine to itself', () => {
    // Sixteen cores carrying twenty: a full suite plus the balance sweep's own
    // pool, and nothing else. The verdict calls that `crowded` — thirty files
    // of this run's own are more than the twenty, so none of it is outside —
    // and the near-limit list keeps it anyway, because the collator was never
    // held off a core and the durations are therefore the tests' own.
    const own = loadOver([sample(0, 20, 3, 30)], -1, 1);
    expect(own).not.toBeNull();
    if (own === null) return;
    expect(contentionOf(CORES, own)).toBe('crowded');
    expect(durationIsMeaningful(own)).toBe(true);
  });

  it('throws out a reading taken while something outside the run held the cores', () => {
    const borrowed = loadOver([sample(0, 15, CONTENDED_LAG_MS, 30)], -1, 1);
    expect(borrowed).not.toBeNull();
    if (borrowed === null) return;
    expect(durationIsMeaningful(borrowed)).toBe(false);
  });
});

describe('how much of the machine a run asks for', () => {
  it('caps every ordinary run at the share that minimized loaded wall clock', () => {
    const cap = Math.round(CORES * WORKER_SHARE);
    expect(testWorkerCount({ cores: CORES })).toBe(cap);
  });

  it('hands the whole decision to an override, so the measurement can be reproduced', () => {
    expect(testWorkerCount({ cores: CORES, override: '15' })).toBe(15);
    expect(testWorkerCount({ cores: CORES, override: '' })).toBe(Math.round(CORES * WORKER_SHARE));
    expect(() => testWorkerCount({ cores: CORES, override: 'lots' })).toThrow(/positive integer/);
    expect(() => testWorkerCount({ cores: CORES, override: '0' })).toThrow(/positive integer/);
  });

  it('is a share of the machine and never a budget, on a single core as much as on sixteen', () => {
    expect(testWorkerCount({ cores: 1 })).toBe(1);
    expect(testWorkerCount({ cores: 2 })).toBe(1);
  });

  // mtg-a3ix4. Every worker slot sized its pool against the whole machine as
  // though it were alone, so three slots each took the half and the box carried
  // three halves. This is the case that fails when the cap stops dividing.
  it('divides the half-machine budget among the runs sharing it', () => {
    const budget = Math.round(CORES * WORKER_SHARE);
    expect(testWorkerCount({ cores: CORES, sharers: 1 })).toBe(budget);
    expect(testWorkerCount({ cores: CORES, sharers: 2 })).toBe(4);
    expect(testWorkerCount({ cores: CORES, sharers: 3 })).toBe(2);
    expect(testWorkerCount({ cores: CORES, sharers: 3 })).toBeLessThan(testWorkerCount({ cores: CORES }));
  });

  it('never lets the runs it sized add up to more than the budget, until each is down to one worker', () => {
    const budget = Math.round(CORES * WORKER_SHARE);
    for (let sharers = 1; sharers <= 12; sharers += 1) {
      const each = testWorkerCount({ cores: CORES, sharers });
      expect(each).toBeGreaterThanOrEqual(1);
      expect(each * sharers).toBeLessThanOrEqual(Math.max(budget, sharers));
    }
  });

  it('still lets an override win outright, and still refuses a sharer count that is not a count', () => {
    expect(testWorkerCount({ cores: CORES, override: '15', sharers: 3 })).toBe(15);
    expect(() => testWorkerCount({ cores: CORES, sharers: 0 })).toThrow(/positive integer/);
    expect(() => testWorkerCount({ cores: CORES, sharers: 1.5 })).toThrow(/positive integer/);
  });
});

describe('how many runs share the worker budget', () => {
  it('is one for a run that is alone and not in a pool', () => {
    expect(runSharers({ liveOthers: 0 })).toBe(1);
    expect(runSharers({ slots: '', liveOthers: 0 })).toBe(1);
  });

  it('counts the runs already live, and itself', () => {
    expect(runSharers({ liveOthers: 2 })).toBe(3);
  });

  it('takes the pool at its word about how many runs it starts, before any of them has claimed', () => {
    expect(runSharers({ slots: '3', liveOthers: 0 })).toBe(3);
  });

  it('is argued up by claims beyond the pool, never down by fewer of them', () => {
    expect(runSharers({ slots: '3', liveOthers: 1 })).toBe(3);
    expect(runSharers({ slots: '3', liveOthers: 4 })).toBe(5);
  });

  it('says so when MTG_TEST_SLOTS is not a count', () => {
    expect(() => runSharers({ slots: 'lots', liveOthers: 0 })).toThrow(
      /MTG_TEST_SLOTS must be a positive integer/,
    );
    expect(() => runSharers({ slots: '0', liveOthers: 0 })).toThrow(
      /MTG_TEST_SLOTS must be a positive integer/,
    );
  });
});

describe('testWorkerOverride', () => {
  it('forces a single worker under the Forge bridge, whatever MTG_TEST_WORKERS says', () => {
    expect(testWorkerOverride({ MTG_REQUIRE_FORGE_BRIDGE: '1', MTG_TEST_WORKERS: '15' })).toBe('1');
    expect(testWorkerOverride({ MTG_REQUIRE_FORGE_BRIDGE: '1', MTG_TEST_WORKERS: undefined })).toBe('1');
  });

  // mtg-b9eom review item 1: the first version only recognized
  // MTG_REQUIRE_FORGE_BRIDGE, so the other three opt-in flags ran unpinned to
  // one worker beside a JVM they themselves started. One case per flag so
  // none of the four can silently drop out of isForgeRequiredRun again.
  it('forces a single worker under each of the other three Forge-required flags', () => {
    expect(testWorkerOverride({ MTG_REQUIRE_FORGE_BOTS: '1', MTG_TEST_WORKERS: '15' })).toBe('1');
    expect(testWorkerOverride({ MTG_REQUIRE_PRINTED_NATIVE_SMOKE: '1', MTG_TEST_WORKERS: '15' })).toBe('1');
    expect(testWorkerOverride({ MTG_REQUIRE_PRINTED_ADMISSIONS: '1', MTG_TEST_WORKERS: '15' })).toBe('1');
  });

  it('leaves MTG_TEST_WORKERS untouched when the Forge bridge is not required', () => {
    expect(testWorkerOverride({ MTG_REQUIRE_FORGE_BRIDGE: undefined, MTG_TEST_WORKERS: '4' })).toBe('4');
    expect(testWorkerOverride({ MTG_REQUIRE_FORGE_BRIDGE: '0', MTG_TEST_WORKERS: '4' })).toBe('4');
    expect(
      testWorkerOverride({ MTG_REQUIRE_FORGE_BRIDGE: undefined, MTG_TEST_WORKERS: undefined }),
    ).toBeUndefined();
  });
});

describe('the wiring', () => {
  const config = readFileSync(join(WORKSPACE_ROOT, 'vitest.config.ts'), 'utf8');

  it('runs the reporter, so a timeout in any project says what the machine was doing', () => {
    expect(config).toContain("'./packages/slice/tools/test-load/reporter.ts'");
    expect(config).toMatch(
      /reporters:\s*\[\s*'default',\s*TEST_LOAD_REPORTER,\s*RPC_TIMEOUT_REPORTER,\s*UNACCOUNTED_REPORTER,/,
    );
  });

  // The one that decides rather than reports, so it is wired separately and
  // checked separately. Unwired it would leave the balance gate's exit code a
  // reading of how busy the box was, which is mtg-c9bc.
  it('runs the transport-timeout verdict, which the regex above also pins after the attribution', () => {
    expect(config).toContain("'./packages/slice/tools/test-load/rpc-timeout.ts'");
  });

  // The one that hardens rather than excuses. Unwired, a run can mark files
  // failed and print no sentence about any of them, which is mtg-jc05.
  it('runs the accounting check, so a file that went missing is named', () => {
    expect(config).toContain("'./packages/slice/tools/test-load/unaccounted.ts'");
  });

  it('sizes the pool through the measured function rather than a number typed here', () => {
    expect(config).toContain("from './packages/slice/tools/test-load/workers'");
    expect(config).toMatch(/maxWorkers:\s*MAX_WORKERS/);
  });

  // mtg-a3ix4. Unwired, the cap goes back to dividing the machine as though the
  // run were alone: the pure functions above stay green and the box carries a
  // half per slot again. The claim is written by the setup file and read by the
  // config, and each half is worthless without the other.
  it('sizes the pool against the runs already live, and claims a place for this one', () => {
    expect(config).toMatch(
      /sharers:\s*runSharers\(\{[^}]*MTG_TEST_SLOTS[^}]*liveRunCount\(runsDirPath\(\)\)/,
    );
    expect(config).toContain("'./packages/slice/tools/test-load/run-claim-setup.ts'");
    expect(config).toMatch(/globalSetup:\s*\[FORGE_LOCK_SETUP,\s*RUN_CLAIM_SETUP\]/);
  });

  // mtg-b9eom, the second clause of the playtester's lane ruling: a Forge-required
  // run takes exactly one worker (folded into MAX_WORKERS through
  // testWorkerOverride) and serializes against every other Forge-required run
  // on the host (globalSetup). Unwired, either half would leave a lane free to
  // run two JVM-backed cases at once, which is the load-81 finding the bead
  // was filed over.
  it('folds the Forge-run override into the pool size and wires its lock as global setup', () => {
    expect(config).toMatch(/testWorkerOverride/);
    expect(config).toMatch(/override:\s*testWorkerOverride\(process\.env\)/);
    expect(config).toContain("'./packages/slice/tools/test-load/forge-lock-setup.ts'");
    expect(config).toMatch(/globalSetup:\s*\[FORGE_LOCK_SETUP,/);
  });

  // The rule the whole bead rests on. `packages/ui/test/play/play.test.ts`
  // gates it from the runner's side by reading back the budget it was given;
  // this gates the text, because the tempting edit is the one made here. The
  // balance project keeps its own ten minutes, and is the only entry allowed
  // to name a clock at all: a sweep of 10,035 seeded games is slow by nature,
  // where a unit test that needs more than five seconds is a finding.
  it('raises no timeout outside the balance project', () => {
    const balance = config.indexOf("name: 'balance'");
    expect(balance).toBeGreaterThan(0);
    const clocks = [...config.matchAll(/testTimeout|hookTimeout/g)].map((match) => match.index);
    expect(clocks.length).toBeGreaterThan(0);
    for (const at of clocks) expect(at).toBeGreaterThan(balance);
  });
});
