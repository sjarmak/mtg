/**
 * Which of a builder's two panes a narrow screen is showing.
 *
 * `mtg-nqms`, and the half of `mtg-3ggp` that did not ship: "for narrower
 * screens, allow the right deck pane to become a drawer or switchable tab
 * rather than shrinking both panes until they are unusable". What shipped was
 * the second clause. Below `../../styles/deck.ts`'s `BUILDER_SPLIT_QUERY` the
 * two panes stack at full width, so neither is a sliver -- and the screen is a
 * document again. Measured on the Constructed builder at 390x844 with sixty
 * cards in the deck: the deck pane ran 1,057px, the collection began 1,528px
 * down and ran 6,562px, and the page was 8,138px. Reaching the collection meant
 * scrolling past the whole deck, and getting back meant scrolling up through
 * the whole collection.
 *
 * So one pane at a time, and a switch. Three things about it are decisions
 * rather than detail.
 *
 * **It is a tab switch, not an overlay drawer.** A drawer over the collection
 * would cover the pane you are picking from at the moment you are deciding what
 * to cut, and 390px of width has room for one column of cards and no more, so
 * there is nothing for a drawer to sit beside.
 *
 * **The control rides the builder's sticky bar** (`.mtg-builder__bar`, which is
 * already `position: sticky` at the top of the page) rather than being a sticky
 * element of its own. Two elements pinned to `top: 0` overlap, and the second
 * one would slide over the first; one sticky region is the arrangement that
 * works. Riding it is also what makes the bead's own sentence true -- the deck
 * is reachable from the end of the collection, because the switch is still on
 * the screen there.
 *
 * **The stylesheet hides a pane, not this file.** Both panes are always
 * rendered and `data-showing` says which one a narrow screen draws, so above
 * the split query the attribute means nothing and the desk arrangement is
 * untouched by construction. A React state that unmounted a pane would take its
 * scroll position and its filters with it, and would have to be undone at the
 * width where both panes are wanted.
 */
import { createElement, useState } from 'react';
import type { ReactElement } from 'react';

/** Which pane, written to `data-showing` on `.mtg-builder__panes`. */
export type BuilderPaneName = 'deck' | 'pool';

/**
 * The pane a builder opens on.
 *
 * The deck, which is the same answer the DOM order already gives: both builders
 * write the deck pane first, because below the split query "the screen is one
 * column and the deck is what you came to read" (`../../styles/deck.ts`). The
 * collection is one press away, and on a desk this value is never read.
 */
export const BUILDER_FIRST_PANE: BuilderPaneName = 'deck';

export interface BuilderPaneState {
  readonly showing: BuilderPaneName;
  /** The pane using the whole workbench, or `null` while both share it. */
  readonly expanded: BuilderPaneName | null;
  readonly show: (pane: BuilderPaneName) => void;
  readonly expand: (pane: BuilderPaneName) => void;
  readonly restore: () => void;
}

/**
 * Not persisted, unlike the dragged split next door in `./builder-split.ts`.
 * A share is a way somebody wants a workbench laid out and survives the day; a
 * tab is where they are looking right now, and a builder that opens on the pane
 * you last happened to leave it on is a builder that opens somewhere different
 * every time.
 */
export function useBuilderPane(): BuilderPaneState {
  const [showing, setShowing] = useState<BuilderPaneName>(BUILDER_FIRST_PANE);
  const [expanded, setExpanded] = useState<BuilderPaneName | null>(null);
  return {
    showing,
    expanded,
    show: setShowing,
    expand: (pane: BuilderPaneName): void => {
      // A phone must show the pane it expands. On a desk this write is inert,
      // but retaining it makes restoring the responsive split deterministic.
      setShowing(pane);
      setExpanded(pane);
    },
    restore: (): void => {
      setExpanded(null);
    },
  };
}

export interface BuilderPaneSwitchProps {
  readonly state: BuilderPaneState;
  /** What the deck pane is called on this screen, and what its button reads. */
  readonly deckLabel: string;
  /** The other pane's name: a Constructed collection, a sealed pool. */
  readonly poolLabel: string;
}

/** The label the two buttons are grouped under, and the one the rigs find it by. */
export const BUILDER_PANE_SWITCH_LABEL = 'Which pane to show';

/** The one name used when an expanded pane hands the workbench back. */
export const BUILDER_SPLIT_VIEW_LABEL = 'Restore split view';

export interface BuilderPaneExpansionProps {
  readonly state: BuilderPaneState;
  readonly pane: BuilderPaneName;
  readonly label: string;
}

/**
 * One reversible control in each pane's own header.
 *
 * The panes remain mounted while one is expanded, just as they do for the
 * phone switch. That preserves their filters, scroll positions and the split
 * ratio stored by `./builder-split.ts`; expansion changes only which boxes CSS
 * lays out.
 */
export function builderPaneExpansionControl(props: BuilderPaneExpansionProps): ReactElement {
  const expanded = props.state.expanded === props.pane;
  const label = expanded ? BUILDER_SPLIT_VIEW_LABEL : `Expand ${props.label}`;
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn mtg-deck__expand',
      'aria-label': label,
      'aria-pressed': expanded,
      onClick: (): void => {
        if (expanded) props.state.restore();
        else props.state.expand(props.pane);
      },
    },
    label,
  );
}

/**
 * Both names, always both pressable, with the current one marked.
 *
 * `aria-pressed` rather than a tab list: an ARIA tablist promises each button
 * controls a panel with an id, and these two buttons control a CSS rule that
 * does nothing at all on a desk. Two toggles that say which is on is the
 * accurate description, and it is what `./view-mode.ts` next door already draws.
 */
export function builderPaneSwitch(props: BuilderPaneSwitchProps): ReactElement {
  const { state } = props;
  const names: readonly (readonly [BuilderPaneName, string])[] = [
    ['deck', props.deckLabel],
    ['pool', props.poolLabel],
  ];
  return createElement(
    'div',
    { className: 'mtg-builder__switch', role: 'group', 'aria-label': BUILDER_PANE_SWITCH_LABEL },
    ...names.map(([pane, label]) =>
      createElement(
        'button',
        {
          key: pane,
          type: 'button',
          className: 'mtg-btn mtg-builder__switch-btn',
          'aria-pressed': state.showing === pane,
          onClick: (): void => {
            state.show(pane);
          },
        },
        label,
      ),
    ),
  );
}
