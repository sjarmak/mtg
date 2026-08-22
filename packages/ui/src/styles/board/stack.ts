/**
 * The stack, drawn on the seam between the two seats rather than in the rail.
 *
 * `mtg-rgc.7`. It was a rail block, and a rail block is a place whether or not
 * it holds anything: `./rail.ts` floors every one of them at `RAIL_BLOCK_MIN_REM`
 * so a squeezed block still reads as a place. An empty stack is the state of the
 * table at nearly every decision in a game, so that floor was 52px of the one
 * column the log is trying to grow in, spent on a box that said "stack is empty".
 * `../../board/StackZone.ts` now renders `null` when the stack is empty and this
 * sheet places what it renders when it is not.
 *
 * # Where it sits, and why that is a measurement rather than a hope
 *
 * An overlay that covers a card the player is about to click is not a smaller
 * layout, it is a worse one — Wizards shipped 2025.47.00 to fix exactly that in
 * Arena. So the strip goes in the one region of `.mtg-board__lanes` that was
 * measured to hold no ink and no click target, and the measurement is the
 * reason for the geometry below rather than a note beside it.
 *
 * Measured in chrome-headless-shell over the played table on the DSL example
 * set, at 1024x768, 1280x800 and 1440x900, at 4 and 12 permanents a side, with
 * the stack empty and two objects deep — twelve cells, and in every one the
 * nearest object above the seam and the nearest below it were both an empty
 * `.mtg-slot` box, never a card face, a badge, a button or a line of text. The
 * free band around the divider's midline read 53.5px at its worst (1280x800,
 * 4 a side) and 63.2px at its best, and it does not shrink with crowding: at
 * twelve a side it is 58.1 / 61.1 / 63.2px against 57.6 / 53.5 / 57.1px at four.
 *
 * `STACK_SEAM_REM` and `STACK_SEAM_TOP_REM` place a 32px strip at `[-12, +20]`
 * from the divider's top edge inside that band. What is left over is the
 * clearance, and it is not symmetric: 18.0px above and 7.6px below at 1024x768,
 * 3.0px above and 18.5px or more below at the two wider ones. The numbers are
 * here rather than inline because the two of them are one decision, and the
 * decision is the difference between the two — a strip that grew without the
 * top moving would eat the 7.6px below it silently.
 *
 * **The guarantee is asserted, not stated.** `../../test/play/stack-seam.browser.test.ts`
 * re-measures the whole matrix in a real browser: every interactive element on
 * the page must answer its own center under `elementFromPoint`, and every slot
 * on both battlefields must have the identical rect with the stack empty and
 * with the stack loaded. A comment cannot fail; those do.
 *
 * # What happens when there is no room
 *
 * Three rules, and between them they cover every state the table can be in.
 *
 * **Width is the only axis it spends.** The strip is one row at a fixed height,
 * entries shrink with an ellipsis on the name, and nothing in it wraps or
 * scrolls the board. A stack ten deep is exactly as tall as a stack one deep,
 * so "the board is crowded" and "the stack is deep" are independent and neither
 * can push the other off the table. What a shrunken entry stops saying, the ask
 * column still says in full: the legal-move enumeration is untouched by this
 * bead and `Let it resolve` is still a line in it.
 *
 * **When the seam is holding cards, the strip stops being an overlay.** The
 * combat band grows to `COMBAT_BAND_SHARE`% and fills with attackers, and at
 * that point the free window this sheet was measured against is gone — so the
 * strip becomes an ordinary flex item beside them and flex layout is the
 * non-overlap guarantee instead of the measurement. One element, two
 * arrangements, selected off the `data-combat` `../../board/CombatZone.ts`
 * already writes; nothing has to detect anything.
 *
 * **Under a coarse pointer the board moves instead.** `../touch.ts` floors every
 * `.mtg-btn` at `TOUCH_TARGET_PX`, which makes the resolve control alone taller
 * than the 42.5px window, so on that input the strip goes back into flow and the
 * seam grows. Reflow is the wrong trade on a mouse — it is the cost this bead
 * exists to remove — and it is the right one for a finger, because the
 * alternative is an overlay guaranteed to cover something.
 *
 * # The paint
 *
 * The top entry takes the accent, because "what resolves next" is the one
 * question this strip exists to answer. Entries lay out left to right in
 * resolution order, which is what `../../board/StackZone.ts` hands over: it used
 * to be a `column-reverse` column over a bottom-first list, which drew the right
 * picture and read out backwards.
 */
import { cssNumber } from '../number';

/**
 * How tall the strip is, in rem.
 *
 * Every other height on this table is a share of something. This one is a
 * constant because it is not sizing content, it is fitting inside a gap that was
 * measured once: the docblock above has the twelve readings and the 42.5px
 * window they agree on. A share would track the viewport and the window does
 * not — the seam is the same handful of pixels at 1024x768 and at 1440x900,
 * because it is padding rather than a fraction of the board.
 */
export const STACK_SEAM_REM = 2;

/**
 * Where its top edge sits relative to the divider's, in rem.
 *
 * Negative, so the strip straddles the seam rather than hanging below it. The
 * band that is free in all twelve cells reaches at least 15px above the
 * divider's top edge and at least 27.6px below it, and the strip is 32px tall,
 * so a top anywhere in `[-15, -4.4]` clears at both ends. -12 spends the slack
 * on the side the measurement was tighter on: at 1024x768 the room below the
 * strip is 7.6px and the room above it 18.0px, and moving the strip up buys the
 * scarce side out of the plentiful one.
 */
export const STACK_SEAM_TOP_REM = -0.75;

export const STACK_CSS = `
/* The seam is what the strip is positioned against, which is also why the strip
   is a child of the divider rather than of the lanes: the element that decides
   whether combat is open is the element the stack has to agree with, and one
   parent means the agreement is layout rather than arithmetic. ./band.ts
   declares everything else about this element and declares no position, so this
   line adds a containing block and changes no paint. */
.mtg-board__divider { position: relative; }
/* Out of flow, so a spell going on the stack moves no card. That is the whole
   of the lever: the old rail block took its 52px whether or not it held
   anything, and this takes nothing on either axis until there is something to
   draw. Centered over the seam and stretched across the lanes so the strip is
   in the middle of the table wherever the two rows have got to. */
.mtg-board__divider[data-combat='false'] .mtg-stack-seam {
  position: absolute;
  inset-inline: 0;
  top: ${cssNumber(STACK_SEAM_TOP_REM)}rem;
  height: ${cssNumber(STACK_SEAM_REM)}rem;
  z-index: 20;
}
/* Over the board, under the two things that are meant to cover the board. The
   zoomed face is 40 and the picker is 45 (../views.ts), and both are answers to
   a click the player just made; the stack is state, and state that could hide
   the dialog you opened over it would be the same bug in the other direction. */
/* The flanks are transparent to the pointer and the ink is not. The measurement
   says nothing legal is under the strip today; this says that if something ever
   arrives there, only the part of the strip that is actually drawn can be in its
   way — an empty 32px bar the width of the table is a click-eater with nothing
   to show for it. The entries and the count keep their events, so the resolve
   control still works and the browser gate still has something to catch. */
.mtg-stack-seam {
  display: flex; align-items: center; justify-content: center;
  gap: var(--mtg-space-2);
  pointer-events: none;
}
.mtg-stack-seam > * { pointer-events: auto; }
/* Open: the strip is an item in the combat row, sized by its content and
   shrinking before the attackers do. It keeps its place at the head of the row
   because ../../board/CombatZone.ts puts it first, which is the reading order
   as well: what is about to resolve, then what is fighting.

   min-width: 0 is what makes "shrinking before the attackers do" true — a flex
   item's automatic minimum is its content, so without it the strip would hold
   its own width and take it out of the row. Its content survives the shrink
   because .mtg-stack below already clips, which is also where the entries' own
   ellipsis comes from. Measured at 1024x768, 1280x800 and 1440x900 by four and
   twelve attackers a side: at twelve a side the strip is squeezed from 385.1px
   to 140.5px and no part of its ink meets any card, slot or control on the
   board in any of the six cells. */
.mtg-board__divider[data-combat='true'] .mtg-stack-seam {
  flex: 0 1 auto; min-width: 0; align-self: center;
}
/* How many objects, in a strip whose entries may all have shrunk to their
   ellipses. It is the one fact the row cannot show by being a row.

   On the raised paper the entries use rather than on the seam's own oxblood,
   which ./band.ts already ruled out for text it wants read: the seam is a dark
   bar and --mtg-ink is dark ink, so a pill in the seam's color would be the one
   label on this strip nobody can read. */
.mtg-stack-seam__count {
  flex: none;
  padding: 0 var(--mtg-space-2);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-pill);
  background: var(--mtg-surface-raised);
  color: var(--mtg-ink);
  font-family: var(--mtg-font-ui); font-size: var(--mtg-text-xs); font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
}
.mtg-stack {
  display: flex; flex-direction: row; align-items: center;
  flex: 0 1 auto; min-width: 0;
  gap: var(--mtg-space-1);
  margin: 0; padding: 0; list-style: none;
  overflow: hidden;
}
.mtg-stack__entry {
  display: flex; flex-direction: row; align-items: center;
  flex: 0 1 auto; min-width: 0;
  gap: var(--mtg-space-2);
  padding: 0 var(--mtg-space-2);
  background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line-strong);
  border-radius: var(--mtg-radius-md);
  line-height: 1.5;
}
.mtg-stack__entry[data-top='true'] { border-color: var(--mtg-accent); background: var(--mtg-accent-soft); }
/* The move, on the object it is about (mtg-atq). Its own width rather than the
   column's, because there is no column any more; and no block padding, because
   ../base.ts's 4px would put the control over the strip's height on its own.
   ../touch.ts still floors it at a touch target under a coarse pointer, which is
   the input the fallback at the foot of this sheet exists for. */
.mtg-stack__resolve { flex: none; padding-block: 0; }
.mtg-stack__name {
  flex: 0 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--mtg-font-card); font-weight: 700; font-size: var(--mtg-text-sm);
}
.mtg-stack__order { color: var(--mtg-ink-muted); font-family: var(--mtg-font-ui); font-weight: 600; }
.mtg-stack__meta {
  display: flex; flex: 0 1 auto; min-width: 0;
  align-items: center; gap: var(--mtg-space-2);
  overflow: hidden; white-space: nowrap;
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted);
}
/* A finger gets the reflow the mouse no longer pays for. The selector matches
   the absolute rule above rather than the bare class, because that rule is two
   selectors deep and a media query buys no specificity. */
@media (pointer: coarse) {
  .mtg-board__divider[data-combat='false'] .mtg-stack-seam {
    position: static;
    height: auto;
    padding-block: var(--mtg-space-1);
  }
}
`;
