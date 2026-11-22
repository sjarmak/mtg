/**
 * The one control that decides what a pane's columns are.
 *
 * `./grouping.ts` holds the axes and the decision behind there being one control
 * rather than the capture's two; this file is the control itself and where a
 * pane's choice is kept. Split for the reason `./view-mode.ts` and
 * `../../styles/deck.ts` are split from what they draw: the grouping is read by
 * `../DeckRoute.ts`, `./ConstructedBuilder.ts`, `../play/SealedBuilder.ts` and
 * the draft pool, and only some of those want a React import.
 *
 * # A select, where View is two buttons
 *
 * `./view-mode.ts` argues two buttons beat a dropdown *at two options*: a select
 * costs a press to open, a read to compare and a second press to choose, and
 * hides the mode you are not in. All three costs are real and none of them
 * outweighs four buttons of permanent chrome in a header bar that already
 * carries Details and View. The crossover is somewhere above two, and four is
 * above it, so this is a select and the argument there is untouched.
 *
 * # Per pane, like the density
 *
 * Same storage shape and the same reason: the capture gives every pane its own
 * pair of controls, and a person reading a deck wants the spells by mana value
 * and the lands they are still arguing about by color. A single switch over the
 * page cannot say both. The key is namespaced separately so a pane's grouping
 * and its density cannot overwrite each other.
 */
import { createElement, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { readStored, writeStored } from './local-store';
import { DEFAULT_GROUPING, GROUPINGS, groupingLabel, parseGrouping } from './grouping';
import type { Grouping } from './grouping';

/** What the control is called, spelled once so a label and its menu agree. */
export const GROUPING_LABEL = 'Group by';

/** Where a pane's choice is kept, namespaced apart from its density. */
export function deckGroupingStoreKey(pane: string): string {
  return `mtg.deck.group.${pane}`;
}

/**
 * The stored choice for one pane, or the default.
 *
 * A stored axis that is not offered by this pane's members falls back to the
 * default rather than being honored, which is the case that actually happens:
 * somebody groups a Constructed build by rarity, then opens a built artifact,
 * whose entries carry no rarity at all. Honoring it would put every card in one
 * `Unknown rarity` column and leave the control reading `Rarity`, which is a
 * screen with no wrong pixel on it and nothing a reader can act on.
 */
export function readDeckGrouping(pane: string, offered: readonly Grouping[]): Grouping {
  const found = parseGrouping(readStored(deckGroupingStoreKey(pane)));
  return found !== null && offered.includes(found) ? found : DEFAULT_GROUPING;
}

export interface DeckGroupingState {
  readonly grouping: Grouping;
  readonly setGrouping: (grouping: Grouping) => void;
}

/**
 * One pane's grouping, read from the store on first render and written back on
 * every change.
 *
 * `offered` is read once at mount, like `./view-mode.ts`'s `pane`: a pane's
 * members change as cards are played and cut, but which axes they can answer is
 * a property of where they came from and does not change while the pane is open.
 */
export function useDeckGrouping(pane: string, offered: readonly Grouping[]): DeckGroupingState {
  const [grouping, setStored] = useState<Grouping>(() => readDeckGrouping(pane, offered));
  const setGrouping = useCallback(
    (next: Grouping): void => {
      // The report is dropped on purpose, as in `./view-mode.ts`: a private
      // window refuses the write, the pane still regroups, and it forgets across
      // a reload, which is what a first visit does anyway.
      writeStored(deckGroupingStoreKey(pane), next);
      setStored(next);
    },
    [pane],
  );
  return { grouping, setGrouping };
}

export interface GroupingControlProps {
  /** The pane this groups, named as the reader sees it (`Main deck`). */
  readonly pane: string;
  /** Which axes this pane's members can all answer; see `./grouping.ts`. */
  readonly offered: readonly Grouping[];
  readonly state: DeckGroupingState;
}

/**
 * The control, drawn in the pane's own header beside its counts.
 *
 * A labeled `<select>` rather than a button that opens a menu, because a select
 * is the platform's own list and arrives with keyboard handling, touch handling
 * and a native picker on a phone. The visible label is the control's name; the
 * accessible name carries the pane too, so four of these on one screen are four
 * distinguishable controls rather than four called `Group by`.
 */
export function GroupingControl(props: GroupingControlProps): ReactElement {
  const { pane, offered, state } = props;
  return createElement(
    'label',
    { className: 'mtg-deck__group' },
    createElement('span', { className: 'mtg-deck__group-label' }, GROUPING_LABEL),
    createElement(
      'select',
      {
        className: 'mtg-select mtg-deck__group-select',
        value: state.grouping,
        'aria-label': `${pane}, ${GROUPING_LABEL}`,
        onChange: (event: { target: { value: string } }): void => {
          const next = parseGrouping(event.target.value);
          if (next !== null) state.setGrouping(next);
        },
      },
      ...GROUPINGS.filter((grouping) => offered.includes(grouping)).map((grouping) =>
        createElement('option', { key: grouping, value: grouping }, groupingLabel(grouping)),
      ),
    ),
  );
}
