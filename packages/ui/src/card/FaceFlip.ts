/**
 * The control that turns a printed card over.
 *
 * A split card (Dusk // Dawn), an aftermath card and a transforming card are
 * one printing with two faces, and the catalog carries both. `PrintedCardFace`
 * draws one of them at a time, chosen by `faceIndex`, and this is the button
 * that changes which. It lives beside the face rather than in it, because the
 * face is itself a button when it can be selected and a button cannot hold a
 * button; so the gallery draws it under each card, the draft rail draws it
 * under the card being read, and the builder's preview draws it under the
 * inspected card. The three share one label so a player who learned it in one
 * place finds it in the others.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';

export interface FaceFlipProps {
  /** The name of the card, for the accessible label. */
  readonly cardName: string;
  /** Every face's name, in printed order. */
  readonly faces: readonly string[];
  /** Which face is showing. */
  readonly index: number;
  readonly onFlip: (nextIndex: number) => void;
  /** Extra class names, for the surface to place it. */
  readonly className?: string;
}

/** The face after `index`, wrapping. */
export function nextFaceIndex(faces: readonly string[], index: number): number {
  return (index + 1) % Math.max(faces.length, 1);
}

/** The accessible name of the button that turns a card to its other face. */
export function faceFlipLabel(name: string, cardName: string): string {
  return `Show ${name} face of ${cardName}`;
}

/** Nothing for a single-faced card: the control exists only when it can act. */
export function FaceFlip(props: FaceFlipProps): ReactElement | null {
  if (props.faces.length < 2) return null;
  const next = nextFaceIndex(props.faces, props.index);
  const name = props.faces[next] ?? 'other';
  return createElement(
    'button',
    {
      type: 'button',
      className:
        props.className === undefined ? 'mtg-btn mtg-faceflip' : `mtg-btn mtg-faceflip ${props.className}`,
      'aria-label': faceFlipLabel(name, props.cardName),
      // The builder's preview is dismissed by any pointer press on the page;
      // a press on the control that turns the card over is not a dismissal.
      onPointerDown: (event: { stopPropagation(): void }): void => event.stopPropagation(),
      onClick: (): void => props.onFlip(next),
    },
    `Show ${name}`,
  );
}
