/**
 * Which vitest runs are live on this host right now, so one run can size its
 * pool against the others instead of against the whole machine.
 *
 * `mtg-a3ix4`. `workers.ts` caps a run at half the cores, and that cap is
 * computed per process: three worker slots each correctly take half the box and
 * the host gets a pool and a half of vitest workers per core before the headless
 * Chrome and Xvfb each browser suite starts. `host-lock.ts` cannot help. It
 * serializes full suites that go through `npm test` or `npm run gate`, and a
 * lane's `npx vitest run --project unit` takes no lock at all.
 *
 * A claim is a file, `<pid>.json`, holding a `LockHolder` — the same shape and
 * the same liveness rule (`holderIsLive`) as the two locks, because a claim is a
 * lock nobody waits on. `run-claim-setup.ts` writes one from vitest's global
 * setup and removes it in the teardown. It is not written at config load,
 * because `vitest.config.ts` is imported by test workers and by the gate's own
 * process, and every one of those would leave a claim under its own pid.
 *
 * Counting only reads: a dead claim is ignored there and removed by the next
 * `claimRun`, so importing the config stays free of side effects.
 *
 * What this does not do, stated because it is the reason `MTG_TEST_SLOTS`
 * exists. A run sizes itself once, from the claims that exist when its config is
 * evaluated. The first of three runs sees none and takes the whole budget, the
 * second sees one and takes half, and a run cannot shrink after it has started.
 * Two runs that evaluate their configs before either has claimed also both see
 * none. A pool that says how many runs it will start has neither problem.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { type LockHolder, holderIsLive, readHolder } from './host-lock';

function claimPathFor(dir: string, pid: number): string {
  return join(dir, `${pid}.json`);
}

/**
 * How many runs other than `exceptPid` are live on this host.
 *
 * A claim from another host is not counted: a state directory shared over a
 * network does not put that machine's suites on these cores. A missing
 * directory is zero runs; any other read failure is a real one and propagates,
 * because a run that cannot tell how crowded the box is should say so rather
 * than guess it is alone.
 */
export function liveRunCount(dir: string, now: number = Date.now(), exceptPid: number = process.pid): number {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') return 0;
    throw error;
  }
  let live = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const holder = readHolder(join(dir, name));
    if (holder === null || holder.host !== hostname() || holder.pid === exceptPid) continue;
    if (holderIsLive(holder, now)) live += 1;
  }
  return live;
}

/**
 * Remove every claim in `dir` whose run is gone. A file that does not parse is
 * left alone: it may be another run's claim half-written, and dropping that
 * would cost the run its place among the live ones.
 */
function sweepDeadClaims(dir: string, now: number): void {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    const holder = readHolder(path);
    if (holder !== null && !holderIsLive(holder, now)) rmSync(path, { force: true });
  }
}

/**
 * Claim a place among the live runs for this process, and return what removes
 * it. Overwrites an earlier claim under the same pid, which can only be a dead
 * process's.
 */
export function claimRun(dir: string, label: string, now: number = Date.now()): () => void {
  mkdirSync(dir, { recursive: true });
  sweepDeadClaims(dir, now);
  const mine: LockHolder = {
    pid: process.pid,
    host: hostname(),
    label,
    startedAt: new Date(now).toISOString(),
  };
  const path = claimPathFor(dir, process.pid);
  writeFileSync(path, `${JSON.stringify(mine, null, 2)}\n`, 'utf8');
  return () => rmSync(path, { force: true });
}
