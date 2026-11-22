/**
 * A stored red verdict keeps what its own run said about the box (`mtg-tgsol`).
 *
 * Recorded 2026-09-18 on tree 9219696a: a review run at a peak 1-minute load of
 * 41.1 on 16 cores went red on 18 files, 17 of which the run's own output
 * attributed to the clock, and the store kept the list of 18 and nothing else.
 * The next lane to read it saw a red tree. So what is guarded here is the
 * plumbing that carries the attribution from the run to the record and from the
 * record to whoever reads it, and that a record written before this existed
 * still reads. None of it changes what is recorded; `decideRecording` is
 * tested where it lives.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestModule } from 'vitest/node';
import type { LoadWindow, TimeoutFinding } from '../tools/test-load/attribution';
import { loadSource, offerLoadSource } from '../tools/test-load/load-source';
import type { MachineSummary } from '../tools/test-load/timeout-only';
import { type LoadAttribution, attributeLoad, describeReds } from '../tools/gate/load';
import GateOutcomeReporter from '../tools/gate/outcome-reporter';
import { readRecord, readReviewRecord, writeRecord, writeReviewRecord } from '../tools/gate/store';
import type { BaseRecord, ReviewRecord } from '../tools/gate/verdict';

/** The box the 2026-09-18 run had: sixteen cores, a load average past forty. */
const BOX: MachineSummary = { cores: 16, peakLoad1: 41.1, peakRunningFiles: 14 };

const SATURATED: LoadWindow = { peakLoad1: 41.1, peakLagMs: 400, peakRunningFiles: 14, samples: 4 };
const QUIET: LoadWindow = { peakLoad1: 3, peakLagMs: 2, peakRunningFiles: 2, samples: 3 };

function timeout(file: string, load: LoadWindow | null): TimeoutFinding {
  return { file, name: `${file} test`, budgetMs: 5_000, load };
}

const CLOCK_FILES = Array.from({ length: 17 }, (_, index) => `packages/kernel/test/clock-${index}.test.ts`);
const ASSERTED_FILE = 'packages/data/test/asserted.test.ts';
const RED_FILES = [...CLOCK_FILES, ASSERTED_FILE];

/** The 2026-09-18 shape: seventeen files that timed out in a saturated window, one that did not. */
function ninthOfSeptember(): LoadAttribution {
  const found = attributeLoad(
    CLOCK_FILES.map((file) => timeout(file, SATURATED)),
    BOX,
    RED_FILES,
    CLOCK_FILES,
  );
  if (found === null) throw new Error('expected an attribution');
  return found;
}

describe('attributeLoad', () => {
  it('names each red file, marks the clock-only ones, and gives the box', () => {
    const load = ninthOfSeptember();
    expect(load).toMatchObject({ cores: 16, peakLoad1: 41.1, peakRunningFiles: 14 });
    expect(load.files).toHaveLength(18);
    expect(load.files.filter((entry) => entry.clockOnly).map((entry) => entry.file)).toEqual(CLOCK_FILES);
    expect(load.files.find((entry) => entry.file === CLOCK_FILES[0])).toEqual({
      file: CLOCK_FILES[0],
      clockOnly: true,
      timeouts: 1,
      contention: 'saturated',
    });
  });

  it('leaves the file that failed on merit unmarked, whatever the load was', () => {
    const asserted = ninthOfSeptember().files.find((entry) => entry.file === ASSERTED_FILE);
    expect(asserted).toEqual({ file: ASSERTED_FILE, clockOnly: false, timeouts: 0, contention: null });
  });

  it('keeps the worst window when a file timed out more than once', () => {
    const file = 'packages/kernel/test/mixed-windows.test.ts';
    const load = attributeLoad(
      [timeout(file, QUIET), timeout(file, SATURATED), timeout(file, QUIET)],
      BOX,
      [file],
      [file],
    );
    expect(load?.files).toEqual([{ file, clockOnly: true, timeouts: 3, contention: 'saturated' }]);
  });

  it('records a file whose only failure was a hook with no window rather than dropping it', () => {
    // A `beforeAll` that ran out of time is an error on the suite, so the reporter has no
    // per-test finding for it. The file is still a clock (`mtg-melhj`) and still listed.
    const file = 'packages/kernel/test/hook-only.test.ts';
    const load = attributeLoad([], BOX, [file], [file]);
    expect(load?.files).toEqual([{ file, clockOnly: true, timeouts: 0, contention: null }]);
  });

  it('tolerates a timeout the reporter could not put a window on', () => {
    const file = 'packages/kernel/test/no-window.test.ts';
    const load = attributeLoad([timeout(file, null)], BOX, [file], [file]);
    expect(load?.files).toEqual([{ file, clockOnly: true, timeouts: 1, contention: null }]);
  });

  it('attributes nothing when no file is red', () => {
    expect(attributeLoad([], BOX, [], [])).toBeNull();
  });

  it('attributes nothing when no sample fell inside the run', () => {
    // A zero peak and an unsampled run are different claims; the second must not be written down as the first.
    expect(attributeLoad([timeout(ASSERTED_FILE, SATURATED)], null, [ASSERTED_FILE], [])).toBeNull();
  });
});

describe('describeReds', () => {
  it('prints the bare list for a record with no attribution, as it always did', () => {
    expect(describeReds(['a.test.ts', 'b.test.ts'], undefined)).toBe('\n  red: a.test.ts\n       b.test.ts');
  });

  it('prints nothing for a record with no red file', () => {
    expect(describeReds([], undefined)).toBe('');
    expect(describeReds([], ninthOfSeptember())).toBe('');
  });

  it('tells a reader of the 2026-09-18 record the box, the clock share, and how to settle it', () => {
    const text = describeReds(RED_FILES, ninthOfSeptember());
    expect(text).toContain('16 cores, peak 1-minute load 41.1 (2.6x per core)');
    expect(text).toContain('up to 14 of the run');
    expect(text).toContain(
      '17 of 18 red file(s) failed only on a clock, 17 with a timeout in a saturated window',
    );
    expect(text).toContain('npm run gate -- --refresh');
  });

  it('tags each clock-only file and leaves the asserted one bare', () => {
    const lines = describeReds(RED_FILES, ninthOfSeptember()).split('\n');
    const clock = lines.find((line) => line.includes('clock-0.test.ts'));
    const asserted = lines.find((line) => line.includes(ASSERTED_FILE));
    expect(clock).toContain('[clock only; 1 timeout(s), worst window saturated]');
    expect(asserted?.trim()).toBe(ASSERTED_FILE);
  });

  it('adds no clock sentence when no red file was a clock', () => {
    const load = attributeLoad([], BOX, [ASSERTED_FILE], []);
    expect(describeReds([ASSERTED_FILE], load ?? undefined)).not.toContain('failed only on a clock');
  });

  it('does not invent a tag for a red file the attribution does not list', () => {
    const load = attributeLoad([], BOX, [ASSERTED_FILE], []);
    expect(describeReds([ASSERTED_FILE, 'packages/x/test/other.test.ts'], load ?? undefined)).toContain(
      '\n       packages/x/test/other.test.ts',
    );
  });
});

const IDENTITY = { baseSha: 'a'.repeat(40), suite: 'npm test', artifacts: [], runtime: 'v22.0.0' };
const REVIEW_IDENTITY = {
  tree: 'b'.repeat(40),
  suite: 'npm test',
  bar: 'full' as const,
  changedFiles: ['packages/slice/tools/gate/cli.ts'],
  artifacts: [],
  runtime: 'v22.0.0',
  forgeBridge: false,
};

function baseRecord(load?: LoadAttribution): BaseRecord {
  return {
    identity: IDENTITY,
    outcome: 'red',
    reason: '1 of 18 failed file(s) failed an assertion rather than a clock',
    redFiles: RED_FILES,
    ...(load === undefined ? {} : { load }),
    measuredAt: '2026-09-18T12:00:00.000Z',
    durationMs: 1_000,
    measuredBy: 'host:/lane',
  };
}

describe('the store carries the attribution', () => {
  let home = '';
  const digest = 'deadbeefdeadbeef';

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mtg-gate-load-test-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('round-trips a base record with its attribution', () => {
    const record = baseRecord(ninthOfSeptember());
    writeRecord(home, digest, record);
    expect(readRecord(home, digest)).toEqual(record);
  });

  it('round-trips a review record with its attribution', () => {
    const record: ReviewRecord = {
      ...baseRecord(ninthOfSeptember()),
      identity: REVIEW_IDENTITY,
      selectedTestFiles: ['packages/slice/test/gate.test.ts'],
    };
    writeReviewRecord(home, digest, record);
    expect(readReviewRecord(home, digest)).toEqual(record);
  });

  it('still reads a record written before the attribution existed', () => {
    const legacy = { ...baseRecord() };
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, `${digest}.json`), JSON.stringify(legacy), 'utf8');
    const read = readRecord(home, digest);
    expect(read).toEqual(legacy);
    expect(read?.load).toBeUndefined();
  });

  it('drops an attribution that no longer parses and keeps the verdict beside it', () => {
    // Deleting the record over a malformed explanation would cost a full suite to re-learn
    // what the record still says.
    mkdirSync(home, { recursive: true });
    const path = join(home, `${digest}.json`);
    writeFileSync(path, JSON.stringify({ ...baseRecord(), load: { cores: 'many' } }), 'utf8');
    const read = readRecord(home, digest);
    expect(read).toEqual(baseRecord());
    expect(existsSync(path)).toBe(true);
  });
});

/** A failed module the way vitest's public API hands it to a reporter. */
function failedModule(file: string, failedTests: readonly { name: string; message: string }[]): TestModule {
  const stub = {
    moduleId: `${process.cwd()}/${file}`,
    state: () => 'failed',
    errors: () => [],
    children: {
      allSuites: () => [],
      allTests: () =>
        failedTests.map((test) => ({
          fullName: test.name,
          result: () => ({ state: 'failed', errors: [{ message: test.message }] }),
        })),
    },
  };
  return stub as unknown as TestModule;
}

describe('the outcome reporter writes the attribution the load reporter made', () => {
  let scratch = '';
  let outcomePath = '';

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'mtg-gate-outcome-test-'));
    outcomePath = join(scratch, 'outcome.json');
    process.env.MTG_GATE_OUTCOME = outcomePath;
  });
  afterEach(() => {
    delete process.env.MTG_GATE_OUTCOME;
    offerLoadSource(null);
    rmSync(scratch, { recursive: true, force: true });
  });

  const modules = [
    failedModule('packages/kernel/test/clock.test.ts', [
      { name: 'slow', message: 'Test timed out in 5000ms.' },
    ]),
    failedModule(ASSERTED_FILE, [{ name: 'wrong', message: 'expected 1 to be 2' }]),
  ];

  it('writes the box and each red file, marking only the clock one', () => {
    offerLoadSource({
      timeouts: () => [timeout('packages/kernel/test/clock.test.ts', SATURATED)],
      machine: () => BOX,
    });
    new GateOutcomeReporter().onTestRunEnd(modules);
    const written = JSON.parse(readFileSync(outcomePath, 'utf8')) as {
      redFiles: string[];
      timeoutOnlyFiles: string[];
      selectedTestFiles: string[];
      load: LoadAttribution;
    };
    expect(written.selectedTestFiles).toEqual([
      'packages/data/test/asserted.test.ts',
      'packages/kernel/test/clock.test.ts',
    ]);
    expect(written.timeoutOnlyFiles).toEqual(['packages/kernel/test/clock.test.ts']);
    expect(written.load.peakLoad1).toBe(41.1);
    expect(written.load.files).toEqual([
      { file: 'packages/kernel/test/clock.test.ts', clockOnly: true, timeouts: 1, contention: 'saturated' },
      { file: ASSERTED_FILE, clockOnly: false, timeouts: 0, contention: null },
    ]);
  });

  it('reads the source when the run ends, not when it was offered', () => {
    let found: readonly TimeoutFinding[] = [];
    offerLoadSource({ timeouts: () => found, machine: () => BOX });
    found = [timeout('packages/kernel/test/clock.test.ts', SATURATED)];
    new GateOutcomeReporter().onTestRunEnd(modules);
    const written = JSON.parse(readFileSync(outcomePath, 'utf8')) as { load: LoadAttribution };
    expect(written.load.files[0]?.timeouts).toBe(1);
  });

  it('writes a null attribution when no load reporter is in the run', () => {
    expect(loadSource()).toBeNull();
    new GateOutcomeReporter().onTestRunEnd(modules);
    const written = JSON.parse(readFileSync(outcomePath, 'utf8')) as { redFiles: string[]; load: unknown };
    expect(written.redFiles).toHaveLength(2);
    expect(written.load).toBeNull();
  });
});
