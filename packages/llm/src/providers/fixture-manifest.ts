/**
 * A run manifest: the keys one recording session served, written down.
 *
 * A recorded run's bill is history, and history does not replay. The fixture
 * cache is flat and keyed by `hash(system, prompt, schema)`, so the only way to
 * ask which files belong to a run, absent a record, is to run the pipeline again
 * and watch which keys it asks for. That answers a question about today's prompt
 * bytes, not about the money that was spent: change an allocator and the same
 * historical run reports different keys, or none, because the prompts moved out
 * from under it. It happened — `setgen/signpost-payoff` reserved ability kinds
 * for signposts, the flagship's fill prompts changed, and a replay that had been
 * standing in for a $22 recording could no longer find its own fixtures.
 *
 * So the run writes down what it served. A manifest is a fact on disk beside the
 * fixtures it names, and the bill computes from the two of them without running
 * anything. `createResumableRecorderTransport` already reports every key it
 * answers, so the next paid run produces one on the way past.
 *
 * One brief can have more than one recording, and that is the normal case rather
 * than the exceptional one — a brief that never moves is a brief nobody is
 * working on. The flagship has two: the skeleton changed between them, so one is
 * what the old skeleton asked and one is what the new one asks, and neither is
 * wrong. So a manifest is named for the run and not for the brief. The first
 * version of this file named them for the brief, a regeneration an hour later
 * wrote over the record of a run that had already been paid for, and that is the
 * same mistake as summing a directory and calling it a run: a name that means
 * "the run" while more than one run exists. `writeRunManifest` refuses an
 * occupied path, so the guarantee is the refusal and not the convention.
 *
 * There is deliberately no file meaning "the latest run of this brief".
 * `listRunManifests` sorts the directory, and the newest is the last element —
 * a lookup cannot go stale, and nothing has to be rewritten for it to stay true.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { LlmTransportError } from '../errors';
import type { RecordedFixture } from './fixture';
import { fixturePath, readFixture } from './fixture';

/**
 * Strict rather than stripping, which is the default and was wrong here: a
 * hand-written `stale` note explaining why a run no longer replays was being
 * silently dropped on read, so the first tool to read and rewrite a manifest
 * would have deleted prose nobody could recover.
 */
const RunManifestSchema = z
  .object({
    /** Filename stem, unique per run. `manifestId` builds it. */
    id: z.string().min(1),
    /** The brief's file stem, shared by every run of that brief. */
    run: z.string().min(1),
    /** The brief this run was generated from, relative to the repository root. */
    brief: z.string().min(1),
    recordedAt: z.string().min(1),
    /** Requests the run sent, including any key it asked for more than once. */
    calls: z.number().int().positive(),
    /** Distinct fixture keys, in the order the run first asked for each. */
    keys: z.array(z.string().min(1)).nonempty(),
    /** Why this run no longer replays, when the brief has moved past it. */
    stale: z.string().min(1).optional(),
  })
  .strict();

export type RunManifest = z.infer<typeof RunManifestSchema>;

/**
 * The filename stem for a run: its brief and when it finished, to the second.
 *
 * Seconds rather than minutes because the only thing standing between two runs
 * is that they differ, and two recordings of one brief inside a minute is a
 * cheap way to lose one. The colons an ISO timestamp uses are illegal in a
 * filename on some hosts, so they become dashes.
 */
export function manifestId(run: string, recordedAt: string): string {
  const stamp = recordedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return `${run}-${stamp}`;
}

export function runManifestPath(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

export function readRunManifest(path: string): RunManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error: unknown) {
    throw new LlmTransportError('fixture', `run manifest ${path} is not readable JSON`, { cause: error });
  }
  const result = RunManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new LlmTransportError(
      'fixture',
      `run manifest ${path} does not match the manifest schema: ${result.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    );
  }
  const duplicates = result.data.keys.filter((key, index) => result.data.keys.indexOf(key) !== index);
  if (duplicates.length > 0) {
    throw new LlmTransportError(
      'fixture',
      `run manifest ${path} lists ${duplicates.length} key(s) twice, so its bill would double-count them: ${[
        ...new Set(duplicates),
      ].join(', ')}`,
    );
  }
  // The same discipline a fixture key already carries: a file that does not
  // answer to its own name is a file a lookup cannot find and a rename can
  // silently point somewhere else.
  const stem = basename(path, '.json');
  if (result.data.id !== stem) {
    throw new LlmTransportError(
      'fixture',
      `run manifest ${path} calls itself ${result.data.id}, so a lookup by id would not find it`,
    );
  }
  return result.data;
}

/**
 * Write a manifest, never over one.
 *
 * A manifest is the disk half of a bill that was paid, and the fixtures it names
 * cannot be regenerated for free, so an overwrite destroys a record rather than
 * updating one. Correcting a manifest means writing the corrected file under its
 * own name and leaving the old one where it is.
 */
export function writeRunManifest(path: string, manifest: RunManifest): void {
  if (existsSync(path)) {
    throw new LlmTransportError(
      'fixture',
      `run manifest ${path} already exists; a recorded run is never rewritten, so give this run its own id`,
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * Every manifest in a directory, oldest run first.
 *
 * This is how "the latest run of a brief" is asked, rather than by keeping a
 * file that has to be rewritten to stay correct:
 * `listRunManifests(dir).filter((run) => run.run === brief).at(-1)`.
 */
export function listRunManifests(dir: string): readonly RunManifest[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readRunManifest(join(dir, name)))
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}

/**
 * The fixtures a manifest names, in manifest order.
 *
 * A key with no file is an error rather than a gap: the manifest is the claim
 * that these files are the run, and a bill summed over a subset of them is a
 * smaller number reported with no sign that anything went missing.
 */
export function readManifestFixtures(dir: string, manifest: RunManifest): readonly RecordedFixture[] {
  const missing = manifest.keys.filter((key) => !existsSync(fixturePath(dir, key)));
  if (missing.length > 0) {
    throw new LlmTransportError(
      'fixture',
      `run ${manifest.run} names ${missing.length} fixture(s) that are not in ${dir}: ${missing.join(', ')}`,
    );
  }
  return manifest.keys.map((key) => readFixture(fixturePath(dir, key)));
}
