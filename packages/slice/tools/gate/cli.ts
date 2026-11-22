/**
 * The repo gate, which is what a lane runs instead of `npm run typecheck && npm test`.
 *
 * ```
 * npm run gate                       # what city.toml's test_command calls, at both stages
 * npm run gate -- --refresh          # measure the base (or, at review, the tree) again and replace what is stored
 * npm run gate -- --show             # print the stored base verdict and stop
 * npm run gate -- --show --tree <rev> # print the stored review verdict for <rev>'s tree and stop
 * ```
 *
 * At **review** it answers from `store.ts` when this exact tree — content, not
 * commit, `git rev-parse HEAD^{tree}` — has already been measured under the
 * same suite, artifacts, runtime and `MTG_REQUIRE_FORGE_BRIDGE` setting, and
 * measures when it has not (`mtg-wq3q8.1`: a fast-forward merge leaves the
 * lane's own review run and the landing run measuring the identical tree, and
 * the second run used to always happen anyway). A red review verdict prints the
 * files that are red here and not already red on the recorded base — the
 * landing bar, computed rather than eyeballed from two summaries.
 *
 * Neither stage runs the balance simulations or the calibration pipeline.
 * `suites.ts` holds that split and the reason for it; the short version is that
 * both answer a question about what is being merged rather than about a lane's
 * intermediate commit, and they are the largest cost on this host. They run once
 * over the merged content, as `npm run gate:merge`. Nothing merges without that,
 * which is the safety property this whole change keeps.
 *
 * At **preflight** it answers from `store.ts` when the base sha has already been
 * measured under the same suite, artifacts and runtime, and measures when it has
 * not. `verdict.ts` holds every judgment in that sentence and the argument for
 * each; this file is the git, the subprocesses and the waiting.
 *
 * ## The exit code is the landing bar
 *
 * `mol-scoped-work` spends this command at `preflight-tests` (whose failure
 * aborts the scope) and again at review, and main has been red on a recorded
 * list for days. A non-zero preflight therefore killed every lane dispatched on
 * that base before it wrote a line, and left each worker to override the step by
 * hand. So the exit code follows what the landing bar says: **preflight exits 0
 * once the base has a verdict, green or red**, and prints the red list;
 * **review exits 0 when every red file is on the base's recorded red list and 1
 * when a file outside it is red**, naming each. A red base no longer stops a
 * lane, because the lane is held to adding no red file the base lacks, and that
 * is checked at review. `verdict.ts` holds both decisions; a run with no
 * recorded base verdict, or a red that names no file, keeps exiting 1.
 *
 * The stage is derived rather than passed because `city.toml` gives this rig one
 * `test_command` and `mol-scoped-work` spends it at both steps. `--stage`
 * overrides for a human.
 *
 * ## A gate run from outside a lane refuses beside a live one
 *
 * `mtg-vxbbi`. `live-lanes.ts` names every live mtg-worker lane on this host; a
 * gate that is not itself running inside a worker session refuses to measure
 * while one is live, exiting **3**, rather than risk the false-red load voids
 * `CLAUDE.md`'s "one full suite at a time" rule exists to prevent. `--beside-lanes`
 * overrides, off by default, for the case where the run touches no file the
 * suite reads.
 *
 * ## The artifact check runs before anything else
 *
 * `mtg-d9cu1` cost a P0 lane and a false escalation to the mayor: a per-bead
 * worktree has neither the card store nor the Forge install, both gitignored,
 * and the ~29 tests that go red on their absence were read as a red base. That
 * is a worse failure than a slow one, so the gate says it in one line at the
 * top of the run rather than leaving it to be re-derived from a red summary.
 * It is a warning and not a refusal: a tree without those artifacts can still
 * be measured, and what it must not do is share a verdict with a tree that has
 * them, which the identity already prevents.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  POLL_INTERVAL_MS,
  WAIT_BUDGET_MS,
  gateHome,
  readRecord,
  readReviewRecord,
  releaseClaim,
  reviewRecordsForTree,
  takeClaim,
  writeRecord,
  writeReviewRecord,
} from './store';
import { LoadAttributionSchema, describeReds, type LoadAttribution } from './load';
import { LIVE_LANE_REFUSAL_EXIT_CODE, checkLiveLanes, readLiveProcessTable } from './live-lanes';
import type { GateOutcomeFile } from './outcome-reporter';
import { laneSuiteText, laneTestCommand } from './suites';
import { barForChangedFiles, directReaderTestFiles, relatedTestCommand, type GateBar } from './scope';
import { runTypecheck } from './typecheck';
import {
  POLL_INTERVAL_MS as HOST_LOCK_POLL_INTERVAL_MS,
  WAIT_BUDGET_MS as HOST_LOCK_WAIT_BUDGET_MS,
  acquireOrWait,
  release as releaseHostLock,
  sleepSync,
  testLockPath,
} from '../test-load/host-lock';
import {
  type BaseIdentity,
  type BaseRecord,
  type ReviewIdentity,
  type ReviewRecord,
  type RunOutcome,
  GATED_ARTIFACTS,
  decidePreflightExit,
  decideRecording,
  decideReviewExit,
  decideReuse,
  decideReviewReuse,
  identityDigest,
  judgeTypecheck,
  mayRecord,
  newRedFiles,
  reviewIdentityDigest,
  stageFrom,
} from './verdict';
import { git } from './git';

/** The suite the gate stands for. Its text is part of the identity, so it is one string. */
const SUITE = laneSuiteText();

const TYPECHECK = ['npm', 'run', 'typecheck'];
const LINT = ['npm', 'run', 'lint'];
const TESTS = laneTestCommand();

function run(command: readonly string[], env: NodeJS.ProcessEnv): number {
  const [bin, ...args] = command;
  if (bin === undefined) throw new Error('empty command');
  const result = spawnSync(bin, args, { stdio: 'inherit', env });
  return result.status ?? 1;
}

function runTests(
  command: readonly string[],
  env: NodeJS.ProcessEnv,
): { readonly status: number; readonly error: string | undefined } {
  const [bin, ...args] = command;
  if (bin === undefined) throw new Error('empty command');
  const result = spawnSync(bin, args, { stdio: 'inherit', env });
  return { status: result.status ?? 1, error: result.error?.message };
}

/** Which gated artifacts this tree actually has, sorted. */
function presentArtifacts(root: string): string[] {
  return GATED_ARTIFACTS.filter((path) => existsSync(join(root, path))).sort();
}

function readOutcomeFile(path: string): GateOutcomeFile {
  const empty: GateOutcomeFile = { redFiles: [], timeoutOnlyFiles: [], selectedTestFiles: [], load: null };
  if (!existsSync(path)) return empty;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const shape = parsed as Partial<GateOutcomeFile>;
    // The attribution only explains a verdict, so one that does not parse is dropped and the
    // red list beside it is kept.
    const load = LoadAttributionSchema.safeParse(shape.load);
    return {
      redFiles: Array.isArray(shape.redFiles) ? shape.redFiles : [],
      timeoutOnlyFiles: Array.isArray(shape.timeoutOnlyFiles) ? shape.timeoutOnlyFiles : [],
      selectedTestFiles: Array.isArray(shape.selectedTestFiles) ? shape.selectedTestFiles : [],
      load: load.success ? load.data : null,
    };
  } catch {
    return empty;
  }
}

/**
 * Take the host-wide suite lock (`../test-load/host-lock.ts`) before measuring,
 * so this lane's full run is not itself the second suite contending for the
 * box. `MTG_TEST_WORKERS` skips it: pinning a worker count is a stated choice
 * to share rather than wait, the same escape hatch `with-lock.ts` honors for
 * ad hoc `npm test`.
 */
function acquireHostLock(path: string): boolean {
  if (process.env.MTG_TEST_WORKERS !== undefined && process.env.MTG_TEST_WORKERS !== '') return false;
  const outcome = acquireOrWait(path, `gate pid ${process.pid} in ${process.cwd()}`, {
    deadlineMs: Date.now() + HOST_LOCK_WAIT_BUDGET_MS,
    pollMs: HOST_LOCK_POLL_INTERVAL_MS,
    sleep: sleepSync,
    onWaiting: (holder) =>
      process.stdout.write(
        `gate: another full suite on this host is running (${holder.label}, since ${holder.startedAt}); ` +
          `waiting up to ${Math.round(HOST_LOCK_WAIT_BUDGET_MS / 60_000)}m rather than measuring beside it. ` +
          'Set MTG_TEST_WORKERS to share the box instead of waiting.\n',
      ),
  });
  if (!outcome.acquired) {
    process.stdout.write('gate: the host lock wait ran out; measuring anyway rather than waiting forever.\n');
  }
  return outcome.acquired;
}

/** Run the suite and report what it did, in the shape `decideRecording` reads. */
async function measure(
  testCommand: readonly string[],
  lint: boolean,
): Promise<{
  outcome: RunOutcome;
  /** What the run attributed its red files to; `null` when it attributed nothing. */
  load: LoadAttribution | null;
  durationMs: number;
  selectedTestFiles: readonly string[];
}> {
  const started = Date.now();
  const typecheckRun = await runTypecheck(TYPECHECK, process.env);
  const typecheck = judgeTypecheck(typecheckRun);
  if (typecheck.kind !== 'passed') {
    return {
      outcome: { exitCode: typecheckRun.status ?? 1, typecheck, redFiles: [], timeoutOnlyFiles: [] },
      load: null,
      durationMs: Date.now() - started,
      selectedTestFiles: [],
    };
  }
  if (lint) {
    const lintStatus = run(LINT, process.env);
    if (lintStatus !== 0) {
      return {
        outcome: { exitCode: lintStatus, typecheck, redFiles: [], timeoutOnlyFiles: [] },
        load: null,
        durationMs: Date.now() - started,
        selectedTestFiles: [],
      };
    }
  }
  const scratch = mkdtempSync(join(tmpdir(), 'mtg-gate-'));
  const outcomePath = join(scratch, 'outcome.json');
  const lockPath = testLockPath();
  const holdingHostLock = acquireHostLock(lockPath);
  try {
    const testRun = runTests(testCommand, { ...process.env, MTG_GATE_OUTCOME: outcomePath });
    const hasOutcome = existsSync(outcomePath);
    const file = readOutcomeFile(outcomePath);
    const testStartFailure =
      !hasOutcome && (testRun.status === 249 || testRun.error !== undefined)
        ? (testRun.error ?? `exit ${testRun.status} with no outcome file`)
        : undefined;
    return {
      outcome: {
        exitCode: testRun.status,
        typecheck,
        redFiles: file.redFiles,
        timeoutOnlyFiles: file.timeoutOnlyFiles,
        ...(testStartFailure === undefined ? {} : { testStartFailure }),
      },
      load: file.load,
      durationMs: Date.now() - started,
      selectedTestFiles: file.selectedTestFiles,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    if (holdingHostLock) releaseHostLock(lockPath);
  }
}

function describeRecord(record: BaseRecord | ReviewRecord): string {
  const scope =
    'selectedTestFiles' in record
      ? `\n  bar: ${record.identity.bar}\n  changed: ${record.identity.changedFiles.join(', ') || '(none)'}\n  selected: ${record.selectedTestFiles.join(', ') || '(none)'}`
      : '';
  return `  ${record.outcome.toUpperCase()} — ${record.reason}${scope}${describeReds(record.redFiles, record.load)}`;
}

function changedFilesFrom(baseSha: string): string[] {
  const output = git(['diff', '--name-only', '--diff-filter=ACDMR', `${baseSha}...HEAD`]);
  return output === '' ? [] : [...new Set(output.split('\n'))].sort();
}

function reviewSuite(bar: GateBar): string {
  return bar === 'full'
    ? `npm run typecheck && npm run lint && ${TESTS.join(' ')}`
    : 'npm run typecheck && npm run lint && node_modules/.bin/vitest related --run --project unit --project browser';
}

/**
 * Print the landing bar for a red review verdict: the files that are red here
 * and not already red on the base, per `verdict.ts`'s `newRedFiles`. This is
 * the diff a lead used to compute by hand from two summaries.
 */
function printLandingBar(reviewRedFiles: readonly string[], baseRecord: BaseRecord | null): void {
  if (baseRecord === null) {
    process.stdout.write(
      'gate: the base was never recorded, so there is no red list to compare this run against.\n',
    );
    return;
  }
  const introduced = newRedFiles(reviewRedFiles, baseRecord);
  if (introduced.length === 0) {
    process.stdout.write(
      'gate: every red file here is already red on the recorded base; the landing bar is no failed ' +
        'file the base does not already have, and this run adds none.\n',
    );
    return;
  }
  process.stdout.write(
    `gate: ${introduced.length} red file(s) outside the base's recorded verdict — the landing bar:\n` +
      `  ${introduced.join('\n  ')}\n`,
  );
}

/**
 * Wait for whoever holds the claim to finish, then read what they wrote.
 *
 * Returns the record they filed, or `null` when the wait ran out or they filed
 * nothing (a timeout-only red records nothing by design, and then this lane
 * measures rather than inheriting a silence).
 */
function waitForHolder(home: string, digest: string, deadline: number): BaseRecord | null {
  process.stdout.write(
    `gate: another lane on this host is measuring this base; waiting up to ` +
      `${Math.round(WAIT_BUDGET_MS / 60_000)}m rather than running a second full suite beside it\n`,
  );
  while (Date.now() < deadline) {
    sleepSync(POLL_INTERVAL_MS);
    const record = readRecord(home, digest);
    if (record !== null) return record;
    const claim = takeClaim(home, digest, process.cwd(), Date.now());
    if (claim !== null) return null;
  }
  return null;
}

function exitPreflight(exitCode: number, baseline: 'recorded' | 'unrecorded'): number {
  const decision = decidePreflightExit(exitCode, baseline);
  process.stdout.write(`gate: preflight exits ${decision.exitCode} — ${decision.why}\n`);
  return decision.exitCode;
}

function exitReview(exitCode: number, redFiles: readonly string[], baseRecord: BaseRecord | null): number {
  const decision = decideReviewExit(exitCode, redFiles, baseRecord);
  process.stdout.write(`gate: review exits ${decision.exitCode} — ${decision.why}\n`);
  return decision.exitCode;
}

/**
 * Checked right before each stage actually measures — never on a reuse
 * answer or `--show`, both of which spend nothing. Returns the exit code to
 * use if the run must refuse, or `null` to proceed.
 */
function refuseIfBesideLiveLanes(besideLanes: boolean): number | null {
  const check = checkLiveLanes(process.env, readLiveProcessTable(), besideLanes);
  if (check.message !== '') process.stdout.write(check.message);
  return check.ok ? null : LIVE_LANE_REFUSAL_EXIT_CODE;
}

export async function main(argv: readonly string[]): Promise<number> {
  const root = process.cwd();
  const baseRef = valueOf(argv, '--base') ?? 'origin/main';
  const treeArg = valueOf(argv, '--tree');
  const refresh = argv.includes('--refresh');
  const showOnly = argv.includes('--show');
  const stageOverride = valueOf(argv, '--stage');
  const besideLanes = argv.includes('--beside-lanes');

  const artifacts = presentArtifacts(root);
  const missing = GATED_ARTIFACTS.filter((path) => !artifacts.includes(path));
  if (missing.length > 0) {
    process.stdout.write(
      `gate: this tree is missing ${missing.join(' and ')}, which are gitignored and absent from a ` +
        `fresh worktree. Tests that need them will be red here and green elsewhere at the same sha ` +
        `(mtg-d9cu1). That is in this verdict's identity, so it is never shared with a tree that has them.\n`,
    );
  }

  const home = gateHome();
  const forgeBridge = process.env.MTG_REQUIRE_FORGE_BRIDGE === '1';

  // `--show --tree` reads a review verdict and stops, mirroring `--show --base`
  // below; it needs none of the base/stage machinery, only the identity for the
  // named tree under this environment.
  if (showOnly && treeArg !== undefined) {
    const tree = git(['rev-parse', `${treeArg}^{tree}`]);
    const stored = reviewRecordsForTree(home, tree).filter(
      (record) =>
        record.identity.artifacts.length === artifacts.length &&
        record.identity.artifacts.every((artifact, at) => artifact === artifacts[at]) &&
        record.identity.runtime === process.version &&
        record.identity.forgeBridge === forgeBridge,
    );
    if (stored.length === 0) {
      process.stdout.write(`gate: nothing stored for tree ${tree.slice(0, 8)} under this environment\n`);
      return 0;
    }
    for (const record of stored) {
      process.stdout.write(`gate: ${reviewIdentityDigest(record.identity)}\n${describeRecord(record)}\n`);
    }
    return 0;
  }

  const baseSha = git(['merge-base', baseRef, 'HEAD']);
  const commitsAhead = Number(git(['rev-list', '--count', `${baseSha}..HEAD`]));
  const derived = stageFrom(commitsAhead);
  const stage = stageOverride === 'preflight' || stageOverride === 'review' ? stageOverride : derived.stage;
  const why = stageOverride === undefined ? derived.why : `--stage ${stageOverride} was passed`;
  process.stdout.write(`gate: ${stage} — ${why}\n`);

  const baseIdentity: BaseIdentity = { baseSha, suite: SUITE, artifacts, runtime: process.version };
  const baseDigest = identityDigest(baseIdentity);
  const storedBase = readRecord(home, baseDigest);

  // Before the stage branches, because `--show` is a question about the store
  // and answering it by running a thirty-minute suite would be absurd. It is
  // also the only way to read a base verdict from a tree that is past preflight.
  if (showOnly) {
    process.stdout.write(
      storedBase === null
        ? `gate: nothing stored for ${baseSha.slice(0, 8)} under ${baseDigest}\n`
        : `gate: ${baseDigest}\n${describeRecord(storedBase)}\n`,
    );
    return 0;
  }

  if (stage === 'review') {
    const tree = git(['rev-parse', 'HEAD^{tree}']);
    const changedFiles = changedFilesFrom(baseSha);
    const bar = barForChangedFiles(changedFiles);
    const directReaders = directReaderTestFiles(root, changedFiles);
    const testCommand =
      bar === 'full' ? TESTS : relatedTestCommand(changedFiles, directReaders, ['unit', 'browser']);
    const reviewIdentity: ReviewIdentity = {
      tree,
      suite: reviewSuite(bar),
      bar,
      changedFiles,
      artifacts,
      runtime: process.version,
      forgeBridge,
    };
    const reviewDigest = reviewIdentityDigest(reviewIdentity);
    const storedReview = readReviewRecord(home, reviewDigest);

    const reviewReuse = decideReviewReuse({
      wanted: reviewIdentity,
      stored: storedReview,
      now: Date.now(),
      refresh,
    });
    if (reviewReuse.kind === 'reuse') {
      process.stdout.write(
        `gate: reusing a recorded review verdict — ${reviewReuse.why}\n${describeRecord(reviewReuse.record)}\n`,
      );
      if (reviewReuse.record.outcome === 'red') {
        printLandingBar(reviewReuse.record.redFiles, storedBase);
      }
      return exitReview(
        reviewReuse.record.outcome === 'green' ? 0 : 1,
        reviewReuse.record.redFiles,
        storedBase,
      );
    }
    process.stdout.write(
      `gate: measuring ${bar} review — ${reviewReuse.why}. Changed files: ` +
        `${changedFiles.join(', ') || '(none)'}. The balance and calibration projects are selected ` +
        'separately by `npm run gate:merge`.\n',
    );

    // Review always measures HEAD, so `mayRecord`'s "is this tree the sha the
    // verdict would be filed under" check is trivially satisfied — passing the
    // same value for both sides of it reduces it to the one check that still
    // applies here: a dirty tree records nothing.
    const dirtyPaths = git(['status', '--porcelain'])
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter((path) => path !== '');
    const mayRecordReview = mayRecord({ headSha: tree, baseSha: tree, dirtyPaths });
    if (!mayRecordReview.ok) {
      process.stdout.write(`gate: this run will not be recorded — ${mayRecordReview.why}\n`);
    }

    const reviewLaneRefusal = refuseIfBesideLiveLanes(besideLanes);
    if (reviewLaneRefusal !== null) return reviewLaneRefusal;

    const { outcome, load, durationMs, selectedTestFiles } = await measure(testCommand, true);
    const recording = decideRecording(outcome);
    if (recording.kind === 'record' && mayRecordReview.ok) {
      const record: ReviewRecord = {
        identity: reviewIdentity,
        outcome: outcome.exitCode === 0 ? 'green' : 'red',
        reason: recording.why,
        redFiles: outcome.redFiles,
        selectedTestFiles,
        load: load ?? undefined,
        measuredAt: new Date().toISOString(),
        durationMs,
        measuredBy: `${hostname()}:${root}`,
      };
      writeReviewRecord(home, reviewDigest, record);
      process.stdout.write(
        `gate: recorded ${record.outcome} for tree ${tree.slice(0, 8)} in ${Math.round(durationMs / 1000)}s — ` +
          `${recording.why}\ngate: a second review of this identical tree reads it instead of running the suite.\n`,
      );
    } else if (recording.kind === 'discard') {
      process.stdout.write(`gate: recording nothing — ${recording.why}\n`);
    }
    if (outcome.exitCode !== 0) {
      printLandingBar(outcome.redFiles, storedBase);
    }
    return exitReview(outcome.exitCode, outcome.redFiles, storedBase);
  }

  const reuse = decideReuse({ wanted: baseIdentity, stored: storedBase, now: Date.now(), refresh });
  if (reuse.kind === 'reuse') {
    process.stdout.write(
      `gate: reusing a recorded base verdict — ${reuse.why}\n${describeRecord(reuse.record)}\n`,
    );
    return exitPreflight(reuse.record.outcome === 'green' ? 0 : 1, 'recorded');
  }
  process.stdout.write(`gate: measuring the base — ${reuse.why}\n`);

  const claim = takeClaim(home, baseDigest, root, Date.now());
  if (claim === null) {
    const inherited = waitForHolder(home, baseDigest, Date.now() + WAIT_BUDGET_MS);
    if (inherited !== null) {
      process.stdout.write(
        `gate: the other lane finished; taking its verdict\n${describeRecord(inherited)}\n`,
      );
      return exitPreflight(inherited.outcome === 'green' ? 0 : 1, 'recorded');
    }
    process.stdout.write(
      `gate: no verdict arrived within the wait, or the holder recorded nothing; measuring here\n`,
    );
  }

  const tree = mayRecord({
    headSha: git(['rev-parse', 'HEAD']),
    baseSha,
    dirtyPaths: git(['status', '--porcelain'])
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter((path) => path !== ''),
  });
  if (!tree.ok) {
    process.stdout.write(`gate: this run will not be recorded — ${tree.why}\n`);
  }

  const preflightLaneRefusal = refuseIfBesideLiveLanes(besideLanes);
  if (preflightLaneRefusal !== null) {
    releaseClaim(home, baseDigest);
    return preflightLaneRefusal;
  }

  try {
    const { outcome, load, durationMs } = await measure(TESTS, false);
    const recording = decideRecording(outcome);
    if (recording.kind === 'record' && tree.ok) {
      const record: BaseRecord = {
        identity: baseIdentity,
        outcome: outcome.exitCode === 0 ? 'green' : 'red',
        reason: recording.why,
        redFiles: outcome.redFiles,
        load: load ?? undefined,
        measuredAt: new Date().toISOString(),
        durationMs,
        measuredBy: `${hostname()}:${root}`,
      };
      writeRecord(home, baseDigest, record);
      process.stdout.write(
        `gate: recorded ${record.outcome} for ${baseSha.slice(0, 8)} in ${Math.round(durationMs / 1000)}s — ` +
          `${recording.why}\ngate: the next lane on this base reads it instead of running the suite.\n`,
      );
    } else if (recording.kind === 'discard') {
      process.stdout.write(`gate: recording nothing — ${recording.why}\n`);
    }
    if (outcome.exitCode !== 0 && outcome.redFiles.length > 0) {
      process.stdout.write(`gate: red on this base:\n  ${outcome.redFiles.join('\n  ')}\n`);
    }
    return exitPreflight(outcome.exitCode, recording.kind === 'record' ? 'recorded' : 'unrecorded');
  } finally {
    releaseClaim(home, baseDigest);
  }
}

function valueOf(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  return argv[at + 1];
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2)));
}
