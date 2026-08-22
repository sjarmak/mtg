/**
 * A zone: a well debossed into the mat.
 *
 * One tonal step down from the mat, keylined in the mat's own edge. Tonal
 * rather than an inset shadow, because DESIGN.md §4 spends shadow on objects and
 * the mat is the one object this composition adds. The rail tone is the
 * exception and stays paper — a hand and a stack are things you hold, not places
 * on the table.
 *
 * The replay viewer reads these as a still frame and the playable board reads
 * them as a live one, so the layout is driven entirely by props: a zone knows
 * how many objects it holds and nothing about whose turn it is.
 *
 * It knows nothing about whose *half* it is on either, and still lands in the
 * right tone: a well cut into a seat's band takes that band's color from the
 * seat above it rather than from the declaration below, which `./band.ts` does
 * in one rule and explains. The well tone here is what a zone outside the
 * two-seat markup gets, and what the rail-toned zone keeps either way — a hand
 * and a stack are things you hold, not places on the table, and Magic Online
 * agrees by drawing the hand outside both bands entirely.
 */
import { TABLE } from './geometry';

export const ZONE_CSS = `
.mtg-zone {
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  padding: var(--mtg-space-2) var(--mtg-space-3);
  background: var(--mtg-mat-well);
  border: 1px solid var(--mtg-mat-edge);
  border-radius: var(--mtg-radius-lg);
  min-height: 4.5rem;
}
.mtg-zone[data-tone='rail'] { background: var(--mtg-surface-rail); border-color: var(--mtg-line); }
.mtg-zone__head { display: flex; align-items: baseline; gap: var(--mtg-space-2); }
.mtg-zone__label {
  font-size: var(--mtg-text-xs); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--mtg-ink-faint);
}
.mtg-zone__count { font-family: var(--mtg-font-mono); font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
.mtg-zone__note { margin-left: auto; font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); }
.mtg-zone__body { display: flex; flex-wrap: wrap; gap: var(--mtg-space-2); align-items: flex-start; }
/*
 * A rail is one row that runs off the edge, not a grid that reflows. An opening
 * hand is seven slots and six gaps — 69.5rem — so under the wrap every other
 * zone wants, the hand broke onto a second row at any ordinary width and stopped
 * reading as a hand at all. The mockup's rail scrolls rather than wrapping, and
 * this is that rule; it is opt-in per zone rather than keyed off the rail *tone*,
 * because the tone is a paint decision and this is a layout one. The witness
 * used to be the stack, which wore the tone and wanted the wrap; mtg-rgc.7 made
 * the stack a strip on the seam that is no longer a zone at all, and the
 * graveyard browsers it left behind wear the same tone and carry no zone body to
 * wrap — so the argument is unchanged and ../../../test/board.test.ts states it
 * against a plain rail-toned zone instead.
 *
 * The block padding is what makes the hover legible rather than clipped. An
 * overflow-x of auto takes the block axis with it — a visible on the other axis
 * computes to auto beside it, so there is no way to scroll one axis and overflow
 * the other — and the body becomes a scroll container both ways. A hand face is
 * exactly as tall as the rail, so the 1.03 hover scale was cut by about 3px top
 * and bottom. This is the room that scale needs.
 *
 * **And the inline axis needed the same room, which is mtg-3oy.** The block
 * padding was written alone, so the first slot's inline-start edge sat flush
 * against the scroll container's padding box, and every mark a hand card paints
 * *outside* its border box was cut there: ./slot.ts's castable ring (2px of
 * amber over 3px of seam, plus its halo), ../card.ts's selection outline (2px at
 * 2px of offset), ../base.ts's focus ring, and the 1.03 hover scale, which on a
 * 124px face reaches 1.86px past the edge on each side. the playtester, 2026-08-13:
 * "for some reason the leftmost card in your hand sometimes has the left border
 * cut off". *Sometimes* is the paint state rather than the layout — the first
 * card's offset from the clip edge is 0.00px at every viewport and every hand
 * size, measured in chrome-headless-shell 151 over the flagship set, so that
 * card is cut whenever it wears one of those marks and is perfect when it wears
 * none. A card with no move on it wears none, and most of a hand is in that
 * state most of the time, which is why the defect reads as intermittent.
 *
 * **It is paid for out of the zone's own padding rather than out of the row.**
 * A bare padding-inline would take 8px off the row's content box, and that row
 * is what ./hand.ts sizes both hands *and* both battlefields from: a seventh of
 * 8px is 1.14px off every hand face, which moves the hand-to-board ratio off the
 * 1.25 and 1.05 that mtg-d6s and mtg-b8e measured and published. So the padding
 * comes with an equal negative inline margin. ./fit.ts gives a play-route zone
 * a --mtg-space-2 of inline padding and this file gives it a --mtg-space-3 off
 * that route, both wider than the step spent here, so the body's border box
 * grows into ground the zone was already holding and its *content* box is the
 * width it always was. Measured before and after at 1440x900, 1280x800,
 * 1024x768 and 810x1080: every face box, every ratio and every clipped-name
 * count is identical.
 *
 * The bleed is bounded by that zone padding, and it is the one thing to check
 * before narrowing it: a zone with less than --mtg-space-1 of inline padding
 * would let this row paint over its own keyline.
 *
 * **The battlefield row had the same omission, and mtg-e3n is that row.** It is
 * fixed below rather than here, because it is a scroll container inside another
 * one and needs the pair twice; the measurement is in that rule's own docblock.
 *
 * jsdom performs no layout, so no test in this suite can see the clipping.
 * ../../../test/play/hand-edge.test.ts asserts the next best thing, which is
 * which declarations win the cascade on a play-route hand body: ./fit.ts
 * restates this rule's block padding one sheet later at equal specificity, and a
 * padding shorthand there would silently take the inline half back.
 */
.mtg-zone__body[data-layout='rail'] {
  flex-wrap: nowrap;
  overflow-x: auto;
  padding-block: var(--mtg-space-1);
  padding-inline: var(--mtg-space-1);
  margin-inline: calc(-1 * var(--mtg-space-1));
}
.mtg-zone__empty { font-size: var(--mtg-text-sm); color: var(--mtg-ink-faint); font-style: italic; }
/*
 * The battlefield row, given the room the hand rail above it already has, and
 * given it twice because the clip is two boxes deep. That is mtg-e3n, and the
 * doubling is the whole of why it was filed rather than done in passing.
 *
 * ./fit.ts makes .mtg-board__spells a scroll container on this route so the
 * spells scroll without taking the mana base off the screen with them, and
 * makes .mtg-zone__body[data-layout='board'] one as well. Both carried block
 * padding only, so the first permanent's inline-start edge sat flush against
 * two padding boxes at once and every mark a card paints outside its border box
 * was cut there: ./slot.ts's castable ring (2px of amber over 3px of seam, plus
 * a 14px halo), ../card.ts's selection outline and ../base.ts's focus ring
 * (2px at 2px of offset each), and the 1.03 hover scale. Measured in
 * chrome-headless-shell 151.0.7922.47 over the flagship set at 1440x900,
 * 1280x800, 1024x768 and 810x1080 by 4, 8 and 12 permanents a side: the first
 * permanent's offset from the nearest clip edge was 0.00px in all 24 cells, at
 * both seats, and is 4.00px in all 24 after. ../../../tools/board-edge.ts is
 * that rig and names the binding clipper on each side, which is what tells a
 * fix that moved the clip out one box from a fix that moved it off the card.
 *
 * **The pair on the inner row alone would have been that first kind of fix.**
 * A negative margin only bleeds into ground the parent is already holding, and
 * the body holds none inline, so the row would have grown 4px into a box that
 * clips at exactly the same place. So the body takes the pair first and bleeds
 * into the zone's own --mtg-space-2 of inline padding (./fit.ts), and the row
 * bleeds into the body's new step. Two boxes, one step, spent once: the zone
 * keeps half its padding, so this row still cannot paint over its own keyline.
 *
 * **And the content box is the width it always was, which is what makes it
 * payable.** ./hand.ts turns this row's content box into --hand-slot and then
 * into --board-face, so a bare padding-inline would take 8px off the row and a
 * seventh of that — 1.14px — off every permanent on the table. What that buys
 * against is ../card.ts's BOARD_RULES_MIN_REM: the rules box goes when the
 * face's *content* box reaches 4rem, which on the face this was measured on —
 * 4px of border and 4px of padding a side, before mtg-iqyc made the band a
 * share of the width — was an 80.00px face against a board face of 82.61px at
 * 1280x800 with four a side. So the headroom there was 2.61px rather than the
 * fifth of a pixel mtg-e3n was filed with, which quoted the floor as a face
 * width; 1.14px would not have crossed it, and two such changes would. On the
 * proportional band the same 82.61px face has a 76.61px content box and the
 * rules box goes at a 69px face, so the headroom is wider still. The margin is
 * what makes the question moot: measured before and after, every face box at
 * all four viewports by all three densities at both seats is identical to the
 * hundredth of a pixel, 82.61 x 115.41 included, and
 * ../../../tools/hand-scale.ts, card-uniformity.ts and tap-rotation.ts read the
 * same across 32 readings.
 *
 * Scoped to the played table because the clip is: off this route ./lands.ts
 * leaves the row wrapping with visible overflow, so there is nothing to reserve
 * against and ../../../test/board.test.ts pins that reading.
 *
 * The mana band under this row is a scroll container too (./lands.ts) and still
 * clips its first tile at 0.00px, measured at both seats at all four viewports.
 * That is a tile rather than a card — no rules box, no name bar — and it is
 * left to mtg-7i50 rather than folded in here.
 */
${TABLE} .mtg-zone__body[data-layout='board'],
${TABLE} .mtg-board__spells {
  padding-inline: var(--mtg-space-1);
  margin-inline: calc(-1 * var(--mtg-space-1));
}
`;
