/**
 * Vitest global setup: take the host-wide Forge-run lock for the whole run's
 * lifetime whenever the run is Forge-required (`isForgeRequiredRun`).
 *
 * The second clause of the playtester's lane ruling (2026-09-18 15:44Z, gas-city
 * template-fragments/mtg-pl-seat.template.md ~line 130): at most one
 * Forge-required run at a time on the host, with `MTG_TEST_WORKERS=1`.
 * `mtg-5n7yb` (host-lock.ts, with-lock.ts) enforces only the first clause —
 * at most one full suite at a time — and takes no lock at all for a
 * Forge-required run, so two lanes each running one measured load 81 with 18
 * JVMs. This is the same mechanism (`host-lock.ts`'s `acquireOrWait`/`release`)
 * under a second lock name (`forgeLockPath`), so the two kinds of run never
 * contend for each other's slot.
 *
 * `vitest.config.ts`'s own `MAX_WORKERS` (via `workers.ts`'s
 * `testWorkerOverride`) forces the single-worker half of the rule, computed
 * before this file ever runs — a global setup file loads after the pool size
 * is already fixed, so it could not force it here even if it tried.
 *
 * A run that is not Forge-required takes no lock and returns no teardown:
 * `isForgeRequiredRun` names the four opt-in flags that actually start an
 * installed Forge JVM (`MTG_REQUIRE_FORGE_BRIDGE`, `MTG_REQUIRE_FORGE_BOTS`,
 * `MTG_REQUIRE_PRINTED_NATIVE_SMOKE`, `MTG_REQUIRE_PRINTED_ADMISSIONS`), and
 * every test gated by one of those already skips without it, so there is
 * nothing here to serialize against on an ordinary run.
 */
import { hostname } from 'node:os';
import {
  forgeLockPath,
  isForgeRequiredRun,
  keepRenewed,
  takeForgeLock,
  type ForgeRequiredEnv,
} from './host-lock';

export interface SetupOptions {
  readonly sleep?: (ms: number) => void;
  readonly env?: ForgeRequiredEnv;
  readonly renewEveryMs?: number;
}

/** Exported for tests; the default export below is what Vitest actually loads. */
export function forgeLockSetup(options: SetupOptions = {}): (() => void) | void {
  const env = options.env ?? process.env;
  if (!isForgeRequiredRun(env)) return undefined;
  const label = `vitest (forge) pid ${process.pid} on ${hostname()}`;
  const handle = takeForgeLock(label, {
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    onWaitOver: 'forge: the wait ran out; measuring anyway rather than waiting forever.\n',
  });
  if (!handle.held) return undefined;
  const stopRenewing = keepRenewed(forgeLockPath(), options.renewEveryMs);
  return () => {
    stopRenewing();
    handle.release();
  };
}

export default function setup(): (() => void) | void {
  return forgeLockSetup();
}
