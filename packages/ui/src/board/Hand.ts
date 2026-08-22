/**
 * Hand: revealed cards plus an explicit count of the ones you cannot see.
 *
 * Hidden information is drawn, not omitted. An opponent's seven face-down cards
 * are seven face-down rectangles, because a replay frame that silently shows an
 * empty hand reads as a mulligan gone wrong.
 *
 * A caller that gives a slot count gets a rail of that many slots, including the
 * ones it has no card for. That is the same honesty applied to layout rather
 * than to information: a hand of two in a rail of seven reads as a hand of two,
 * where a row of two cards on its own reads as a surface that failed to lay
 * itself out. The empty slots are drawn only for cards the viewer can see —
 * padding a face-down count out to seven would be inventing cards the opponent
 * does not hold.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import type { CardArt } from '../card/ArtSlot';
import { CardSlot } from './CardSlot';
import { Zone } from './Zone';

export interface HandCard {
  readonly key: string;
  readonly card: DslCard;
  readonly art?: CardArt | null;
  /** Inert when false; the caller owns the legality question, not this view. */
  readonly playable?: boolean;
}

export interface HandProps {
  readonly label: string;
  readonly cards: readonly HandCard[];
  /** Cards held but not revealed to this viewer. */
  readonly hiddenCount?: number;
  /** How many slots the rail draws. Fewer cards than this leaves slots empty. */
  readonly slots?: number;
  readonly selectedKey?: string;
  readonly onSelect?: (card: HandCard) => void;
  /**
   * The double click and the context gesture, on the same cards `onSelect`
   * reaches. Three gestures, one legality rule: a card the caller drew as
   * unplayable answers to none of them.
   */
  readonly onActivate?: (card: HandCard) => void;
  readonly onMenu?: (card: HandCard) => void;
  /**
   * The move picker belonging to a card, drawn when one is open on it. Given the
   * card's key and its name, because the picker is titled with the card it
   * belongs to and this row is the only place that holds both. Where the panel
   * lands on screen is the sheet's business, not this row's: it is taken out of
   * the flow entirely (`../styles/board/zone.ts`).
   */
  readonly pickerFor?: (key: string, name: string) => ReactNode;
}

function faceDown(index: number): ReactElement {
  return createElement('span', {
    key: `hidden-${index}`,
    className: 'mtg-facedown',
    'aria-label': 'face-down card',
    role: 'img',
  });
}

/** A slot with nothing in it: drawn, and out of the accessible tree. */
function emptySlot(index: number): ReactElement {
  return createElement('div', {
    key: `slot-${index}`,
    className: 'mtg-slot',
    'data-slot': 'hand',
    'data-empty': true,
    'aria-hidden': true,
  });
}

/**
 * One revealed card. An unplayable card is not a button.
 *
 * `playable` is the caller's reading of the kernel's enumeration, so a card
 * drawn as unplayable is a card with no move on offer, and a button that
 * dispatches nothing is worse than no button: it keeps a focus stop in the tab
 * order and a cursor that says press me. Dropping `onSelect` drops both, and it
 * is one condition rather than two because `CardSlot` already decides between a
 * `<button>` and an inert `<div>` on exactly that prop.
 *
 * That is the whole of what the player sees, and it used to be one thing more:
 * the word `unplayable` printed over the collector line. the playtester, 2026-08-13,
 * after playing the lab: "replace the unplayable text with the card just not
 * being selectable when it cant be played (so remove that text)". It was the
 * affordance written out — every card wearing it was already inert — and a hand
 * of seven spent five of its foot lines saying so. The face is not faded either;
 * no rule in the shipped sheet dims it.
 */
function revealed(props: HandProps, entry: HandCard): ReactElement {
  const inert = entry.playable === false;
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
    // The object id on the slot, the same way a permanent carries it. A hand of
    // two Mountains draws two identical faces, and without this the only handle
    // on either of them is a name they share.
    permanentKey: entry.key,
    ...(picker === null ? {} : { picker }),
    ...(onSelect === undefined
      ? {}
      : {
          onSelect: (): void => {
            onSelect(entry);
          },
        }),
    ...(onActivate === undefined
      ? {}
      : {
          onActivate: (): void => {
            onActivate(entry);
          },
        }),
    ...(onMenu === undefined
      ? {}
      : {
          onMenu: (): void => {
            onMenu(entry);
          },
        }),
  });
}

export function Hand(props: HandProps): ReactElement {
  const hidden = props.hiddenCount ?? 0;
  // A hand with anything hidden in it is somebody else's, and its face-down
  // count is already the whole truth about how many cards it holds.
  const spare = hidden > 0 ? 0 : Math.max((props.slots ?? 0) - props.cards.length, 0);
  const items: ReactNode[] = [
    ...props.cards.map((entry) => revealed(props, entry)),
    ...Array.from({ length: hidden }, (_unused, index) => faceDown(index)),
    ...Array.from({ length: spare }, (_unused, index) => emptySlot(index)),
  ];
  return createElement(Zone, {
    label: props.label,
    items,
    count: props.cards.length + hidden,
    tone: 'rail',
    // One row that runs off the edge rather than a grid that reflows: a hand
    // that breaks onto a second row stops reading as a hand. On the played table
    // that row is also what *sizes* the cards in it — `../styles/board/hand.ts`
    // makes a hand slot a seventh of the row and takes the height from the trim,
    // because the hand is the thing you are deciding from and the measurement
    // says its ceiling is the width of this row rather than the height it was
    // left. Everywhere else the rail keeps the fixed compact width it had.
    layout: 'rail',
    emptyText: 'no cards in hand',
  });
}
