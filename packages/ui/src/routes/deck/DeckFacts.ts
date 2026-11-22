/**
 * The deck's own numbers, above the cards, recomputed as the cards change.
 *
 * `mtg-ipse`. A built artifact prints `totalCards`, `priceUsd` and a curve, and
 * the moment a copy is cut those three become claims about a deck nobody is
 * looking at any more. So they are drawn from `./artifact-edit.ts`'s
 * recomputation rather than read out of the document, and the document's own
 * figures are reproduced exactly while nothing has been edited -- which is the
 * first thing `../../../test/deck/artifact-edit.test.ts` asserts, because a line
 * that disagreed with the file on the unedited deck would print two numbers for
 * one deck.
 *
 * # The one move that is missing says so
 *
 * Everything a person does to a deck here is arithmetic over entries the file
 * carries. Adding a card the deck never contained is not: it needs the
 * 38,623-card store, which is `better-sqlite3` and about 656 MB and is not
 * something a browser has. The button is therefore drawn and disabled with the
 * reason beside it rather than left out. A move that is quietly absent reads as
 * a page that does not do that; a move that is present and dark with a sentence
 * under it reads as a page that knows what it cannot reach, and it is the same
 * two rows either way.
 *
 * # The evidence does not follow the numbers
 *
 * The prompt, the criteria, each card's reason and the castability bands are
 * the record of one build. They are not recomputed here and could not be: they
 * are a model's judgment over the deck it was asked for, and re-deriving them
 * from a person's cuts would be this codebase writing the reasoning it delegates
 * (`patterns.md`'s ZFC line). What the page does instead is label them, with
 * `BUILT_EVIDENCE_NOTE`, the moment a count moves.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { CURVE_BUCKETS } from '@mtg/deckbuild';
import type { DeckArtifact } from '../../lab/deck-artifact';
import { BUILT_DECK, deckFacts, isEdited } from './artifact-edit';
import type { DeckEdit, DeckFactsValue } from './artifact-edit';

/** What the numbers line is called, for a reader steering the page by name. */
export const DECK_FACTS_LABEL = 'This deck by the numbers';

/** The one move an artifact deck cannot make, drawn and refused. */
export const ADD_CARD_LABEL = 'Add a card';

export const ADD_CARD_REASON =
  'Adding a card this deck never contained needs the card store, which this page does not carry. Every other move is arithmetic over the cards already in the document.';

/** Printed at the top of the details panel once any count has moved. */
export const BUILT_EVIDENCE_NOTE =
  "The plan, the criteria, each card's reason and the castability bands below describe the deck as it was built. They are the record of that build and are not recomputed as you edit.";

/** Said beside the built figures, because nothing here is written anywhere. */
export const EDIT_NOT_KEPT_NOTE =
  'The built document is unchanged, and this edit is not kept when the page is reloaded.';

/**
 * The figures, in the order the line prints them.
 *
 * The curve is printed as text rather than drawn as a bar chart because it has
 * one row to sit in: `mtg-z4q6` moved this page's prose behind a disclosure
 * precisely so the columns start higher, and a chart above them would spend what
 * that bought. The compact pane grouped by mana value already draws the curve at
 * full size; this is the version that survives the reader grouping by color.
 */
function factsPhrases(facts: DeckFactsValue): readonly string[] {
  const buckets = CURVE_BUCKETS.filter((bucket) => facts.histogram[bucket] > 0);
  return [
    `${String(facts.cards)} cards`,
    `$${facts.priceUsd.toFixed(2)}`,
    `average mana value ${facts.averageManaValue.toFixed(2)}`,
    `curve ${buckets.map((bucket) => `${String(bucket)}: ${String(facts.histogram[bucket])}`).join(', ')}`,
    facts.colors.map((spread) => `${spread.color} ${String(spread.cards)}`).join(', '),
  ];
}

function factsLine(facts: DeckFactsValue): string {
  return factsPhrases(facts).join(' · ');
}

/**
 * The deck's live numbers, and the move it has to refuse.
 *
 * Only the **main deck** is described here, which is what the built document
 * describes with these three fields as well: a sideboard's own edit moves the
 * count in its pane's heading and nothing on this line.
 */
export function DeckFacts(props: { readonly deck: DeckArtifact; readonly edit: DeckEdit }): ReactElement {
  const facts = deckFacts(props.deck, props.edit);
  const edited = isEdited(props.edit);
  return createElement(
    'div',
    { className: 'mtg-deck__facts', role: 'group', 'aria-label': DECK_FACTS_LABEL },
    createElement('span', { className: 'mtg-deck__facts-line' }, factsLine(facts)),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        disabled: true,
        'aria-describedby': 'mtg-deck-add-reason',
      },
      ADD_CARD_LABEL,
    ),
    createElement('p', { className: 'mtg-deck__facts-reason', id: 'mtg-deck-add-reason' }, ADD_CARD_REASON),
    !edited
      ? null
      : createElement(
          'p',
          { className: 'mtg-deck__facts-built' },
          `Built as ${factsLine(deckFacts(props.deck, BUILT_DECK))}. ${EDIT_NOT_KEPT_NOTE}`,
        ),
  );
}
