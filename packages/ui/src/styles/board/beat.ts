/**
 * Where the acknowledgment sits while a beat plays as motion on the board.
 *
 * `mtg-gt4q`. `../../routes/play/beat-motion.ts` argues why a beat that names
 * permanents is drawn as movement rather than as a panel; this file argues the
 * one geometric question that arrangement asks, which is where to put a control
 * that has to be reachable *during* an animation without covering the animation.
 *
 * # On the seam, because that is the band with nothing in it
 *
 * `.mtg-board__divider`, the bar between the two battlefields. `./stack.ts` had
 * the same problem one bead earlier and measured the answer rather than guessing
 * it: twelve cells in chrome-headless-shell, three viewports by two board sizes
 * by an empty and a loaded stack, and in every one the nearest object above the
 * seam and the nearest below it were both an empty slot box, never a card face,
 * a badge, a button or a line of text. The free window read 53.5px at its worst
 * and does not shrink with crowding. That measurement is what this control is
 * spending, and the control is 28.8px tall at the shipped type scale, so it fits
 * the window the strip was already fitted into.
 *
 * A child of the divider rather than of the lanes, which is `./stack.ts`'s rule
 * verbatim: the element that decides whether combat is open is the element
 * anything drawn on this seam has to agree with, and one parent makes the
 * agreement layout instead of arithmetic. It also removes the reason the first
 * version of this file was wrong — centering in `.mtg-board__lanes` put the
 * control at 50% of an element whose two halves are not the same height, because
 * the viewer's band also carries the step bar and the hand. Measured at
 * 1440x900: the lanes' midline is 470px and the seam is at 358px, so the
 * Continue was drawn 99px inside the near battlefield, over the player's own
 * cards.
 *
 * # The end of the seam, not the middle
 *
 * `inset-inline-end`, because the middle of this window is taken. `./stack.ts`
 * puts the stack strip across the same band with its ink centered, and a beat is
 * at its most likely with a spell on the stack — the playtester's own sentence has a
 * removal spell in it. A deep stack fills the width, so "centered ink and a
 * control at the end" is not on its own a guarantee. The second rule below is:
 * while a beat is up, the strip's end edge stops short by
 * `BEAT_SEAM_CLEARANCE_REM`, so the two boxes cannot meet whatever the stack is
 * holding. It is a layout fact rather than a measurement, which is the stronger
 * of the two and the only one available here — the stack's own window was
 * measured against a board, and this is one drawn box against another.
 *
 * The third rule is the same reservation for the other resident. An open combat
 * band fills this element with a scrolling strip of attackers (`./band.ts`), and
 * a death beat from combat damage is exactly the case where both are up at once.
 * `padding-inline-end` on the open band takes the column out of the strip's
 * content box, so flex layout keeps the attackers off the control the way it
 * keeps them off the stack. Padding on a *closed* band changes nothing, since
 * everything on it is out of flow, so the rule is scoped to the open one and the
 * resting board this bead is mostly about pays nothing.
 *
 * `BEAT_SEAM_CLEARANCE_REM` is the one number here, and
 * `../../../test/play/beat-motion.browser.test.ts` measures the drawn control
 * against it rather than trusting it: a label that outgrew the reservation would
 * hang over a stack entry, and that is invisible to every structural test.
 *
 * # Under the menus, over the plane
 *
 * z-index 45. The scale on this table is 20 for the stack strip, 30 for the turn
 * stops, 40 for `./motion.ts`'s fixed plane, 45 for the picker and the hover
 * zoom, and 46 for `./ask-flyout.ts`'s box. This has to be above the plane, since
 * the plane is what the departing cards are drawn on and it is exactly what the
 * player would otherwise press through. It does not need to be above the flyout:
 * the two cannot be up at once, because a beat drawn here is the `board` slot and
 * a flyout only opens on the other four (`../../routes/play/ask-flyout.ts`).
 *
 * `pointer-events` are on the button and off the box around it, so the padded
 * area that centers the control is not also a lid over the two cards under it.
 *
 * # Quiet
 *
 * No panel, no border, no surface fill: a bordered box in the middle of the table
 * is the panel this bead removed, moved. The button is the surface's own primary
 * button (`../views.ts`), with the table's shadow under it so it reads as
 * floating over live cards rather than as part of either board. Nothing here is
 * uppercase, so `polish.test.ts`'s pairing of uppercase with weight and faint ink
 * has nothing to say about it.
 */
import { cssNumber } from '../number';
import { TABLE } from './geometry';

/**
 * The column at the end of the seam that belongs to the beat while one is up.
 *
 * Wide enough for the control and its own inline padding with room left over:
 * the Continue measures 81.6px at 1440x900 and the box adds 16px, against the
 * 112px this reserves. The slack is deliberate — the label is one word today and
 * the reservation is what the two seam residents are held apart by, so a number
 * fitted exactly to the current word would be the thing that quietly stopped
 * being true. The browser test fails when the drawn box does not fit inside it.
 */
export const BEAT_SEAM_CLEARANCE_REM = 7;

export const BEAT_CSS = `
${TABLE} .mtg-beat {
  position: absolute; z-index: 45;
  inset-inline-end: 0; inset-block-start: 50%;
  transform: translateY(-50%);
  display: flex; align-items: center;
  padding-inline: var(--mtg-space-2);
  pointer-events: none;
}
${TABLE} .mtg-beat__continue {
  pointer-events: auto;
  box-shadow: var(--mtg-shadow-table);
}
/* The stack keeps the middle of the seam and gives up its end.

   Padding rather than an inset, and that is the whole of mtg-... : an inset only
   moves a positioned box, and the seam is only positioned for a mouse. The foot
   of ./stack.ts puts it back in flow under \`(pointer: coarse)\` so a finger gets
   the reflow instead of an overlay, and on that arm \`inset-inline-end\` computed
   to 112px and did nothing at all. Measured in chrome-headless-shell on a board
   with a beat up and three spells on the stack, strip end minus Continue start:
   the seam's box ran +89.56px past it at both 932x430 and 844x390 with a finger
   against -22.44px at 1280x800 with a mouse, and the entries inside it ran
   +54.45px past it, which is a stack entry drawn under the one control a beat
   offers. Padding shrinks the content box on either arm, the seam paints
   no background of its own, and its \`justify-content: center\` recenters the ink
   in what is left exactly as the inset did.

   It is the same declaration the open band two rules down already uses, for the
   same reason stated there: the attackers are in flow and could never have been
   held off by an inset either. */
${TABLE} .mtg-board__divider[data-combat='false']:has(.mtg-beat) .mtg-stack-seam {
  padding-inline-end: ${cssNumber(BEAT_SEAM_CLEARANCE_REM)}rem;
}
/* And the attackers give up the same column, out of the content box rather than
   out of an inset, because they are in flow and the stack is not. Outweighs
   ./band.ts's padding shorthand, so being before it in the sheet costs nothing. */
${TABLE} .mtg-board__divider[data-combat='true']:has(.mtg-beat) {
  padding-inline-end: ${cssNumber(BEAT_SEAM_CLEARANCE_REM)}rem;
}
`;
