#!/usr/bin/env -S npx tsx
/**
 * The gate that makes narrowing a DSL enum impossible to do quietly.
 *
 * ```
 * npm run vocabulary:refresh            # rebuild the snapshot and write it
 * npm run vocabulary:refresh -- --check # report drift, write nothing, exit 1 if any
 * ```
 *
 * ## The problem it answers
 *
 * Every enumerated value in DSL v0 is a named `as const` string tuple, and a
 * generated set file is a document written in those names. Narrowing one of the
 * tuples — a rename is a removal plus an addition — makes every artifact already
 * on disk that used the old name unparseable, all at once, silently. That
 * happened to one counter kind on 2026-08-16 and went unnoticed for two days,
 * because the artifacts are outputs rather than sources and nothing in CI reads
 * them.
 *
 * The obvious fix is the wrong one. A gate that parsed the generated files would
 * have an exit code that depended on which files a given machine was holding,
 * and this repository has already been bitten by exactly that: the art
 * governance check once discovered its own subject by walking a gitignored
 * output directory, and its verdict became a fact about the hard drive. So the
 * subject here is tracked state only — a committed snapshot of the vocabulary,
 * diffed against the vocabulary the package exports today.
 *
 * ## Why the snapshot is derived rather than listed
 *
 * The snapshot is built by importing the `@mtg/dsl` namespace and collecting
 * every exported array of strings. Nothing enumerates the enums by hand, which
 * is the property that matters: an enum added tomorrow is covered the day it is
 * exported, with no list for anybody to forget. The filter is deliberately
 * generous — an exported string array that is not conceptually an enum still
 * gets watched, which costs a line in a JSON file and buys the guarantee that
 * the derivation has no exceptions to keep in step. Empty arrays are skipped
 * because at run time an empty array of strings and an empty array of anything
 * else are the same object.
 *
 * Zod schemas are not introspected. The tuples are the source of truth and the
 * schemas are built from them, so reading the tuples reads the same fact one
 * layer earlier and without depending on a validator's internals.
 *
 * ## Two verdicts, and the asymmetry between them is the whole point
 *
 * An **addition** is mechanical and safe: nothing on disk becomes unreadable
 * when a new member appears, so the report says to run the refresh and stops
 * there. A **removal** is the dangerous direction, so it fails hard, names the
 * member that was dropped, and refuses to rewrite the snapshot at all — a
 * refresh that laundered a narrowing into a green tree would be the original bug
 * with extra steps. The one way past it is to record the retirement in
 * `packages/dsl/src/retired-vocabulary.ts`, which is a line of tracked state
 * saying what the old name means now. Recorded removals fall back to the
 * mechanical verdict.
 *
 * Recording a retirement does not make any schema accept the retired name. That
 * stays a per-enum decision about whether artifacts naming it are worth reading;
 * see `counters.ts`, which is the one enum that has said yes so far.
 *
 * ## Why the subject is a parameter
 *
 * `@mtg/dsl` is not the only package whose enums are written into artifacts
 * nobody regenerates. the art pipeline writes `provenance`, `framing` and
 * `paletteRole` into every `art-plan.json` under `out/art/`, which on this
 * machine is 4.2 GB of paid renders, and narrowing one of those tuples has
 * exactly the failure the counter-kind rename had. So everything here is written
 * against a `WatchedVocabulary` — the package's namespace, its committed
 * snapshot, its retired table and where that table lives — and `DSL_VOCABULARY`
 * is one value of that type rather than the only subject. the art pipeline holds the
 * other one, and the CLI that refreshes both lives on its side, because the
 * workspace's dependency arrow runs art -> dsl and this file may not import back
 * across it.
 *
 * The list is short on purpose. The test is not "does the package export a
 * string tuple" but "does a member of it get written into an artifact nobody
 * regenerates": `@mtg/kernel`'s `STEPS` is exported and enumerated and still out
 * of scope, because its only written-down homes are type-checked replay fixtures
 * (a narrowing there fails the build, loudly, on the same commit) and gitignored
 * sim logs that a seed reproduces.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as dsl from '@mtg/dsl';
import type { RetiredNames } from '@mtg/dsl';
import { format, resolveConfig } from 'prettier';

/** The committed snapshot. Tracked, so the gate's exit code is a fact about the tree. */
export const VOCABULARY_SNAPSHOT_PATH = fileURLToPath(
  new URL('../data/vocabulary-snapshot.json', import.meta.url),
);

/** The command a reader of the JSON needs, printed into the JSON. */
export const VOCABULARY_REFRESH_COMMAND = 'npm run vocabulary:refresh';

/** One enum name to its members, in declaration order. */
export type Vocabulary = Readonly<Record<string, readonly string[]>>;

/**
 * One package whose enums are watched, and everything the gate needs to say so.
 *
 * `retiredTablePath` is repo-relative and appears in the failure text rather
 * than being derived from `snapshotPath`: the two files do not have to sit in
 * the same place, and they do not. `@mtg/dsl` keeps its table in `src/` because
 * `counters.ts` reads it at run time to build a parse-time alias map; the art pipeline
 * has no runtime reader and keeps its table beside its descriptor.
 */
export interface WatchedVocabulary {
  /** The package as it is imported, for a report that names its subject. */
  readonly packageName: string;
  /** The namespace the enums are derived from. */
  readonly namespace: Readonly<Record<string, unknown>>;
  /** The committed snapshot file. */
  readonly snapshotPath: string;
  /** The retired-name table, by enum name. */
  readonly retiredNames: (enumName: string) => RetiredNames;
  /** Where a developer records a retirement, repo-relative. */
  readonly retiredTablePath: string;
}

/** The committed file's shape. */
export interface VocabularySnapshot {
  readonly generatedBy: string;
  readonly contentSha256: string;
  readonly enums: Vocabulary;
}

/** The resolved members' address, separate from every source or position digest. */
export function vocabularyContentSha256(vocabulary: Vocabulary): string {
  const ordered = Object.fromEntries(
    Object.entries(vocabulary).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex');
}

/** Members an enum has gained since the snapshot. */
export interface AddedMembers {
  readonly enumName: string;
  readonly members: readonly string[];
}

/** One member an enum no longer declares, and whether the retirement is recorded. */
export interface DroppedMember {
  readonly enumName: string;
  readonly member: string;
  /** `undefined` is unrecorded, `null` is a recorded removal, string is a rename. */
  readonly recordedAs: string | null | undefined;
}

export interface VocabularyDrift {
  readonly added: readonly AddedMembers[];
  readonly dropped: readonly DroppedMember[];
}

/**
 * `narrowed` is the hard failure: a member left the vocabulary with no record of
 * where its meaning went. `stale` is the mechanical one.
 */
export type VocabularyVerdict = 'fresh' | 'stale' | 'narrowed';

export interface VocabularyCheck {
  readonly drift: VocabularyDrift;
  readonly verdict: VocabularyVerdict;
  readonly text: string;
  readonly wrote: boolean;
}

/**
 * The exported value as a tuple of strings, or `null` if it is not one.
 *
 * Written as a loop rather than `every` so the narrowing survives without a type
 * predicate, and so an array of anything else costs one comparison.
 */
function stringTuple(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const members: readonly unknown[] = value;
  if (members.length === 0) return null;
  const strings: string[] = [];
  for (const member of members) {
    if (typeof member !== 'string') return null;
    strings.push(member);
  }
  return strings;
}

/**
 * Every enum `@mtg/dsl` exports today, by name.
 *
 * The namespace is a parameter so the diff and the report can be tested against
 * a stated vocabulary rather than against whatever the package happens to
 * export, which would make the tests restate the snapshot.
 */
export function currentVocabulary(namespace: Readonly<Record<string, unknown>> = dsl): Vocabulary {
  const entries: [string, readonly string[]][] = [];
  for (const [name, value] of Object.entries(namespace)) {
    const members = stringTuple(value);
    if (members !== null) entries.push([name, members]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

/** `@mtg/dsl`: the vocabulary the whole generated-set format is written in. */
export const DSL_VOCABULARY: WatchedVocabulary = {
  packageName: '@mtg/dsl',
  namespace: dsl,
  snapshotPath: VOCABULARY_SNAPSHOT_PATH,
  retiredNames: dsl.recordedRetirements,
  retiredTablePath: 'packages/dsl/src/retired-vocabulary.ts',
};

/** Names in `left` that `right` does not have, in `left`'s order. */
function missingFrom(left: readonly string[], right: readonly string[]): readonly string[] {
  const present = new Set(right);
  return left.filter((member) => !present.has(member));
}

/**
 * The committed snapshot against the live vocabulary.
 *
 * `lookup` is the retired table, injected for the same reason the namespace is:
 * a test that had to edit the real table to exercise the recorded branch would
 * be editing the thing the gate reads.
 */
export function diffVocabulary(
  committed: Vocabulary,
  current: Vocabulary,
  lookup: (enumName: string) => RetiredNames = dsl.recordedRetirements,
): VocabularyDrift {
  const names = [...new Set([...Object.keys(committed), ...Object.keys(current)])].sort((left, right) =>
    left.localeCompare(right),
  );
  const added: AddedMembers[] = [];
  const dropped: DroppedMember[] = [];
  for (const enumName of names) {
    const before = committed[enumName] ?? [];
    const after = current[enumName] ?? [];
    const gained = missingFrom(after, before);
    if (gained.length > 0) added.push({ enumName, members: gained });
    const retired = lookup(enumName);
    for (const member of missingFrom(before, after)) {
      dropped.push({
        enumName,
        member,
        recordedAs: Object.hasOwn(retired, member) ? retired[member] : undefined,
      });
    }
  }
  return { added, dropped };
}

/**
 * The verdict, given the drift and whether the serialized snapshot differs
 * byte-for-byte.
 *
 * Bytes matter on top of the drift because a reordered tuple changes the file
 * without adding or dropping anything, and a snapshot that does not match what
 * the refresh would write is not a snapshot.
 */
export function vocabularyVerdict(drift: VocabularyDrift, bytesDiffer: boolean): VocabularyVerdict {
  if (drift.dropped.some((entry) => entry.recordedAs === undefined)) return 'narrowed';
  if (drift.added.length > 0 || drift.dropped.length > 0 || bytesDiffer) return 'stale';
  return 'fresh';
}

function memberCount(vocabulary: Vocabulary): number {
  return Object.values(vocabulary).reduce((total, members) => total + members.length, 0);
}

/** What a developer reads when the gate fires. */
export function vocabularyReport(
  drift: VocabularyDrift,
  verdict: VocabularyVerdict,
  current: Vocabulary,
  wrote: boolean,
  watched: WatchedVocabulary = DSL_VOCABULARY,
): string {
  if (verdict === 'fresh') {
    const enums = Object.keys(current).length;
    return `the ${watched.packageName} vocabulary snapshot is fresh: ${String(enums)} enums, ${String(memberCount(current))} members\n`;
  }
  const lines: string[] = [];
  for (const entry of drift.added) {
    lines.push(`${entry.enumName} gained ${entry.members.join(', ')}`);
  }
  for (const entry of drift.dropped) {
    lines.push(
      entry.recordedAs === undefined
        ? `${entry.enumName} no longer declares ${entry.member}`
        : entry.recordedAs === null
          ? `${entry.enumName} dropped ${entry.member}, recorded as removed`
          : `${entry.enumName} dropped ${entry.member}, recorded as ${entry.recordedAs}`,
    );
  }
  if (verdict === 'narrowed') {
    const unrecorded = drift.dropped.filter((entry) => entry.recordedAs === undefined);
    const names = unrecorded.map((entry) => `${entry.enumName}.${entry.member}`).join(', ');
    lines.push(
      `narrowing a ${watched.packageName} enum invalidates every generated artifact already on disk that names the dropped member, and nothing in CI regenerates those artifacts`,
      `record ${names} in ${watched.retiredTablePath}, mapping each retired name to its replacement or to null when it was removed, then run ${VOCABULARY_REFRESH_COMMAND}`,
      `the snapshot was not rewritten: a refresh that accepted an unrecorded removal would be the silent narrowing it exists to catch`,
    );
  } else {
    lines.push(
      wrote
        ? `the committed ${watched.packageName} vocabulary snapshot was stale and has been rewritten`
        : `the committed ${watched.packageName} vocabulary snapshot is stale; run ${VOCABULARY_REFRESH_COMMAND}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The committed file, validated at the boundary.
 *
 * A missing file is a bootstrap rather than an error: everything reads as added,
 * which is the mechanical verdict, and the refresh writes the first snapshot.
 */
export function readVocabularySnapshot(path: string = VOCABULARY_SNAPSHOT_PATH): {
  readonly snapshot: VocabularySnapshot;
  readonly text: string;
} {
  if (!existsSync(path)) {
    return {
      snapshot: {
        generatedBy: VOCABULARY_REFRESH_COMMAND,
        contentSha256: vocabularyContentSha256({}),
        enums: {},
      },
      text: '',
    };
  }
  const text = readFileSync(path, 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${path}: not a JSON object`);
  const enums: unknown = (parsed as { enums?: unknown }).enums;
  if (typeof enums !== 'object' || enums === null) throw new Error(`${path}: no "enums" object`);
  const checked: Record<string, readonly string[]> = {};
  for (const [name, value] of Object.entries(enums)) {
    const members = stringTuple(value);
    if (members === null) throw new Error(`${path}: ${name} is not a non-empty array of strings`);
    checked[name] = members;
  }
  const expectedContentSha256 = vocabularyContentSha256(checked);
  const recordedContentSha256: unknown = (parsed as { contentSha256?: unknown }).contentSha256;
  if (recordedContentSha256 !== undefined && recordedContentSha256 !== expectedContentSha256) {
    throw new Error(`${path}: contentSha256 does not match enums`);
  }
  return {
    snapshot: {
      generatedBy: VOCABULARY_REFRESH_COMMAND,
      contentSha256: expectedContentSha256,
      enums: checked,
    },
    text,
  };
}

/**
 * The snapshot as the file's bytes.
 *
 * Through prettier, because the file is tracked and `npm run format` checks
 * `packages/**` — a serializer that agreed with itself but not with prettier
 * would put the refresh and the format check in a loop.
 */
export async function serializeVocabularySnapshot(current: Vocabulary): Promise<string> {
  const config = (await resolveConfig(fileURLToPath(import.meta.url))) ?? {};
  const snapshot: VocabularySnapshot = {
    generatedBy: VOCABULARY_REFRESH_COMMAND,
    contentSha256: vocabularyContentSha256(current),
    enums: current,
  };
  return format(JSON.stringify(snapshot), { ...config, filepath: 'vocabulary-snapshot.json' });
}

/** Rebuilds the snapshot and reports it against the committed file. */
export async function refreshVocabularySnapshot(
  check: boolean,
  path?: string,
  watched: WatchedVocabulary = DSL_VOCABULARY,
): Promise<VocabularyCheck> {
  const file = path ?? watched.snapshotPath;
  const committed = readVocabularySnapshot(file);
  const current = currentVocabulary(watched.namespace);
  const drift = diffVocabulary(committed.snapshot.enums, current, watched.retiredNames);
  const text = await serializeVocabularySnapshot(current);
  const verdict = vocabularyVerdict(drift, text !== committed.text);
  const wrote = !check && verdict === 'stale';
  if (wrote) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { encoding: 'utf8' });
  }
  return { drift, verdict, text: vocabularyReport(drift, verdict, current, wrote, watched), wrote };
}

/**
 * Every watched package in one pass, for a CLI that has to refresh all of them.
 *
 * The verdict is the worst of the individual ones, so one narrowed package fails
 * the run, and the text is every package's report in order: a developer who
 * narrowed two enums in two packages should read both sentences, not the first.
 */
export async function refreshAllVocabularySnapshots(
  check: boolean,
  watched: readonly WatchedVocabulary[],
): Promise<{ readonly verdict: VocabularyVerdict; readonly text: string }> {
  const reports = [];
  for (const subject of watched) {
    reports.push(await refreshVocabularySnapshot(check, undefined, subject));
  }
  const verdict: VocabularyVerdict = reports.some((report) => report.verdict === 'narrowed')
    ? 'narrowed'
    : reports.some((report) => report.verdict === 'stale')
      ? 'stale'
      : 'fresh';
  return { verdict, text: reports.map((report) => report.text).join('') };
}

export function parseVocabularySnapshotArgs(argv: readonly string[]): { readonly check: boolean } {
  for (const flag of argv) {
    if (flag !== '--check') throw new Error(`unknown vocabulary snapshot flag ${flag}`);
  }
  return { check: argv.includes('--check') };
}

async function main(argv: readonly string[]): Promise<void> {
  const { check } = parseVocabularySnapshotArgs(argv);
  const { text, verdict } = await refreshVocabularySnapshot(check);
  process.stdout.write(text);
  if (verdict === 'narrowed' || (check && verdict === 'stale')) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ kind: 'vocabulary-snapshot-error', message: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 1;
  });
}
