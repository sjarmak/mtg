/**
 * The art slot: finalized or explicitly pending, never quietly blank.
 *
 * Ported governance rule from the prior project (`docs/art-governance.md`, reuse
 * item 9): a generative backlog rots silently unless every unfinished surface
 * announces itself. A card with no art renders a hatched frame labeled "Art
 * pending" carrying the card's own id, so a screenshot of a set in progress is
 * self-describing and a missing render can never pass for a design choice.
 */
import { createElement, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

export interface CardArt {
  readonly src: string;
  /** Describes the illustration, not the card; the card name is already text. */
  readonly alt: string;
}

export interface ArtSlotProps {
  /** `null` is the meaningful, expected state during set generation. */
  readonly art: CardArt | null;
  /** Identifies what the art is pending *for* — a card id or art-spec key. */
  readonly subject: string;
  /**
   * Drawn over the window, inside it. The board face's mana cost is the one
   * caller, and *inside* is the whole point: this element is `overflow: hidden`,
   * so a badge pinned to its corner is clipped by the window rather than
   * escaping onto the name below it. That escape is the second of the two
   * blocking defects `mtg-bc2.129` recorded against `ui/board-face` — 217 pairs
   * of overlapping ink in one game, because a cost with an intrinsic height sat
   * in a window that shrank underneath it.
   */
  readonly overlay?: ReactNode;
}

export const ART_PENDING_LABEL = 'Art pending';

/**
 * Renders the illustration, or the labeled pending frame when there is none.
 *
 * An image that fails to load falls back to the same frame. Art can be a remote
 * URL now that decks carry real card art, and a broken one otherwise renders as
 * a blank box with alt text — which is exactly the silent gap this component
 * exists to prevent. The failure is remembered against the `src` that produced
 * it, so a later card at the same slot gets its own attempt.
 */
export function ArtSlot(props: ArtSlotProps): ReactElement {
  const { art, subject } = props;
  const overlay = props.overlay ?? null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (art !== null && art.src !== failedSrc) {
    return createElement(
      'span',
      { className: 'mtg-art', 'data-region': 'art', 'data-art-state': 'ready' },
      createElement('img', {
        className: 'mtg-art__image',
        src: art.src,
        alt: art.alt,
        onError: () => {
          setFailedSrc(art.src);
        },
      }),
      overlay,
    );
  }
  return createElement(
    'span',
    {
      className: 'mtg-art',
      'data-region': 'art',
      'data-art-state': 'pending',
      role: 'img',
      'aria-label': `${ART_PENDING_LABEL} for ${subject}`,
    },
    createElement('span', { className: 'mtg-art__pending-label' }, ART_PENDING_LABEL),
    createElement('span', { className: 'mtg-art__pending-note' }, subject),
    overlay,
  );
}
