/**
 * How densely one pane of the deck draws its cards, and the control that says so.
 *
 * The playtester, 2026-08-14: "in the deck building view there should be an option to
 * view the cards as either full or compact", and immediately after, "though
 * really that deck building view should match MTGO". The second sentence is what
 * decides the shape of the first. In `references/mtgo+interface+(1)-3169202701.png`
 * every pane carries its **own** Sort and View pair — the collection pool, the
 * main deck and the sideboard each have one in their own header bar — so the
 * setting is per pane rather than one switch over the page. That is not a
 * decoration of the ask; it is the reason the ask works. A person reading a deck
 * wants the spells small enough to see the whole curve and the four lands they
 * are still arguing about drawn large, and a single global switch cannot say
 * both.
 *
 * # What a compact pane is, and where that vocabulary comes from
 *
 * `../../card/anatomy.ts` already answers "what is a compact face" for a DSL
 * card: `COMPACT_REGIONS` is `title`, `type`, `footer` — a card-shaped shorthand
 * that drops the art window and the rules box. A deck tile is not a card face
 * (`./DeckTile.ts` records why it cannot be), but it has the same five regions
 * under different names, so compact here means the same subtraction: keep the
 * head that identifies the card and the type line, drop the picture and the
 * prose.
 *
 * It parts company with `COMPACT_REGIONS` on exactly one region, the footer, and
 * the reason is that the two footers hold different things. A compact *card*
 * face keeps its footer because that is where the power and toughness live, and
 * a permanent whose P/T is not on it is not readable at a glance. A deck tile's
 * foot holds the illustrator credit, the set code and the criteria ids — and the
 * credit is a fact about a picture this mode does not draw. Crediting an artist
 * whose work is not on the screen is worse than not crediting them, so the foot
 * goes with the art it belongs to.
 *
 * The inclusion reason goes too, and that is the one genuine loss. `./DeckTile.ts`
 * argues that a list which shows the cards but hides why each one is in it "is
 * just a decklist", and it is right. Compact *is* just a decklist. That is what
 * it is for and it is why full stays the default: the argument is the page's
 * whole reason to exist, and a person opts out of it deliberately, per pane, when
 * what they need at that moment is to see forty cards at once.
 *
 * # Why the preference is kept, and where
 *
 * `../play/rail-collapse.ts` settled this question for the played surface and the
 * answer carries: whether a panel is open is not a move, it is view state, it is
 * held by the view, and it is written to `localStorage` so it outlives a reload
 * the way a person expects a setting they chose to stay chosen. Nothing here
 * enters a deck artifact or changes a byte of what `npm run lab` staged.
 *
 * The store is reached through `./local-store.ts`, which runtime-checks it for
 * the two reasons that file records: the workspace tsconfig has no `lib: dom`,
 * and a page in a private window can *throw* from `setItem` rather than merely
 * declining. A store that cannot be read or written is not an error worth
 * surfacing here — the pane simply draws full, which is the state a first-ever
 * visit is in, so the write's failure report is deliberately dropped.
 *
 * That accessor used to be written out in this file, on the argument that two
 * copies of fifteen lines (the other being `../play/rail-collapse.ts`) is under
 * the rule of three. `./saved-decks.ts` was the third, so the two callers in this
 * directory now share one and the play surface keeps its own — hoisting a helper
 * out of `../play/` would put a deck-view change inside that surface's blast
 * radius for no behavior either one gains.
 */
import { createElement, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { readStored, writeStored } from './local-store';

/**
 * The two densities, and deliberately only two.
 *
 * MTGO's own View menu offers more than a pair, but every extra rung is a
 * decision the reader has to make before they can read anything, and the ask was
 * for two. A third mode is a bead, not a `| 'medium'` added here quietly.
 */
export const DECK_VIEW_MODES = ['full', 'compact'] as const;
export type DeckViewMode = (typeof DECK_VIEW_MODES)[number];

/** What each mode is called on its button. Sentence case, as MTGO draws it. */
export const DECK_VIEW_LABELS: Readonly<Record<DeckViewMode, string>> = {
  full: 'Full cards',
  compact: 'Compact list',
};

/**
 * What the control is called.
 *
 * `View` is MTGO's own word for this dropdown, and using it means a person who
 * knows that client already knows what this is. The pane's name goes on the
 * group rather than into the word, so a screen reader reads "Spells, View" and
 * not two controls both called View.
 */
export const DECK_VIEW_LABEL = 'View';

/** The mode a pane draws before anybody has said otherwise. See the docblock. */
export const DEFAULT_DECK_VIEW_MODE: DeckViewMode = 'full';

/** Where a pane's preference is kept, namespaced so it cannot collide with a lane's. */
export function deckViewStoreKey(pane: string): string {
  return `mtg.deck.view.${pane}`;
}

function isMode(value: string | null): value is DeckViewMode {
  return value !== null && (DECK_VIEW_MODES as readonly string[]).includes(value);
}

/**
 * The stored preference for one pane, or the default.
 *
 * A stored value that is not one of the two modes is treated as nothing stored
 * rather than as an error. The only ways to get one are a hand-edited store or a
 * build that used to spell a mode differently, and in both cases the honest
 * response is the state a first visit is in.
 */
export function readDeckViewMode(pane: string): DeckViewMode {
  const found = readStored(deckViewStoreKey(pane));
  return isMode(found) ? found : DEFAULT_DECK_VIEW_MODE;
}

function writeDeckViewMode(pane: string, mode: DeckViewMode): void {
  // The report is dropped on purpose. A page in a private window refuses the
  // write; the pane still switches and just forgets across a reload, which is
  // exactly the behavior of a first visit.
  writeStored(deckViewStoreKey(pane), mode);
}

export interface DeckViewState {
  readonly mode: DeckViewMode;
  readonly setMode: (mode: DeckViewMode) => void;
}

/**
 * One pane's density, read from the store on first render and written back on
 * every change.
 *
 * The initializer is passed as a function so the read happens once per mount
 * rather than on every render, and `pane` is closed over rather than watched:
 * a pane's identity is fixed by which section it is, and a section that changed
 * its name mid-render would be a different pane with a different preference.
 */
export function useDeckViewMode(pane: string): DeckViewState {
  const [mode, setStored] = useState<DeckViewMode>(() => readDeckViewMode(pane));
  const setMode = useCallback(
    (next: DeckViewMode): void => {
      writeDeckViewMode(pane, next);
      setStored(next);
    },
    [pane],
  );
  return { mode, setMode };
}

export interface DeckViewControlProps {
  /** The pane this switches, named as the reader sees it (`Spells`). */
  readonly pane: string;
  readonly state: DeckViewState;
}

/**
 * The control, drawn in the pane's own header beside its count.
 *
 * Two pressed-state buttons rather than MTGO's dropdown, and the reason is the
 * option count. A select with two entries costs a press to open, a read to
 * compare and a second press to choose, and hides the mode you are not in; two
 * buttons show both answers and take one press. `../../styles/base.ts` already
 * draws `.mtg-btn[aria-pressed='true']`, so this is the sheet's existing
 * vocabulary rather than a new one, and `../../styles/touch.ts` already floors
 * `.mtg-btn` at the touch target.
 *
 * `role="group"` with the pane's name on it, so the two buttons are announced as
 * one control belonging to one section. Not `role="radiogroup"`: a radio group
 * takes over the arrow keys inside itself, and these two buttons sit in a page
 * header where the arrow keys are the reader's own. `aria-pressed` says which
 * one is on, which is the state a toggle has.
 */
export function DeckViewControl(props: DeckViewControlProps): ReactElement {
  const { pane, state } = props;
  return createElement(
    'div',
    {
      className: 'mtg-deck__view',
      role: 'group',
      'aria-label': `${pane}, ${DECK_VIEW_LABEL}`,
    },
    ...DECK_VIEW_MODES.map((mode) =>
      createElement(
        'button',
        {
          key: mode,
          type: 'button',
          className: 'mtg-btn mtg-deck__view-btn',
          'aria-pressed': state.mode === mode,
          onClick: (): void => {
            state.setMode(mode);
          },
        },
        DECK_VIEW_LABELS[mode],
      ),
    ),
  );
}
