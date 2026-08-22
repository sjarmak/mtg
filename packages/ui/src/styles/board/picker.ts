/**
 * A card's own moves, drawn in the rail's column at the end of the table.
 *
 * `position: fixed` for the reason the zoom is (`../../board/CardSlot.ts` writes
 * it out): every zone body on the played table is `overflow: auto`, and an
 * absolutely positioned menu inside a hand slot would be clipped by the rail it
 * sits in, and a picker you can only reach by scrolling the hand sideways is a
 * picker that is not there. Fixed boxes are clipped only by a transformed,
 * filtered or contained ancestor, and no ancestor of a slot is any of those.
 *
 * **Where it sits is `mtg-jft`'s verifier finding.** It was anchored to the
 * start corner, which is the corner your hand is drawn in: measured in chromium
 * at 1440x900, the panel came out [16,705,240,179] against hand slots
 * [30,665,150,217] and [188,665,150,217], so a menu asking which aiming you
 * wanted was drawn over the cards you were choosing between. The rail's column
 * is the one part of the table that holds no card and already holds every
 * variable-length thing (`./rail.ts`, and `Board`'s own `rail` prop), and a
 * picker's height is decided by the game state exactly as the move list's is. So
 * it goes there, at the bottom of that column. Measured after, at the same
 * position: [1184,705,240,179] at 1440x900, [1024,605,240,179] at 1280x800 and
 * [768,573,240,179] at 1024x768, intersecting no slot and no land chip at any of
 * the three, and the point at the center of its first option hit-tests to that
 * option.
 *
 * What it covers is the row the rail ends on, and how much of that row is the
 * window's height rather than a constant. Measured in chromium at this
 * position's ordinary priority, where eight moves are on offer and `Pass` is the
 * last of them: at 1440x900 the panel is [1184,705,240,179] and covers none of
 * the eight; at 1280x800 it is [1024,605,240,179] over `Pass` at
 * [1000,593,246,37] and takes 222x25 of it, which is 25 of that button's 37
 * rows; at 1024x768 it is [768,573,240,179] over `Pass` at [744,593,246,37] and
 * takes all 37. "None of the eight" is what this comment shipped saying, and it
 * holds at one viewport of the three, so the claim here is a bound instead: at
 * most the rail's last row, and no card at any of the three. Nothing moves under
 * it, the panel body is its own scroller, and Escape from anywhere on the table
 * or a second click on the card gives the rail back in one stroke.
 * The zoom moves the other way on this route (`./fit.ts`'s `ZOOM_CLEARANCE`),
 * landing at [892,543,244,341] against the picker's [1184,705,240,179] at
 * 1440x900, so the two are still on screen together and a player choosing
 * between four aimings of one spell still sees that spell's whole face while
 * they do it.
 *
 * The list scrolls inside itself rather than growing, because a
 * `declareBlockers` prompt can name one blocker in dozens of assignments and a
 * menu taller than the window has options nobody can press.
 */
import { cssNumber } from '../number';
import { PLAY_RAIL_REM } from './rail';

/**
 * How far the picker sits from the window's end and bottom edges, and how wide
 * it is. Two numbers rather than a spacing token, because they are arithmetic
 * now and the test that keeps them honest does the sum.
 *
 * `PICKER_INSET_REM + PICKER_WIDTH_REM <= PLAY_RAIL_REM` is the whole placement
 * argument: the mat is two grid columns, every card is drawn in the first one,
 * and a box anchored to the window's end edge that is no wider than the rail
 * cannot reach past the rail's own start edge. The rail column's start edge is
 * further from that window edge than 17rem, by the shell's padding and the
 * mat's, so the slack is real rather than exact.
 */
export const PICKER_INSET_REM = 1;

/** And the width the sum above leaves it. */
export const PICKER_WIDTH_REM = PLAY_RAIL_REM - 2 * PICKER_INSET_REM;

export const PICKER_CSS = `
.mtg-picker {
  position: fixed; z-index: 45;
  inset-block-end: ${cssNumber(PICKER_INSET_REM)}rem; inset-inline-end: ${cssNumber(PICKER_INSET_REM)}rem;
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  width: ${cssNumber(PICKER_WIDTH_REM)}rem; max-height: 60vh; overflow-y: auto;
  padding: var(--mtg-space-2);
  background: var(--mtg-surface-rail); border: 1px solid var(--mtg-line-strong);
  border-radius: var(--mtg-radius-md); box-shadow: var(--mtg-shadow-table);
}
.mtg-picker__title {
  font-size: var(--mtg-text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--mtg-ink-faint);
}
.mtg-picker__list { display: flex; flex-direction: column; gap: var(--mtg-space-1); }
.mtg-slot[data-picking='true'] > .mtg-card { outline: 2px solid var(--mtg-accent); outline-offset: 2px; }
`;
