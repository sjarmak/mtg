/**
 * How tall a strip column's box is, when the pane around it knows its own height.
 *
 * `mtg-47xi`. `./strips.ts`'s `DECK_STACK_BOX` states `boxHeight: 360` and every
 * column in the app was that tall whatever window it was in. That was right when
 * the region sat in a page that scrolled: 360px is a readable stack and the page
 * carried whatever else there was. Since `mtg-tz11` the pane around it is a
 * scrollport with a measured height, and the constant became the only thing in
 * the arrangement that did not know how much room there is -- on a 1440x900 desk
 * the columns stopped short of the bottom of a pane with 300px of nothing under
 * them, while a deep column two positions along was clipped at the floor and had
 * lost its tail.
 *
 * # The room, in both directions, floored at the bottom strip
 *
 * It grew only, once, and the constant was the floor. The reason given was that
 * shrinking is the failure `../../styles/deck.ts`'s `.mtg-deck__pane-scroll > *`
 * rule had already fixed from the other end -- a region squeezed to a short
 * pane's height cut its columns off while the pane reported nothing to scroll.
 * That rule is what holds the region at its own height, and it still does; what
 * grow-only added on top of it was the same cut one level up.
 *
 * Measured on the shipped page (`mtg-4lfg`), sealed builder, 1440x900: the deck
 * pane's scrollport is 325px, the region inside it 392px, and both stacks report
 * no clipping while the pane scrolls 67px of them out of sight. The region was
 * laid out against the 360px constant because the room was less than that, so
 * every column believed it fitted and the bottom card of each was cut anyway.
 * The pane is where a reader would have to notice, and a reader looking at a
 * column of cards does not read the pane.
 *
 * So the box is the room, up and down, and the floor is the bottom strip's own
 * height rather than the caller's constant. That is a whole card face at the
 * full density and, since `mtg-mxkrk`, one name bar at compact: a region with
 * less height than the one thing it always draws whole has nothing to say --
 * the same reasoning `./strips.ts`'s `fullStackBox` already uses to make one
 * face its own floor. Below the room a deep column now sits on `minPitch`,
 * reports itself `clipped`, and scrolls inside its own column, which is what
 * the MTGO capture does and what `stackMetrics` was built to express.
 *
 * # Why CSS says whether to measure at all
 *
 * A region that took its height from its own scrollport unconditionally would
 * chase itself: where the scrollport is sized by its content -- the Constructed
 * builder below `BUILDER_FRAME_QUERY`, the draft pool under the pack -- a taller
 * box makes a taller scrollport makes a taller box, once per frame, forever.
 * Whether a pane has a height of its own is a question the media queries already
 * answer, and answering it a second time in JS is two statements of one fact
 * that can disagree. So each frame block declares `--strip-box-from: pane` on
 * the scrollport and this file reads that token: one discrete flag crossing the
 * boundary, no query string spelled twice, and a surface that never opts in
 * keeps the constant it has always had.
 */
import { useEffect, useRef, useState } from 'react';
import { STACK_BOX_FROM_PANE, STACK_BOX_SOURCE_PROPERTY } from '../../styles/stack-box';
import type { StackBox } from './strips';

/**
 * The four lengths the box is derived from, in CSS pixels.
 *
 * Stated as numbers rather than as elements so the arithmetic is exact and
 * testable without a browser, which is the same split `./strips.ts` draws
 * between the pitch and the drawing that positions it.
 */
export interface StackRoom {
  /** The pane scrollport's content height: all the room there is. */
  readonly scrollportHeight: number;
  /**
   * The pane scrollport's content width: all the room the columns share.
   *
   * Only the full density reads it (`./strips.ts`'s `fullColumnWidth`), and it
   * cannot chase itself the way the height can: the region declares
   * `overflow-x: auto`, so its width is the scrollport's whatever its columns
   * add up to, and a wider column can only make the region scroll rather than
   * make the pane wider.
   */
  readonly scrollportWidth: number;
  /** The strips region's top, measured from the top of that content. */
  readonly regionTop: number;
  /** The first stack's top within the region: the column heads and their gap. */
  readonly stackTop: number;
  /**
   * What the region spends below its columns: the padding it reserves, plus the
   * sideways scrollbar it draws there when its columns run off the right.
   *
   * `mtg-qs2d`. The padding alone was the reading, and a classic scrollbar is
   * about 15px more of it -- on a region sized by its content, the scrollbar
   * grows the region rather than being drawn inside it, so a box derived from
   * the padding alone came out a scrollbar too tall and the deepest column hung
   * out the bottom of the pane by that much. Measured rather than named, because
   * the same region on an overlay-scrollbar platform spends nothing here and a
   * constant would be wrong on one of the two.
   */
  readonly regionFoot: number;
}

/**
 * The box for a region with that much room, floored at its bottom strip.
 *
 * Floored down to whole pixels: the pitch is divided out of `boxHeight` and a
 * fractional box buys nothing but a stack whose last strip lands a tenth of a
 * pixel outside it.
 *
 * The caller's own `boxHeight` is not the floor and is not consulted. It is the
 * height a region has where nothing measured it, which is a different question
 * from how tall this pane is; treating it as a minimum is what let a 392px
 * region sit in a 325px pane and call itself unclipped.
 */
export function boxFromRoom(base: StackBox, room: StackRoom): StackBox {
  const room_ = room.scrollportHeight - room.regionTop - room.stackTop - room.regionFoot;
  const boxHeight = Math.max(base.faceHeight, Math.floor(room_));
  return boxHeight === base.boxHeight ? base : { ...base, boxHeight };
}

interface ElementLike {
  readonly getBoundingClientRect: () => { readonly top: number };
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly parentElement: ElementLike | null;
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly clientWidth: number;
  /** With the sideways scrollbar and any border; `clientHeight` has neither. */
  readonly offsetHeight: number;
}

/**
 * The room the region has, or `null` when nothing said it could measure.
 *
 * Exported for the browser rig, which asserts on the numbers rather than on the
 * box they produce: a box that came out right from two lengths that were both
 * wrong is the failure a test of the product alone cannot see.
 */
export function roomOf(region: ElementLike, styleOf: (element: ElementLike) => StyleLike): StackRoom | null {
  const scrollport = region.parentElement;
  if (scrollport === null) return null;
  if (styleOf(scrollport).getPropertyValue(STACK_BOX_SOURCE_PROPERTY).trim() !== STACK_BOX_FROM_PANE) {
    return null;
  }
  const stack = region.querySelector('.mtg-strips__stack');
  if (stack === null) return null;
  const regionTop = region.getBoundingClientRect().top;
  return {
    scrollportHeight: scrollport.clientHeight,
    scrollportWidth: scrollport.clientWidth,
    regionTop: regionTop - scrollport.getBoundingClientRect().top + scrollport.scrollTop,
    stackTop: stack.getBoundingClientRect().top - regionTop,
    regionFoot:
      (Number.parseFloat(styleOf(region).getPropertyValue('padding-block-end')) || 0) +
      // The difference is the sideways scrollbar, and a border if the region
      // ever grows one -- which is space under the columns either way, so
      // counting both is right rather than merely harmless.
      Math.max(0, region.offsetHeight - region.clientHeight),
  };
}

interface StyleLike {
  readonly getPropertyValue: (property: string) => string;
}

interface ObserverLike {
  readonly observe: (target: unknown) => void;
  readonly disconnect: () => void;
}

interface Host {
  readonly ResizeObserver?: new (callback: () => void) => ObserverLike;
  readonly getComputedStyle?: (element: unknown) => StyleLike;
}

/**
 * The room this region has, and the ref that finds it.
 *
 * Re-measured whenever the scrollport resizes, which is the window, the app bar
 * wrapping to a second line, and the details panel opening and closing above the
 * panes. Where the environment has no `ResizeObserver` -- server rendering, and
 * every jsdom suite in this package -- the hook does nothing at all and the
 * caller draws against whatever it states as its own floor, so a unit test
 * measures the arrangement it has always measured.
 *
 * The room rather than the box, since `mtg-rgc.21`. At the full density the box
 * is derived from the measured *width* (`./strips.ts`'s `fullColumnWidth` and
 * `fullStackBox`), so a hook that took a base box and returned a box would have
 * to be handed a box that already depended on what it was about to measure. It
 * also retires an effect whose dependency list spelled out the base's four
 * fields to keep a caller's inline object from re-running it every render: this
 * one depends on nothing and the observer carries every later reading.
 */
export function useStackRoom(): {
  readonly room: StackRoom | null;
  readonly ref: (element: unknown) => void;
} {
  const [room, setRoom] = useState<StackRoom | null>(null);
  const region = useRef<ElementLike | null>(null);
  useEffect(() => {
    const host = globalThis as Host;
    const Observer = host.ResizeObserver;
    const styleOf = host.getComputedStyle;
    const element = region.current;
    if (Observer === undefined || styleOf === undefined || element === null) return;
    const scrollport = element.parentElement;
    if (scrollport === null) return;
    const measure = (): void => {
      setRoom(roomOf(element, (target) => styleOf(target)));
    };
    const observer = new Observer(measure);
    observer.observe(scrollport);
    measure();
    return (): void => {
      observer.disconnect();
    };
  }, []);
  return {
    room,
    ref: (element: unknown): void => {
      region.current = element as ElementLike | null;
    },
  };
}

/**
 * The box this region should lay its columns out against, floored at `base`.
 *
 * The compact density's whole reading: a stated box, replaced by the pane's own
 * height wherever the pane declares one, floored at one strip.
 */
export function useStackBox(base: StackBox): {
  readonly box: StackBox;
  readonly ref: (element: unknown) => void;
} {
  const { room, ref } = useStackRoom();
  return { box: room === null ? base : boxFromRoom(base, room), ref };
}
