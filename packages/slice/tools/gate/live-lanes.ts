/**
 * Whether a full-suite gate run is about to measure beside a live mtg-worker
 * lane on this host, and who to name in the refusal.
 *
 * `mtg-vxbbi`. "One full suite at a time on this host, and never beside a
 * lane" (CLAUDE.md) has been broken three times by the lead seat, each
 * costing a voided run of about fifteen minutes: a gate started from outside
 * any worker session (the lead's own landing or base-recording run) measured
 * beside a live worker lane, drove the box past its core count, and its
 * verdict was void before it finished.
 *
 * A worker session's processes carry these in `/proc/<pid>/environ` (measured
 * 2026-09-22 from a live lane, workflow mtg-fcivz): `GC_RIG=mtg`,
 * `GC_AGENT=mtg-worker-pool`, `GC_TEMPLATE=/home/agent/projects/mtg/mtg-worker`,
 * `GC_SESSION_ID=gc-996747`, `GC_DIR=/home/agent/mtg-worktrees/mtg-worker-slots/
 * mtg-worker-1`. Children such as `tsc`, `vitest` and `chrome` inherit them.
 * `isWorkerEnv` is the one place that rule lives, so nothing here can drift
 * against it independently; it couples this module to gas-city's session
 * environment shape, and will need updating if that shape changes.
 *
 * Lanes run their own gate inside the worker session (pool max is 4, and each
 * lane's full suite already queues on the host-wide suite lock,
 * `../test-load/host-lock.ts`), so a gate running INSIDE a worker session
 * must never refuse on other lanes — only a gate run from outside any worker
 * session (a lead's landing or base-recording run) checks at all.
 *
 * Split into a pure decision over an injected process table (`findLiveLanes`)
 * and a thin reader over `/proc` (`readLiveProcessTable`), the way
 * `../test-load/host-lock.ts` splits its own liveness rule from its file IO:
 * the decision is what is worth testing without a real host.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';

/** One live process, as read from (or faked in place of) `/proc`. */
export interface ProcessRow {
  readonly pid: number;
  /** `/proc/<pid>/cwd`, or `null` when it could not be read (permissions, or the process is gone). */
  readonly cwd: string | null;
  readonly environ: Readonly<Record<string, string>>;
  readonly argv: readonly string[];
}

/** One distinct working tree a live lane's processes sit in. */
export interface LiveLaneWorktree {
  readonly cwd: string;
  /** `git rev-parse --abbrev-ref HEAD` there, or `null` when `cwd` is not a git worktree. */
  readonly branch: string | null;
}

/** One live worker lane: every process sharing one `GC_SESSION_ID`. */
export interface LiveLane {
  readonly sessionId: string;
  /** `GC_DIR` from whichever process in the group carried it, or `null` if none did. */
  readonly slotDir: string | null;
  readonly worktrees: readonly LiveLaneWorktree[];
  readonly processes: readonly { readonly pid: number; readonly command: string }[];
}

/**
 * Whether `env` belongs to an mtg-worker session. The one exported rule so
 * `findLiveLanes` and a gate's self-check cannot drift on what counts as a
 * worker.
 *
 * `GC_RIG` names the rig rather than `GC_AGENT` or `GC_SESSION_ID`, because a
 * process with `GC_RIG` set to another rig is a peer project's lane on the
 * same host and must be ignored, not refused on.
 */
export function isWorkerEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.GC_RIG !== 'mtg') return false;
  const template = env.GC_TEMPLATE;
  if (template === undefined || template === '') return false;
  const segments = template.split('/').filter((segment) => segment !== '');
  return segments[segments.length - 1] === 'mtg-worker';
}

/** `git rev-parse --abbrev-ref HEAD` at `cwd`, or `null` when it is not a git worktree. */
export function defaultGitBranch(cwd: string): string | null {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const branch = result.stdout.trim();
  return branch === '' ? null : branch;
}

/**
 * Whether `argv` is one of the two known idle-poll loops a drained worker
 * session runs between dispatches, rather than real work: `gc nudge poll`
 * and a `bd ready --assignee=...` loop (`mtg-u7u0e`, first seen against
 * session `gc-996747` whose lane bead had already closed).
 *
 * Matches by substring over the joined command, not by argv position, so an
 * interpreter, a path prefix, or a proxy such as `rtk` in front of the real
 * command does not defeat it. Only these two named shapes are recognized;
 * anything else — a test command, a node/vitest process, a command this
 * guard does not recognize — counts as live work. That is the safe default
 * this guard already had: refusing is the safe direction, so only a known
 * poll loop is carved out of it, nothing is allow-listed by omission.
 */
export function isPollerCommand(argv: readonly string[]): boolean {
  const command = argv.join(' ');
  if (/\bgc\b.*\bnudge\b.*\bpoll\b/u.test(command)) return true;
  if (/\bbd\b.*\bready\b/u.test(command)) return true;
  return false;
}

/**
 * Group a process table into live worker lanes by `GC_SESSION_ID`.
 *
 * Pure over an injected table, so the grouping is testable without a real
 * host. A row whose `GC_SESSION_ID` is unset is a worker process gas-city
 * has not finished stamping yet and is skipped rather than grouped under an
 * empty key.
 *
 * A session whose every live process is a poll loop (`isPollerCommand`) is
 * not a live lane and is left out of the result entirely (`mtg-u7u0e`): an
 * idle pool session between dispatches spends no CPU worth voiding a suite
 * over. A session with even one non-poller process — a build, a test run,
 * the implementation work itself — is still reported in full, pollers
 * included, because that lane really is live.
 */
export function findLiveLanes(
  table: readonly ProcessRow[],
  gitBranch: (cwd: string) => string | null = defaultGitBranch,
): readonly LiveLane[] {
  const bySession = new Map<string, ProcessRow[]>();
  for (const row of table) {
    if (!isWorkerEnv(row.environ)) continue;
    const sessionId = row.environ.GC_SESSION_ID;
    if (sessionId === undefined || sessionId === '') continue;
    const group = bySession.get(sessionId);
    if (group === undefined) bySession.set(sessionId, [row]);
    else group.push(row);
  }

  const branchCache = new Map<string, string | null>();
  const branchOf = (cwd: string): string | null => {
    const cached = branchCache.get(cwd);
    if (cached !== undefined) return cached;
    const branch = gitBranch(cwd);
    branchCache.set(cwd, branch);
    return branch;
  };

  const lanes: LiveLane[] = [];
  for (const [sessionId, rows] of bySession) {
    if (rows.every((row) => isPollerCommand(row.argv))) continue;
    const slotDir = rows.find((row) => row.environ.GC_DIR !== undefined)?.environ.GC_DIR ?? null;
    const cwds = [...new Set(rows.map((row) => row.cwd).filter((cwd): cwd is string => cwd !== null))];
    lanes.push({
      sessionId,
      slotDir,
      worktrees: cwds.map((cwd) => ({ cwd, branch: branchOf(cwd) })),
      processes: rows.map((row) => ({ pid: row.pid, command: row.argv.join(' ') || `pid ${row.pid}` })),
    });
  }
  return lanes;
}

/** Raw bytes a process's `/proc/<pid>/*` files hand back, or `null` when the pid could not be read. */
export interface ProcReaders {
  readonly listPids: () => readonly string[];
  /** The raw, NUL-joined content of `/proc/<pid>/environ`, or `null` if it could not be read. */
  readonly readEnviron: (pid: number) => string | null;
  /** The target of `/proc/<pid>/cwd`, or `null` if it could not be read. */
  readonly readCwdLink: (pid: number) => string | null;
  /** The raw, NUL-joined content of `/proc/<pid>/cmdline`, or `null` if it could not be read. */
  readonly readCmdline: (pid: number) => string | null;
}

/** The real `/proc` on this host. */
export const defaultProcReaders: ProcReaders = {
  listPids: () => readdirSync('/proc').filter((name) => /^\d+$/u.test(name)),
  readEnviron: (pid) => {
    try {
      return readFileSync(`/proc/${pid}/environ`, 'utf8');
    } catch {
      return null;
    }
  },
  readCwdLink: (pid) => {
    try {
      return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  },
  readCmdline: (pid) => {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    } catch {
      return null;
    }
  },
};

function parseEnviron(raw: string): Record<string, string> {
  const environ: Record<string, string> = {};
  for (const entry of raw.split('\0')) {
    if (entry === '') continue;
    const at = entry.indexOf('=');
    if (at === -1) continue;
    environ[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return environ;
}

function parseCmdline(raw: string): readonly string[] {
  return raw.split('\0').filter((token) => token !== '');
}

/**
 * Read every process on this host from `/proc` (or from `readers`, a fake
 * for tests).
 *
 * A pid that vanishes mid-scan, or whose `environ` cannot be read
 * (permissions, or it exited between the `readdir` and the read), is skipped
 * by design: a race and another user's process are both normal here, and
 * this is a best-effort snapshot, not an assertion that the list is
 * complete. `environ` is the row's load-bearing field, so a pid that fails
 * only there is dropped outright; `cwd` and `argv` are best-effort on top of
 * that and degrade to `null` / `[]` rather than dropping the row.
 */
export function readLiveProcessTable(readers: ProcReaders = defaultProcReaders): readonly ProcessRow[] {
  let pids: readonly string[];
  try {
    pids = readers.listPids();
  } catch {
    return [];
  }
  const rows: ProcessRow[] = [];
  for (const pidStr of pids) {
    const pid = Number(pidStr);
    const environRaw = readers.readEnviron(pid);
    if (environRaw === null) continue;
    const cmdlineRaw = readers.readCmdline(pid);
    rows.push({
      pid,
      cwd: readers.readCwdLink(pid),
      environ: parseEnviron(environRaw),
      argv: cmdlineRaw === null ? [] : parseCmdline(cmdlineRaw),
    });
  }
  return rows;
}

/** One line per live lane: session id, slot dir, each worktree's branch, and its processes. */
export function describeLiveLanes(lanes: readonly LiveLane[]): string {
  return lanes
    .map((lane) => {
      const slot = lane.slotDir ?? 'unknown slot (no GC_DIR observed)';
      const worktrees =
        lane.worktrees.length === 0
          ? 'no cwd observed'
          : lane.worktrees.map((wt) => `${wt.cwd} (${wt.branch ?? 'not a git worktree'})`).join(', ');
      const processes = lane.processes.map((proc) => `pid ${proc.pid} [${proc.command}]`).join(', ');
      return `  session ${lane.sessionId} — slot ${slot} — ${worktrees} — ${processes}`;
    })
    .join('\n');
}

/** The exit code a refusal here uses. Unused by `cli.ts` and `merge.ts` before this change. */
export const LIVE_LANE_REFUSAL_EXIT_CODE = 3;

/** What checking for live lanes decided, and what it printed along the way. */
export interface LiveLaneCheck {
  /** `false` means: do not measure. */
  readonly ok: boolean;
  /** What to print, or `''` when there is nothing to say (no lanes, and this run is itself a worker). */
  readonly message: string;
}

/**
 * Whether this run may measure now.
 *
 * A worker gate (`env` is itself an mtg-worker session) always says yes and
 * prints nothing: it is a lane measuring its own tree, and those suites
 * already queue on the host-wide suite lock. `besideLanes` is the
 * `--beside-lanes` override, off by default; with it the run proceeds and
 * the lanes it is measuring beside are printed rather than silently
 * ignored.
 */
export function checkLiveLanes(
  env: Readonly<Record<string, string | undefined>>,
  table: readonly ProcessRow[],
  besideLanes: boolean,
  gitBranch: (cwd: string) => string | null = defaultGitBranch,
): LiveLaneCheck {
  if (isWorkerEnv(env)) return { ok: true, message: '' };
  const lanes = findLiveLanes(table, gitBranch);
  if (lanes.length === 0) return { ok: true, message: '' };
  const described = describeLiveLanes(lanes);
  if (besideLanes) {
    return {
      ok: true,
      message: `gate: --beside-lanes was passed; measuring beside ${lanes.length} live worker lane(s):\n${described}\n`,
    };
  }
  return {
    ok: false,
    message:
      `gate: refusing — ${lanes.length} worker lane(s) are live on this host, and CLAUDE.md says one ` +
      `full suite at a time on this host, and never beside a lane. Pass --beside-lanes to measure anyway.\n` +
      `${described}\n`,
  };
}
