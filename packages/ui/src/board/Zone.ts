/**
 * The zone container every board region is built from.
 *
 * Items arrive as an explicit array rather than as `children` so "empty" is a
 * value the caller can be honest about: a battlefield with nothing on it says
 * so, instead of collapsing to a bare label.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

export type ZoneTone = 'sunken' | 'rail';

/**
 * How the body arranges its items: `wrap` reflows onto as many rows as it needs,
 * `rail` keeps one row and scrolls, `board` stacks its items down the zone.
 * Separate from the tone, which is the zone's surface: the stack is on rail
 * paper and still wraps.
 *
 * `board` exists because a battlefield holds two things rather than n slots —
 * the cards in play, and the mana base in a row under them
 * (`../styles/board/lands.ts`, `LAND_TILE_HEIGHT_REM`) — and a body that laid its
 * items out as a row would put the two side by side.
 */
export type ZoneLayout = 'wrap' | 'rail' | 'board';

export interface ZoneProps {
  readonly label: string;
  readonly items: readonly ReactNode[];
  /** Shown beside the label; omit when the item count is already the count. */
  readonly count?: number;
  readonly note?: string;
  readonly tone?: ZoneTone;
  readonly layout?: ZoneLayout;
  readonly emptyText?: string;
}

export function Zone(props: ZoneProps): ReactElement {
  const count = props.count ?? props.items.length;
  const emptyText = props.emptyText ?? 'empty';
  const head = createElement(
    'div',
    { className: 'mtg-zone__head' },
    createElement('span', { className: 'mtg-zone__label' }, props.label),
    createElement('span', { className: 'mtg-zone__count' }, String(count)),
    props.note === undefined ? null : createElement('span', { className: 'mtg-zone__note' }, props.note),
  );
  const body =
    props.items.length === 0
      ? createElement('span', { className: 'mtg-zone__empty' }, emptyText)
      : createElement(
          'div',
          { className: 'mtg-zone__body', 'data-layout': props.layout ?? 'wrap' },
          ...props.items,
        );
  return createElement(
    'section',
    { className: 'mtg-zone', 'data-tone': props.tone ?? 'sunken', 'aria-label': props.label },
    head,
    body,
  );
}
