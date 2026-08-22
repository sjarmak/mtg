/**
 * Which set `npm run play` opens, and why that is the flagship.
 *
 * Split out of `play.ts` so it can be imported and tested. `play.ts` calls
 * `main()` at module scope, so importing it to read one constant starts Vite —
 * which is not a hypothetical, it happened while checking this very list.
 *
 * The flagship leads at every tier. Tideglass Reach was the prototype built to
 * get the pipeline working before the flagship set existed, and it stayed the
 * launcher's default long after it stopped being the set anybody wanted to
 * play. It is still the fixture most of the test suite reads, which is the job
 * it is good at; it is no longer what the lab reaches for.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SetCandidate } from './resolve-set';

/** The flagship's set code, as `@mtg/setgen` stamps it onto the document. */
export const FLAGSHIP_CODE = 'TGR';

/** The brief the flagship is generated from, relative to the repository root. */
export const FLAGSHIP_BRIEF = join('packages', 'setgen', 'briefs', 'tideglass-reach.json');

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/**
 * True when a set document is the flagship.
 *
 * Ordering alone could not make the flagship the default. `out/slice/set/set.json`
 * is whatever the last `npm run slice` built, and a slice of the prototype
 * outranked every flagship set build on disk. Demoting the slice tier outright
 * would be wrong in the other direction — a fresh slice of the flagship is
 * exactly what somebody wants to see — so the tier is kept and qualified.
 *
 * Unreadable is false rather than thrown: this only decides which of several
 * candidates to prefer, and `resolveSet` is what reports a broken document.
 */
export function isFlagshipSet(json: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || !('set' in parsed)) return false;
  const { set } = parsed as { set: unknown };
  if (typeof set !== 'object' || set === null || !('code' in set)) return false;
  const { code } = set as { code: unknown };
  return code === FLAGSHIP_CODE;
}

/**
 * The card ids the flagship brief hands the pipeline already written.
 *
 * `authoredCards` is the brief's second vocabulary: finished DSL cards the
 * generator is deliberately unable to write, carried through untouched and
 * appended after the generated ones. Read from the brief rather than listed
 * here, so a fifth authored card is qualified by adding it to the brief and
 * nothing else.
 *
 * An unreadable or shapeless brief gives an empty list rather than a throw, for
 * the same reason `isFlagshipSet` returns false: this decides which of several
 * candidates to prefer, and an empty list makes the qualifier a no-op instead of
 * turning a launcher into a crash. A brief with no authored cards, which is
 * every other brief in the tree, gives the same empty list and the same no-op.
 */
export function authoredCardIds(repoRoot: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(repoRoot, FLAGSHIP_BRIEF), 'utf8'));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || !('authoredCards' in parsed)) return [];
  const { authoredCards } = parsed as { authoredCards: unknown };
  if (!Array.isArray(authoredCards)) return [];
  return authoredCards.flatMap((card: unknown) =>
    typeof card === 'object' &&
    card !== null &&
    'id' in card &&
    typeof (card as { id: unknown }).id === 'string'
      ? [(card as { id: string }).id]
      : [],
  );
}

/**
 * True when a set document prints every card the brief authored.
 *
 * A build of the flagship that is missing them is not the flagship set, it is a
 * build that predates them. `out/XMP/set.json` is exactly that today: the raw
 * output of the one paid generation run, written before `authoredCards`
 * existed, so it holds the 249 cards the model wrote and none of the four the
 * brief carries. Ranking the committed fixture above it would fix that by
 * encoding today's staleness into the order, and would be wrong the morning
 * after the next run of the fixed brief, which produces all of them.
 *
 * Qualifying by content is the move the file already makes for the set code and
 * for the same reason: position cannot know what is in a file.
 *
 * The cost is honest and small. It parses each candidate one extra time, over
 * documents the launcher is about to parse anyway, and it reads the brief once
 * per resolution. Unreadable is true rather than thrown, so a document nobody
 * can parse stays a candidate and `resolveSet` remains the one place that says a
 * set is missing or broken.
 */
export function hasAuthoredCards(json: string, ids: readonly string[]): boolean {
  if (ids.length === 0) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return true;
  }
  if (typeof parsed !== 'object' || parsed === null || !('cards' in parsed)) return true;
  const { cards } = parsed as { cards: unknown };
  if (!Array.isArray(cards)) return true;
  const printed = new Set(
    cards.flatMap((card: unknown) =>
      typeof card === 'object' &&
      card !== null &&
      'id' in card &&
      typeof (card as { id: unknown }).id === 'string'
        ? [(card as { id: string }).id]
        : [],
    ),
  );
  return ids.every((id) => printed.has(id));
}

/**
 * Drops a candidate that is on disk but is not the flagship as the brief states
 * it: some other set, or a build of this one that predates its authored cards.
 *
 * Only `out/slice/set/set.json` can be some other set; the other two are the
 * flagship by construction. A slice of the prototype used to outrank every
 * flagship set build here, which is how the lab kept opening the wrong set.
 *
 * A candidate that cannot be read is kept, so `resolveSet` stays the one place
 * that decides a document is missing or broken and says so by name. It lives
 * here rather than in `play.ts` because `play.ts` calls `main()` at module
 * scope: `netplay.ts` imported this function from there and started the whole
 * play launcher, Vite included, on its way to filtering a list.
 */
export function flagshipOnly(
  candidates: readonly SetCandidate[],
  ids: readonly string[] = authoredCardIds(REPO_ROOT),
): readonly SetCandidate[] {
  return candidates.filter((candidate) => {
    let json: string;
    try {
      json = readFileSync(candidate.path, 'utf8');
    } catch {
      return true;
    }
    return isFlagshipSet(json) && hasAuthoredCards(json, ids);
  });
}

/**
 * The reduced reference builds, which are sets the lab can open and nothing else
 * on this list is.
 *
 * `npm run reference:reduced -- --out out/reference` writes one directory per
 * printing, and `out/reference` is the path this repository's own docs and that
 * command's own worked example name. The flag has no default and deliberately —
 * a run that quietly overwrote a previous emission is what it exists to prevent
 * — so the launcher cannot know where somebody else pointed it, and it looks in
 * the conventional place rather than guessing.
 *
 * These are candidates for the *picker*, never for the default: `flagshipOnly`
 * drops every one of them, because M11 is not the flagship. That is the whole
 * change of role the filter went through. It used to discard what it dropped;
 * now it only decides which set the page opens on.
 *
 * Tolerant of the directory not existing, which is every checkout that has not
 * run the command.
 */
export function referenceSetCandidates(repoRoot: string): readonly SetCandidate[] {
  const root = join(repoRoot, 'out', 'reference');
  let names: readonly string[];
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(root, name, 'set.json');
    return existsSync(path)
      ? [{ path, what: `the reduced reference build in ${join('out', 'reference', name)}` }]
      : [];
  });
}

/** Where a set is looked for, best first. */
export function setCandidates(repoRoot: string): readonly SetCandidate[] {
  return [
    {
      path: join(repoRoot, 'out', 'TGR', 'set.json'),
      what: 'the most recent `setgen` run of the flagship brief',
    },
    {
      path: join(repoRoot, 'out', 'slice', 'set', 'set.json'),
      what: 'the most recent `npm run slice` run',
    },
    {
      path: join(repoRoot, 'packages', 'setgen', 'fixtures', 'sets', 'tideglass-reach.set.json'),
      what: 'the committed example set',
    },
  ];
}

/** The list `play.ts` uses, and the one the tests read. */
export const SET_CANDIDATES: readonly SetCandidate[] = setCandidates(REPO_ROOT);

/**
 * Every set worth *staging*, which is a longer list than every set worth opening.
 *
 * The two were the same list for as long as the launcher staged one set. They
 * are not the same question: `SET_CANDIDATES` ranks the places a set the
 * launcher would open on its own can be, and a reduced reference build is never
 * one of those — `flagshipOnly` drops it, and rightly. But it is a set somebody
 * wants to compare the flagship against one click later, which is what the
 * picker is for. So the reference builds are appended here and nowhere else,
 * and `SET_CANDIDATES` keeps meaning what every caller of `resolveSet` already
 * reads it as.
 */
export const LIBRARY_CANDIDATES: readonly SetCandidate[] = [
  ...SET_CANDIDATES,
  ...referenceSetCandidates(REPO_ROOT),
];
