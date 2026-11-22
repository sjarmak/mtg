/**
 * Telling same-named printings apart by the keywords a permanent has right now
 * (`mtg-oin1f`).
 *
 * Forge names the 1/1 lifelink Vampire of Dark Ascension and the 2/2 flying
 * Vampire of Innistrad the same thing, and they are two different cards; colors
 * do not separate them and power and toughness move with pumps and counters. The
 * keywords the backend projects (`ObjectView.keywords`) are the fact that does:
 * each printing's rules text states which it prints, and a token is one of them
 * for as long as it has those.
 *
 * Two things keep this from guessing. The comparison runs over a closed
 * vocabulary (the keywords the DSL can name), so a line of rules text this file
 * cannot read is left out of *both* sides rather than counted against a
 * printing. And a keyword granted or stripped after the token was made can
 * leave no printing that matches, or several, and either way the caller draws
 * the labeled pending frame rather than a card the token may not be.
 */
import { GRANTABLE_KEYWORD_PRINT_NAMES } from '@mtg/dsl';
import type { ObjectView } from '@mtg/engine';
import type { PrintedCardPresentation } from './printed-card-art';

const VOCABULARY: ReadonlySet<string> = new Set(Object.values(GRANTABLE_KEYWORD_PRINT_NAMES));

/**
 * The vocabulary keywords a printing's rules text states, lowercase. Reminder
 * text is dropped, and only a whole comma- or line-separated fragment counts, so
 * "Creatures you control have flying." states none.
 */
export function printedKeywordsOf(card: Pick<PrintedCardPresentation, 'faces'>): ReadonlySet<string> {
  const stated = new Set<string>();
  for (const face of card.faces) {
    const text = (face.oracleText ?? '').replace(/\([^)]*\)/gu, '');
    for (const fragment of text.split(/[\n,]/u)) {
      const word = fragment.trim().toLowerCase();
      if (VOCABULARY.has(word)) stated.add(word);
    }
  }
  return stated;
}

function sameKeywords(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((keyword) => right.has(keyword));
}

/**
 * The candidates whose printed keywords are the ones the object has, or, when
 * none is exactly that, the ones whose printed keywords it still has (a token
 * that gained a keyword still has all it printed). Returns every candidate
 * unchanged when the backend reports no keywords for the object or nothing
 * fits, so a caller that reads a single survivor as the answer reads "cannot
 * tell" for anything but one match.
 */
export function narrowByKeywords(
  object: Pick<ObjectView, 'keywords'>,
  candidates: readonly PrintedCardPresentation[],
): readonly PrintedCardPresentation[] {
  if (object.keywords === undefined) return candidates;
  const current = new Set(object.keywords.filter((keyword) => VOCABULARY.has(keyword)));
  const printed = candidates.map((candidate) => ({ candidate, keywords: printedKeywordsOf(candidate) }));
  const exact = printed.filter((entry) => sameKeywords(entry.keywords, current));
  if (exact.length > 0) return exact.map((entry) => entry.candidate);
  const kept = printed.filter((entry) => [...entry.keywords].every((keyword) => current.has(keyword)));
  return kept.length > 0 ? kept.map((entry) => entry.candidate) : candidates;
}
