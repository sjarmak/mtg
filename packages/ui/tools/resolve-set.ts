/**
 * Finding a set to play, and saying what is wrong when there is none.
 *
 * Split out of `play.ts` so it can be tested: the launcher's real job is its
 * failure modes, and a function that calls `process.exit` cannot be asserted
 * on. Everything here returns a result; the script turns a failure into an
 * exit code and a message.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCard } from '@mtg/dsl';

export interface SetCandidate {
  readonly path: string;
  /** Human phrase for where this came from, used in the success line. */
  readonly what: string;
}

export interface ResolvedSet {
  readonly ok: true;
  readonly path: string;
  readonly what: string;
  readonly cardCount: number;
  readonly json: string;
}

export interface ResolveFailure {
  readonly ok: false;
  readonly message: string;
}

export type ResolveResult = ResolvedSet | ResolveFailure;

function failure(message: string): ResolveFailure {
  return { ok: false, message };
}

/**
 * Reads a set and checks it really is one.
 *
 * Every card goes through `parseCard` rather than trusting the shape. A
 * malformed set that reaches the browser fails as a blank page with a console
 * error, which is the least debuggable outcome available; failing here names
 * the file and the reason.
 */
export function readSetDocument(path: string, what: string): ResolveResult {
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
  if (typeof parsed !== 'object' || parsed === null || !('cards' in parsed)) {
    return failure(`${path} has no "cards" array, so it is not a set document`);
  }
  const { cards } = parsed as { cards: unknown };
  if (!Array.isArray(cards) || cards.length === 0) {
    return failure(`${path} has an empty "cards" array; generate a set with \`npm run slice\``);
  }
  try {
    for (const card of cards) parseCard(card);
  } catch (cause: unknown) {
    return failure(
      `${path} holds a card the DSL rejects (${cause instanceof Error ? cause.message : String(cause)}). ` +
        'Regenerate it with `npm run slice`.',
    );
  }
  return { ok: true, path, what, cardCount: cards.length, json: raw };
}

/**
 * The named set if there is one, otherwise the first candidate that exists.
 *
 * `exists` is injectable so the tests can describe a checkout without creating
 * one on disk.
 */
export function resolveSet(
  candidates: readonly SetCandidate[],
  explicit: string | undefined,
  options: {
    readonly cwd?: string;
    readonly exists?: (path: string) => boolean;
    readonly read?: (path: string, what: string) => ResolveResult;
  } = {},
): ResolveResult {
  const exists = options.exists ?? existsSync;
  const read = options.read ?? readSetDocument;

  if (explicit !== undefined) {
    const path = resolve(options.cwd ?? process.cwd(), explicit);
    if (!exists(path)) return failure(`no set at ${path}`);
    return read(path, 'the set you named');
  }
  for (const candidate of candidates) {
    if (exists(candidate.path)) return read(candidate.path, candidate.what);
  }
  return failure(
    'no set to play. Expected one of:\n' +
      candidates.map((candidate) => `  - ${candidate.path} (${candidate.what})`).join('\n') +
      '\nRun `npm run slice` to generate one, or pass a path: `npm run play -- <set.json>`.',
  );
}
