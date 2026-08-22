/**
 * Where a cue starts and where it ends, as arithmetic over boxes.
 *
 * FLIP (First, Last, Invert, Play) is the idiom, and the reason is responsive
 * layout: the table reflows at every viewport, a battlefield row re-fits every
 * time a permanent lands (`../styles/board/arrival.ts` measures 136.1px faces
 * becoming 119.7px in one frame at eight going to nine), and the hand is a
 * seventh of its row. Any coordinate written down here would be wrong on the
 * next window. So nothing is written down: both ends are *measured* off the
 * laid-out page, the difference between them becomes one transform, and the
 * browser plays it out.
 *
 * Everything in this file is a function of rectangles. The measuring is
 * `./runner.ts`'s, which is what lets the ordering, the fallbacks and the
 * inversion be asserted in a test with no layout engine in it.
 *
 * **Transforms only.** Every value produced here lands in `transform` and
 * `opacity`, which are the two properties that cannot move a layout box.
 * `../styles/board/slot.ts` pairs `aspect-ratio` with `min-height: 0` to make
 * every face on the board one height, and `arrival.ts` records what happens to
 * that pair when an animation touches a length: the uneven-row bug comes back.
 * A traveling card is also drawn in a layer of its own, so it cannot reflow the
 * row it is leaving or the one it is joining.
 */
import type { ZoneId } from '@mtg/kernel';
import type { MotionSeat } from './plan';

/** The part of a `DOMRect` any of this needs. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The element that stands for a zone, per seat, or null when the board draws no
 * such thing.
 *
 * Five of the six zones are on screen and one is not. The library is drawn
 * nowhere at all — a deck has no element, only a count in the pod. A cue
 * touching it still happens; it is given `fallbackRect` below rather than being
 * dropped, because "the card went somewhere off the table" is a truer thing to
 * show than the card vanishing. Exile joined the drawn five in `mtg-iidz` and
 * takes the same fallback while it is empty, since the pod draws no strip for a
 * seat that owns nothing there (`../board/Board.ts`) and a selector that matches
 * nothing is already the case the caller handles.
 *
 * The selectors are the shipped markup and nothing invented for this lane:
 * `../board/Board.ts` writes `data-seat` on each lane, `../board/Zone.ts` writes
 * `data-layout` on each body (`board` is the battlefield, `rail` inside a lane is
 * the hand), `../board/StackZone.ts` names the stack, and `../board/ZoneBrowser.ts`
 * carries the seat its pile belongs to and which of that seat's two piles it is
 * — one seat now has two browsers, so the seat alone no longer picks one out.
 */
export function zoneSelector(zone: ZoneId, seat: MotionSeat): string | null {
  const lane = `.mtg-board__side[data-seat='${seat}']`;
  switch (zone) {
    case 'battlefield':
      return `${lane} .mtg-zone__body[data-layout='board']`;
    case 'hand':
      return `${lane} .mtg-zone__body[data-layout='rail']`;
    case 'stack':
      return '.mtg-stack';
    case 'graveyard':
      return `.mtg-browser[data-seat='${seat}'][data-zone='graveyard']`;
    case 'exile':
      return `.mtg-browser[data-seat='${seat}'][data-zone='exile']`;
    case 'library':
      return null;
    default:
      return null;
  }
}

/**
 * The mat itself, which the runner marks as driven.
 *
 * The element the hook is given is the route's wrapper (`../routes/play/PlayView.ts`
 * says why it has to be an ancestor of the fixed ghost plane), and the sheet's
 * fallback arrival is scoped to `.mtg-board:not([data-motion='on'])`
 * (`../styles/board/arrival.ts`). An attribute written only on the wrapper
 * therefore left that rule matching, so an opponent's arriving permanent wore
 * both vocabularies at once — the CSS `translate` and this layer's `transform`.
 * Named here beside the other selectors so the two files cannot drift.
 */
export const MAT_SELECTOR = '.mtg-board';

/** The lane a seat's cards live in, which is what an unanchored zone falls back to. */
export function laneSelector(seat: MotionSeat): string {
  return `.mtg-board__side[data-seat='${seat}']`;
}

/**
 * Where a zone with no element on the table is treated as being: just outside
 * the far edge of its own seat's lane.
 *
 * Off the top for the opponent and off the bottom for you, which is the same
 * reading `arrival.ts` used to choose its direction — the far seat's cards come
 * from off the top of the mat, yours from off the bottom. A card drawn therefore
 * rises out of your own edge into your hand, and a card milled sinks back
 * through it. The box is the size of the anchor it is offset from so a ghost
 * keeps its proportions, and it is a quarter of that box outside the lane rather
 * than a whole one: far enough that the travel is unmistakably from off-table,
 * near enough that the card is on screen for most of it.
 */
export function fallbackRect(lane: Rect, seat: MotionSeat, size: Rect): Rect {
  const drop = size.height * 0.25 + size.height;
  const y = seat === 'opponent' ? lane.y - drop : lane.y + lane.height + drop - size.height;
  return { x: size.x, y, width: size.width, height: size.height };
}

/** The middle of a box. Travel is measured center to center, so a card of one size
 * moving into a slot of another does not appear to jump at either end. */
export function centerOf(rect: Rect): { readonly x: number; readonly y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The inversion: what to add to an element that is already sitting at `last` to
 * make it appear to be at `first`.
 *
 * Scale as well as offset, because the same card is drawn at different sizes in
 * different zones — a hand slot is a seventh of the hand row and a battlefield
 * slot is whatever the row fits — so a card that traveled on offset alone would
 * change size in one frame at the end of an otherwise smooth movement. Guarded
 * against a zero-width `last`, which is what a browser reports for an element
 * that is display:none or not laid out, and which would otherwise produce an
 * infinite scale.
 */
export function invert(
  first: Rect,
  last: Rect,
): { readonly dx: number; readonly dy: number; readonly scale: number } {
  const from = centerOf(first);
  const to = centerOf(last);
  const scale = last.width > 0 ? first.width / last.width : 1;
  return { dx: from.x - to.x, dy: from.y - to.y, scale };
}

/** A transform string, built in one place so the runner never assembles CSS. */
export function transformOf(dx: number, dy: number, scale: number): string {
  return `translate(${round(dx)}px, ${round(dy)}px) scale(${round(scale)})`;
}

/**
 * Two decimals. A transform is a rendering instruction rather than a measurement,
 * and full float precision in it is bytes in the style attribute that no display
 * can resolve; it also makes a test assert against a number the layout engine
 * happened to produce.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
