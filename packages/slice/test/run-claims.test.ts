/**
 * `mtg-a3ix4`: a run that starts beside others finds them, so the half-machine
 * worker budget is divided rather than taken whole by every slot.
 *
 * The pure arithmetic is in `test-load.test.ts`; this file is the half that
 * reads the disk, and the seam between the two — a claim on disk, read back
 * into a pool size — because either half alone stays green while the box goes
 * back to carrying one budget per slot.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCK_MAX_AGE_MS, type LockHolder, runsDirPath } from '../tools/test-load/host-lock';
import { runClaimSetup } from '../tools/test-load/run-claim-setup';
import { claimRun, liveRunCount } from '../tools/test-load/run-claims';
import { runSharers, testWorkerCount } from '../tools/test-load/workers';

const CORES = 16;
const NOBODY = -1;

/** A pid that is certainly gone: a child that has already exited and been reaped. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  if (child.pid === undefined) throw new Error('could not spawn a child to borrow a dead pid from');
  return child.pid;
}

const sleepers: ChildProcess[] = [];

/** The pid of a process that stays alive until `afterEach` reaps it, standing in for a sibling vitest run. */
function livePid(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  if (child.pid === undefined) throw new Error('could not spawn a child to stand in for a live run');
  sleepers.push(child);
  return child.pid;
}

afterEach(() => {
  for (const child of sleepers.splice(0)) child.kill();
});

function claim(dir: string, overrides: Partial<LockHolder> & { pid: number }): void {
  const holder: LockHolder = {
    host: hostname(),
    label: 'a sibling vitest run',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${holder.pid}.json`), JSON.stringify(holder), 'utf8');
}

describe('liveRunCount', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-run-claims-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is zero when nobody has ever claimed, including when the directory does not exist', () => {
    expect(liveRunCount(join(dir, 'never-made'))).toBe(0);
    expect(liveRunCount(dir)).toBe(0);
  });

  it('counts the live runs other than the caller', () => {
    claim(dir, { pid: process.pid });
    claim(dir, { pid: livePid() });
    expect(liveRunCount(dir, Date.now(), NOBODY)).toBe(2);
    expect(liveRunCount(dir)).toBe(1);
  });

  it('does not count a run whose process is gone', () => {
    claim(dir, { pid: deadPid() });
    expect(liveRunCount(dir, Date.now(), NOBODY)).toBe(0);
  });

  it('does not count a claim that has outlived any run measured, whatever its pid says', () => {
    const stale = new Date(Date.now() - LOCK_MAX_AGE_MS - 60_000).toISOString();
    claim(dir, { pid: livePid(), startedAt: stale });
    expect(liveRunCount(dir, Date.now(), NOBODY)).toBe(0);
  });

  it('does not count a run on another host, whose cores are not these', () => {
    claim(dir, { pid: livePid(), host: 'peer-rig' });
    expect(liveRunCount(dir, Date.now(), NOBODY)).toBe(0);
  });

  it('ignores a file that is not a claim, and one that is half-written', () => {
    writeFileSync(join(dir, 'notes.txt'), 'not a claim', 'utf8');
    writeFileSync(join(dir, '4242.json'), '{"pid":', 'utf8');
    expect(liveRunCount(dir, Date.now(), NOBODY)).toBe(0);
  });

  it('does not clean up after a dead run: counting only reads', () => {
    const pid = deadPid();
    claim(dir, { pid });
    liveRunCount(dir, Date.now(), NOBODY);
    expect(existsSync(join(dir, `${pid}.json`))).toBe(true);
  });
});

describe('claimRun', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-run-claims-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('makes this run visible to the next one, and its release makes it invisible again', () => {
    const release = claimRun(dir, 'this run');
    expect(liveRunCount(dir, Date.now(), NOBODY)).toBe(1);
    release();
    expect(liveRunCount(dir, Date.now(), NOBODY)).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('creates the directory it claims in', () => {
    const release = claimRun(join(dir, 'not', 'yet'), 'this run');
    expect(liveRunCount(join(dir, 'not', 'yet'), Date.now(), NOBODY)).toBe(1);
    release();
  });

  it('removes the claims of runs that are gone, and leaves live and unreadable ones alone', () => {
    const gone = deadPid();
    const alive = livePid();
    claim(dir, { pid: gone });
    claim(dir, { pid: alive });
    writeFileSync(join(dir, 'half.json'), '{"pid":', 'utf8');
    const release = claimRun(dir, 'this run');
    expect(existsSync(join(dir, `${gone}.json`))).toBe(false);
    expect(existsSync(join(dir, `${alive}.json`))).toBe(true);
    expect(existsSync(join(dir, 'half.json'))).toBe(true);
    release();
  });
});

describe('the global setup', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-run-claims-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('claims for the run and hands back the teardown that drops it', () => {
    const teardown = runClaimSetup({ dir, label: 'vitest under test' });
    expect(liveRunCount(dir, Date.now(), NOBODY)).toBe(1);
    teardown();
    expect(liveRunCount(dir, Date.now(), NOBODY)).toBe(0);
  });

  it('claims under MTG_TEST_RUNS_HOME when it is set, so a test can keep off the real host directory', () => {
    const prior = process.env.MTG_TEST_RUNS_HOME;
    process.env.MTG_TEST_RUNS_HOME = dir;
    try {
      expect(runsDirPath()).toBe(dir);
      const teardown = runClaimSetup();
      expect(liveRunCount(dir, Date.now(), NOBODY)).toBe(1);
      teardown();
    } finally {
      if (prior === undefined) delete process.env.MTG_TEST_RUNS_HOME;
      else process.env.MTG_TEST_RUNS_HOME = prior;
    }
  });
});

// The case the bead is about, end to end through the disk: a run that starts
// while two others are live must take a third of the budget rather than the
// whole of it, and a run that starts alone still takes all of it.
describe('a run that starts beside live siblings', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-run-claims-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function poolFor(slots: string | undefined): number {
    return testWorkerCount({
      cores: CORES,
      sharers: runSharers({ slots, liveOthers: liveRunCount(dir) }),
    });
  }

  it('takes the whole budget when nothing else is running', () => {
    expect(poolFor(undefined)).toBe(Math.round(CORES / 2));
  });

  it('takes half of it beside one sibling and a third beside two', () => {
    claim(dir, { pid: livePid() });
    expect(poolFor(undefined)).toBe(4);
    claim(dir, { pid: deadPid() });
    expect(poolFor(undefined)).toBe(4);
    claim(dir, { pid: livePid() });
    expect(poolFor(undefined)).toBe(2);
  });

  it('takes a third of it from the pool alone, before any sibling has claimed', () => {
    expect(poolFor('3')).toBe(2);
  });
});
