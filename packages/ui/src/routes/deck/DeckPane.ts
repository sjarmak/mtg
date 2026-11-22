/**
 * One pane of a deck screen: a header bar, its fixed rows, and a box of cards
 * that scrolls.
 *
 * Every deck screen in this app draws this shape, and three of them drew it
 * from three implementations -- a `section` per pane, a head holding the pane's
 * name, its count, its density control and its grouping control, then whatever
 * that pane keeps above its cards, then the cards. `mtg-pmpu` is the bead that
 * says the deck side of every editor here is one thing; this is the part of it
 * that is a component rather than an argument.
 *
 * The three were the Constructed builder, the sealed builder, and
 * `../DeckRoute.ts`'s panes over a built artifact, and they had drifted the way
 * three copies do: the artifact panes titled themselves with a small uppercase
 * micro label and the builders with a heading, the artifact head wrapped and the
 * builder head did not, and the two controls sat in opposite orders. None of
 * that was decided; it was written twice. The merged version takes the MTGO
 * capture's answer where they disagreed -- a pane bar reads `Main Deck: 42` in
 * ordinary type, with Display then Sort at the right end.
 *
 * What the shared version adds is the scrollport. `../DeckRoute.ts`'s panes
 * became boxes with their own scrollbars in `mtg-tz11` and the builders did
 * not, so an open deck was the MTGO capture's frame and the screen you build a
 * deck on was still a document: at 1440x900 the Constructed builder is 13,436px
 * tall, and scrolling to the pool takes the deck you are cutting from off the
 * top of the screen. The split here is the same one `../DeckRoute.ts` states --
 * everything the reader steers the pane with sits outside `above`'s box, so it
 * stays where it was left however far the cards have been driven.
 *
 * Outside a frame this changes nothing: a scrollport in a column that is free
 * to grow is as tall as its contents and never scrolls. That is what every
 * surface here gets below `../../styles/deck.ts`'s `BUILDER_FRAME_QUERY`, which
 * is the gate rather than the two-column one: a pane spends about 180px on its
 * own header and filters before it draws a card. `mtg-sk1c` put the sealed
 * builder's three hosts inside the same frame, so the two builders now differ
 * in nothing but what they are called.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { GroupingControl, useDeckGrouping } from './GroupingControl';
import { GROUPINGS } from './grouping';
import type { Grouping } from './grouping';
import type { DeckGroupingState } from './GroupingControl';
import {
  CARD_VIEW_MODES,
  DECK_VIEW_MODES,
  DECK_VIEW_MODES_OFFERED,
  DEFAULT_DECK_PANE_VIEW_MODE,
  DeckViewControl,
  useDeckViewMode,
} from './view-mode';
import type { DeckViewMode, DeckViewState } from './view-mode';

export interface DeckPaneProps {
  /**
   * Which pane this is, written to `data-pane`.
   *
   * Read by the layout -- the builder's split gives the pool the wider track --
   * and by the rigs, which is the other reason it is an attribute rather than a
   * class: a test asking for the pool pane should not have to know what the
   * pool is called on this screen.
   */
  readonly kind: 'deck' | 'pool' | 'sideboard';
  /**
   * The pane's name: what its controls announce themselves for, and its heading
   * unless `title` overrides it.
   */
  readonly label: string;
  /**
   * What the heading prints, where that is more than the name. The capture
   * writes a pane bar as "Main Deck: 42", and a pane holding a finished list has
   * exactly one number to put there.
   *
   * The controls are still named `label`. "Main deck: 60, View" is a control
   * that renames itself every time somebody cuts a card, which is a moving
   * target for anyone steering the page by name.
   */
  readonly title?: string;
  /** What is in it, in a few words. Empty draws nothing rather than a gap. */
  readonly note: string;
  /** Its density and its grouping, from `usePaneControls`. */
  readonly controls: PaneControls;
  /** Optional actions that apply to the pane as a whole. */
  readonly actions?: ReactNode;
  /**
   * Rows between the header and the scrollport: the mana curve, the mana base,
   * the pool's filters, the selected copy's moves. They belong to the pane
   * rather than to its cards, so they do not scroll with them.
   */
  readonly above?: ReactNode;
  /**
   * The cards. The only thing in the pane that scrolls.
   *
   * Optional in the type and required in practice: every caller passes them as
   * `createElement`'s variadic tail rather than as a property, and a required
   * `children` refuses that call.
   */
  readonly children?: ReactNode;
}

/** Both controls a pane carries, stored under the pane's own name. */
export interface PaneControls {
  readonly view: DeckViewState;
  readonly grouping: DeckGroupingState;
  /** The axes this pane's cards can answer. `GROUPINGS` unless narrowed. */
  readonly offered: readonly Grouping[];
  /** The drawings this pane has. `DECK_VIEW_MODES` unless narrowed. */
  readonly views: readonly DeckViewMode[];
}

/**
 * What a pane may draw and what it draws before anybody says.
 *
 * `mtg-umro` gave the two panes of a builder different answers -- a deck offers
 * the decklist and whole cards and opens on the list, a pool offers the two
 * densities and opens on compact -- so the pair travels together the way the
 * grouping's `offered` already does. Absent means every mode and the shared
 * default, which is what the three panes outside a builder get.
 */
export interface PaneViews {
  readonly offered: readonly DeckViewMode[];
  readonly fallback: DeckViewMode;
}

/**
 * What every pane that draws faces offers, and what it opens on.
 *
 * The two card densities, and whole cards first. That reverses the answer this
 * constant gave until 2026-09-17, and the reason is what compact became on the
 * same day: `mtg-mxkrk` made a compact strip its title bar alone, with no
 * picture anywhere in it, so a pane opening compact opens on a column of names.
 * That is the right drawing for counting a deck and the wrong one for opening
 * it -- the playtester, on being shown it: "set the default when opening the deck
 * view to full cards not to compact list". Compact stays one press away in the
 * pane's own header, and the choice is still remembered per pane, so the
 * default is only what a pane nobody has set does.
 *
 * `PANE_LIMITED_CARD_VIEWS` is this same pair and used to be the only one that
 * opened on whole cards, for the reason a draft pool is a reading surface: art,
 * type line and rules all matter while somebody decides what to include. That
 * argument now covers every faces pane, so it is one constant under two names
 * rather than two spellings of one rule.
 */
export const PANE_CARD_VIEWS: PaneViews = {
  offered: CARD_VIEW_MODES,
  fallback: 'full',
};

/** Limited deckbuilding's panes; see `PANE_CARD_VIEWS`, which they now share. */
export const PANE_LIMITED_CARD_VIEWS: PaneViews = PANE_CARD_VIEWS;

/** The Constructed builder's deck pane: a decklist, or whole cards (`mtg-umro`). */
export const PANE_DECKLIST_VIEWS: PaneViews = {
  offered: DECK_VIEW_MODES_OFFERED,
  fallback: DEFAULT_DECK_PANE_VIEW_MODE,
};

/**
 * The two per-pane preferences, read together under one storage key.
 *
 * A hook rather than two, because every caller wants both under one name and
 * calling them separately is two chances to key them differently -- which is
 * the bug `../DeckRoute.ts`'s `DeckSection` documents from the other side.
 *
 * The key is not the label. A pane's heading is copy, a copy edit is a thing
 * somebody does without thinking about storage, and keying the preference to it
 * would drop the reader's choice the first time a pane is reworded; the label
 * is what the control announces itself with instead.
 */
export function usePaneControls(
  key: string,
  offered: readonly Grouping[] = GROUPINGS,
  views?: PaneViews,
): PaneControls {
  const viewModes = views?.offered ?? DECK_VIEW_MODES;
  const view = useDeckViewMode(key, viewModes, views?.fallback);
  const grouping = useDeckGrouping(key, offered);
  return { view, grouping, offered, views: viewModes };
}

export function DeckPane(props: DeckPaneProps): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-deck__pane', 'data-pane': props.kind, 'aria-label': props.label },
    createElement(
      'div',
      { className: 'mtg-deck__pane-head' },
      createElement('h2', { className: 'mtg-deck__pane-title' }, props.title ?? props.label),
      props.note === '' ? null : createElement('span', { className: 'mtg-deck__pane-note' }, props.note),
      createElement(DeckViewControl, {
        pane: props.label,
        state: props.controls.view,
        offered: props.controls.views,
      }),
      createElement(GroupingControl, {
        pane: props.label,
        offered: props.controls.offered,
        state: props.controls.grouping,
      }),
      props.actions ?? null,
    ),
    props.above ?? null,
    createElement('div', { className: 'mtg-deck__pane-scroll' }, props.children),
  );
}
