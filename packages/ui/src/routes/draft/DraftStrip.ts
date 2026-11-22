import { createElement } from 'react';
import type { ReactElement, RefObject } from 'react';

interface AdviceJumpTarget {
  querySelector(selector: string): AdviceJumpTarget | null;
  scrollIntoView(options: { block: 'start'; inline: 'nearest' }): void;
  focus(options: { preventScroll: boolean }): void;
}

function direction(round: number): string {
  return round % 2 === 1 ? 'passing left' : 'passing right';
}

function packLabel(next: { readonly round: number; readonly pickNumber: number }): string {
  return `Pack ${String(next.round)} · Pick ${String(next.pickNumber)}`;
}

function remainingLabel(packSize: number): string {
  return `${String(packSize)} ${packSize === 1 ? 'card' : 'cards'} remaining`;
}

function orderLabel(props: {
  readonly hasRatingSource: boolean;
  readonly ratingSource: string | null;
  readonly ratingsEnabled: boolean;
}): string | null {
  if (!props.hasRatingSource) return null;
  if (!props.ratingsEnabled) return 'Rarest first';
  return props.ratingSource === null ? null : `${props.ratingSource}: best rated first`;
}

export interface DraftStripProps {
  readonly next: { readonly round: number; readonly pickNumber: number; readonly packSize: number };
  readonly taken: number;
  readonly hasAdvice: boolean;
  readonly viewerCollapsed: boolean;
  readonly onExpandViewer: () => void;
  readonly surface: RefObject<HTMLDivElement | null>;
  readonly hasRatingSource: boolean;
  readonly ratingSource: string | null;
  readonly ratingsEnabled: boolean;
  readonly onToggleRatings: () => void;
  readonly onNewDraft: () => void;
}

export function DraftStrip(props: DraftStripProps): ReactElement {
  const order = orderLabel(props);
  return createElement(
    'div',
    { className: 'mtg-strip', 'aria-live': 'polite' },
    createElement('span', { className: 'mtg-strip__title' }, packLabel(props.next)),
    createElement(
      'span',
      { className: 'mtg-strip__note' },
      `${remainingLabel(props.next.packSize)} · ${direction(props.next.round)}`,
    ),
    createElement('span', { className: 'mtg-strip__note' }, `${String(props.taken)} drafted`),
    order === null ? null : createElement('span', { className: 'mtg-strip__note' }, order),
    createElement('span', { className: 'mtg-strip__spacer' }),
    !props.hasAdvice
      ? null
      : createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            onClick: (): void => {
              if (props.viewerCollapsed) {
                props.onExpandViewer();
                return;
              }
              const tabs = (props.surface.current as unknown as AdviceJumpTarget | null)?.querySelector(
                '.mtg-rail__tabs',
              );
              tabs?.scrollIntoView({ block: 'start', inline: 'nearest' });
              tabs?.querySelector('button')?.focus({ preventScroll: true });
            },
          },
          'Review advice',
        ),
    createElement(
      'div',
      { className: 'mtg-strip__setup' },
      !props.hasRatingSource
        ? null
        : createElement(
            'button',
            {
              type: 'button',
              className: 'mtg-btn',
              'aria-pressed': props.ratingsEnabled,
              onClick: props.onToggleRatings,
            },
            props.ratingsEnabled ? 'Hide ratings' : 'Show ratings',
          ),
      createElement(
        'button',
        { type: 'button', className: 'mtg-btn', onClick: props.onNewDraft },
        'New draft',
      ),
    ),
  );
}
