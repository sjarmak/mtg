import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { CardSlot } from './CardSlot';
import type { HandCard } from './Hand';
import { Zone } from './Zone';

export interface AvatarZoneProps {
  readonly label: string;
  readonly cards: readonly HandCard[];
  readonly selectedKey?: string;
  readonly onSelect?: (card: HandCard) => void;
  readonly onActivate?: (card: HandCard) => void;
  readonly onMenu?: (card: HandCard) => void;
  readonly pickerFor?: (key: string, name: string) => ReactNode;
  readonly pointed?: ReadonlySet<string>;
}

function avatar(props: AvatarZoneProps, entry: HandCard): ReactElement {
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

export function AvatarZone(props: AvatarZoneProps): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-avatar' },
    createElement(Zone, {
      label: props.label,
      items: props.cards.map((entry) => avatar(props, entry)),
      tone: 'rail',
      emptyText: 'avatar absent',
    }),
  );
}
