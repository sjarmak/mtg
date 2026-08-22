/**
 * A badge, and the one place one is drawn.
 *
 * It was `./Battlefield.ts`'s private vocabulary until two surfaces needed the
 * same badge. `mtg-njrp` draws the relationship between an object on the stack
 * and the permanent it is aimed at as **one mark on both ends** — the same
 * shape, the same number — and a shape a second file draws for itself is a shape
 * the two can disagree about. So the type, the drawings and the render live
 * here, `./Battlefield.ts` says which marks a permanent earns, and
 * `./StackZone.ts` puts the matching one on the entry doing the aiming.
 *
 * The sheet stayed where it was: `.mtg-mark` is a standalone rule in
 * `../styles/board/slot.ts` rather than a descendant of `.mtg-slot`, so a badge
 * outside a slot is already styled and nothing had to move to make the stack
 * draw one.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';

export type MarkTone = 'neutral' | 'positive' | 'negative' | 'pending';

/**
 * A mark drawn as a picture instead of as its own text.
 *
 * The paths live in `GLYPH_PATHS` below, which is a total record over this
 * type, so a member added here without a drawing is a compile error rather than
 * a blank badge.
 */
export type MarkGlyph = 'hourglass' | 'reticle';

export interface BoardMark {
  readonly key: string;
  /**
   * What the mark is called, and the badge's own text unless `glyph` draws it
   * instead. A glyph mark's label is therefore never seen, only heard.
   */
  readonly label: string;
  readonly tone: MarkTone;
  /**
   * The whole sentence, when the badge is an abbreviation of one. `ATK` and
   * `-2` say themselves; a `3/3` in the corner of a thumbnail cannot say what
   * the creature was printed as or what moved it, so the sentence goes here and
   * the badge stays the width of a badge.
   */
  readonly title?: string;
  /** Drawn in place of the label's text; see `MarkGlyph`. */
  readonly glyph?: MarkGlyph;
  /**
   * Short text drawn *beside* a glyph, for the one picture that is incomplete
   * without a number.
   *
   * The hourglass says the whole of what it means and needs nothing; the
   * reticle says "something on the stack is aimed here" and cannot say *which*
   * something, which is the entire question when two stack objects are aimed at
   * two twins. So the badge carries the aiming entry's place in the resolution
   * order, and that number is what pairs the two ends of the mark. It is not
   * `label`, because a label is the accessible name on a glyph mark and this is
   * two characters of paint.
   */
  readonly badge?: string;
  /**
   * Said, not shown: the badge is taken out of the picture and left in the
   * accessibility tree, carrying `title` as its whole content.
   *
   * Three marks are silent and every one of them is a fact the *drawing* now
   * carries — an attacker is in the combat band, a derived size is underlined —
   * so the badge would be the same sentence twice on a face with no room for it.
   * The mark is not deleted, and that is load-bearing in two directions. It is
   * the only path a screen reader has to either fact, since neither a position
   * nor an underline reaches one. And `../styles/board/attach.ts` selects the
   * underline itself through `:has(.mtg-mark[data-mark='derived'])` on this
   * card's own marks, so deleting the mark would delete the drawing the playtester
   * asked to keep.
   *
   * Hidden by `../styles/board/slot.ts` with the clip-and-shrink pattern rather
   * than `display: none` or `visibility: hidden`, both of which take an element
   * out of the accessibility tree and would make this field a way of deleting a
   * sentence silently.
   */
  readonly silent?: boolean;
}

/**
 * Each glyph as filled paths in a 12 x 12 box, scaled by CSS with the text.
 *
 * Filled rather than stroked because `.mtg-mark__glyph` sets `fill:
 * currentColor` and no stroke, so the reticle's ring is a donut — an outer
 * circle and an inner one wound the other way, which the nonzero rule cuts a
 * hole with — and its center is a third subpath wound like the outer one.
 * Two rings and no cross-hairs: at 0.85em the badge draws about eleven pixels
 * across, and four ticks at that size close the ring into a blob.
 */
const GLYPH_PATHS: Readonly<Record<MarkGlyph, string>> = {
  hourglass: 'M2 1h8v1.4H2z M2 9.6h8V11H2z M3.4 2.4h5.2L6 6z M6 6l2.6 3.6H3.4z',
  reticle:
    'M6 0.8A5.2 5.2 0 1 0 6 11.2A5.2 5.2 0 1 0 6 0.8Z M6 2.8A3.2 3.2 0 1 1 6 9.2A3.2 3.2 0 1 1 6 2.8Z M6 4.4A1.6 1.6 0 1 0 6 7.6A1.6 1.6 0 1 0 6 4.4Z',
};

function glyphNode(glyph: MarkGlyph): ReactElement {
  return createElement(
    'svg',
    { key: 'glyph', className: 'mtg-mark__glyph', viewBox: '0 0 12 12', 'aria-hidden': true },
    createElement('path', { d: GLYPH_PATHS[glyph] }),
  );
}

/** What a glyph mark draws: the picture, and the number that completes it. */
function markContent(mark: BoardMark): readonly ReactElement[] | string {
  if (mark.glyph === undefined) return mark.label;
  const picture = glyphNode(mark.glyph);
  return mark.badge === undefined
    ? [picture]
    : [picture, createElement('span', { key: 'badge', className: 'mtg-mark__badge' }, mark.badge)];
}

/**
 * One badge, named.
 *
 * `role: 'img'` with an `aria-label` rather than a bare `title`, and that is the
 * defect this closes rather than housekeeping. A `span` carrying no role is
 * generic, and a generic element is dropped from the accessibility tree
 * whatever it is labeled — `../card/Card.ts` learned the same thing about the
 * inert face. So every mark on the table was published to a screen reader as
 * either loose text or nothing, and an hourglass would have been nothing at
 * all. The `title` stays beside it, because a pointer wants the tooltip and
 * `aria-label` is not one.
 */
export function markNode(mark: BoardMark): ReactElement {
  const name = mark.title ?? mark.label;
  // A silent mark draws nothing, so it is given no `title`: a tooltip is a
  // pointer affordance and there is no longer anything under the pointer for it
  // to hang on. The `aria-label` is the whole of it, and `role: 'img'` is what
  // keeps a labeled generic element in the tree at all.
  const content = mark.silent === true ? null : markContent(mark);
  return createElement(
    'span',
    {
      key: mark.key,
      className: 'mtg-mark',
      'data-mark': mark.key,
      'data-tone': mark.tone,
      role: 'img',
      'aria-label': name,
      ...(mark.silent === true ? { 'data-silent': true } : { title: name }),
    },
    content,
  );
}
