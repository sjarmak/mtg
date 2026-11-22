/**
 * `mtg-b9eom`: the second clause of the playtester's lane ruling (2026-09-18
 * 15:44Z) — at most one Forge-required run at a time on the host, with
 * `MTG_TEST_WORKERS=1` — as it applies to `npm run verify:live`, which never
 * runs vitest and so cannot be reached by `forge-lock-setup.ts`.
 *
 * Unlike `with-lock.ts`'s suite lock, there is no `MTG_TEST_WORKERS` escape
 * hatch: the ruling states no exception for a Forge-required run, so this
 * always takes the lock and always forces the child's env to one worker.
 */
import type { SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LockHolder, forgeLockPath, tryAcquire } from '../tools/test-load/host-lock';
import { main } from '../tools/test-load/with-forge-lock';

function holder(overrides: Partial<LockHolder> = {}): LockHolder {
  return {
    pid: 424_242,
    host: 'peer-rig',
    label: 'peer forge run',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

type Spawn = typeof spawnSync;

function fakeSpawn(result: Partial<SpawnSyncReturns<Buffer>>): { calls: unknown[][]; spawn: Spawn } {
  const calls: unknown[][] = [];
  const spawn = ((bin: string, args: readonly string[], opts: unknown) => {
    calls.push([bin, args, opts]);
    return {
      pid: 0,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: null,
      signal: null,
      error: undefined,
      ...result,
    };
  }) as unknown as Spawn;
  return { calls, spawn };
}

describe('with-forge-lock main', () => {
  let dir = '';
  let path = '';
  const priorHome = process.env.MTG_FORGE_LOCK_HOME;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-with-forge-lock-test-'));
    path = join(dir, 'gc-forge-run.lock');
    process.env.MTG_FORGE_LOCK_HOME = path;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (priorHome === undefined) delete process.env.MTG_FORGE_LOCK_HOME;
    else process.env.MTG_FORGE_LOCK_HOME = priorHome;
    vi.restoreAllMocks();
  });

  it('refuses to run with no command after --', () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(main(['--'])).toBe(2);
    expect(main([])).toBe(2);
    err.mockRestore();
  });

  it('acquires the lock, runs the command, and releases it', () => {
    const { calls, spawn } = fakeSpawn({ status: 0 });
    const code = main(['--', 'npx', 'tsx', 'packages/ui/tools/live-journey.ts'], {
      spawn,
      label: 'forge run under test',
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    // Released: a fresh acquire on the same path succeeds without waiting.
    const outcome = tryAcquire(path, 'someone else', Date.now());
    expect(outcome.acquired).toBe(true);
  });

  it('forces MTG_TEST_WORKERS=1 on the child, whatever this process was given', () => {
    process.env.MTG_TEST_WORKERS = '8';
    const { calls, spawn } = fakeSpawn({ status: 0 });
    main(['--', 'npx', 'tsx', 'packages/ui/tools/live-journey.ts'], { spawn, label: 'forge run under test' });
    delete process.env.MTG_TEST_WORKERS;
    const [, , opts] = calls[0] ?? [];
    expect((opts as { env?: Record<string, string> } | undefined)?.env?.MTG_TEST_WORKERS).toBe('1');
  });

  it('passes the wrapped command exit code through', () => {
    const { spawn } = fakeSpawn({ status: 7 });
    const code = main(['--', 'true'], { spawn, label: 'forge run under test' });
    expect(code).toBe(7);
  });

  it('releases the lock even when the wrapped command fails to spawn', () => {
    const { spawn } = fakeSpawn({ status: null, error: new Error('boom') });
    expect(() => main(['--', 'nonexistent'], { spawn, label: 'forge run under test' })).toThrow('boom');
    const outcome = tryAcquire(path, 'someone else', Date.now());
    expect(outcome.acquired).toBe(true);
  });

  it('has no MTG_TEST_WORKERS escape hatch: it waits for the holder even when a share was already stated', () => {
    process.env.MTG_TEST_WORKERS = '4';
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(holder({ label: 'someone else entirely' })), 'utf8');
    const sleep = vi.fn(() => rmSync(path, { force: true }));
    const { spawn } = fakeSpawn({ status: 0 });
    const code = main(['--', 'npx', 'tsx', 'packages/ui/tools/live-journey.ts'], {
      spawn,
      sleep,
      label: 'forge run under test',
    });
    delete process.env.MTG_TEST_WORKERS;
    expect(code).toBe(0);
    expect(sleep).toHaveBeenCalled();
  });

  it('waits for the holder and says what it is waiting for, then runs once free', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(holder({ label: 'the other forge run' })), 'utf8');
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const sleep = vi.fn(() => rmSync(path, { force: true }));
    const { spawn } = fakeSpawn({ status: 0 });
    const code = main(['--', 'npx', 'tsx', 'packages/ui/tools/live-journey.ts'], {
      spawn,
      sleep,
      label: 'forge run under test',
    });
    expect(code).toBe(0);
    const printed = out.mock.calls.map((call) => String(call[0])).join('');
    expect(printed).toContain('the other forge run');
    out.mockRestore();
  });

  it('uses the forge lock path, distinct from the full-suite lock', () => {
    expect(forgeLockPath()).toBe(path);
  });

  it('parses --label from argv, as the usage line advertises, when no programmatic label is given', () => {
    let holderDuringRun: LockHolder | undefined;
    const { calls, spawn } = fakeSpawn({ status: 0 });
    const spawnAndCapture = ((bin: string, args: readonly string[], opts: unknown) => {
      holderDuringRun = JSON.parse(readFileSync(path, 'utf8')) as LockHolder;
      return spawn(bin, args, opts as never);
    }) as unknown as Spawn;
    const code = main(['--label', 'parsed label', '--', 'true'], { spawn: spawnAndCapture });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(holderDuringRun?.label).toBe('parsed label');
  });

  it('refuses --label with no value', () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(main(['--label', '--', 'true'])).toBe(2);
    err.mockRestore();
  });
});
