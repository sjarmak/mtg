/**
 * Finding the preconstructed decks that belong to the set being played.
 *
 * A precon file names card ids. The set document it was cut from is staged
 * separately, and both of them carry the same three-letter code, so "same set
 * code" is not a check — two builds of one set at different sizes share it and
 * share almost no ids. What actually decides the pairing is whether the set
 * prints every card the file names, so that is the rule: **all of them or the
 * file is not a candidate.** An art manifest can cover most of a set and still
 * be the right manifest, because a card without a picture draws a pending frame
 * and the game goes on; a deck list without a card deals a 59-card deck, which
 * is a different deck from the one somebody wrote.
 *
 * Nothing here builds a deck or reads a rule. `@mtg/deckbuild` owns the schema
 * and `buildPrecon` owns the construction; this decides which file to copy.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePreconFile, PreconError } from '@mtg/deckbuild';
import type { PreconFile } from '@mtg/deckbuild';

export const PRECON_FILENAME = 'precons.json';

/** Files a precon document is looked for in, best first. */
export interface PreconCandidate {
  readonly path: string;
  /** Human phrase for where this came from, used in the launcher's line. */
  readonly what: string;
}

export interface ChosenPrecons {
  readonly candidate: PreconCandidate;
  readonly file: PreconFile;
  readonly json: string;
}

/** Why a candidate was passed over. Kept so the launcher can say what it found. */
export interface RejectedPrecons {
  readonly candidate: PreconCandidate;
  readonly why: string;
}

export interface PreconSearch {
  readonly chosen: ChosenPrecons | null;
  readonly rejected: readonly RejectedPrecons[];
}

/**
 * Where a precon file is looked for, given the set document being staged.
 *
 * Beside the set first, because a generated run that carries its own decks has
 * said which set they belong to by putting them there. Then the committed
 * fixtures, sorted so two checkouts search in the same order.
 */
export function preconCandidatesFor(setPath: string, repoRoot: string): readonly PreconCandidate[] {
  const beside = join(setPath, '..', PRECON_FILENAME);
  const fixtures = join(repoRoot, 'packages', 'setgen', 'fixtures', 'decks');
  const committed = existsSync(fixtures)
    ? readdirSync(fixtures)
        .filter((name) => name.endsWith('.precons.json'))
        .sort()
        .map((name) => ({ path: join(fixtures, name), what: `the committed ${name}` }))
    : [];
  return [{ path: beside, what: 'a precon file beside the set' }, ...committed];
}

/**
 * The first candidate whose every card id this set prints.
 *
 * A candidate that is on disk and does not resolve is *rejected with a reason*
 * rather than skipped silently: the likeliest cause is a file written against
 * an older build of the same set, and a launcher that said nothing would leave
 * somebody looking for decks that never appear.
 */
export function choosePreconFile(
  candidates: readonly PreconCandidate[],
  cardIds: readonly string[],
  options: { readonly read?: (path: string) => string | null } = {},
): PreconSearch {
  const read = options.read ?? defaultRead;
  const printed = new Set(cardIds);
  const rejected: RejectedPrecons[] = [];
  for (const candidate of candidates) {
    const json = read(candidate.path);
    if (json === null) continue;
    let file: PreconFile;
    try {
      file = parsePreconFile(JSON.parse(json));
    } catch (cause: unknown) {
      const why = cause instanceof PreconError ? cause.message : `not a precon document (${String(cause)})`;
      rejected.push({ candidate, why });
      continue;
    }
    const missing = file.decks.flatMap((deck) =>
      deck.spells.filter((entry) => !printed.has(entry.id)).map((entry) => entry.id),
    );
    if (missing.length > 0) {
      const shown = [...new Set(missing)].slice(0, 4).join(', ');
      rejected.push({
        candidate,
        why: `names ${String(new Set(missing).size)} card(s) this set does not print (${shown})`,
      });
      continue;
    }
    return { chosen: { candidate, file, json }, rejected };
  }
  return { chosen: null, rejected };
}

function defaultRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** One line for the launcher's stdout, whatever the search found. */
export function describePrecons(search: PreconSearch): string {
  const notes = search.rejected.map((entry) => `  - ${entry.candidate.path}: ${entry.why}`);
  if (search.chosen === null) {
    const head =
      'No preconstructed decks match this set, so the Play tab opens a sealed pool. ' +
      'Write a list into packages/setgen/fixtures/decks/ to add some.';
    return notes.length === 0 ? head : `${head}\n${notes.join('\n')}`;
  }
  const { chosen } = search;
  const names = chosen.file.decks.map((deck) => deck.name).join(', ');
  const head = `Staged ${String(chosen.file.decks.length)} preconstructed decks from ${chosen.candidate.what}: ${names}.`;
  return notes.length === 0 ? head : `${head}\n${notes.join('\n')}`;
}
