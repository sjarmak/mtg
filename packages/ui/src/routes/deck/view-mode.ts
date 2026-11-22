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
 * just a decklist", and it is right. Compact *is* just a decklist.
 *
 * # Which one a pane opens in
 *
 * Whole cards, for every pane that draws faces, and that reverses the answer
 * twice: this file said full until `mtg-ljda`, compact after it, and full again
 * from 2026-09-17. What changed each time is what compact *is*. `mtg-9ubz` made
 * it the capture's mana-value columns, which is why `mtg-ljda` opened on it;
 * `mtg-mxkrk` made a compact strip its title bar alone, no picture in it
 * anywhere, and a deck opened on that is a deck opened on its own decklist.
 * The playtester, shown it: "set the default when opening the deck view to full
 * cards not to compact list". The constant that carries this is
 * `./DeckPane.ts`'s `PANE_CARD_VIEWS`; the paragraphs below are the argument it
 * reversed.
 *
 * The old answer was that the inclusion reason is the page's whole argument and
 * a person opts out of it deliberately. It was written when the two modes
 * differed only in density — the same flat run of tiles, drawn large or drawn
 * small — so the choice really was "the argument, or forty cards at once".
 * `mtg-9ubz` ended that: compact is now the deck grouped into mana-value columns
 * with a card count over each, which is the capture's layout, and the page's
 * default stopped being a density and became a layout.
 *
 * The playtester, 2026-08-29: "the deckbuilding UI really needs to match the MTGO one
 * and the way cards are organized". A default that opens on our own flat run and
 * puts the capture's layout one press away does not match it; it offers it. So
 * the columns are what a pane opens in, and full is the deliberate opt-in — for
 * a pane you are reading card by card, where the reason each one is in the deck
 * is what you came for. Nothing is lost, because the control is in the pane's
 * own header bar and the choice is remembered per pane.
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
 * surfacing here — the pane simply draws the default, which is the state a
 * first-ever visit is in, so the write's failure report is deliberately dropped.
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
 * The three drawings, and no pane offers all three.
 *
 * MTGO's own View menu offers more than a pair, and every extra rung is a
 * decision the reader has to make before they can read anything, so a mode is
 * added here only when a pane needs one it does not have. `list` was `mtg-umro`,
 * the bead this file used to say a third mode would have to be: the deck pane
 * moved into a third of the workbench and its columns do not fit there.
 *
 * What a pane *offers* is narrower than this list and is stated per pane below.
 */
export const DECK_VIEW_MODES = ['full', 'compact', 'list'] as const;
export type DeckViewMode = (typeof DECK_VIEW_MODES)[number];

/** What each mode is called on its button. Sentence case, as MTGO draws it. */
export const DECK_VIEW_LABELS: Readonly<Record<DeckViewMode, string>> = {
  full: 'Full cards',
  compact: 'Compact list',
  list: 'Decklist',
};

/**
 * The two card densities, which is the pair this file was written for.
 *
 * What every pane offers except the Constructed builder's deck. `list` is a
 * deck's drawing and only a deck's -- one row per *distinct* card with the
 * copies played written down the left edge -- and a pool plays no copies of
 * anything, so offering it there would be a control that renders a column of
 * `0`s. The sealed builder's deck pane could take it and does not: that screen
 * keeps the stacked workbench its columns were argued for (`mtg-8osf`), so it is
 * not short of the width they need.
 */
export const CARD_VIEW_MODES: readonly DeckViewMode[] = ['full', 'compact'];

/**
 * What a deck pane offers, and the reason it is not all three.
 *
 * `mtg-umro`. `compact` and `list` would both be "the deck, small", and they
 * differ in what they can say: compact is mana-value columns of overlapping
 * title bars, which needs the width the capture gives it, and list is rows,
 * which is what a third of a workbench holds. A pane offering both is a pane
 * asking the reader to discover that one of them is unusable at this width.
 *
 * So a deck pane offers two: the list, and whole cards. `full` is unchanged and
 * still draws the strip columns at face size, which is `mtg-rgc.21`'s answer and
 * is the card view the playtester asked to be able to switch the deck pane to.
 */
export const DECK_VIEW_MODES_OFFERED: readonly DeckViewMode[] = ['list', 'full'];

/**
 * The mode as a *face* density, for the two components that draw faces.
 *
 * `../../card/Card.ts` takes `CardSize` and `./StripColumns.ts` takes
 * `StripDensity`, and both are the pair this file had before `mtg-umro` added
 * the decklist. A pane in list mode never reaches either of them -- it renders
 * `./DeckListRows.ts` instead -- so the narrowing is a total function with an
 * unreachable arm rather than a fallback that hides a state.
 */
export function cardDensity(mode: DeckViewMode): 'full' | 'compact' {
  return mode === 'full' ? 'full' : 'compact';
}

/**
 * What the control is called.
 *
 * `View` is MTGO's own word for this dropdown, and using it means a person who
 * knows that client already knows what this is. The pane's name goes on the
 * group rather than into the word, so a screen reader reads "Spells, View" and
 * not two controls both called View.
 */
export const DECK_VIEW_LABEL = 'View';

/**
 * The fallback for a pane that states none, and for a tile drawn without one.
 *
 * No longer what a pane of faces opens in: `./DeckPane.ts`'s `PANE_CARD_VIEWS`
 * states `full` since 2026-09-17, because `mtg-mxkrk` made compact a column of
 * title bars with no picture in it and opening a deck on that is opening it on
 * a list. What is left here is the unnarrowed default, which `./DeckTile.ts`
 * takes when a caller draws a tile without saying, and the "Which one a pane
 * opens in" section above is the argument that constant now carries.
 */
export const DEFAULT_DECK_VIEW_MODE: DeckViewMode = 'compact';

/**
 * A deck pane's own default, which is the decklist (`mtg-umro`).
 *
 * The pool keeps `DEFAULT_DECK_VIEW_MODE`. The two panes of a deck editor are
 * for two different activities and the captures draw them differently on
 * purpose: a collection is a grid of whole cards you are reading, and a deck is
 * a list you are counting.
 */
export const DEFAULT_DECK_PANE_VIEW_MODE: DeckViewMode = 'list';

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
export function readDeckViewMode(
  pane: string,
  offered: readonly DeckViewMode[] = DECK_VIEW_MODES,
  fallback: DeckViewMode = DEFAULT_DECK_VIEW_MODE,
): DeckViewMode {
  const found = readStored(deckViewStoreKey(pane));
  // A stored mode this pane does not offer reads as nothing stored, on the same
  // argument as a mode that does not exist: a deck pane carrying `compact` from
  // before `mtg-umro` would otherwise open on a control that is not on it.
  return isMode(found) && offered.includes(found) ? found : fallback;
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
export function useDeckViewMode(
  pane: string,
  offered: readonly DeckViewMode[] = DECK_VIEW_MODES,
  fallback: DeckViewMode = DEFAULT_DECK_VIEW_MODE,
): DeckViewState {
  const [mode, setStored] = useState<DeckViewMode>(() => readDeckViewMode(pane, offered, fallback));
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
  /** The modes this pane has. `DECK_VIEW_MODES` unless narrowed. */
  readonly offered?: readonly DeckViewMode[];
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
    ...(props.offered ?? DECK_VIEW_MODES).map((mode) =>
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
