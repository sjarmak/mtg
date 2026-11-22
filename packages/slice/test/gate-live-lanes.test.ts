/**
 * `findLiveLanes`/`checkLiveLanes` never touch a real host: every case here
 * builds its own `ProcessRow[]` or `ProcReaders` fake. `mtg-vxbbi`'s
 * acceptance criterion 2 (a positive control against real `/proc`) is run by
 * hand, not here, since it needs a real live worker session.
 */
import { describe, expect, it } from 'vitest';
import {
  LIVE_LANE_REFUSAL_EXIT_CODE,
  checkLiveLanes,
  describeLiveLanes,
  findLiveLanes,
  isPollerCommand,
  isWorkerEnv,
  readLiveProcessTable,
  type ProcessRow,
  type ProcReaders,
} from '../tools/gate/live-lanes';

const WORKER_ENV = {
  GC_RIG: 'mtg',
  GC_AGENT: 'mtg-worker-pool',
  GC_TEMPLATE: '/home/agent/projects/mtg/mtg-worker',
  GC_SESSION_ID: 'gc-996747',
  GC_DIR: '/home/agent/mtg-worktrees/mtg-worker-slots/mtg-worker-1',
};

function workerRow(over: Partial<ProcessRow> = {}): ProcessRow {
  return {
    pid: 12345,
    cwd: '/home/agent/mtg-worktrees/mtg-worker-slots/mtg-worker-1-worktrees/mtg-abcde',
    environ: WORKER_ENV,
    argv: ['node', '.../vitest/vitest.mjs', 'run'],
    ...over,
  };
}

const fakeBranch = (cwd: string): string | null => (cwd.includes('worktrees') ? 'work/mtg-abcde' : null);

describe('isWorkerEnv', () => {
  it('is true for a real mtg-worker session', () => {
    expect(isWorkerEnv(WORKER_ENV)).toBe(true);
  });

  it('is false when GC_RIG names another rig', () => {
    expect(isWorkerEnv({ ...WORKER_ENV, GC_RIG: 'other-rig' })).toBe(false);
  });

  it('is false with no GC_TEMPLATE', () => {
    const { GC_TEMPLATE: _GC_TEMPLATE, ...rest } = WORKER_ENV;
    expect(isWorkerEnv(rest)).toBe(false);
  });

  it('is false when GC_TEMPLATE names a different route', () => {
    expect(isWorkerEnv({ ...WORKER_ENV, GC_TEMPLATE: '/home/agent/projects/other/other-worker' })).toBe(
      false,
    );
  });

  it('reads the last path segment, trailing slash and all', () => {
    expect(isWorkerEnv({ ...WORKER_ENV, GC_TEMPLATE: '/home/agent/projects/mtg/mtg-worker/' })).toBe(true);
  });
});

describe('isPollerCommand', () => {
  it('is true for a gc nudge poll loop', () => {
    expect(isPollerCommand(['gc', 'nudge', 'poll'])).toBe(true);
  });

  it('is true for a bd ready --assignee loop', () => {
    expect(isPollerCommand(['bd', 'ready', '--assignee=gc-996747', '--json', '--limit=1'])).toBe(true);
  });

  it('is true through a wrapping prefix such as a proxy', () => {
    expect(isPollerCommand(['rtk', 'bd', 'ready', '--assignee=gc-996747'])).toBe(true);
  });

  it('is false for a vitest run', () => {
    expect(isPollerCommand(['node', '.../vitest/vitest.mjs', 'run'])).toBe(false);
  });

  it('is false for a bd command that is not ready, such as a claim', () => {
    expect(isPollerCommand(['bd', 'update', 'mtg-abcde', '--claim'])).toBe(false);
  });

  it('is false for an empty argv', () => {
    expect(isPollerCommand([])).toBe(false);
  });
});

describe('findLiveLanes', () => {
  it('returns nothing for an empty table', () => {
    expect(findLiveLanes([])).toEqual([]);
  });

  it('groups a worker process into one lane, naming its session, slot and branch', () => {
    const lanes = findLiveLanes([workerRow()], fakeBranch);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({
      sessionId: 'gc-996747',
      slotDir: '/home/agent/mtg-worktrees/mtg-worker-slots/mtg-worker-1',
    });
    expect(lanes[0]?.worktrees).toEqual([
      {
        cwd: '/home/agent/mtg-worktrees/mtg-worker-slots/mtg-worker-1-worktrees/mtg-abcde',
        branch: 'work/mtg-abcde',
      },
    ]);
    expect(lanes[0]?.processes).toEqual([{ pid: 12345, command: 'node .../vitest/vitest.mjs run' }]);
  });

  it('ignores a process whose GC_RIG names another rig', () => {
    const foreign = workerRow({ pid: 999, environ: { ...WORKER_ENV, GC_RIG: 'other-rig' } });
    expect(findLiveLanes([foreign], fakeBranch)).toEqual([]);
  });

  it('ignores a non-worker process entirely, whatever its env holds', () => {
    const notAWorker = workerRow({ environ: { PATH: '/usr/bin' } });
    expect(findLiveLanes([notAWorker], fakeBranch)).toEqual([]);
  });

  it('groups two processes under one GC_SESSION_ID into one lane with two processes', () => {
    const tsc = workerRow({ pid: 1, argv: ['node', 'tsc'] });
    const vitest = workerRow({ pid: 2, argv: ['node', 'vitest'] });
    const lanes = findLiveLanes([tsc, vitest], fakeBranch);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.processes.map((p) => p.pid)).toEqual([1, 2]);
  });

  it('keeps two sessions as two separate lanes', () => {
    const a = workerRow({ pid: 1, environ: { ...WORKER_ENV, GC_SESSION_ID: 'gc-1' } });
    const b = workerRow({ pid: 2, environ: { ...WORKER_ENV, GC_SESSION_ID: 'gc-2' } });
    expect(
      findLiveLanes([a, b], fakeBranch)
        .map((lane) => lane.sessionId)
        .sort(),
    ).toEqual(['gc-1', 'gc-2']);
  });

  it('skips a worker row with no GC_SESSION_ID rather than grouping it under an empty key', () => {
    const { GC_SESSION_ID: _GC_SESSION_ID, ...rest } = WORKER_ENV;
    expect(findLiveLanes([workerRow({ environ: rest })], fakeBranch)).toEqual([]);
  });

  it('reports null slotDir and no worktrees when nothing in the group carries them', () => {
    const { GC_DIR: _GC_DIR, ...rest } = WORKER_ENV;
    const row = workerRow({ cwd: null, environ: rest });
    const lanes = findLiveLanes([row], fakeBranch);
    expect(lanes[0]).toMatchObject({ slotDir: null, worktrees: [] });
  });

  it('excludes a session whose only live processes are poll loops', () => {
    const nudge = workerRow({ pid: 1, argv: ['gc', 'nudge', 'poll'] });
    const ready = workerRow({ pid: 2, argv: ['bd', 'ready', '--assignee=gc-996747', '--json', '--limit=1'] });
    expect(findLiveLanes([nudge, ready], fakeBranch)).toEqual([]);
  });

  it('still reports a session with one non-poller process alongside its pollers', () => {
    const nudge = workerRow({ pid: 1, argv: ['gc', 'nudge', 'poll'] });
    const vitest = workerRow({ pid: 2, argv: ['node', '.../vitest/vitest.mjs', 'run'] });
    const lanes = findLiveLanes([nudge, vitest], fakeBranch);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.processes.map((p) => p.pid)).toEqual([1, 2]);
  });

  it('keeps one session excluded as poll-only while a sibling session with real work still reports', () => {
    const idle = workerRow({
      pid: 1,
      environ: { ...WORKER_ENV, GC_SESSION_ID: 'gc-idle' },
      argv: ['gc', 'nudge', 'poll'],
    });
    const busy = workerRow({
      pid: 2,
      environ: { ...WORKER_ENV, GC_SESSION_ID: 'gc-busy' },
      argv: ['node', '.../vitest/vitest.mjs', 'run'],
    });
    const lanes = findLiveLanes([idle, busy], fakeBranch);
    expect(lanes.map((lane) => lane.sessionId)).toEqual(['gc-busy']);
  });
});

describe('describeLiveLanes', () => {
  it('names the session id, the slot dir and the branch', () => {
    const [lane] = findLiveLanes([workerRow()], fakeBranch);
    if (lane === undefined) throw new Error('expected a lane');
    const text = describeLiveLanes([lane]);
    expect(text).toContain('gc-996747');
    expect(text).toContain('/home/agent/mtg-worktrees/mtg-worker-slots/mtg-worker-1');
    expect(text).toContain('work/mtg-abcde');
    expect(text).toContain('12345');
  });
});

describe('checkLiveLanes', () => {
  const NON_WORKER_GATE_ENV = { PATH: '/usr/bin' };

  it('proceeds silently on an empty table', () => {
    const check = checkLiveLanes(NON_WORKER_GATE_ENV, [], false, fakeBranch);
    expect(check).toEqual({ ok: true, message: '' });
  });

  it('refuses when a worker lane is live and this gate is not itself a worker', () => {
    const check = checkLiveLanes(NON_WORKER_GATE_ENV, [workerRow()], false, fakeBranch);
    expect(check.ok).toBe(false);
    expect(check.message).toContain('gc-996747');
    expect(check.message).toContain('/home/agent/mtg-worktrees/mtg-worker-slots/mtg-worker-1');
    expect(check.message).toContain('work/mtg-abcde');
  });

  it('proceeds without checking when the gate itself is a worker session', () => {
    const check = checkLiveLanes(WORKER_ENV, [workerRow({ pid: 1 })], false, fakeBranch);
    expect(check).toEqual({ ok: true, message: '' });
  });

  it('proceeds and prints the lanes when --beside-lanes overrides', () => {
    const check = checkLiveLanes(NON_WORKER_GATE_ENV, [workerRow()], true, fakeBranch);
    expect(check.ok).toBe(true);
    expect(check.message).toContain('--beside-lanes');
    expect(check.message).toContain('gc-996747');
  });

  it('uses an exit code that neither cli.ts nor merge.ts returned before this change', () => {
    expect(LIVE_LANE_REFUSAL_EXIT_CODE).toBe(3);
  });

  it('proceeds silently when the only live worker session is polling, not working', () => {
    const nudge = workerRow({ pid: 1, argv: ['gc', 'nudge', 'poll'] });
    const ready = workerRow({ pid: 2, argv: ['bd', 'ready', '--assignee=gc-996747'] });
    const check = checkLiveLanes(NON_WORKER_GATE_ENV, [nudge, ready], false, fakeBranch);
    expect(check).toEqual({ ok: true, message: '' });
  });

  it('still refuses when a worker session is running a test command alongside its pollers', () => {
    const nudge = workerRow({ pid: 1, argv: ['gc', 'nudge', 'poll'] });
    const vitest = workerRow({ pid: 2, argv: ['node', '.../vitest/vitest.mjs', 'run'] });
    const check = checkLiveLanes(NON_WORKER_GATE_ENV, [nudge, vitest], false, fakeBranch);
    expect(check.ok).toBe(false);
    expect(check.message).toContain('gc-996747');
  });
});

describe('readLiveProcessTable', () => {
  function fakeReaders(over: Partial<ProcReaders>): ProcReaders {
    return {
      listPids: () => ['1', '2'],
      readEnviron: () => null,
      readCwdLink: () => null,
      readCmdline: () => null,
      ...over,
    };
  }

  it('skips a pid whose environ could not be read (vanished, or a permissions error)', () => {
    const readers = fakeReaders({
      readEnviron: (pid) => (pid === 1 ? 'GC_RIG=mtg\0' : null),
    });
    const rows = readLiveProcessTable(readers);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pid).toBe(1);
  });

  it('degrades cwd and argv to null/[] rather than dropping the row when they fail', () => {
    const readers = fakeReaders({
      readEnviron: () => 'GC_RIG=mtg\0',
      readCwdLink: () => null,
      readCmdline: () => null,
    });
    const rows = readLiveProcessTable(readers);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ cwd: null, argv: [] });
  });

  it('parses NUL-joined environ and cmdline', () => {
    const readers = fakeReaders({
      listPids: () => ['7'],
      readEnviron: () => 'GC_RIG=mtg\0GC_SESSION_ID=gc-1\0',
      readCwdLink: () => '/some/worktree',
      readCmdline: () => 'node\0script.js\0--flag\0',
    });
    const [row] = readLiveProcessTable(readers);
    expect(row).toEqual({
      pid: 7,
      cwd: '/some/worktree',
      environ: { GC_RIG: 'mtg', GC_SESSION_ID: 'gc-1' },
      argv: ['node', 'script.js', '--flag'],
    });
  });

  it('returns an empty table rather than throwing when listPids itself fails', () => {
    const readers = fakeReaders({
      listPids: () => {
        throw new Error('no /proc on this platform');
      },
    });
    expect(readLiveProcessTable(readers)).toEqual([]);
  });
});
