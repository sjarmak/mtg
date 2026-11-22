/**
 * The Decks section of the Cards tab: every deck the lab has, drawn to be
 * looked at, each with the one way into opening it.
 *
 * `mtg-a982g.1` built this as the workbench's own shelf — the decks a person
 * had described to the model, read the same way `../deck/use-shelf.ts` reads
 * them for Customize's Decks section. `mtg-aay2k` widens it: a precon written
 * beside the staged set, `@mtg/decklab`'s artifact built from the card store,
 * and a deck saved in this browser are decks too, and a gallery that shows
 * only the fourth kind is not the list its own heading claims. The four kinds
 * are the same four `../deck/DeckLibrary.ts` shelves, read the same way, so
 * the two sections cannot disagree about which decks exist.
 *
 * # A link, not a button
 *
 * A tile here is an anchor rather than a button, because what pressing it does
 * is go somewhere: Customize's Decks section, open on that one deck, which
 * `../deck/open.ts` already states a request for regardless of which of the
 * four kinds the deck is. A real anchor opens in a second tab and can be sent
 * to the other person on the LAN, which is not true of a button with an
 * `onClick`.
 *
 * # What a tile does not say
 *
 * No plan, no prompt, no archetype sentence — `mtg-aay2k`'s acceptance
 * criteria drops the description a tile used to carry, because a gallery of
 * four kinds does not have one shared sentence to show and a workbench
 * variation's prompt run to 396 characters the one time it was measured
 * (`../../styles/deck-card.ts`). What is left is what every kind can state
 * truthfully: a name, where its cards come from, how many there are, and
 * what colors it plays.
 */
import { createElement, useMemo } from 'react';
import type { ReactElement } from 'react';
import { routeHash } from '../../app/router';
import {
  counted,
  DECK_CARD_GRID_CLASS,
  DECK_CARD_KIND_LABELS,
  deckColorPips,
  deckCountsLine,
} from '../deck/DeckCard';
import type { DeckCardKind } from '../deck/DeckCard';
import { DECK_OPEN_PARAM, deckOpenParam } from '../deck/open';
import type { DeckOpen } from '../deck/open';
import type { DeckRouteProps } from '../deck/route-state';
import { savedCardCount, savedDeckColors } from '../deck/saved-decks';
import { useDeckKeeping } from '../deck/deck-keeping';
import { useShelf } from '../deck/use-shelf';
import { preconFacts } from '../play/precon-facts';

/** What this section is handed: the same route props `../DeckRoute.ts` reads, minus the ones a read-only gallery has no use for. */
export type DeckGalleryProps = Pick<DeckRouteProps, 'state' | 'precons' | 'cards' | 'set'>;

/** The section's heading. */
export const DECK_GALLERY_TITLE = 'Decks';

/** The accessible name of the grid, which is what a screen reader finds it by. */
export const DECK_GALLERY_LABEL = 'All decks';

/**
 * What the section says when nothing has a deck to show.
 *
 * The ordinary state of a lab started with `npm run play` before anyone has
 * built or saved anything: no precons file ships with every set, the
 * decklab artifact is staged only after `npm run lab`, and nothing is saved
 * on a fresh browser. The sentence names where the other two entry points
 * are — Customize's Decks section — rather than apologizing for a shelf with
 * nothing on it.
 */
export const DECK_GALLERY_EMPTY_NOTE =
  'No decks yet. Open the Customize tab to build one or describe one to the workbench.';

/** What a tile says when nothing recorded which set its cards come from. */
const DECK_GALLERY_NO_SET_LABEL = 'not from a staged set';

/** The accessible name of a tile: what pressing it does. */
export function deckGalleryTileLabel(name: string): string {
  return `Open ${name}`;
}

/** Where a tile leads: Customize's Decks section, open on this deck. */
export function deckGalleryTileHref(open: DeckOpen): string {
  return routeHash({
    mode: 'customize',
    sub: 'decks',
    params: { [DECK_OPEN_PARAM]: deckOpenParam(open) },
  });
}

/**
 * One deck, ready to draw: what every kind can state about itself in common,
 * regardless of where the deck came from or how its own record shapes that.
 */
interface GalleryRow {
  readonly key: string;
  readonly kind: DeckCardKind;
  readonly name: string;
  readonly colors: readonly string[];
  readonly totalCards: number;
  /** Empty when nothing recorded which set the cards come from. */
  readonly sets: readonly string[];
  readonly open: DeckOpen;
}

function tile(row: GalleryRow): ReactElement {
  return createElement(
    'a',
    {
      key: row.key,
      className: 'mtg-deckcard',
      'data-kind': row.kind,
      href: deckGalleryTileHref(row.open),
      'aria-label': deckGalleryTileLabel(row.name),
    },
    createElement(
      'span',
      { className: 'mtg-deckcard__head' },
      createElement('span', { className: 'mtg-deckcard__name' }, row.name),
      createElement('span', { className: 'mtg-deckcard__kind' }, DECK_CARD_KIND_LABELS[row.kind]),
      deckColorPips(row.colors),
    ),
    createElement(
      'span',
      { className: 'mtg-deckcard__counts' },
      deckCountsLine([
        counted(row.totalCards, 'card'),
        row.sets.length === 0 ? DECK_GALLERY_NO_SET_LABEL : row.sets.join(', '),
      ]),
    ),
  );
}

export function DeckGallery(props: DeckGalleryProps): ReactElement {
  const { variations } = useShelf();
  const saved = useDeckKeeping().decks;
  const cards = props.cards;
  const preconDecks = props.precons?.status === 'ready' ? props.precons.file.decks : [];
  const setName = props.set?.name;
  const deckState = props.state;

  // Recomputed only when the inputs that feed a row change, rather than on
  // every render: `preconFacts` resolves each precon's spells against the
  // staged set, which is the same cost `../deck/DeckLibrary.ts` avoids the
  // same way.
  const rows: readonly GalleryRow[] = useMemo(() => {
    const preconRows: readonly GalleryRow[] =
      cards === undefined
        ? []
        : preconDecks.map((deck) => {
            const facts = preconFacts(deck, cards);
            return {
              key: `precon:${deck.id}`,
              kind: 'precon',
              name: deck.name,
              colors: facts.colors,
              totalCards: facts.spells + facts.lands,
              sets: setName === undefined ? [] : [setName],
              open: { kind: 'precon', id: deck.id },
            };
          });
    const artifactRows: readonly GalleryRow[] =
      deckState.status === 'ready'
        ? [
            {
              key: 'artifact',
              kind: 'artifact',
              name: deckState.deck.prompt,
              colors: deckState.deck.colors,
              totalCards: deckState.deck.totalCards,
              // Cut from the 38,623-card store rather than from a staged set,
              // so there is no set to name; the format it was built for is the
              // nearest fact about where its cards come from, the same one
              // `../deck/DeckLibrary.ts` shows beside its card count.
              sets: [deckState.deck.format],
              open: { kind: 'artifact' },
            },
          ]
        : [];
    const variationRows: readonly GalleryRow[] = variations.map((row) => ({
      key: `variation:${row.id}`,
      kind: 'variation',
      name: row.name,
      colors: row.colors,
      totalCards: row.totalCards,
      sets: row.sets,
      open: { kind: 'variation', id: row.id },
    }));
    const savedRows: readonly GalleryRow[] = saved.map((deck) => ({
      key: `saved:${deck.id}`,
      kind: 'saved',
      name: deck.name,
      colors: savedDeckColors(deck, cards),
      totalCards: savedCardCount(deck),
      sets: deck.set === undefined ? [] : [deck.set.name],
      open: { kind: 'build', savedId: deck.id },
    }));
    return [...preconRows, ...artifactRows, ...variationRows, ...savedRows];
  }, [cards, preconDecks, setName, deckState, variations, saved]);

  return createElement(
    'div',
    null,
    createElement(
      'div',
      { className: 'mtg-page-head' },
      createElement('h1', { className: 'mtg-page-title' }, DECK_GALLERY_TITLE),
    ),
    rows.length === 0
      ? createElement(
          'div',
          { className: 'mtg-empty' },
          createElement('span', { className: 'mtg-empty__body' }, DECK_GALLERY_EMPTY_NOTE),
        )
      : createElement(
          'div',
          { className: DECK_CARD_GRID_CLASS, role: 'group', 'aria-label': DECK_GALLERY_LABEL },
          ...rows.map(tile),
        ),
  );
}
