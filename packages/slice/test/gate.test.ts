/**
 * What the gate refuses.
 *
 * The memo's whole risk is on the write side: a verdict recorded wrongly is not
 * a slow lane, it is every later lane on that sha aborting its scope for a
 * reason that was never true. So most of what is checked here is the discarding.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLAIM_MAX_AGE_MS,
  claimIsLive,
  readClaim,
  readRecord,
  readReviewRecord,
  releaseClaim,
  reviewRecordsForTree,
  takeClaim,
  writeRecord,
  writeReviewRecord,
} from '../tools/gate/store';
import config from '../../../vitest.config';
import {
  MERGE_ONLY_PROJECTS,
  laneProjects,
  laneSuiteText,
  laneTestCommand,
  mergeTestCommand,
  projectRoster,
} from '../tools/gate/suites';
import {
  type BaseIdentity,
  type BaseRecord,
  type ReviewIdentity,
  type ReviewRecord,
  MEASUREMENT_TTL_MS,
  decidePreflightExit,
  decideRecording,
  decideReviewExit,
  decideReuse,
  decideReviewReuse,
  identityDigest,
  mayRecord,
  newRedFiles,
  reviewIdentityDigest,
  sameIdentity,
  sameReviewIdentity,
  stageFrom,
} from '../tools/gate/verdict';

const IDENTITY: BaseIdentity = {
  baseSha: '48a3b6ea11223344556677889900aabbccddeeff',
  suite: 'npm run typecheck && npx vitest run',
  artifacts: ['data/store/mtg.sqlite', 'tools/forge/dist'],
  runtime: 'v22.11.0',
};

const REVIEW_IDENTITY: ReviewIdentity = {
  tree: '7a3b6ea11223344556677889900aabbccddeeff1',
  suite: 'npm run typecheck && npx vitest run --project unit',
  bar: 'scoped',
  changedFiles: ['packages/ui/src/App.tsx'],
  artifacts: ['data/store/mtg.sqlite', 'tools/forge/dist'],
  runtime: 'v22.11.0',
  forgeBridge: false,
};

function reviewRecord(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    identity: REVIEW_IDENTITY,
    outcome: 'green',
    reason: 'the suite passed',
    redFiles: [],
    selectedTestFiles: ['packages/ui/test/App.test.ts'],
    measuredAt: new Date(1_000_000).toISOString(),
    durationMs: 900_000,
    measuredBy: 'test-host:/checkout',
    ...over,
  };
}

/** As much of a vitest project as the split needs to read: its name. */
interface ProjectShape {
  readonly test: { readonly name: string };
}

/** Every value passed to a `--project` flag in `command`, in order. */
function flagValues(command: readonly string[]): string[] {
  return command.flatMap((token, at) => (token === '--project' ? [command[at + 1] ?? ''] : []));
}

function record(over: Partial<BaseRecord> = {}): BaseRecord {
  return {
    identity: IDENTITY,
    outcome: 'green',
    reason: 'the suite passed',
    redFiles: [],
    measuredAt: new Date(1_000_000).toISOString(),
    durationMs: 1_943_000,
    measuredBy: 'test-host:/checkout',
    ...over,
  };
}

describe('identityDigest', () => {
  it('does not care what order the artifacts were found in', () => {
    const reversed = { ...IDENTITY, artifacts: [...IDENTITY.artifacts].reverse() };
    expect(identityDigest(reversed)).toBe(identityDigest(IDENTITY));
    expect(sameIdentity(reversed, IDENTITY)).toBe(true);
  });

  it('separates a tree that has the card store from one that does not', () => {
    // mtg-d9cu1: the same sha is green with these present and ~29 tests red
    // without them, so the two must never read each other's verdict.
    const bare = { ...IDENTITY, artifacts: [] };
    expect(identityDigest(bare)).not.toBe(identityDigest(IDENTITY));
  });

  it('separates a different sha, suite or runtime', () => {
    for (const other of [
      { ...IDENTITY, baseSha: 'ffffffffffffffffffffffffffffffffffffffff' },
      { ...IDENTITY, suite: 'npx vitest run --project unit' },
      { ...IDENTITY, runtime: 'v24.0.0' },
    ]) {
      expect(identityDigest(other)).not.toBe(identityDigest(IDENTITY));
      expect(sameIdentity(other, IDENTITY)).toBe(false);
    }
  });
});

describe('decideReuse', () => {
  const now = 1_000_000 + 60_000;

  it('reuses a fresh record of the same identity', () => {
    const verdict = decideReuse({ wanted: IDENTITY, stored: record(), now, refresh: false });
    expect(verdict.kind).toBe('reuse');
  });

  it('reuses a red verdict too, because that is the answer preflight wanted', () => {
    const red = record({ outcome: 'red', redFiles: ['packages/ui/test/a.test.ts'] });
    const verdict = decideReuse({ wanted: IDENTITY, stored: red, now, refresh: false });
    expect(verdict.kind).toBe('reuse');
  });

  it('measures when nothing is stored', () => {
    const verdict = decideReuse({ wanted: IDENTITY, stored: null, now, refresh: false });
    expect(verdict).toMatchObject({ kind: 'measure' });
    expect(verdict.why).toContain('48a3b6ea');
  });

  it('measures when --refresh was asked for, even on a perfectly good record', () => {
    expect(decideReuse({ wanted: IDENTITY, stored: record(), now, refresh: true }).kind).toBe('measure');
  });

  it('measures when the stored record is about something else', () => {
    const foreign = record({ identity: { ...IDENTITY, artifacts: [] } });
    const verdict = decideReuse({ wanted: IDENTITY, stored: foreign, now, refresh: false });
    expect(verdict.kind).toBe('measure');
    expect(verdict.why).toContain('different one');
  });

  it('measures once the record is past its time to live', () => {
    const stale = now + MEASUREMENT_TTL_MS + 1;
    expect(decideReuse({ wanted: IDENTITY, stored: record(), now: stale, refresh: false }).kind).toBe(
      'measure',
    );
  });

  it('measures rather than trusting a record whose date is not a date', () => {
    const broken = record({ measuredAt: 'sometime last week' });
    expect(decideReuse({ wanted: IDENTITY, stored: broken, now, refresh: false }).kind).toBe('measure');
  });
});

describe('reviewIdentityDigest and sameReviewIdentity', () => {
  it('is the same identity across two commits that share one tree', () => {
    // mtg-wq3q8.1: a fast-forward merge changes the commit that names the
    // content without changing the content itself.
    expect(sameReviewIdentity(REVIEW_IDENTITY, { ...REVIEW_IDENTITY })).toBe(true);
    expect(reviewIdentityDigest(REVIEW_IDENTITY)).toBe(reviewIdentityDigest({ ...REVIEW_IDENTITY }));
  });

  it('separates a tree that differs by one file', () => {
    const other = { ...REVIEW_IDENTITY, tree: 'ffffffffffffffffffffffffffffffffffffffff' };
    expect(sameReviewIdentity(other, REVIEW_IDENTITY)).toBe(false);
    expect(reviewIdentityDigest(other)).not.toBe(reviewIdentityDigest(REVIEW_IDENTITY));
  });

  it('separates full and scoped measurements of the same tree', () => {
    const full = { ...REVIEW_IDENTITY, bar: 'full' as const, changedFiles: ['package.json'] };
    expect(sameReviewIdentity(full, REVIEW_IDENTITY)).toBe(false);
    expect(reviewIdentityDigest(full)).not.toBe(reviewIdentityDigest(REVIEW_IDENTITY));
  });

  it('separates a run that required the Forge bridge from one that did not', () => {
    const other = { ...REVIEW_IDENTITY, forgeBridge: true };
    expect(sameReviewIdentity(other, REVIEW_IDENTITY)).toBe(false);
    expect(reviewIdentityDigest(other)).not.toBe(reviewIdentityDigest(REVIEW_IDENTITY));
  });

  it('separates a tree with different artifact presence, for the mtg-d9cu1 reason', () => {
    const other = { ...REVIEW_IDENTITY, artifacts: [] };
    expect(sameReviewIdentity(other, REVIEW_IDENTITY)).toBe(false);
    expect(reviewIdentityDigest(other)).not.toBe(reviewIdentityDigest(REVIEW_IDENTITY));
  });

  it('does not share a digest namespace with a base identity of the same sha-shaped value', () => {
    const asBase: BaseIdentity = {
      baseSha: REVIEW_IDENTITY.tree,
      suite: REVIEW_IDENTITY.suite,
      artifacts: REVIEW_IDENTITY.artifacts,
      runtime: REVIEW_IDENTITY.runtime,
    };
    expect(reviewIdentityDigest(REVIEW_IDENTITY)).not.toBe(identityDigest(asBase));
  });
});

describe('decideReviewReuse', () => {
  const now = 1_000_000 + 60_000;

  it('reuses a fresh record of the same tree, whatever commit asked', () => {
    const verdict = decideReviewReuse({
      wanted: REVIEW_IDENTITY,
      stored: reviewRecord(),
      now,
      refresh: false,
    });
    expect(verdict.kind).toBe('reuse');
  });

  it('reuses a red verdict too', () => {
    const red = reviewRecord({ outcome: 'red', redFiles: ['packages/ui/test/a.test.ts'] });
    const verdict = decideReviewReuse({ wanted: REVIEW_IDENTITY, stored: red, now, refresh: false });
    expect(verdict.kind).toBe('reuse');
  });

  it('measures when nothing is stored', () => {
    const verdict = decideReviewReuse({ wanted: REVIEW_IDENTITY, stored: null, now, refresh: false });
    expect(verdict).toMatchObject({ kind: 'measure' });
  });

  it('measures when the tree differs by one file', () => {
    const stored = reviewRecord({
      identity: { ...REVIEW_IDENTITY, tree: 'ffffffffffffffffffffffffffffffffffffffff' },
    });
    const verdict = decideReviewReuse({ wanted: REVIEW_IDENTITY, stored, now, refresh: false });
    expect(verdict.kind).toBe('measure');
  });

  it('measures when artifact presence differs', () => {
    const stored = reviewRecord({ identity: { ...REVIEW_IDENTITY, artifacts: [] } });
    const verdict = decideReviewReuse({ wanted: REVIEW_IDENTITY, stored, now, refresh: false });
    expect(verdict.kind).toBe('measure');
  });

  it('measures when MTG_REQUIRE_FORGE_BRIDGE differs', () => {
    // A run that skipped the Forge bridge assertions is not the run a landing
    // decision may stand in for.
    const stored = reviewRecord({ identity: { ...REVIEW_IDENTITY, forgeBridge: true } });
    const verdict = decideReviewReuse({ wanted: REVIEW_IDENTITY, stored, now, refresh: false });
    expect(verdict.kind).toBe('measure');
  });

  it('measures when --refresh was asked for', () => {
    expect(
      decideReviewReuse({ wanted: REVIEW_IDENTITY, stored: reviewRecord(), now, refresh: true }).kind,
    ).toBe('measure');
  });

  it('measures once the record is past its time to live', () => {
    const stale = now + MEASUREMENT_TTL_MS + 1;
    const verdict = decideReviewReuse({
      wanted: REVIEW_IDENTITY,
      stored: reviewRecord(),
      now: stale,
      refresh: false,
    });
    expect(verdict.kind).toBe('measure');
  });
});

describe('newRedFiles', () => {
  const reviewRed = ['packages/ui/test/a.test.ts', 'packages/kernel/test/b.test.ts'];

  it('treats every review red file as new when there is no base record', () => {
    expect(newRedFiles(reviewRed, null)).toEqual(reviewRed);
  });

  it('treats every review red file as new when the base was green', () => {
    const base: BaseRecord = { ...record(), outcome: 'green', redFiles: [] };
    expect(newRedFiles(reviewRed, base)).toEqual(reviewRed);
  });

  it('exempts exactly the files the base already had red, not everything', () => {
    const base: BaseRecord = { ...record(), outcome: 'red', redFiles: ['packages/kernel/test/b.test.ts'] };
    expect(newRedFiles(reviewRed, base)).toEqual(['packages/ui/test/a.test.ts']);
  });

  it('still reports a review file red on the base as new if the base was not actually red there', () => {
    // A file present in the review's red list but absent from the base's own
    // redFiles is a regression this branch introduced, base-red or not.
    const base: BaseRecord = { ...record(), outcome: 'red', redFiles: ['packages/other/test/c.test.ts'] };
    expect(newRedFiles(reviewRed, base)).toEqual(reviewRed);
  });
});

describe('decidePreflightExit', () => {
  it('exits 0 on a red base once its verdict is recorded, so the lane is not aborted', () => {
    expect(decidePreflightExit(1, 'recorded').exitCode).toBe(0);
  });

  it('exits 0 on a green base', () => {
    expect(decidePreflightExit(0, 'recorded').exitCode).toBe(0);
  });

  it('keeps the suite exit code when nothing was recorded (timeout-only or a lost worker)', () => {
    expect(decidePreflightExit(1, 'unrecorded').exitCode).toBe(1);
  });
});

describe('decideReviewExit', () => {
  const redBase: BaseRecord = record({
    outcome: 'red',
    redFiles: ['packages/ui/test/a.test.ts', 'packages/kernel/test/b.test.ts'],
  });

  it('exits 0 on a green run', () => {
    expect(decideReviewExit(0, [], redBase).exitCode).toBe(0);
  });

  it('exits 0 when the red files are a subset of the base red list', () => {
    expect(decideReviewExit(1, ['packages/kernel/test/b.test.ts'], redBase).exitCode).toBe(0);
  });

  it('exits 1 and names a red file the base does not have', () => {
    const decision = decideReviewExit(
      1,
      ['packages/kernel/test/b.test.ts', 'packages/dsl/test/new.test.ts'],
      redBase,
    );
    expect(decision.exitCode).toBe(1);
    expect(decision.why).toContain('packages/dsl/test/new.test.ts');
    expect(decision.why).not.toContain('b.test.ts');
  });

  it('exits 1 on any red when the base was never recorded, and says so', () => {
    const decision = decideReviewExit(1, ['packages/ui/test/a.test.ts'], null);
    expect(decision.exitCode).toBe(1);
    expect(decision.why).toContain('never recorded');
  });

  it('exits 1 when every red file is new against a green base', () => {
    expect(decideReviewExit(1, ['packages/ui/test/a.test.ts'], record()).exitCode).toBe(1);
  });

  it('exits 1 on a failed run with no red file, which no list can excuse', () => {
    expect(decideReviewExit(1, [], redBase).exitCode).toBe(1);
  });
});

describe('decideRecording', () => {
  it('records a green run', () => {
    const verdict = decideRecording({
      exitCode: 0,
      typecheck: { kind: 'passed' },
      redFiles: [],
      timeoutOnlyFiles: [],
    });
    expect(verdict.kind).toBe('record');
  });

  it('records a typecheck refusal, which no amount of load can cause, and names what it refused', () => {
    const firstDiagnostic =
      "packages/ui/src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.";
    const verdict = decideRecording({
      exitCode: 2,
      typecheck: { kind: 'refused', firstDiagnostic },
      redFiles: [],
      timeoutOnlyFiles: [],
    });
    expect(verdict.kind).toBe('record');
    expect(verdict.why).toContain(firstDiagnostic);
  });

  it('discards a typecheck that was ended rather than answered, and says which kind', () => {
    // mtg-urbjc: a `tsc` that printed nothing after `> tsc --noEmit` was stored
    // as a red base for a tree whose `tsc` exited 0 two minutes later.
    const why = 'the typechecker was killed by SIGKILL, which is the box ending the run';
    const verdict = decideRecording({
      exitCode: 1,
      typecheck: { kind: 'unreliable', why },
      redFiles: [],
      timeoutOnlyFiles: [],
    });
    expect(verdict.kind).toBe('discard');
    expect(verdict.why).toContain(why);
  });

  it('records a red run when something actually asserted', () => {
    const verdict = decideRecording({
      exitCode: 1,
      typecheck: { kind: 'passed' },
      redFiles: ['packages/ui/test/a.test.ts', 'packages/kernel/test/b.test.ts'],
      timeoutOnlyFiles: ['packages/kernel/test/b.test.ts'],
    });
    expect(verdict.kind).toBe('record');
    expect(verdict.why).toContain('1 of 2');
  });

  it('discards a red run whose every failure was a clock', () => {
    // This is the one that would do real damage: on this box a wave of lanes
    // drives it past its core count and vitest's budgets stop being hang
    // detectors. Recording that would abort every later lane on the sha.
    const files = ['packages/ui/test/a.test.ts', 'packages/kernel/test/b.test.ts'];
    const verdict = decideRecording({
      exitCode: 1,
      typecheck: { kind: 'passed' },
      redFiles: files,
      timeoutOnlyFiles: files,
    });
    expect(verdict.kind).toBe('discard');
    expect(verdict.why).toContain('oversubscription');
  });

  it('discards a non-zero exit with no failed file at all', () => {
    const verdict = decideRecording({
      exitCode: 1,
      typecheck: { kind: 'passed' },
      redFiles: [],
      timeoutOnlyFiles: [],
    });
    expect(verdict.kind).toBe('discard');
  });

  it('reports a test command that failed to start instead of an unaccounted red', () => {
    const verdict = decideRecording({
      exitCode: 249,
      typecheck: { kind: 'passed' },
      redFiles: [],
      timeoutOnlyFiles: [],
      testStartFailure: 'spawn E2BIG',
    });
    expect(verdict).toEqual({ kind: 'discard', why: 'the test command failed to start: spawn E2BIG' });
  });
});

describe('mayRecord', () => {
  const base = '48a3b6ea11223344556677889900aabbccddeeff';

  it('lets a clean tree sitting exactly on the base record', () => {
    expect(mayRecord({ headSha: base, baseSha: base, dirtyPaths: [] }).ok).toBe(true);
  });

  it('refuses a tree that is ahead of the sha the verdict would be filed under', () => {
    // `--stage preflight` in a checkout three commits along would otherwise
    // measure that checkout and publish the answer against the merge-base.
    const verdict = mayRecord({ headSha: 'ff'.repeat(20), baseSha: base, dirtyPaths: [] });
    expect(verdict.ok).toBe(false);
  });

  it('refuses a tree with uncommitted changes, which are in no commit', () => {
    const verdict = mayRecord({ headSha: base, baseSha: base, dirtyPaths: ['packages/ui/src/a.ts'] });
    expect(verdict.ok).toBe(false);
  });

  it('refuses a dirty tree the way review calls it too, headSha and baseSha both the measured tree', () => {
    // `cli.ts`'s review stage reuses this function by passing the same tree
    // value for both fields, since review has no separate base ref to compare
    // against; this is the call shape it actually makes.
    const tree = 'aa'.repeat(20);
    expect(mayRecord({ headSha: tree, baseSha: tree, dirtyPaths: [] }).ok).toBe(true);
    expect(mayRecord({ headSha: tree, baseSha: tree, dirtyPaths: ['packages/ui/src/a.ts'] }).ok).toBe(false);
  });
});

describe('stageFrom', () => {
  it('calls a worktree sitting on the base ref preflight', () => {
    expect(stageFrom(0).stage).toBe('preflight');
  });

  it('calls a worktree with commits of its own review', () => {
    expect(stageFrom(3).stage).toBe('review');
  });
});

describe('the lane/merge split', () => {
  it('reads the real project roster out of vitest.config.ts', () => {
    // The same read `packages/metrics/test/legacy-cube-project.test.ts` makes,
    // asserted here so a config shape change fails in the gate's own suite
    // rather than in a lane at three in the morning.
    const projects = (config as { readonly test: { readonly projects: readonly ProjectShape[] } }).test
      .projects;
    expect(projectRoster()).toEqual(projects.map((project) => project.test.name));
  });

  it('names only projects that exist, because a stale name measures nothing', () => {
    // The load-bearing one, and it guards the merge side: a renamed project
    // leaves the lane complement quietly correct, but hands `gate:merge` a
    // filter matching nothing. vitest does refuse that (exit 1, "No projects
    // matched the filter"), so the failure is loud — this makes it early.
    expect(projectRoster()).toEqual(expect.arrayContaining([...MERGE_ONLY_PROJECTS]));
  });

  it('partitions the roster: every project is in exactly one of the two commands', () => {
    const lane = flagValues(laneTestCommand());
    const merge = flagValues(mergeTestCommand());
    expect([...lane, ...merge].sort()).toEqual([...projectRoster()].sort());
    expect(lane.filter((name) => merge.includes(name))).toEqual([]);
  });

  it('names its projects positively, because vitest ORs negated filters into a no-op', () => {
    // Measured 2026-09-17 against a four-project config: `--project '!balance'`
    // alone drops one project, but `--project '!balance' --project
    // '!calibration'` runs all four, since `balance` matches `!calibration`.
    // `!a,!b` and `!{a,b}` are the same no-op. A lane spelled that way would
    // have gone on paying for the simulations while its command said it did not.
    expect(flagValues(laneTestCommand()).some((name) => name.startsWith('!'))).toBe(false);
    expect(flagValues(mergeTestCommand()).some((name) => name.startsWith('!'))).toBe(false);
  });

  it('derives the lane list rather than holding a copy of the roster', () => {
    // A project nobody here has heard of is a lane project. That is the whole
    // point of deriving it: an accept-list would leave it running in no lane.
    const invented = [...projectRoster(), 'a-project-added-next-year'];
    expect(laneProjects(invented)).toContain('a-project-added-next-year');
  });

  it('refuses a roster it cannot take a complement of, instead of running everything', () => {
    // An empty lane list would emit `npx vitest run` with no --project, which
    // runs every project — the exact outcome this file prevents, reached by
    // silence.
    expect(() => laneProjects([...MERGE_ONLY_PROJECTS])).toThrow(/merge-only/);
  });

  it('gives the memo a different identity than it had before the split', () => {
    // A verdict measured under the old text stood for a run that played the
    // balance games. Reading it now would be inheriting a claim about games
    // nobody played in this configuration.
    expect(laneSuiteText()).not.toBe('npm run typecheck && npx vitest run');
    expect(identityDigest({ ...IDENTITY, suite: laneSuiteText() })).not.toBe(identityDigest(IDENTITY));
  });
});

describe('the store', () => {
  let home = '';

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mtg-gate-test-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const digest = 'deadbeefdeadbeef';

  it('round-trips a record', () => {
    writeRecord(home, digest, record());
    expect(readRecord(home, digest)).toEqual(record());
  });

  it('round-trips a review record under its own digest, sharing the store', () => {
    const reviewDigest = 'feedfacefeedface';
    writeReviewRecord(home, reviewDigest, reviewRecord());
    expect(readReviewRecord(home, reviewDigest)).toEqual(reviewRecord());
    // The base record filed alongside it is untouched.
    writeRecord(home, digest, record());
    expect(readRecord(home, digest)).toEqual(record());
  });

  it('finds every review record for a tree without treating the tree as a commit', () => {
    const older = reviewRecord({ measuredAt: new Date(2_000_000).toISOString() });
    const newer = reviewRecord({
      identity: { ...REVIEW_IDENTITY, bar: 'full', changedFiles: ['package.json'] },
      measuredAt: new Date(3_000_000).toISOString(),
    });
    writeReviewRecord(home, 'older', older);
    writeReviewRecord(home, 'newer', newer);
    writeReviewRecord(
      home,
      'other',
      reviewRecord({ identity: { ...REVIEW_IDENTITY, tree: 'f'.repeat(40) } }),
    );
    writeRecord(home, digest, record());
    expect(reviewRecordsForTree(home, REVIEW_IDENTITY.tree)).toEqual([newer, older]);
    expect(readRecord(home, digest)).toEqual(record());
  });

  it('reads a base record as absent through the review schema, and vice versa', () => {
    // A base and a review digest could in principle collide; the schemas are
    // mutually exclusive on their identity shape, so a mismatch degrades to
    // "nothing recorded" rather than returning the wrong kind of record.
    writeRecord(home, digest, record());
    expect(readReviewRecord(home, digest)).toBeNull();
  });

  it('reads a malformed record as absent, and does not leave it for the next lane', () => {
    mkdirSync(home, { recursive: true });
    const path = join(home, `${digest}.json`);
    writeFileSync(path, '{ this is not json', 'utf8');
    expect(readRecord(home, digest)).toBeNull();
    expect(() => readFileSync(path, 'utf8')).toThrow();
  });

  it('reads a well-formed file that is not a record as absent', () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, `${digest}.json`), JSON.stringify({ outcome: 'green' }), 'utf8');
    expect(readRecord(home, digest)).toBeNull();
  });

  it('refuses a second claim while the first holder is alive', () => {
    const now = Date.now();
    expect(takeClaim(home, digest, '/a', now)).not.toBeNull();
    // Written by this same process, so the pid probe finds it alive.
    expect(takeClaim(home, digest, '/b', now)).toBeNull();
  });

  it('takes over a claim whose holder is gone', () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, `${digest}.claim.json`),
      JSON.stringify({
        pid: 999_999_999,
        // A dead LOCAL holder: claimIsLive only probes the pid when the host
        // matches this machine's own hostname, so a hardcoded host modeled a
        // remote claim (and passed only on the box that hardcoded name belonged
        // to; mtg-9x52s).
        host: hostname(),
        worktree: '/gone',
        startedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    const taken = takeClaim(home, digest, '/b', Date.now());
    expect(taken).not.toBeNull();
    expect(readClaim(home, digest)?.worktree).toBe('/b');
  });

  it('takes over a claim that has outlasted the longest run, whatever its pid says', () => {
    const now = Date.now();
    expect(takeClaim(home, digest, '/a', now - CLAIM_MAX_AGE_MS - 1)).not.toBeNull();
    expect(takeClaim(home, digest, '/b', now)).not.toBeNull();
    expect(readClaim(home, digest)?.worktree).toBe('/b');
  });

  it('judges a claim from another host by age alone, since its pid is unreachable from here', () => {
    const elsewhere = { pid: 1, host: 'some-other-box', worktree: '/x', startedAt: new Date().toISOString() };
    expect(claimIsLive(elsewhere, Date.now())).toBe(true);
    expect(claimIsLive(elsewhere, Date.now() + CLAIM_MAX_AGE_MS + 1)).toBe(false);
  });

  it('leaves another process claim alone on release', () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, `${digest}.claim.json`),
      JSON.stringify({
        pid: 999_999_999,
        host: 'ds-5090',
        worktree: '/theirs',
        startedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    releaseClaim(home, digest);
    expect(readClaim(home, digest)?.worktree).toBe('/theirs');
  });
});
