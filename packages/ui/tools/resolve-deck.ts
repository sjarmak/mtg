/**
 * Finding a deck to show, and saying what is wrong when there is none.
 *
 * Split out of `lab.ts` for the reason `resolve-set.ts` is split out of
 * `play.ts`: the launcher's real job is its failure modes, and a function that
 * calls `process.exit` cannot be asserted on. Everything here returns a result;
 * the script turns a failure into an exit code and a message.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readDeckArtifact } from '../src/lab/deck-artifact';
import type { DeckArtifact } from '../src/lab/deck-artifact';

export interface DeckCandidate {
  readonly path: string;
  /** Human phrase for where this came from, used in the success line. */
  readonly what: string;
}

export interface ResolvedDeck {
  readonly ok: true;
  readonly path: string;
  readonly what: string;
  readonly prompt: string;
  readonly cardCount: number;
  /**
   * The parsed document, not the bytes. Staging rewrites the art URLs to the
   * local copies it caches, so the launcher re-serializes rather than copying
   * the file through — and the artifact on disk keeps its absolute URLs, which
   * is what makes it portable to a machine that has no cache yet.
   */
  readonly deck: DeckArtifact;
}

export interface ResolveFailure {
  readonly ok: false;
  readonly message: string;
}

export type ResolveResult = ResolvedDeck | ResolveFailure;

function failure(message: string): ResolveFailure {
  return { ok: false, message };
}

/**
 * Reads a deck document and checks it really is one.
 *
 * The whole artifact goes through the schema rather than being trusted by
 * shape. A malformed deck that reaches the browser fails as a blank page with a
 * console error, which is the least debuggable outcome available; failing here
 * names the file and the field.
 */
export function readDeckDocument(path: string, what: string): ResolveResult {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause: unknown) {
    return failure(`could not read ${path} (${cause instanceof Error ? cause.message : String(cause)})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause: unknown) {
    return failure(`${path} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`);
  }
  const result = readDeckArtifact(parsed, path);
  if (!result.ok) return failure(result.message);
  const { deck } = result;
  const cardCount = [...deck.spells, ...deck.lands, ...deck.basics].reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  return { ok: true, path, what, prompt: deck.prompt, cardCount, deck };
}

/**
 * The named deck if there is one, otherwise the first candidate that exists.
 *
 * `exists` is injectable so the tests can describe a checkout without creating
 * one on disk.
 */
export function resolveDeck(
  candidates: readonly DeckCandidate[],
  explicit: string | undefined,
  options: {
    readonly cwd?: string;
    readonly exists?: (path: string) => boolean;
    readonly read?: (path: string, what: string) => ResolveResult;
  } = {},
): ResolveResult {
  const exists = options.exists ?? existsSync;
  const read = options.read ?? readDeckDocument;

  if (explicit !== undefined) {
    const path = resolve(options.cwd ?? process.cwd(), explicit);
    if (!exists(path)) return failure(`no deck at ${path}`);
    return read(path, 'the deck you named');
  }
  for (const candidate of candidates) {
    if (exists(candidate.path)) return read(candidate.path, candidate.what);
  }
  return failure(
    'no deck to show. Expected one of:\n' +
      candidates.map((candidate) => `  - ${candidate.path} (${candidate.what})`).join('\n') +
      '\nBuild one with `npx tsx packages/decklab/src/cli.ts --prompt "…" --format modern ' +
      '--artifact out/decklab/deck.json`, or pass a path: `npm run lab -- <deck.json>`.',
  );
}
