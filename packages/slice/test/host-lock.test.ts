/**
 * `mtg-5n7yb`: the host-wide suite lock, and the `npm test` wrapper built on it.
 *
 * The lock's whole risk is a false "acquired": two lanes each believing they
 * hold it would be the exact oversubscription this exists to prevent. So most
 * of what is checked here is the refusal to take a lock somebody else still
 * holds, and the one carve-out (a dead or aged-out holder) that must still
 * work or a wedged process locks every lane out forever.
 */
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
  type SpawnSyncReturns,
} from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FORGE_HOLDER_ENV,
  LOCK_MAX_AGE_MS,
  LOCK_RENEW_INTERVAL_MS,
  type LockHolder,
  acquireOrWait,
  forgeLockPath,
  holderIsLive,
  isForgeRequiredRun,
  keepRenewed,
  readHolder,
  release,
  renew,
  suiteHolderIsLive,
  testLockPath,
  tryAcquire,
  withForgeLock,
} from '../tools/test-load/host-lock';
import { main } from '../tools/test-load/with-lock';

function holder(overrides: Partial<LockHolder> = {}): LockHolder {
  return {
    pid: 424_242,
    host: 'peer-rig',
    label: 'peer suite',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

type Spawn = typeof spawnSync;

function waitForText(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.includes(expected)) {
        child.stdout.off('data', onData);
        child.off('exit', onExit);
        resolve();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      child.stdout.off('data', onData);
      reject(new Error(`process exited before ${JSON.stringify(expected)}: code=${code} signal=${signal}`));
    };
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve) => child.once('exit', resolve));
}

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

describe('testLockPath', () => {
  const prior = process.env.MTG_TEST_LOCK_HOME;
  afterEach(() => {
    if (prior === undefined) delete process.env.MTG_TEST_LOCK_HOME;
    else process.env.MTG_TEST_LOCK_HOME = prior;
  });

  it('honors the override, for tests and for pinning the lock elsewhere', () => {
    process.env.MTG_TEST_LOCK_HOME = '/tmp/somewhere/lock.json';
    expect(testLockPath()).toBe('/tmp/somewhere/lock.json');
  });
});

describe('forgeLockPath', () => {
  const priorForge = process.env.MTG_FORGE_LOCK_HOME;
  const priorTest = process.env.MTG_TEST_LOCK_HOME;
  afterEach(() => {
    if (priorForge === undefined) delete process.env.MTG_FORGE_LOCK_HOME;
    else process.env.MTG_FORGE_LOCK_HOME = priorForge;
    if (priorTest === undefined) delete process.env.MTG_TEST_LOCK_HOME;
    else process.env.MTG_TEST_LOCK_HOME = priorTest;
  });

  it('honors its own override, distinct from the full-suite lock', () => {
    process.env.MTG_FORGE_LOCK_HOME = '/tmp/somewhere-else/forge.json';
    expect(forgeLockPath()).toBe('/tmp/somewhere-else/forge.json');
  });

  it('never collides with the full-suite lock path, so the two never contend', () => {
    delete process.env.MTG_FORGE_LOCK_HOME;
    delete process.env.MTG_TEST_LOCK_HOME;
    expect(forgeLockPath()).not.toBe(testLockPath());
  });
});

describe('isForgeRequiredRun', () => {
  // mtg-b9eom review item 1: named once so testWorkerOverride and
  // forgeLockSetup cannot drift on which flags actually spawn a JVM. One
  // case per flag, since the earlier version only recognized the first and
  // the other three ran unlocked.
  it('recognizes MTG_REQUIRE_FORGE_BRIDGE', () => {
    expect(isForgeRequiredRun({ MTG_REQUIRE_FORGE_BRIDGE: '1' })).toBe(true);
  });

  it('recognizes MTG_REQUIRE_FORGE_BOTS', () => {
    expect(isForgeRequiredRun({ MTG_REQUIRE_FORGE_BOTS: '1' })).toBe(true);
  });

  it('recognizes MTG_REQUIRE_PRINTED_NATIVE_SMOKE', () => {
    expect(isForgeRequiredRun({ MTG_REQUIRE_PRINTED_NATIVE_SMOKE: '1' })).toBe(true);
  });

  it('recognizes MTG_REQUIRE_PRINTED_ADMISSIONS', () => {
    expect(isForgeRequiredRun({ MTG_REQUIRE_PRINTED_ADMISSIONS: '1' })).toBe(true);
  });

  it('is false when no flag is set, and false for a value other than the literal "1"', () => {
    expect(isForgeRequiredRun({})).toBe(false);
    expect(isForgeRequiredRun({ MTG_REQUIRE_FORGE_BRIDGE: 'true' })).toBe(false);
    expect(isForgeRequiredRun({ MTG_REQUIRE_FORGE_BOTS: '0' })).toBe(false);
  });
});

describe('holderIsLive', () => {
  it('judges a claim from another host by age alone, since its pid is unreachable from here', () => {
    const now = Date.now();
    const elsewhere = holder({ host: 'some-other-box', startedAt: new Date(now).toISOString() });
    expect(holderIsLive(elsewhere, now)).toBe(true);
    expect(holderIsLive(elsewhere, now + LOCK_MAX_AGE_MS + 1)).toBe(false);
  });

  it('treats this process as live on this host, by pid', () => {
    const now = Date.now();
    const mine = holder({ pid: process.pid, host: hostname(), startedAt: new Date(now).toISOString() });
    expect(holderIsLive(mine, now)).toBe(true);
  });

  it('treats a dead pid on this host as not live', () => {
    const now = Date.now();
    const gone = holder({ pid: 999_999_999, host: hostname(), startedAt: new Date(now).toISOString() });
    expect(holderIsLive(gone, now)).toBe(false);
  });

  it('ages out a holder on this host whatever its pid says', () => {
    const now = Date.now();
    const mine = holder({
      pid: process.pid,
      host: hostname(),
      startedAt: new Date(now - LOCK_MAX_AGE_MS - 1).toISOString(),
    });
    expect(holderIsLive(mine, now)).toBe(false);
  });

  it('counts age from the last renewal, so a holder that keeps renewing never ages out', () => {
    const now = Date.now();
    const longRunning = {
      pid: process.pid,
      host: hostname(),
      startedAt: new Date(now - 3 * LOCK_MAX_AGE_MS).toISOString(),
    };
    expect(
      holderIsLive(holder({ ...longRunning, renewedAt: new Date(now - 1_000).toISOString() }), now),
    ).toBe(true);
    expect(
      holderIsLive(
        holder({ ...longRunning, renewedAt: new Date(now - LOCK_MAX_AGE_MS - 1).toISOString() }),
        now,
      ),
    ).toBe(false);
  });

  it('renews several times inside the window a waiter allows a holder', () => {
    expect(LOCK_RENEW_INTERVAL_MS * 3).toBeLessThan(LOCK_MAX_AGE_MS);
  });
});

describe('suiteHolderIsLive', () => {
  it('keeps a live holder on this host regardless of age', () => {
    const now = Date.now();
    const mine = holder({
      pid: process.pid,
      host: hostname(),
      startedAt: new Date(now - LOCK_MAX_AGE_MS - 1).toISOString(),
    });
    expect(suiteHolderIsLive(mine, now)).toBe(true);
  });
});

describe('tryAcquire and release', () => {
  let dir = '';
  let path = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-host-lock-test-'));
    path = join(dir, 'gc-test-suite.lock');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('acquires a lock nobody holds', () => {
    const outcome = tryAcquire(path, 'lane a', Date.now());
    expect(outcome.acquired).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8')).label).toBe('lane a');
  });

  it('refuses a second acquire while this process still holds it', () => {
    tryAcquire(path, 'lane a', Date.now());
    const second = tryAcquire(path, 'lane b', Date.now());
    expect(second.acquired).toBe(false);
    if (second.acquired) return;
    expect(second.holder?.label).toBe('lane a');
  });

  it('refuses a second acquire while a live peer-rig holder is recorded', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(holder({ label: 'peer suite' })), 'utf8');
    const outcome = tryAcquire(path, 'lane b', Date.now());
    expect(outcome.acquired).toBe(false);
    if (outcome.acquired) return;
    expect(outcome.holder?.label).toBe('peer suite');
  });

  it('takes over a lock whose holder is a dead pid on this host', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(holder({ pid: 999_999_999, host: hostname() })), 'utf8');
    const outcome = tryAcquire(path, 'lane b', Date.now());
    expect(outcome.acquired).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8')).label).toBe('lane b');
  });

  it('takes over a lock that has aged out, whatever its pid says', () => {
    const now = Date.now();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        holder({
          pid: process.pid,
          host: hostname(),
          startedAt: new Date(now - LOCK_MAX_AGE_MS - 1).toISOString(),
        }),
      ),
      'utf8',
    );
    const outcome = tryAcquire(path, 'lane b', now);
    expect(outcome.acquired).toBe(true);
  });

  it('reads a malformed lock file as absent rather than throwing', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, '{ not json', 'utf8');
    const outcome = tryAcquire(path, 'lane b', Date.now());
    expect(outcome.acquired).toBe(true);
  });

  it('releases its own lock', () => {
    tryAcquire(path, 'lane a', Date.now());
    release(path);
    const outcome = tryAcquire(path, 'lane b', Date.now());
    expect(outcome.acquired).toBe(true);
  });

  it('leaves another holder alone on release, rather than clearing what it does not own', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(holder({ label: 'peer suite' })), 'utf8');
    release(path);
    expect(JSON.parse(readFileSync(path, 'utf8')).label).toBe('peer suite');
  });
});

describe('renew', () => {
  let dir = '';
  let path = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-host-lock-test-'));
    path = join(dir, 'gc-forge-run.lock');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('stamps its own lock with the renewal time and keeps who took it and when', () => {
    const takenAt = Date.now() - 60_000;
    tryAcquire(path, 'lane a', takenAt);
    expect(renew(path, takenAt + 5_000, {})).toBe(true);
    expect(readHolder(path)).toEqual({
      pid: process.pid,
      host: hostname(),
      label: 'lane a',
      startedAt: new Date(takenAt).toISOString(),
      renewedAt: new Date(takenAt + 5_000).toISOString(),
    });
    expect(readdirSync(dir)).toEqual(['gc-forge-run.lock']);
  });

  it('keeps a lock that would have aged out refused to a second taker', () => {
    const now = Date.now();
    tryAcquire(path, 'a three-hour run', now - LOCK_MAX_AGE_MS - 1);
    expect(renew(path, now, {})).toBe(true);
    const second = tryAcquire(path, 'lane b', now);
    expect(second.acquired).toBe(false);
    if (second.acquired) return;
    expect(second.holder?.label).toBe('a three-hour run');
  });

  it('leaves a lock somebody else holds exactly as it found it', () => {
    const peer = JSON.stringify(holder({ label: 'peer suite' }));
    writeFileSync(path, peer, 'utf8');
    expect(renew(path, Date.now(), {})).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(peer);
    expect(readdirSync(dir)).toEqual(['gc-forge-run.lock']);
  });

  it('writes nothing when there is no lock to renew', () => {
    expect(renew(path, Date.now(), {})).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('renews the lock of the run this process was started inside', () => {
    const now = Date.now();
    const parent = holder({ pid: process.ppid, host: hostname(), label: 'the parent run' });
    writeFileSync(path, JSON.stringify(parent), 'utf8');
    expect(renew(path, now, { [FORGE_HOLDER_ENV]: String(process.ppid) })).toBe(true);
    expect(readHolder(path)).toEqual({ ...parent, renewedAt: new Date(now).toISOString() });
  });

  it('says so on stderr, and keeps the run alive, when a renewal cannot be written', async () => {
    tryAcquire(path, 'lane a', Date.now());
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    chmodSync(dir, 0o555);
    const stop = keepRenewed(path, 5);
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
    } finally {
      stop();
      chmodSync(dir, 0o755);
    }
    const printed = err.mock.calls.map((call) => String(call[0])).join('');
    err.mockRestore();
    expect(printed).toContain(`could not renew the lock at ${path}`);
    expect(readHolder(path)?.renewedAt).toBeUndefined();
  });

  it('does not renew for a holder the environment names on another host', () => {
    const elsewhere = JSON.stringify(holder({ pid: process.ppid, host: 'some-other-box' }));
    writeFileSync(path, elsewhere, 'utf8');
    expect(renew(path, Date.now(), { [FORGE_HOLDER_ENV]: String(process.ppid) })).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(elsewhere);
  });
});

describe('acquireOrWait', () => {
  let dir = '';
  let path = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-host-lock-test-'));
    path = join(dir, 'gc-test-suite.lock');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('acquires immediately when the lock is free, without sleeping', () => {
    const sleep = vi.fn();
    const outcome = acquireOrWait(path, 'lane a', { deadlineMs: Date.now() + 1_000, pollMs: 10, sleep });
    expect(outcome.acquired).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('reports who it is waiting for, once, before the first sleep', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(holder({ label: 'the other lane' })), 'utf8');
    const seen: LockHolder[] = [];
    // The injected sleep clears the peer's lock, standing in for that lane's
    // suite finishing partway through the wait.
    const sleep = vi.fn(() => rmSync(path, { force: true }));
    const outcome = acquireOrWait(path, 'lane b', {
      deadlineMs: Date.now() + 60_000,
      pollMs: 10,
      sleep,
      onWaiting: (h) => seen.push(h),
    });
    expect(outcome.acquired).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.label).toBe('the other lane');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('polls until the deadline and gives up, naming who still holds it', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(holder({ label: 'a run that never finishes' })), 'utf8');
    let now = Date.now();
    const deadlineMs = now + 30;
    const sleep = vi.fn(() => {
      now += 10;
    });
    const outcome = acquireOrWait(path, 'lane b', { deadlineMs, pollMs: 10, sleep, now: () => now });
    expect(outcome.acquired).toBe(false);
    if (outcome.acquired) return;
    expect(outcome.holder?.label).toBe('a run that never finishes');
    expect(sleep.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('withForgeLock', () => {
  let dir = '';
  let path = '';
  const priorHome = process.env.MTG_FORGE_LOCK_HOME;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-with-forge-lock-fn-test-'));
    path = join(dir, 'gc-forge-run.lock');
    process.env.MTG_FORGE_LOCK_HOME = path;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (priorHome === undefined) delete process.env.MTG_FORGE_LOCK_HOME;
    else process.env.MTG_FORGE_LOCK_HOME = priorHome;
  });

  // mtg-b9eom review item 2: printed-probe-cli.ts and
  // printed-observed-sweep-cli.ts call the installed Forge bridge in-process
  // rather than spawning a wrapped subprocess, so they wrap their own call
  // with this function instead of with-forge-lock.ts.
  it('holds the lock for the lifetime of fn, and releases it once fn resolves', async () => {
    let heldDuringCall = false;
    const result = await withForgeLock('caller under test', async () => {
      heldDuringCall = tryAcquire(path, 'someone else', Date.now()).acquired === false;
      return 'done';
    });
    expect(result).toBe('done');
    expect(heldDuringCall).toBe(true);
    expect(tryAcquire(path, 'someone else', Date.now()).acquired).toBe(true);
  });

  it('releases the lock even when fn rejects', async () => {
    await expect(withForgeLock('caller under test', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(tryAcquire(path, 'someone else', Date.now()).acquired).toBe(true);
  });

  it('waits for a live peer holder, then runs once it frees up', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(holder({ label: 'the other forge run' })), 'utf8');
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const sleep = vi.fn(() => rmSync(path, { force: true }));
    const result = await withForgeLock('caller under test', () => Promise.resolve('done'), { sleep });
    expect(result).toBe('done');
    const printed = out.mock.calls.map((call) => String(call[0])).join('');
    expect(printed).toContain('the other forge run');
    out.mockRestore();
  });

  it('renews the lock while fn runs, and stops once fn settles', async () => {
    const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    let duringCall: LockHolder | null = null;
    await withForgeLock(
      'a run longer than the lock allows',
      async () => {
        await pause(80);
        duringCall = readHolder(path);
      },
      { renewEveryMs: 5 },
    );
    expect(duringCall).toMatchObject({ label: 'a run longer than the lock allows', pid: process.pid });
    expect((duringCall as LockHolder | null)?.renewedAt).toEqual(expect.any(String));
    expect(existsSync(path)).toBe(false);
    await pause(40);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('stops renewing when fn rejects', async () => {
    const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    await expect(
      withForgeLock('caller under test', () => Promise.reject(new Error('boom')), { renewEveryMs: 5 }),
    ).rejects.toThrow('boom');
    await pause(40);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('with-lock main', () => {
  let dir = '';
  let path = '';
  const priorHome = process.env.MTG_TEST_LOCK_HOME;
  const priorWorkers = process.env.MTG_TEST_WORKERS;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-with-lock-test-'));
    path = join(dir, 'gc-test-suite.lock');
    process.env.MTG_TEST_LOCK_HOME = path;
    delete process.env.MTG_TEST_WORKERS;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (priorHome === undefined) delete process.env.MTG_TEST_LOCK_HOME;
    else process.env.MTG_TEST_LOCK_HOME = priorHome;
    if (priorWorkers === undefined) delete process.env.MTG_TEST_WORKERS;
    else process.env.MTG_TEST_WORKERS = priorWorkers;
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
    const code = main(['--', 'npx', 'vitest', 'run'], { spawn, label: 'lane under test' });
    expect(code).toBe(0);
    expect(calls).toEqual([['npx', ['vitest', 'run'], { stdio: 'inherit' }]]);
    // Released: a fresh acquire on the same path succeeds without waiting.
    const outcome = tryAcquire(path, 'someone else', Date.now());
    expect(outcome.acquired).toBe(true);
  });

  it('passes the wrapped command exit code through', () => {
    const { spawn } = fakeSpawn({ status: 7 });
    const code = main(['--', 'true'], { spawn, label: 'lane under test' });
    expect(code).toBe(7);
  });

  it('releases the lock even when the wrapped command fails to spawn', () => {
    const { spawn } = fakeSpawn({ status: null, error: new Error('boom') });
    expect(() => main(['--', 'nonexistent'], { spawn, label: 'lane under test' })).toThrow('boom');
    const outcome = tryAcquire(path, 'someone else', Date.now());
    expect(outcome.acquired).toBe(true);
  });

  it('waits for the holder when MTG_TEST_WORKERS is set', () => {
    process.env.MTG_TEST_WORKERS = '4';
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        holder({
          pid: process.pid,
          host: hostname(),
          label: 'someone else entirely',
          startedAt: new Date(Date.now() - LOCK_MAX_AGE_MS - 1).toISOString(),
        }),
      ),
      'utf8',
    );
    const sleep = vi.fn(() => rmSync(path, { force: true }));
    const { spawn } = fakeSpawn({ status: 0 });
    const code = main(['--', 'npx', 'vitest', 'run'], { spawn, sleep, label: 'lane under test' });
    expect(code).toBe(0);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(() => readFileSync(path, 'utf8')).toThrow();
  });

  it('waits for the holder and says what it is waiting for, then runs once free', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(holder({ label: 'the other lane' })), 'utf8');
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const sleep = vi.fn(() => rmSync(path, { force: true }));
    const { spawn } = fakeSpawn({ status: 0 });
    const code = main(['--', 'npx', 'vitest', 'run'], { spawn, sleep, label: 'lane under test' });
    expect(code).toBe(0);
    const printed = out.mock.calls.map((call) => String(call[0])).join('');
    expect(printed).toContain('the other lane');
    out.mockRestore();
  });

  it('exits after the wrapped child exits', () => {
    const script = join(process.cwd(), 'packages/slice/tools/test-load/with-lock.ts');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', script, '--', process.execPath, '-e', 'process.exit(0)'],
      {
        encoding: 'utf8',
        timeout: 5_000,
        env: { ...process.env, MTG_TEST_LOCK_HOME: path },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
  });

  it('blocks a second process with MTG_TEST_WORKERS until the first process exits', async () => {
    const script = join(process.cwd(), 'packages/slice/tools/test-load/with-lock.ts');
    const marker = join(dir, 'second-ran');
    const first = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        script,
        '--',
        process.execPath,
        '-e',
        "process.stdout.write('READY\\n');process.stdin.once('data',()=>process.exit(0));process.stdin.resume()",
      ],
      { env: { ...process.env, MTG_TEST_LOCK_HOME: path } },
    );
    const firstExit = waitForExit(first);
    await waitForText(first, 'READY');
    const second = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `import { main } from ${JSON.stringify(pathToFileURL(script).href)};const waitBuffer=new SharedArrayBuffer(4);const code=main(['--',${JSON.stringify(process.execPath)},'-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`)}],{label:'second lane',sleep:()=>Atomics.wait(new Int32Array(waitBuffer),0,0,20)});process.exit(code)`,
      ],
      { env: { ...process.env, MTG_TEST_LOCK_HOME: path, MTG_TEST_WORKERS: '2' } },
    );
    const secondExit = waitForExit(second);
    try {
      await waitForText(second, 'waiting for it to exit');
      expect(existsSync(marker)).toBe(false);
      first.stdin.write('\n');
      expect(await firstExit).toBe(0);
      expect(await secondExit).toBe(0);
      expect(readFileSync(marker, 'utf8')).toBe('ran');
    } finally {
      if (first.exitCode === null) {
        first.stdin.write('\n');
        first.kill();
      }
      if (second.exitCode === null) second.kill();
    }
  }, 15_000);
});
