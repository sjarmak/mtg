/**
 * The positions a reduced build refused, on the page rather than on stdout.
 *
 * `npm run reference:reduced` prints every refusal it made and then writes a set
 * that looks like any other set. A person handed the URL of a server somebody
 * else started sees a gallery with holes in it and nothing that says where the
 * holes are, which is `mtg-f1b0`. The shell already says *that* the set is
 * reduced and which set it came from (`../../lab/reduced-notice.ts`); this is
 * the other half, the list of what is gone and why.
 *
 * # Why it hangs off the Cards route's own search
 *
 * The bead asks for the list to be searchable, and this route already owns a
 * search box over the cards that are here. Two search boxes on one page, one for
 * the cards and one for the ghosts of cards, is two controls a person has to
 * tell apart before either works. So the same query narrows both, and the same
 * rarity filter does: a reader who types "ajani" is asking the page about Ajani,
 * and the answer "not in this build, refused for a missing evidence row" is the
 * answer, not a different question.
 *
 * The other filters do not reach it, and that is a limit rather than an
 * oversight. A drop carries a rarity and a color list and nothing else that the
 * bar filters on: there is no mana value and no type line, because the card was
 * refused before anything derived them. Identity is left out for a narrower
 * reason — the bar's identities are `../../styles/tokens.ts`'s color-identity
 * strings derived from a DSL card, and a drop's `colors` come off the printing's
 * own record, so matching them would be two vocabularies agreeing by accident.
 *
 * # Shut by default
 *
 * Sixty-eight refusals is the reduced M13's number and it is a page of text
 * above the gallery somebody came for. A `<details>` states the count in its
 * summary, which is the part everybody needs, and opens to the reasons, which is
 * the part one reader in ten wants. It stays shut across a search rather than
 * springing open, because a control that opens itself while you are typing moves
 * the thing you are reading.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { Rarity } from '@mtg/dsl';
import type { ReductionDrop, SetReduction } from '../../lab/reduced-notice';

/** The disclosure's id, so a test and a future control can both name it. */
export const MISSING_CARDS_ID = 'mtg-cards-missing';

/** What the summary says when nothing narrows the list. */
export function missingCardsSummary(reduction: SetReduction): string {
  return `${String(reduction.dropped)} cards ${reduction.sourceName} prints that this build does not`;
}

/** Everything about a refusal a typed word could reasonably mean. */
function haystack(drop: ReductionDrop): string {
  return [String(drop.collectorNumber), drop.name, drop.rarity, drop.code, drop.detail, ...drop.colors]
    .join(' ')
    .toLowerCase();
}

function matchesDrop(drop: ReductionDrop, query: string, rarity: Rarity | null): boolean {
  if (rarity !== null && drop.rarity !== rarity) return false;
  return query === '' || haystack(drop).includes(query);
}

function dropRow(drop: ReductionDrop): ReactElement {
  return createElement(
    'li',
    { key: String(drop.collectorNumber), className: 'mtg-missing__row' },
    createElement(
      'span',
      { className: 'mtg-missing__name' },
      `${String(drop.collectorNumber)}. ${drop.name}`,
    ),
    createElement('span', { className: 'mtg-missing__meta' }, `${drop.rarity} · ${drop.code}`),
    createElement('span', { className: 'mtg-missing__why' }, drop.detail),
  );
}

/**
 * The disclosure, or `null` when there is nothing to disclose.
 *
 * `null` covers both the ordinary set, which carries no reduction at all, and
 * the reduced build that refused nothing — the reduced M11 is one, at 249 of 249
 * positions, and "0 cards Magic 2011 prints that this build does not" is a
 * control that opens onto an empty list.
 */
export function missingCards(
  reduction: SetReduction | null,
  query: string,
  rarity: Rarity | null,
): ReactElement | null {
  if (reduction === null || reduction.drops.length === 0) return null;
  const needle = query.trim().toLowerCase();
  const shown = reduction.drops.filter((drop) => matchesDrop(drop, needle, rarity));
  const narrowed = needle !== '' || rarity !== null;
  return createElement(
    'details',
    { className: 'mtg-missing', id: MISSING_CARDS_ID },
    createElement('summary', { className: 'mtg-missing__summary' }, missingCardsSummary(reduction)),
    createElement(
      'p',
      { className: 'mtg-page-note' },
      narrowed
        ? `${String(shown.length)} of ${String(reduction.dropped)} shown, narrowed by the search box and the rarity filter above.`
        : 'Each one was refused rather than approximated. Search or filter by rarity above to narrow this list too.',
    ),
    shown.length === 0
      ? createElement('p', { className: 'mtg-page-note' }, 'No refused card matches that.')
      : createElement('ul', { className: 'mtg-missing__list' }, ...shown.map(dropRow)),
  );
}
