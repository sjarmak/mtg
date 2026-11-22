/**
 * Whether the base branch was already red, answered once per sha rather than
 * once per lane.
 *
 * Every dispatched lane runs `npm run typecheck && npm test` twice: once in
 * `mol-scoped-work`'s `preflight-tests` step, against a worktree the previous
 * step created *at the base ref*, and once at review against the finished
 * branch. Measured on main at 48a3b6ea (`out/base-red-2026-09-17/`), one full
 * run is 1943s over 2660 files, and one file — the format-health balance gate —
 * holds a worker for 1800s of it, so no run containing it finishes faster than
 * thirty minutes however many cores it is given.
 *
 * The preflight half of that is the same measurement every time. Three lanes
 * standing on one base sha ask one question and pay for the answer three times.
 * So the answer is written down, keyed by what it is an answer about, and the
 * second lane reads it. N lanes on one sha go from 2N full suites to N+1, and
 * the change carries no selection risk at all, because a memo hit returns
 * literally the same verdict the re-run would have produced.
 *
 * ## Why this is not test selection
 *
 * The obvious cheaper preflight is "run only the tests the change can reach",
 * and it cannot be built here: `preflight-tests` runs after `workspace-setup`,
 * which branches from the base, so at the moment preflight runs there is no
 * diff to take a closure of. The lane knows its bead, not its edits. Selecting
 * from the bead would be a guess, and the one failure mode worth refusing is
 * silently skipping a dependent. Memoizing answers the same question exactly.
 *
 * ## What a measurement is a measurement of
 *
 * The sha alone is not the key, and the reason is `mtg-d9cu1`. `data/store/`
 * and `tools/forge/dist` are gitignored, so a fresh per-bead worktree has
 * neither the 656 MB card store nor the Forge install, and about 29 tests go
 * red on their absence while the identical sha is green in a checkout that has
 * them. A verdict recorded in one of those trees is not a fact about the sha.
 * Artifact presence is therefore part of the identity, alongside the suite that
 * was run and the runtime that ran it — a node upgrade is not in the sha either.
 *
 * ## Why a red verdict is recorded only when something actually asserted
 *
 * Memoizing red is where this could do real damage: a poisoned entry is read
 * as the base's own red list by every later lane on that sha until it expires,
 * and review exempts exactly that list (`decideReviewExit`). A red base no
 * longer stops a lane at preflight (`decidePreflightExit`: `mol-scoped-work`
 * aborts the scope when the step fails, and a lane dispatched on a red main used
 * to die before it wrote a line), so a wrong entry now hides regressions
 * instead of aborting lanes; the recording rule below is what keeps the list
 * true. And this box produces red runs that are facts about the box
 * — a wave of parallel lanes drives it to several times its core count and
 * vitest's timeouts stop being hang detectors (`test-suite-false-failures-are-
 * oversubscription`, and `test-load/timeout-only.ts` for the arithmetic).
 *
 * So the rule is asymmetric on purpose. Green always records: load cannot make
 * a failing test pass. Red records only when at least one red file failed an
 * assertion rather than a clock. A run whose every red file is timeout-only,
 * or which exited non-zero with no red file at all, records nothing and the
 * next lane measures again. Refusing to write costs one re-run; writing a lie
 * costs every lane on that sha.
 *
 * The typechecker is held to the same bar and used not to be. A `tsc` that was
 * killed by a signal, or that exited non-zero without printing one diagnostic,
 * is the box ending the run rather than the tree being wrong, and it was filed
 * as a property of the sha all the same (`mtg-urbjc`: a preflight that showed
 * `> tsc --noEmit` and nothing after it stored a red base for a tree whose
 * `tsc` exited 0 two minutes later). `judgeTypecheck` records a typecheck red
 * only when it exited with a status and printed at least one `error TS` line,
 * and the first such line goes into the stored reason so a reader of the record
 * sees what the tree was refused for.
 *
 * This module is the judgment. `store.ts` is the file IO and `cli.ts` is the
 * command, split the way `lane-claim/` and `test-load/` split theirs: the
 * decision table is the part worth testing.
 */
import { createHash } from 'node:crypto';
import type { LoadAttribution } from './load';
import type { GateBar } from './scope';

/**
 * How long a recorded measurement stands.
 *
 * The sha, the suite, the artifacts and the runtime are all in the key, so an
 * entry is only wrong if something outside all four drifted — an unpinned
 * global tool, a machine's own state. A day is short enough that such a drift
 * is re-measured the same day and long enough that a base sha, which lives
 * hours, is never measured twice for lack of patience.
 */
export const MEASUREMENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The gitignored artifacts whose presence changes the verdict, repo-relative.
 *
 * Both are named in `mtg-d9cu1` and in the handoff notes' third kind of red.
 * The card store is 656 MB and the Forge install is a build output, so neither
 * is in a clone and neither is in a fresh per-bead worktree; about 29 tests go
 * red on their absence at a sha that is green where they exist. A list rather
 * than a pair because the next one will be found the same way, and a verdict
 * keyed on a stale list is a verdict that silently means something else.
 */
export const GATED_ARTIFACTS: readonly string[] = ['data/store/mtg.sqlite', 'tools/forge/dist'];

/** What a base measurement is a measurement of. Every field is in the key. */
export interface BaseIdentity {
  /** The commit measured. `git merge-base <base ref> HEAD`, never `HEAD` itself. */
  readonly baseSha: string;
  /** The command that produced the verdict, verbatim. A different suite is a different answer. */
  readonly suite: string;
  /**
   * Which of the gitignored artifacts this tree had, sorted. Absent ones are
   * absent from the list rather than recorded as false, so the list reads as
   * what was there.
   */
  readonly artifacts: readonly string[];
  /** `process.version`. A node upgrade changes the answer and is not in the sha. */
  readonly runtime: string;
}

/** A recorded measurement of one identity. */
export interface BaseRecord {
  readonly identity: BaseIdentity;
  readonly outcome: 'green' | 'red';
  /**
   * One line saying what the verdict was, for whoever reads a hit weeks later.
   * A record whose `redFiles` is empty and whose outcome is red is the
   * typechecker, and this is where it says so.
   */
  readonly reason: string;
  /** The red files, relative to the repo root. Empty when green. */
  readonly redFiles: readonly string[];
  /**
   * What the run attributed those red files to: the box, and per file whether it
   * failed only on a clock. Absent on a green record and on one written before
   * `mtg-tgsol`, so a reader must not treat absence as "quiet box".
   */
  readonly load?: LoadAttribution | undefined;
  /** ISO 8601. Compared against the TTL, and printed. */
  readonly measuredAt: string;
  readonly durationMs: number;
  /** Host and worktree of whoever paid for it. Reported, never compared. */
  readonly measuredBy: string;
}

/**
 * The identity's address in the store.
 *
 * A digest rather than a path built out of the fields, because the suite is a
 * shell command and the artifacts are paths, and neither is safe as a filename.
 * The record carries the whole identity as well, so a reader of one file can
 * see what it is about and `decideReuse` can catch a file that does not match
 * the name it is under.
 */
export function identityDigest(identity: BaseIdentity): string {
  const canonical = [
    `sha=${identity.baseSha}`,
    `suite=${identity.suite}`,
    `artifacts=${[...identity.artifacts].sort().join(',')}`,
    `runtime=${identity.runtime}`,
  ].join('\n');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** Whether two identities are the same question. Field-wise, order-insensitive on artifacts. */
export function sameIdentity(left: BaseIdentity, right: BaseIdentity): boolean {
  return (
    left.baseSha === right.baseSha &&
    left.suite === right.suite &&
    left.runtime === right.runtime &&
    [...left.artifacts].sort().join(',') === [...right.artifacts].sort().join(',')
  );
}

export type Reuse =
  | { readonly kind: 'reuse'; readonly why: string; readonly record: BaseRecord }
  | { readonly kind: 'measure'; readonly why: string };

/** What a caller knows when it asks whether it may skip the run. */
export interface ReuseInput {
  readonly wanted: BaseIdentity;
  /** What the store holds under `identityDigest(wanted)`, or `null`. */
  readonly stored: BaseRecord | null;
  /** `Date.now()`. */
  readonly now: number;
  /** `--refresh`: measure anyway and overwrite. */
  readonly refresh: boolean;
}

/**
 * Whether a stored measurement answers this lane's question.
 *
 * Every refusal names what did not match, because the alternative is a lane
 * paying thirty minutes and never learning why it was not given the answer that
 * was sitting on disk.
 */
export function decideReuse({ wanted, stored, now, refresh }: ReuseInput): Reuse {
  if (refresh) {
    return { kind: 'measure', why: '--refresh was asked for, so the stored verdict is ignored and replaced' };
  }
  if (stored === null) {
    return { kind: 'measure', why: `nothing recorded for ${wanted.baseSha.slice(0, 8)} under this identity` };
  }
  if (!sameIdentity(stored.identity, wanted)) {
    return {
      kind: 'measure',
      why:
        `the record filed under this identity is about a different one ` +
        `(${describeIdentity(stored.identity)}), so it is not an answer to ${describeIdentity(wanted)}`,
    };
  }
  const age = now - Date.parse(stored.measuredAt);
  if (!Number.isFinite(age)) {
    return { kind: 'measure', why: `the record's measuredAt (${stored.measuredAt}) is not a date` };
  }
  if (age > MEASUREMENT_TTL_MS) {
    const hours = Math.round(age / (60 * 60 * 1000));
    return {
      kind: 'measure',
      why: `the record is ${hours}h old, past the ${MEASUREMENT_TTL_MS / 3_600_000}h it stands for`,
    };
  }
  return {
    kind: 'reuse',
    why:
      `${wanted.baseSha.slice(0, 8)} was measured ${stored.outcome} at ${stored.measuredAt} by ` +
      `${stored.measuredBy}, on the same suite, artifacts and runtime`,
    record: stored,
  };
}

/**
 * ## Review verdicts are keyed by tree, not by commit
 *
 * `--stage review` runs the identical lane suite `--stage preflight` runs, and
 * today it runs it again on a fast-forward: when the base has not moved since
 * the lane branched, merging is a fast-forward and the landing run measures the
 * exact tree the lane's own review step already measured. Measured 2026-09-18:
 * the landing run for two stacked branches took over 30 minutes of 8 workers.
 *
 * `BaseIdentity` cannot be reused for this as-is, because its key question is
 * "was this base sha green", answered once per sha; the review question is "was
 * this content green", which a rename or a rebase changes the sha of without
 * changing the answer. So the key is `git rev-parse HEAD^{tree}` — the content
 * built — in place of the commit that happens to name it.
 *
 * One field has no analogue on the base side: whether
 * `MTG_REQUIRE_FORGE_BRIDGE=1` was set. Every `bridge-*.integration.test.ts`
 * file treats that env var as the difference between "run the Forge bridge
 * assertions" and "skip them if Forge is unavailable", so a run that skipped
 * them is not the run a landing decision may stand in for. It is part of the
 * identity for the same reason artifact presence is: two runs that differ in it
 * are not the same question, whatever their tree hash says.
 *
 * Suite, artifacts and runtime carry the same meaning and the same reasoning as
 * `BaseIdentity`'s; see the module docblock above.
 */
export interface ReviewIdentity {
  /** `git rev-parse HEAD^{tree}`. The content, not the commit that names it. */
  readonly tree: string;
  readonly suite: string;
  readonly bar: GateBar;
  readonly changedFiles: readonly string[];
  readonly artifacts: readonly string[];
  readonly runtime: string;
  /** Whether `MTG_REQUIRE_FORGE_BRIDGE=1` was set for this run. */
  readonly forgeBridge: boolean;
}

/** A recorded measurement of one review identity. Same shape as `BaseRecord`. */
export interface ReviewRecord {
  readonly identity: ReviewIdentity;
  readonly outcome: 'green' | 'red';
  readonly reason: string;
  readonly redFiles: readonly string[];
  readonly selectedTestFiles: readonly string[];
  /** See `BaseRecord.load`. */
  readonly load?: LoadAttribution | undefined;
  readonly measuredAt: string;
  readonly durationMs: number;
  readonly measuredBy: string;
}

/** The review identity's address in the store. Mirrors `identityDigest`. */
export function reviewIdentityDigest(identity: ReviewIdentity): string {
  const canonical = [
    `tree=${identity.tree}`,
    `suite=${identity.suite}`,
    `bar=${identity.bar}`,
    `changedFiles=${[...identity.changedFiles].sort().join(',')}`,
    `artifacts=${[...identity.artifacts].sort().join(',')}`,
    `runtime=${identity.runtime}`,
    `forgeBridge=${identity.forgeBridge}`,
  ].join('\n');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** Whether two review identities are the same question. Mirrors `sameIdentity`. */
export function sameReviewIdentity(left: ReviewIdentity, right: ReviewIdentity): boolean {
  return (
    left.tree === right.tree &&
    left.suite === right.suite &&
    left.bar === right.bar &&
    [...left.changedFiles].sort().join(',') === [...right.changedFiles].sort().join(',') &&
    left.runtime === right.runtime &&
    left.forgeBridge === right.forgeBridge &&
    [...left.artifacts].sort().join(',') === [...right.artifacts].sort().join(',')
  );
}

export type ReviewReuse =
  | { readonly kind: 'reuse'; readonly why: string; readonly record: ReviewRecord }
  | { readonly kind: 'measure'; readonly why: string };

/** What a caller knows when it asks whether it may skip the review run. */
export interface ReviewReuseInput {
  readonly wanted: ReviewIdentity;
  readonly stored: ReviewRecord | null;
  readonly now: number;
  readonly refresh: boolean;
}

/**
 * Whether a stored review measurement answers this run's question.
 *
 * Same TTL, same refresal shape as `decideReuse` — duplicated rather than
 * shared because the identity fields differ (`tree` and `forgeBridge` have no
 * analogue in `BaseIdentity`), and a generic version would have to reconstruct
 * the field-by-field comparison `sameReviewIdentity` already states plainly.
 */
export function decideReviewReuse({ wanted, stored, now, refresh }: ReviewReuseInput): ReviewReuse {
  if (refresh) {
    return { kind: 'measure', why: '--refresh was asked for, so the stored verdict is ignored and replaced' };
  }
  if (stored === null) {
    return {
      kind: 'measure',
      why: `nothing recorded for tree ${wanted.tree.slice(0, 8)} under this identity`,
    };
  }
  if (!sameReviewIdentity(stored.identity, wanted)) {
    return {
      kind: 'measure',
      why:
        `the record filed under this identity is about a different one ` +
        `(${describeReviewIdentity(stored.identity)}), so it is not an answer to ${describeReviewIdentity(wanted)}`,
    };
  }
  const age = now - Date.parse(stored.measuredAt);
  if (!Number.isFinite(age)) {
    return { kind: 'measure', why: `the record's measuredAt (${stored.measuredAt}) is not a date` };
  }
  if (age > MEASUREMENT_TTL_MS) {
    const hours = Math.round(age / (60 * 60 * 1000));
    return {
      kind: 'measure',
      why: `the record is ${hours}h old, past the ${MEASUREMENT_TTL_MS / 3_600_000}h it stands for`,
    };
  }
  return {
    kind: 'reuse',
    why:
      `tree ${wanted.tree.slice(0, 8)} was measured ${stored.outcome} at ${stored.measuredAt} by ` +
      `${stored.measuredBy}, on the same suite, artifacts, runtime and Forge-bridge requirement`,
    record: stored,
  };
}

function describeReviewIdentity(identity: ReviewIdentity): string {
  const artifacts =
    identity.artifacts.length === 0 ? 'no artifacts' : [...identity.artifacts].sort().join('+');
  return `${identity.tree.slice(0, 8)} / ${identity.bar} / ${identity.changedFiles.length} changed / ${identity.suite} / ${artifacts} / ${identity.runtime} / forgeBridge=${identity.forgeBridge}`;
}

/**
 * The red files a review run carries beyond what the base already recorded.
 *
 * This is the landing bar stated as data: a lead merging a branch whose base
 * was already red does not need every file green, only no failed file the base
 * did not already have. Today that set difference is computed by hand from two
 * summaries; this is the one function behind it, so `cli.ts` prints it and a
 * test can hold it to the rule directly.
 *
 * A `null` or green base record means nothing is exempted, so every review red
 * file is new. A red base record exempts exactly its `redFiles` — not "the base
 * was red so anything goes", because a review red file absent from the base's
 * own list is still a regression this branch introduced.
 */
export function newRedFiles(
  reviewRedFiles: readonly string[],
  baseRecord: BaseRecord | null,
): readonly string[] {
  if (baseRecord === null || baseRecord.outcome === 'green') return [...reviewRedFiles];
  const exempt = new Set(baseRecord.redFiles);
  return reviewRedFiles.filter((file) => !exempt.has(file));
}

/** An exit code and the sentence that says why the gate chose it. */
export interface ExitDecision {
  readonly exitCode: number;
  readonly why: string;
}

/**
 * The preflight exit code once the base has been measured or a recorded verdict
 * reused.
 *
 * Red exits 0. `mol-scoped-work` runs this at `preflight-tests` with
 * `gc.on_fail = "abort_scope"`, so a non-zero exit killed every lane dispatched
 * on a red main before it wrote a line, and left each worker to override the
 * step by hand. The landing bar never asked for a green base, only that the lane
 * add no red file the base lacks, and review enforces that against the list
 * preflight prints. A run that recorded nothing (`decideRecording` discarded it:
 * timeout-only, or a lost worker) is not a measurement of the base, so it keeps
 * the suite's own exit code.
 */
export function decidePreflightExit(exitCode: number, baseline: 'recorded' | 'unrecorded'): ExitDecision {
  if (baseline === 'unrecorded') {
    return { exitCode, why: 'no base verdict was recorded, so the suite exit code stands' };
  }
  return exitCode === 0
    ? { exitCode: 0, why: 'the base is green' }
    : {
        exitCode: 0,
        why:
          'the base is red on the list above; that does not stop this lane, and review fails ' +
          'only on a red file outside it',
      };
}

/**
 * The review exit code: the landing bar as an exit status.
 *
 * Green exits 0. Red exits 0 only when every red file is on the base's recorded
 * red list; a file outside it exits 1 and is named. Three reds cannot be
 * attributed to a file and keep exiting 1: no recorded base verdict (there is
 * nothing to compare to, and it says so), a non-zero run with no red file (the
 * typechecker refused the tree, or a worker was lost), and a recorded base that
 * was green (every red file is new).
 */
export function decideReviewExit(
  exitCode: number,
  reviewRedFiles: readonly string[],
  baseRecord: BaseRecord | null,
): ExitDecision {
  if (exitCode === 0) return { exitCode: 0, why: 'the suite passed' };
  if (baseRecord === null) {
    return { exitCode, why: 'the base was never recorded, so there is no red list to compare against' };
  }
  if (reviewRedFiles.length === 0) {
    return {
      exitCode,
      why: 'the run failed with no red file to attribute (the typechecker or a lost worker), so it cannot be excused',
    };
  }
  const introduced = newRedFiles(reviewRedFiles, baseRecord);
  if (introduced.length === 0) {
    return { exitCode: 0, why: 'every red file is already red on the recorded base' };
  }
  return {
    exitCode: 1,
    why: `${introduced.length} red file(s) outside the recorded base: ${introduced.join(', ')}`,
  };
}

export type Recording =
  { readonly kind: 'record'; readonly why: string } | { readonly kind: 'discard'; readonly why: string };

/** What the typechecker did, as the process reported it and as it printed. */
export interface TypecheckRun {
  /** The exit status, or `null` when the process produced none: a signal killed it, or it never started. */
  readonly status: number | null;
  /** The signal that killed it, or `null`. */
  readonly signal: string | null;
  /** Everything it wrote to stdout and stderr, in the order it arrived. */
  readonly output: string;
}

/**
 * What a typecheck run says about the tree.
 *
 * Three answers rather than pass and fail, because a failed run is two different
 * things: the typechecker saying the tree is wrong, and the run ending for a
 * reason that is not about the tree.
 */
export type TypecheckJudgment =
  | { readonly kind: 'passed' }
  | {
      readonly kind: 'refused';
      /** The first line the run printed that names a TypeScript error, trimmed. */
      readonly firstDiagnostic: string;
    }
  | { readonly kind: 'unreliable'; readonly why: string };

/** `tsc` prints `path(1,2): error TS2322: ...`, or `error TS5023: ...` when no file is at fault. */
const TS_DIAGNOSTIC = /\berror TS\d+:/u;

/** Enough of a diagnostic to name the fault; `tsc` messages can run to paragraphs. */
const MAX_DIAGNOSTIC_CHARS = 300;

/**
 * Whether a typecheck run is a fact about the tree.
 *
 * A refusal is a fact when the process exited with a status and printed at least
 * one TypeScript error, because that is the checker saying something the tree
 * caused. A signal death, a process that never started and a non-zero exit with
 * no diagnostic (a missing `node_modules`, an out-of-memory kill the wrapper
 * reported as a status) are all a run that ended, and the tree may be clean.
 */
export function judgeTypecheck(run: TypecheckRun): TypecheckJudgment {
  if (run.signal !== null) {
    return {
      kind: 'unreliable',
      why: `the typechecker was killed by ${run.signal}, which is the box ending the run and says nothing about the tree`,
    };
  }
  if (run.status === null) {
    return { kind: 'unreliable', why: 'the typechecker produced no exit status, so it did not finish' };
  }
  if (run.status === 0) return { kind: 'passed' };
  const firstDiagnostic = run.output.split('\n').find((line) => TS_DIAGNOSTIC.test(line));
  if (firstDiagnostic === undefined) {
    return {
      kind: 'unreliable',
      why: `the typechecker exited ${run.status} and printed no TypeScript error, so nothing deterministic said the tree is wrong`,
    };
  }
  return { kind: 'refused', firstDiagnostic: firstDiagnostic.trim().slice(0, MAX_DIAGNOSTIC_CHARS) };
}

/** What a finished run looked like, as plain data a test can build. */
export interface RunOutcome {
  /** The process exit code of the run: the typechecker's when it stopped the run, otherwise the suite's. */
  readonly exitCode: number;
  /**
   * What `tsc --noEmit` said.
   *
   * Its own field because it is red before a single test runs, so the test-file
   * reasoning below would see a non-zero exit with no failed file and discard a
   * genuinely red base as a lost worker. Anything but `passed` means no test ran.
   */
  readonly typecheck: TypecheckJudgment;
  /** Every failed file, relative to the repo root. */
  readonly redFiles: readonly string[];
  /** The subset of `redFiles` whose every failure was a clock. `classifyTimeoutOnly`'s answer. */
  readonly timeoutOnlyFiles: readonly string[];
  readonly testStartFailure?: string | undefined;
}

/**
 * Whether this run may be written down as a fact about the sha.
 *
 * The asymmetry is the point and the module docblock argues it: green is always
 * a fact, red is a fact only when something deterministic said so.
 */
export function decideRecording(outcome: RunOutcome): Recording {
  if (outcome.typecheck.kind === 'refused') {
    return {
      kind: 'record',
      why:
        `the typechecker refused the tree (${outcome.typecheck.firstDiagnostic}), which is a property ` +
        'of the tree and not of the box it ran on',
    };
  }
  if (outcome.typecheck.kind === 'unreliable') {
    return {
      kind: 'discard',
      why: `${outcome.typecheck.why}; recording it would file the box's condition as the base's (mtg-urbjc)`,
    };
  }
  if (outcome.exitCode === 0) {
    return { kind: 'record', why: 'the suite passed, and load cannot make a failing test pass' };
  }
  if (outcome.testStartFailure !== undefined) {
    return { kind: 'discard', why: `the test command failed to start: ${outcome.testStartFailure}` };
  }
  if (outcome.redFiles.length === 0) {
    return {
      kind: 'discard',
      why:
        'the run exited non-zero with no failed file, which is the run losing a worker or a ' +
        'collection throwing rather than the base being red (see test-load/unaccounted.ts)',
    };
  }
  const asserted = outcome.redFiles.filter((file) => !outcome.timeoutOnlyFiles.includes(file));
  if (asserted.length === 0) {
    return {
      kind: 'discard',
      why:
        `all ${outcome.redFiles.length} failed file(s) were timeout-only, which on this box is ` +
        'oversubscription rather than a red base; recording it would abort every later lane on this sha',
    };
  }
  return {
    kind: 'record',
    why: `${asserted.length} of ${outcome.redFiles.length} failed file(s) failed an assertion rather than a clock`,
  };
}

/** What the working tree is, as far as recording a verdict cares. */
export interface TreeState {
  readonly headSha: string;
  readonly baseSha: string;
  /** `git status --porcelain`, one entry per line. Ignored files are not in it. */
  readonly dirtyPaths: readonly string[];
}

export type MayRecord = { readonly ok: true } | { readonly ok: false; readonly why: string };

/**
 * Whether what was measured is actually the sha the verdict would be filed under.
 *
 * Nothing else checks this, and without it the store is one hand-typed flag away
 * from a lie that costs every later lane on the sha. `--stage preflight` in a
 * checkout three commits ahead would measure that checkout and record the
 * answer against the merge-base; a tree with uncommitted edits would record
 * their effect as a property of the commit.
 *
 * At a real `preflight-tests` this always holds, because `workspace-setup` has
 * just branched at the base ref and touched nothing. So this refuses only the
 * cases that were never preflight, and it refuses *recording* rather than
 * running: measuring a tree that is not the base is a fine thing to do, and
 * publishing the result as though it were about the base is not.
 *
 * Reuse is deliberately not gated on it. "Was this base red" is answered
 * correctly by a record about that base whatever the asking tree looks like.
 */
export function mayRecord(tree: TreeState): MayRecord {
  if (tree.headSha !== tree.baseSha) {
    return {
      ok: false,
      why:
        `this tree is at ${tree.headSha.slice(0, 8)} and the verdict would be filed under ` +
        `${tree.baseSha.slice(0, 8)}, so it would be a measurement of something else`,
    };
  }
  if (tree.dirtyPaths.length > 0) {
    const shown = tree.dirtyPaths.slice(0, 3).join(', ');
    const more = tree.dirtyPaths.length > 3 ? ` and ${tree.dirtyPaths.length - 3} more` : '';
    return {
      ok: false,
      why: `this tree has uncommitted changes (${shown}${more}), which are not part of ${tree.baseSha.slice(0, 8)}`,
    };
  }
  return { ok: true };
}

export type Stage = 'preflight' | 'review';

export interface StageVerdict {
  readonly stage: Stage;
  readonly why: string;
}

/**
 * Which half of the lane this run is, derived rather than passed.
 *
 * `city.toml` gives this rig one `test_command` and `mol-scoped-work` spends it
 * at both `preflight-tests` and `self-review`, so a stage-dependent command has
 * to work out for itself which one it is in. Commits ahead of the base is the
 * discriminant: `workspace-setup` branches at the base ref, so preflight runs
 * at zero, and nothing reaches review without having committed something.
 *
 * A review that is somehow at zero commits is a branch with nothing in it, and
 * the base verdict is the correct answer to that too, so the ambiguous case
 * fails into the right behavior rather than into a guess. `--stage` overrides
 * for anyone running this by hand.
 */
export function stageFrom(commitsAhead: number): StageVerdict {
  if (commitsAhead === 0) {
    return {
      stage: 'preflight',
      why: 'this worktree is at the base ref with no commits of its own',
    };
  }
  return {
    stage: 'review',
    why: `this worktree is ${commitsAhead} commit(s) ahead of the base ref`,
  };
}

function describeIdentity(identity: BaseIdentity): string {
  const artifacts =
    identity.artifacts.length === 0 ? 'no artifacts' : [...identity.artifacts].sort().join('+');
  return `${identity.baseSha.slice(0, 8)} / ${identity.suite} / ${artifacts} / ${identity.runtime}`;
}
