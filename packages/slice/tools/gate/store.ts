/**
 * Where a base verdict is kept, and how two lanes that want the same one at the
 * same moment avoid both paying for it.
 *
 * The store is deliberately **outside every checkout**. Lanes run in per-bead
 * worktrees under the orchestrator's worktree root, each created and destroyed
 * around one bead, and a memo inside one of those is a memo exactly one lane reads
 * and that is deleted before the second lane exists. It is keyed to the host
 * rather than shared over a network because what it records is partly a fact
 * about this machine's artifacts and runtime, which `verdict.ts` puts in the key.
 *
 * `MTG_GATE_HOME` overrides the location, which is what the tests use.
 *
 * ## Why a pid is the liveness probe here, when `lane-claim/` refuses one
 *
 * `lane-claim/claim.ts` argues at length that a pid would be worse than nothing
 * for its problem, and it is right: its writer is an *agent*, and the claim is
 * taken by a one-shot `npx tsx` that has exited by the time anyone looks, so a
 * pid check would find the holder dead every time and grant every twin.
 *
 * The holder here is the opposite shape. It is the process that is running the
 * suite, and it stays alive for the whole thirty-odd minutes it holds the claim.
 * Its pid being gone means the run really is gone, which is the only thing this
 * claim needs to know. The two modules reach opposite conclusions from the same
 * rule, which is that a liveness probe is worth having exactly when the thing
 * it probes is the thing that holds the lock.
 *
 * A claim is still bounded by age as well, because a probe cannot speak for a
 * pid on another host and because a process can wedge without exiting. Taking a
 * claim over is safe in a way losing a worktree is not: the worst case is two
 * lanes measuring the same sha, which is exactly what happens today.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { LoadAttributionSchema } from './load';
import type { BaseRecord, ReviewRecord } from './verdict';

/** How long to wait for another lane's measurement before giving up and measuring too. */
export const WAIT_BUDGET_MS = 45 * 60 * 1000;

/** How often the waiter looks. A full suite is ~32 minutes; nothing here is tight. */
export const POLL_INTERVAL_MS = 10_000;

/**
 * When a claim is stale whatever its pid says.
 *
 * Above the longest run measured (1943s) with room for a loaded box, and below
 * the wait budget, so a waiter never expires while still believing in a claim.
 */
export const CLAIM_MAX_AGE_MS = 40 * 60 * 1000;

/**
 * The attribution is additive and only explains a verdict, so a record written
 * before it existed parses, and one whose attribution no longer matches the
 * schema loses the attribution and keeps the verdict. Dropping the whole record
 * for it would cost a full suite to re-learn what the record still says.
 */
const OptionalLoad = LoadAttributionSchema.optional().catch(undefined);

const BaseRecordSchema = z.object({
  identity: z.object({
    baseSha: z.string().min(1),
    suite: z.string().min(1),
    artifacts: z.array(z.string()),
    runtime: z.string().min(1),
  }),
  outcome: z.union([z.literal('green'), z.literal('red')]),
  reason: z.string().min(1),
  redFiles: z.array(z.string()),
  load: OptionalLoad,
  measuredAt: z.string().min(1),
  durationMs: z.number(),
  measuredBy: z.string().min(1),
});

/** Same shape as `BaseRecordSchema`, with the tree-keyed identity `verdict.ts`'s `ReviewIdentity` describes. */
const ReviewRecordSchema = z.object({
  identity: z.object({
    tree: z.string().min(1),
    suite: z.string().min(1),
    bar: z.union([z.literal('full'), z.literal('scoped')]),
    changedFiles: z.array(z.string()),
    artifacts: z.array(z.string()),
    runtime: z.string().min(1),
    forgeBridge: z.boolean(),
  }),
  outcome: z.union([z.literal('green'), z.literal('red')]),
  reason: z.string().min(1),
  redFiles: z.array(z.string()),
  selectedTestFiles: z.array(z.string()),
  load: OptionalLoad,
  measuredAt: z.string().min(1),
  durationMs: z.number(),
  measuredBy: z.string().min(1),
});

const ClaimSchema = z.object({
  pid: z.number().int().positive(),
  host: z.string().min(1),
  worktree: z.string().min(1),
  startedAt: z.string().min(1),
});

/** A lane's claim on measuring one identity. */
export type GateClaim = z.infer<typeof ClaimSchema>;

/** Where verdicts are kept on this host. */
export function gateHome(): string {
  const override = process.env.MTG_GATE_HOME;
  if (override !== undefined && override !== '') return resolve(override);
  const state = process.env.XDG_STATE_HOME;
  const base = state !== undefined && state !== '' ? state : join(homedir(), '.local', 'state');
  return join(base, 'mtg-lab', 'gate');
}

function recordPath(home: string, digest: string): string {
  return join(home, `${digest}.json`);
}

function claimPath(home: string, digest: string): string {
  return join(home, `${digest}.claim.json`);
}

/**
 * The record filed under this digest, or `null`.
 *
 * A malformed file reads as absent rather than throwing: the store is a cache
 * on a shared host, and a half-written or hand-edited entry should cost one
 * re-measurement, not abort a lane. It is deleted on the way past so the next
 * lane does not re-read the same garbage.
 *
 * Generic over the record shape because the base and review records share this
 * IO exactly and differ only in what their identity contains; `schema` is what
 * tells a base digest and a review digest apart if they ever collided.
 */
function readTypedRecord<T>(home: string, digest: string, schema: z.ZodType<T>): T | null {
  const path = recordPath(home, digest);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    rmSync(path, { force: true });
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    rmSync(path, { force: true });
    return null;
  }
  return parsed.data;
}

/**
 * File a record, atomically.
 *
 * Written beside and renamed, because a reader on this host can arrive between
 * the open and the last byte, and a truncated read costs the reader a full
 * suite. `renameSync` within one directory is atomic on every filesystem this
 * runs on.
 */
function writeTypedRecord(home: string, digest: string, record: unknown): void {
  mkdirSync(home, { recursive: true });
  const target = recordPath(home, digest);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  renameSync(staging, target);
}

export function readRecord(home: string, digest: string): BaseRecord | null {
  return readTypedRecord(home, digest, BaseRecordSchema);
}

export function writeRecord(home: string, digest: string, record: BaseRecord): void {
  writeTypedRecord(home, digest, record);
}

/** Same store, same digest namespace, the tree-keyed record `mtg-wq3q8.1` adds. */
export function readReviewRecord(home: string, digest: string): ReviewRecord | null {
  return readTypedRecord(home, digest, ReviewRecordSchema);
}

export function writeReviewRecord(home: string, digest: string, record: ReviewRecord): void {
  writeTypedRecord(home, digest, record);
}

export function reviewRecordsForTree(home: string, tree: string): readonly ReviewRecord[] {
  if (!existsSync(home)) return [];
  return readdirSync(home)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.claim.json'))
    .flatMap((name) => {
      try {
        const parsed = ReviewRecordSchema.safeParse(JSON.parse(readFileSync(join(home, name), 'utf8')));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    })
    .filter((record) => record.identity.tree === tree)
    .sort((left, right) => right.measuredAt.localeCompare(left.measuredAt));
}

/** The claim on this digest, or `null` when there is none or it is unreadable. */
export function readClaim(home: string, digest: string): GateClaim | null {
  const path = claimPath(home, digest);
  if (!existsSync(path)) return null;
  try {
    const parsed = ClaimSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Whether a claim still stands.
 *
 * A pid on another host cannot be probed from here, so such a claim is judged
 * by age alone. `process.kill(pid, 0)` signals nothing and throws `ESRCH` only
 * when there is no such process; `EPERM` means it exists and belongs to someone
 * else, which is still alive.
 */
export function claimIsLive(claim: GateClaim, now: number): boolean {
  const age = now - Date.parse(claim.startedAt);
  if (!Number.isFinite(age) || age > CLAIM_MAX_AGE_MS) return false;
  if (claim.host !== hostname()) return true;
  try {
    process.kill(claim.pid, 0);
    return true;
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    return code === 'EPERM';
  }
}

/**
 * Take the claim, or report who holds it.
 *
 * `wx` is the atomicity: two lanes calling this in the same millisecond cannot
 * both succeed, because the filesystem decides. A dead or aged-out claim is
 * removed and the take is retried once, which is enough — a second failure
 * means somebody else won the retry, and reporting them is the correct answer.
 */
export function takeClaim(home: string, digest: string, worktree: string, now: number): GateClaim | null {
  mkdirSync(home, { recursive: true });
  const mine: GateClaim = {
    pid: process.pid,
    host: hostname(),
    worktree,
    startedAt: new Date(now).toISOString(),
  };
  const path = claimPath(home, digest);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify(mine, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      return mine;
    } catch {
      const holder = readClaim(home, digest);
      if (holder !== null && claimIsLive(holder, now)) return null;
      rmSync(path, { force: true });
    }
  }
  return null;
}

/** Drop a claim this process holds. Another process's claim is left alone. */
export function releaseClaim(home: string, digest: string): void {
  const holder = readClaim(home, digest);
  if (holder === null) return;
  if (holder.pid !== process.pid || holder.host !== hostname()) return;
  rmSync(claimPath(home, digest), { force: true });
}
