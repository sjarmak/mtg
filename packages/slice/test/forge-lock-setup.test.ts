/**
 * `mtg-b9eom`: the vitest `globalSetup` half of the Forge-run lock — the
 * entry point that covers an ad hoc `MTG_REQUIRE_FORGE_BRIDGE=1 vitest run`
 * and the printed-probe CLI's internal vitest subprocess, both of which load
 * `vitest.config.ts` and so both run this on every process start.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FORGE_HOLDER_ENV,
  type LockHolder,
  forgeLockInherited,
  readHolder,
  takeForgeLock,
  tryAcquire,
} from '../tools/test-load/host-lock';
import { forgeLockSetup } from '../tools/test-load/forge-lock-setup';

function holder(overrides: Partial<LockHolder> = {}): LockHolder {
  return {
    pid: 424_242,
    host: 'peer-rig',
    label: 'peer forge run',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('forgeLockSetup', () => {
  let dir = '';
  let path = '';
  const priorHome = process.env.MTG_FORGE_LOCK_HOME;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-forge-lock-setup-test-'));
    path = join(dir, 'gc-forge-run.lock');
    process.env.MTG_FORGE_LOCK_HOME = path;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (priorHome === undefined) delete process.env.MTG_FORGE_LOCK_HOME;
    else process.env.MTG_FORGE_LOCK_HOME = priorHome;
  });

  it('is inert without MTG_REQUIRE_FORGE_BRIDGE=1: no lock taken, no teardown', () => {
    const teardown = forgeLockSetup({ env: {} });
    expect(teardown).toBeUndefined();
    const outcome = tryAcquire(path, 'someone else', Date.now());
    expect(outcome.acquired).toBe(true);
  });

  it('is inert when the flag is set to anything other than the literal "1"', () => {
    const teardown = forgeLockSetup({ env: { MTG_REQUIRE_FORGE_BRIDGE: 'true' } });
    expect(teardown).toBeUndefined();
    const outcome = tryAcquire(path, 'someone else', Date.now());
    expect(outcome.acquired).toBe(true);
  });

  it('acquires the lock when required and free, and its teardown releases it', () => {
    const teardown = forgeLockSetup({ env: { MTG_REQUIRE_FORGE_BRIDGE: '1' } });
    expect(typeof teardown).toBe('function');
    const whileHeld = tryAcquire(path, 'someone else', Date.now());
    expect(whileHeld.acquired).toBe(false);
    teardown?.();
    const afterTeardown = tryAcquire(path, 'someone else', Date.now());
    expect(afterTeardown.acquired).toBe(true);
  });

  // mtg-b9eom review item 1: one case per Forge-required flag, since the
  // earlier version only checked MTG_REQUIRE_FORGE_BRIDGE and the other
  // three ran with no global-setup lock at all.
  it.each([
    ['MTG_REQUIRE_FORGE_BOTS'],
    ['MTG_REQUIRE_PRINTED_NATIVE_SMOKE'],
    ['MTG_REQUIRE_PRINTED_ADMISSIONS'],
  ] as const)('acquires the lock under %s too', (flag) => {
    const teardown = forgeLockSetup({ env: { [flag]: '1' } });
    expect(typeof teardown).toBe('function');
    const whileHeld = tryAcquire(path, 'someone else', Date.now());
    expect(whileHeld.acquired).toBe(false);
    teardown?.();
  });

  it('waits for a live peer holder, then acquires once it frees up', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(holder({ label: 'the other forge run' })), 'utf8');
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const sleep = vi.fn(() => rmSync(path, { force: true }));
    const teardown = forgeLockSetup({ env: { MTG_REQUIRE_FORGE_BRIDGE: '1' }, sleep });
    expect(typeof teardown).toBe('function');
    const printed = out.mock.calls.map((call) => String(call[0])).join('');
    expect(printed).toContain('the other forge run');
    out.mockRestore();
    teardown?.();
  });

  const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('keeps renewing the lock for the life of the run, and stops at teardown', async () => {
    const teardown = forgeLockSetup({ env: { MTG_REQUIRE_FORGE_BRIDGE: '1' }, renewEveryMs: 5 });
    await pause(80);
    expect(readHolder(path)).toMatchObject({ pid: process.pid, renewedAt: expect.any(String) });
    teardown?.();
    expect(existsSync(path)).toBe(false);
    await pause(40);
    expect(existsSync(path)).toBe(false);
  });

  it('renews a lock its parent holds, and leaves releasing it to the parent', async () => {
    const parent = holder({ pid: process.ppid, host: hostname(), label: 'the wrapping command' });
    writeFileSync(path, JSON.stringify(parent), 'utf8');
    const prior = process.env[FORGE_HOLDER_ENV];
    process.env[FORGE_HOLDER_ENV] = String(process.ppid);
    try {
      const teardown = forgeLockSetup({ env: { MTG_REQUIRE_FORGE_BRIDGE: '1' }, renewEveryMs: 5 });
      await pause(80);
      expect(readHolder(path)).toMatchObject({ ...parent, renewedAt: expect.any(String) });
      teardown?.();
      const left = readFileSync(path, 'utf8');
      await pause(40);
      expect(readFileSync(path, 'utf8')).toBe(left);
      expect(readHolder(path)?.pid).toBe(process.ppid);
    } finally {
      if (prior === undefined) delete process.env[FORGE_HOLDER_ENV];
      else process.env[FORGE_HOLDER_ENV] = prior;
    }
  });
});

describe('the Forge lock across a real parent and child process', () => {
  const setupModule = join(process.cwd(), 'packages/slice/tools/test-load/forge-lock-setup.ts');
  const childScript =
    `import(${JSON.stringify(setupModule)}).then((m) => {` +
    `const teardown = m.forgeLockSetup({ sleep: () => { process.exit(3); } });` +
    `process.stdout.write(typeof teardown === 'function' ? 'held' : 'unheld');` +
    `if (typeof teardown === 'function') teardown();` +
    `});`;
  let dir = '';
  let path = '';
  const priorHome = process.env.MTG_FORGE_LOCK_HOME;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-forge-lock-child-test-'));
    path = join(dir, 'gc-forge-run.lock');
    process.env.MTG_FORGE_LOCK_HOME = path;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (priorHome === undefined) delete process.env.MTG_FORGE_LOCK_HOME;
    else process.env.MTG_FORGE_LOCK_HOME = priorHome;
  });

  function runChild() {
    return spawnSync(process.execPath, ['--import', 'tsx', '-e', childScript], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, MTG_REQUIRE_FORGE_BRIDGE: '1' },
    });
  }

  it('lets a child of the holder proceed without waiting, and leaves the lock for the parent to release', () => {
    const parent = takeForgeLock('parent probe', { onWaitOver: 'ran out\n' });
    expect(parent.held).toBe(true);
    const child = runChild();
    // The child's injected `sleep` exits 3, so a child that tried to wait fails here rather than hanging.
    expect(child.status).toBe(0);
    // The child's teardown ran and is a no-op for an inherited lock: the file is still the parent's.
    expect(child.stdout).toBe('held');
    expect(existsSync(path)).toBe(true);
    parent.release();
    expect(existsSync(path)).toBe(false);
    expect(process.env[FORGE_HOLDER_ENV]).toBeUndefined();
  });

  it('still makes a child that does not descend from the holder wait', () => {
    const parent = takeForgeLock('parent probe', { onWaitOver: 'ran out\n' });
    const env = { ...process.env, MTG_REQUIRE_FORGE_BRIDGE: '1' } as NodeJS.ProcessEnv;
    delete env[FORGE_HOLDER_ENV];
    const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', childScript], {
      encoding: 'utf8',
      timeout: 60_000,
      env,
    });
    expect(child.status).toBe(3);
    parent.release();
  });

  it('does not trust a holder pid that is not the one on the lock file', () => {
    tryAcquire(path, 'peer', Date.now());
    const prior = process.env[FORGE_HOLDER_ENV];
    process.env[FORGE_HOLDER_ENV] = '1';
    try {
      expect(forgeLockInherited(path)).toBe(false);
    } finally {
      if (prior === undefined) delete process.env[FORGE_HOLDER_ENV];
      else process.env[FORGE_HOLDER_ENV] = prior;
    }
  });
});
