/**
 * The top of a library while it is public: Oracle of Mul Daya's "play with the
 * top card of your library revealed", and the cards that let you play from it.
 *
 * The engine says when the card is public (`SeatView.libraryTop`), and this zone
 * draws exactly what it says: nothing on an ordinary position, and the revealed
 * card otherwise, for both seats, because a revealed card is revealed to the
 * table. Whether the card is a button is the hand's rule restated: the caller
 * marks it `playable` when the engine offers a play or a cast from there, and
 * the same three gestures a held card answers reach the same handlers. The panel
 * shares the command zone's column (`../styles/board/command.ts`), under the
 * commander when there is one and in its place when there is not.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { CardSlot } from './CardSlot';
import type { HandCard } from './Hand';
import { Zone } from './Zone';

export interface LibraryTopProps {
  readonly label: string;
  /** Top of the library first. */
  readonly cards: readonly HandCard[];
  readonly selectedKey?: string;
  readonly onSelect?: (card: HandCard) => void;
  readonly onActivate?: (card: HandCard) => void;
  readonly onMenu?: (card: HandCard) => void;
  readonly pickerFor?: (key: string, name: string) => ReactNode;
  readonly pointed?: ReadonlySet<string>;
}

function revealed(props: LibraryTopProps, entry: HandCard): ReactElement {
  const inert = entry.playable !== true;
  const onSelect = inert ? undefined : props.onSelect;
  const onActivate = inert ? undefined : props.onActivate;
  const onMenu = inert ? undefined : props.onMenu;
  const picker = props.pickerFor?.(entry.key, entry.card.name) ?? null;
  return createElement(CardSlot, {
    key: entry.key,
    kind: 'hand',
    card: entry.card,
    art: entry.art ?? null,
    selected: props.selectedKey === entry.key,
    permanentKey: entry.key,
    ...(props.pointed?.has(entry.key) === true ? { pointed: true } : {}),
    ...(picker === null ? {} : { picker }),
    ...(onSelect === undefined ? {} : { onSelect: (): void => onSelect(entry) }),
    ...(onActivate === undefined ? {} : { onActivate: (): void => onActivate(entry) }),
    ...(onMenu === undefined ? {} : { onMenu: (): void => onMenu(entry) }),
  });
}

export function LibraryTop(props: LibraryTopProps): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-library-top' },
    createElement(Zone, {
      label: props.label,
      items: props.cards.map((entry) => revealed(props, entry)),
      tone: 'rail',
      emptyText: 'library empty',
    }),
  );
}
