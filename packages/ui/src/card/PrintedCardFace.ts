/** Exact printed text and official illustration inside the shared card contract. */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { Card } from './Card';
import type { PrintedCardPresentation } from './printed-card-art';
import { printedCardArt, printedDisplayCard } from './printed-card-art';

export interface PrintedCardFaceProps {
  readonly card: PrintedCardPresentation;
  /** Runtime copy identity; catalog identity remains unchanged in the source row. */
  readonly physicalId?: string;
  /** Inspect a different printed face while retaining the original catalog and image indices. */
  readonly faceIndex?: number;
  readonly size: 'art' | 'board' | 'compact' | 'full';
  readonly selected?: boolean;
  readonly autoFocus?: boolean;
  readonly deferArt?: boolean;
  readonly footnote?: string;
  readonly onSelect?: () => void;
  readonly onActivate?: () => void;
  readonly onMenu?: () => void;
  readonly onHover?: (hovered: boolean) => void;
}

/**
 * Presentation-only adapter from a catalog row to the same `Card` component
 * every generated draft, builder and battlefield already uses.
 */
export function PrintedCardFace(props: PrintedCardFaceProps): ReactElement {
  const card = props.physicalId === undefined ? props.card : { ...props.card, physicalId: props.physicalId };
  const face = card.faces[props.faceIndex ?? 0];
  if (face === undefined) throw new Error(`printed card ${props.card.name} has no face`);
  const object = {
    oid: card.physicalId,
    name: face.name,
    typeLine: face.typeLine,
    power: null,
    toughness: null,
  };
  const display = printedDisplayCard(card, object);
  return createElement(Card, {
    card: display,
    art: printedCardArt(card, object),
    size: props.size,
    ...(props.selected === undefined ? {} : { selected: props.selected }),
    ...(props.autoFocus === undefined ? {} : { autoFocus: props.autoFocus }),
    ...(props.deferArt === undefined ? {} : { deferArt: props.deferArt }),
    ...(props.footnote === undefined ? {} : { footnote: props.footnote }),
    ...(props.onSelect === undefined ? {} : { onSelect: () => props.onSelect?.() }),
    ...(props.onActivate === undefined ? {} : { onActivate: () => props.onActivate?.() }),
    ...(props.onMenu === undefined ? {} : { onMenu: () => props.onMenu?.() }),
    ...(props.onHover === undefined
      ? {}
      : { onHover: (hovered: DslCard | null) => props.onHover?.(hovered !== null) }),
  });
}
