/**
 * A written deck, read: a precon's spells against the set that prints them.
 *
 * `mtg-c52t`. The second of the three screens `../DeckRoute.ts` held. It is a
 * separate screen from `./OpenDeckScreen.ts` rather than a mode of it because
 * its members are DSL cards rather than artifact entries: every grouping axis is
 * answerable, the face is `../../card/Card.ts`'s rather than a tile, and its
 * copy counts are printed in a file instead of chosen by a builder.
 */
import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import type { PreconFile } from '@mtg/deckbuild';
import { buildPrecon } from '@mtg/deckbuild';
import { Card } from '../../card/Card';
import type { CardArt } from '../../card/ArtSlot';
import { CLEAR_SELECTION_LABEL } from './ConstructedBuilder';
import { counted, deckCountsLine } from './DeckCard';
import { DeckPane, PANE_CARD_VIEWS, usePaneControls } from './DeckPane';
import { cardDensity } from './view-mode';
import { StripColumns } from './StripColumns';
import type { StripFaceGestures } from './StripColumns';
import { cardGroupingFacts, cardStripFacts } from './build';
import { groupMembers } from './grouping';
import type { Group, Grouping } from './grouping';
import { MAIN_DECK_LABEL } from './pane-names';
import { stripLabel } from './strips';
import type { Strip } from './strips';
import { preconFacts } from '../play/precon-facts';
import type { PositionArt } from '../play/position';

/** A precon's spell, paired with the card the staged set prints for it. */
interface PreconEntry {
  readonly card: DslCard;
  readonly count: number;
}

/**
 * A written deck's spells, grouped into an ascending mana curve.
 *
 * The grouping, the sort and the sum above each column are `./columns.ts`'s
 * (`mtg-xzxs`): this was the third hand-written copy of that rule, after the
 * Constructed builder's and the artifact pane's, and a third copy is a third
 * chance for the number above a column to stop meaning cards. The land rule is
 * `./build.ts`'s `cardManaValue` for the same reason — a land has no mana
 * cost at all rather than a cost of nothing, and this file derived that zero a
 * second time.
 *
 * What is left here is the part that is genuinely this pane's: a precon names
 * its spells by id and carries the count beside the id, so the pair has to be
 * assembled against the staged set before anything can be grouped. A spell the
 * set does not print is dropped rather than drawn, which is what `buildPrecon`
 * does with it one line below.
 */
function preconCardGroups(
  deck: PreconFile['decks'][number],
  cards: readonly DslCard[],
  grouping: Grouping,
): readonly Group<PreconEntry>[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const entries: PreconEntry[] = [];
  for (const entry of deck.spells) {
    const card = byId.get(entry.id);
    if (card === undefined) continue;
    entries.push({ card, count: entry.count });
  }
  return groupMembers(
    entries,
    (entry) => cardGroupingFacts(entry.card),
    (entry) => entry.count,
    grouping,
  );
}

/**
 * What is selected in a written deck's pane: the copy, and the card it is a copy of.
 *
 * A precon pane reads a deck nobody can edit here, so the bar carries no move --
 * `./ConstructedBuilder.ts`'s carries *Add another* and *Cut this one*
 * because that pane's copy counts are a thing a person changes, and this one's
 * are printed. What is left is the reason a reader clicked a 26px name bar at
 * all: the whole card, drawn once, above the columns rather than over the two
 * strips under the one they picked.
 */
function PreconSelectionBar(props: {
  readonly strip: Strip<PreconEntry>;
  readonly art: CardArt | null;
  readonly onClear: () => void;
}): ReactElement {
  const { card, count } = props.strip.member;
  return createElement(
    'div',
    {
      className: 'mtg-deck__selection',
      role: 'group',
      'aria-label': `Selected: ${stripLabel(props.strip)}`,
    },
    createElement('span', { className: 'mtg-deck__selection-name' }, stripLabel(props.strip)),
    createElement(
      'button',
      { type: 'button', className: 'mtg-btn', onClick: props.onClear },
      CLEAR_SELECTION_LABEL,
    ),
    createElement(Card, {
      card,
      size: 'full',
      art: props.art,
      footnote: `${String(count)} ${count === 1 ? 'copy' : 'copies'}`,
    }),
  );
}
export function PreconDeckView(props: {
  readonly deck: PreconFile['decks'][number];
  readonly cards: readonly DslCard[];
  readonly artFor?: PositionArt;
}): ReactElement {
  // A precon's members are DSL cards, so every axis is answerable and the
  // default list is offered flat.
  const controls = usePaneControls(`precon-${props.deck.id}`, undefined, PANE_CARD_VIEWS);
  const view = controls.view;
  const facts = preconFacts(props.deck, props.cards);
  const built = buildPrecon(props.deck, props.cards);
  const noncreatures = facts.spells - facts.creatures;
  const groups = preconCardGroups(props.deck, props.cards, controls.grouping.grouping);
  // Transient and per pane, for `DeckSection`'s reason: it is which copy you are
  // looking at, and a reload that remembered it would reopen the deck with a
  // card outlined for no reason a reader could recall.
  const [selected, setSelected] = useState<Strip<PreconEntry> | null>(null);
  // Both densities since `mtg-rgc.21`: the columns are the arrangement and the
  // view control chooses how dense they are drawn, so a written deck reads as a
  // curve whichever one is on.
  const columns = true;
  return createElement(
    'div',
    { className: 'mtg-deck' },
    createElement(
      DeckPane,
      {
        kind: 'deck',
        // What the pane holds, not what the deck is called: `deckScreen` puts
        // the deck's name at the head of the route, and a pane repeating it
        // printed the name twice on one screen. Titled the way the artifact
        // deck's pane is, so two kinds of deck read the same.
        label: MAIN_DECK_LABEL,
        title: `${MAIN_DECK_LABEL}: ${String(built.deck.length)}`,
        note: deckCountsLine([
          counted(facts.creatures, 'creature'),
          counted(noncreatures, 'noncreature spell'),
          counted(facts.lands, 'land'),
        ]),
        controls,
        above:
          columns && selected !== null
            ? createElement(PreconSelectionBar, {
                strip: selected,
                art: props.artFor?.(selected.member.card) ?? null,
                onClear: () => {
                  setSelected(null);
                },
              })
            : null,
      },
      // Under the deck's own name, not above it. The library shelves sit on this
      // page too, so a plan drawn before the section heading was a paragraph
      // about a deck that had not been named yet: the shipped page put "Curve
      // out with tramplers…" directly beneath "No saved decks yet.", where it
      // read as a note about the empty shelf.
      createElement('p', { className: 'mtg-deck__plan' }, props.deck.plan),
      // A deck, drawn the way every other deck pane on the site draws one.
      // `mtg-pmpu.1` settled that out of the 2026-08-29 captures and moved the
      // built artifact's pane and the Constructed builder's onto
      // `./StripColumns.ts`; this pane kept a column of faces per mana
      // value, so a written deck from a generated set was the one deck in the
      // lab organized a different way from the rest. Whether the cards are a
      // store printing or a card this project authored is not a reason for the
      // deck they are in to be drawn differently.
      createElement(StripColumns<PreconEntry>, {
        groups,
        factsOf: (entry: PreconEntry) => cardStripFacts(entry.card, entry.card.id, entry.count),
        density: cardDensity(view.mode),
        selectedKey: selected?.key,
        onSelect: setSelected,
        label: `${props.deck.name} cards`,
        // Only the full density draws anything here: at full every strip is a
        // whole face and the one that is open shows all of it, and a compact
        // column is name bars all the way down (`mtg-mxkrk`).
        renderFace: (entry: PreconEntry, gestures: StripFaceGestures) =>
          createElement(Card, {
            card: entry.card,
            size: 'full',
            deferArt: true,
            art: props.artFor?.(entry.card) ?? null,
            selected: gestures.selected,
            // The copies this deck plays, which the compact column says with
            // its strips and a face has no other way to say.
            footnote: `${String(entry.count)} ${entry.count === 1 ? 'copy' : 'copies'}`,
            onSelect: gestures.onSelect,
          }),
      }),
      createElement(
        'p',
        { className: 'mtg-deck__pane-note' },
        `${String(built.deck.length)} cards total. Basic lands: ${Object.entries(props.deck.basics)
          .filter((entry): entry is [string, number] => entry[1] !== undefined && entry[1] > 0)
          .map(([color, count]) => `${color} ${String(count)}`)
          .join(' · ')}`,
      ),
    ),
  );
}
