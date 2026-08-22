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
 */
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

/** The committed file's shape. */
export interface VocabularySnapshot {
  readonly generatedBy: string;
  readonly enums: Vocabulary;
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
  readonly recordedAs: string | null;
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
  lookup: (enumName: string) => RetiredNames = dsl.retiredNames,
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
      dropped.push({ enumName, member, recordedAs: retired[member] ?? null });
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
  if (drift.dropped.some((entry) => entry.recordedAs === null)) return 'narrowed';
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
): string {
  if (verdict === 'fresh') {
    const enums = Object.keys(current).length;
    return `the vocabulary snapshot is fresh: ${String(enums)} enums, ${String(memberCount(current))} members\n`;
  }
  const lines: string[] = [];
  for (const entry of drift.added) {
    lines.push(`${entry.enumName} gained ${entry.members.join(', ')}`);
  }
  for (const entry of drift.dropped) {
    lines.push(
      entry.recordedAs === null
        ? `${entry.enumName} no longer declares ${entry.member}`
        : `${entry.enumName} dropped ${entry.member}, recorded as ${entry.recordedAs}`,
    );
  }
  if (verdict === 'narrowed') {
    const unrecorded = drift.dropped.filter((entry) => entry.recordedAs === null);
    const names = unrecorded.map((entry) => `${entry.enumName}.${entry.member}`).join(', ');
    lines.push(
      `narrowing a DSL enum invalidates every generated artifact already on disk that names the dropped member, and nothing in CI regenerates those artifacts`,
      `record ${names} in packages/dsl/src/retired-vocabulary.ts, mapping each retired name to the member that carries its meaning now, then run ${VOCABULARY_REFRESH_COMMAND}`,
      `the snapshot was not rewritten: a refresh that accepted an unrecorded removal would be the silent narrowing it exists to catch`,
    );
  } else {
    lines.push(
      wrote
        ? `the committed vocabulary snapshot was stale and has been rewritten`
        : `the committed vocabulary snapshot is stale; run ${VOCABULARY_REFRESH_COMMAND}`,
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
    return { snapshot: { generatedBy: VOCABULARY_REFRESH_COMMAND, enums: {} }, text: '' };
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
  return { snapshot: { generatedBy: VOCABULARY_REFRESH_COMMAND, enums: checked }, text };
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
  const snapshot: VocabularySnapshot = { generatedBy: VOCABULARY_REFRESH_COMMAND, enums: current };
  return format(JSON.stringify(snapshot), { ...config, filepath: 'vocabulary-snapshot.json' });
}

/** Rebuilds the snapshot and reports it against the committed file. */
export async function refreshVocabularySnapshot(
  check: boolean,
  path: string = VOCABULARY_SNAPSHOT_PATH,
): Promise<VocabularyCheck> {
  const committed = readVocabularySnapshot(path);
  const current = currentVocabulary();
  const drift = diffVocabulary(committed.snapshot.enums, current);
  const text = await serializeVocabularySnapshot(current);
  const verdict = vocabularyVerdict(drift, text !== committed.text);
  const wrote = !check && verdict === 'stale';
  if (wrote) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { encoding: 'utf8' });
  }
  return { drift, verdict, text: vocabularyReport(drift, verdict, current, wrote), wrote };
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
