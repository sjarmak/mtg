import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

/** How long a waiter gives another lane's suite before measuring beside it anyway. */
export const WAIT_BUDGET_MS = 45 * 60 * 1000;

/** How often a waiter checks back. A full suite is tens of minutes; nothing here is tight. */
export const POLL_INTERVAL_MS = 10_000;

export const LOCK_MAX_AGE_MS = 40 * 60 * 1000;

export const LOCK_RENEW_INTERVAL_MS = LOCK_MAX_AGE_MS / 4;

const HolderSchema = z.object({
  pid: z.number().int().positive(),
  host: z.string().min(1),
  label: z.string().min(1),
  startedAt: z.string().min(1),
  renewedAt: z.string().min(1).optional(),
});

/** Who holds the lock, and what they said they were doing. */
export type LockHolder = z.infer<typeof HolderSchema>;

export type AcquireOutcome =
  { readonly acquired: true } | { readonly acquired: false; readonly holder: LockHolder | null };

export type HolderLiveness = (holder: LockHolder, now: number) => boolean;

function lockPathFor(filename: string, override: string | undefined): string {
  if (override !== undefined && override !== '') return resolve(override);
  const state = process.env.XDG_STATE_HOME;
  const base = state !== undefined && state !== '' ? state : join(homedir(), '.local', 'state');
  return join(base, filename);
}

/** Where the full-suite lock file lives on this host. `MTG_TEST_LOCK_HOME` overrides it, for tests and for pinning it elsewhere. */
export function testLockPath(): string {
  return lockPathFor('gc-test-suite.lock', process.env.MTG_TEST_LOCK_HOME);
}

/**
 * The directory where each live vitest run on this host leaves a claim
 * (`run-claims.ts`), so a run starting beside others can see how many suites
 * share the box's worker budget. `MTG_TEST_RUNS_HOME` overrides it, mirroring
 * the two lock paths.
 */
export function runsDirPath(): string {
  return lockPathFor('gc-test-runs', process.env.MTG_TEST_RUNS_HOME);
}

/**
 * Where the Forge-run lock lives — the second clause of the playtester's lane
 * ruling (2026-09-18 15:44Z): at most one Forge-required run at a time on the
 * host, whatever lane it belongs to. A distinct file from `testLockPath()`'s,
 * so a Forge-required run and an ordinary full suite never contend for each
 * other's slot. `MTG_FORGE_LOCK_HOME` overrides it, mirroring
 * `MTG_TEST_LOCK_HOME` above.
 */
export function forgeLockPath(): string {
  return lockPathFor('gc-forge-run.lock', process.env.MTG_FORGE_LOCK_HOME);
}

/**
 * The env shape every Forge-required opt-in flag shares, so
 * `isForgeRequiredRun` has one place to name all of them.
 */
export interface ForgeRequiredEnv {
  readonly MTG_REQUIRE_FORGE_BRIDGE?: string | undefined;
  readonly MTG_REQUIRE_FORGE_BOTS?: string | undefined;
  readonly MTG_REQUIRE_PRINTED_NATIVE_SMOKE?: string | undefined;
  readonly MTG_REQUIRE_PRINTED_ADMISSIONS?: string | undefined;
}

/**
 * Whether this run starts an installed Forge JVM under one of the repo's four
 * opt-in flags: `MTG_REQUIRE_FORGE_BRIDGE` (the bridge integration suite),
 * `MTG_REQUIRE_FORGE_BOTS` (`bot-benchmark.integration.test.ts`, an installed
 * bot runner), `MTG_REQUIRE_PRINTED_NATIVE_SMOKE`
 * (`printed-native-smoke.integration.test.ts`, an installed native game) and
 * `MTG_REQUIRE_PRINTED_ADMISSIONS` (`installed-printed-admissions.integration.test.ts`,
 * a backend service over the installed bridge). Named once so
 * `testWorkerOverride` and `forgeLockSetup` cannot drift on which flags
 * actually spawn `java` — the earlier version of this lock only recognized
 * the first, so the other three ran unlocked and unpinned to one worker
 * beside it.
 */
export function isForgeRequiredRun(env: ForgeRequiredEnv): boolean {
  return (
    env.MTG_REQUIRE_FORGE_BRIDGE === '1' ||
    env.MTG_REQUIRE_FORGE_BOTS === '1' ||
    env.MTG_REQUIRE_PRINTED_NATIVE_SMOKE === '1' ||
    env.MTG_REQUIRE_PRINTED_ADMISSIONS === '1'
  );
}

/** The holder a lock or claim file names, or null when there is no file or it does not parse as one. */
export function readHolder(path: string): LockHolder | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = HolderSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Whether a claim still stands. A pid on another host cannot be probed from
 * here, so such a claim is judged by age alone; `process.kill(pid, 0)` throws
 * `ESRCH` only when there is no such process, and `EPERM` means it exists and
 * belongs to someone else, which is still alive.
 */
export function holderIsLive(holder: LockHolder, now: number): boolean {
  const age = now - Date.parse(holder.renewedAt ?? holder.startedAt);
  if (!Number.isFinite(age) || age > LOCK_MAX_AGE_MS) return false;
  if (holder.host !== hostname()) return true;
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as { code?: string }).code === 'EPERM';
  }
}

export function suiteHolderIsLive(holder: LockHolder, now: number): boolean {
  if (holder.host !== hostname()) return holderIsLive(holder, now);
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as { code?: string }).code === 'EPERM';
  }
}

/**
 * Take the lock, or report who holds it.
 *
 * `wx` is the atomicity: two processes calling this in the same millisecond
 * cannot both succeed, because the filesystem decides. A dead or aged-out
 * holder is removed and the take retried once; a second failure means someone
 * else won the retry, and reporting them is the correct answer.
 */
export function tryAcquire(
  path: string,
  label: string,
  now: number,
  isLive: HolderLiveness = holderIsLive,
): AcquireOutcome {
  mkdirSync(dirname(path), { recursive: true });
  const mine: LockHolder = {
    pid: process.pid,
    host: hostname(),
    label,
    startedAt: new Date(now).toISOString(),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify(mine, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      return { acquired: true };
    } catch {
      const holder = readHolder(path);
      if (holder !== null && isLive(holder, now)) return { acquired: false, holder };
      rmSync(path, { force: true });
    }
  }
  return { acquired: false, holder: readHolder(path) };
}

/** Drop the lock if this process holds it. Another process's lock is left alone. */
export function release(path: string): void {
  const holder = readHolder(path);
  if (holder === null) return;
  if (holder.pid !== process.pid || holder.host !== hostname()) return;
  rmSync(path, { force: true });
}

export function renew(path: string, now: number, env: NodeJS.ProcessEnv = process.env): boolean {
  const holder = readHolder(path);
  if (holder === null || holder.host !== hostname()) return false;
  if (holder.pid !== process.pid && env[FORGE_HOLDER_ENV] !== String(holder.pid)) return false;
  const renewed: LockHolder = { ...holder, renewedAt: new Date(now).toISOString() };
  const pending = `${path}.${String(process.pid)}.renewing`;
  writeFileSync(pending, `${JSON.stringify(renewed, null, 2)}\n`, 'utf8');
  renameSync(pending, path);
  return true;
}

export function keepRenewed(path: string, everyMs: number = LOCK_RENEW_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    try {
      renew(path, Date.now());
    } catch (error: unknown) {
      process.stderr.write(
        `forge: could not renew the lock at ${path}, so it lapses ` +
          `${String(Math.round(LOCK_MAX_AGE_MS / 60_000))}m after its last renewal: ${String(error)}\n`,
      );
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

function forgeWaitMessage(holder: LockHolder): string {
  return (
    `forge: another Forge-required run holds the lock (${holder.label}, since ${holder.startedAt}); ` +
    `waiting up to ${Math.round(WAIT_BUDGET_MS / 60_000)}m rather than contending for the same JVMs.\n`
  );
}

/**
 * The env var a Forge-lock holder exports to its children: the holder's pid.
 * The lock is not reentrant, so a child that takes it again (a probe CLI's
 * `vitest run` under the Forge lock its parent holds, `with-forge-lock.ts`
 * wrapping a Forge-required vitest run) would wait out `WAIT_BUDGET_MS` on
 * its own parent. A child that sees this pid on the lock file is already
 * inside the run the lock protects and proceeds without taking or releasing.
 */
export const FORGE_HOLDER_ENV = 'MTG_FORGE_LOCK_HOLDER_PID';

/** Whether the Forge lock at `path` is held by the live process this env names. */
export function forgeLockInherited(path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const named = env[FORGE_HOLDER_ENV];
  if (named === undefined || named === '') return false;
  const holder = readHolder(path);
  if (holder === null || holder.host !== hostname() || String(holder.pid) !== named) return false;
  return holderIsLive(holder, Date.now());
}

export interface ForgeLockHandle {
  /** False when the wait ran out and the run proceeds unlocked. */
  readonly held: boolean;
  /** Drops what this call took; a no-op for an inherited or unacquired lock. */
  readonly release: () => void;
}

/**
 * Take the Forge-run lock, or recognize that an ancestor already holds it.
 * A taken lock is exported to children through `FORGE_HOLDER_ENV` until
 * `release`, so anything this process spawns treats it as already held.
 */
export function takeForgeLock(
  label: string,
  options: { readonly sleep?: (ms: number) => void; readonly onWaitOver: string },
): ForgeLockHandle {
  const path = forgeLockPath();
  if (forgeLockInherited(path)) return { held: true, release: () => undefined };
  const outcome = acquireOrWait(path, label, {
    deadlineMs: Date.now() + WAIT_BUDGET_MS,
    pollMs: POLL_INTERVAL_MS,
    sleep: options.sleep ?? sleepSync,
    onWaiting: (holder) => process.stdout.write(forgeWaitMessage(holder)),
  });
  if (!outcome.acquired) {
    process.stdout.write(options.onWaitOver);
    return { held: false, release: () => undefined };
  }
  const previous = process.env[FORGE_HOLDER_ENV];
  process.env[FORGE_HOLDER_ENV] = String(process.pid);
  return {
    held: true,
    release: () => {
      if (previous === undefined) delete process.env[FORGE_HOLDER_ENV];
      else process.env[FORGE_HOLDER_ENV] = previous;
      release(path);
    },
  };
}

/**
 * Take the host-wide Forge-run lock for the lifetime of `fn`, and release it
 * whatever `fn` does. For a CLI tool that starts the installed Forge bridge
 * in-process rather than as a wrapped subprocess (`printed-probe-cli.ts`,
 * `printed-observed-sweep-cli.ts` — `with-forge-lock.ts` wraps a *command*,
 * these wrap their own call into the bridge), so a set lane's probe/sweep run
 * never overlaps another Forge-required run's JVMs the way `verify:live` and
 * the `MTG_REQUIRE_*`-gated vitest suites already don't.
 */
export async function withForgeLock<T>(
  label: string,
  fn: () => Promise<T>,
  options: { readonly sleep?: (ms: number) => void; readonly renewEveryMs?: number } = {},
): Promise<T> {
  const handle = takeForgeLock(label, {
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    onWaitOver: 'forge: the wait ran out; running anyway rather than waiting forever.\n',
  });
  const stopRenewing = handle.held ? keepRenewed(forgeLockPath(), options.renewEveryMs) : () => undefined;
  try {
    return await fn();
  } finally {
    stopRenewing();
    handle.release();
  }
}

/**
 * Block this process for `ms`.
 *
 * `Atomics.wait` on a buffer nobody else can reach is the only way to sleep
 * without an event loop turn — every caller here is synchronous `spawnSync`
 * work end to end, and a promise-based sleep would return control to a loop
 * with nothing scheduled on it.
 */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface WaitOptions {
  /** Absolute `Date.now()`-scale time to stop waiting and measure anyway. */
  readonly deadlineMs: number;
  readonly pollMs: number;
  readonly sleep: (ms: number) => void;
  readonly now?: () => number;
  readonly isLive?: HolderLiveness;
  /** Called once, as soon as another live holder is found, before the first sleep. */
  readonly onWaiting?: (holder: LockHolder) => void;
}

export function acquireOrWait(path: string, label: string, options: WaitOptions): AcquireOutcome {
  const now = options.now ?? Date.now;
  let outcome = tryAcquire(path, label, now(), options.isLive);
  if (outcome.acquired) return outcome;
  if (outcome.holder !== null) options.onWaiting?.(outcome.holder);
  while (now() < options.deadlineMs) {
    options.sleep(options.pollMs);
    outcome = tryAcquire(path, label, now(), options.isLive);
    if (outcome.acquired) return outcome;
  }
  return outcome;
}
