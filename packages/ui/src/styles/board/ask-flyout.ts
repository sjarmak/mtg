/**
 * The shut ask column's other half: the box the panel moves into, and the alert
 * that says it is there.
 *
 * `mtg-li0o`. `./rail.ts` narrows the column to 5rem and hides
 * `.mtg-board__pods > .mtg-panel` in it, which is every panel
 * `../../routes/play/PlayView.ts` can put in that slot. This sheet is where they
 * go instead. `../../routes/play/ask-flyout.ts` argues the behavior; this file
 * argues the geometry, and the two facts it has to get right are where the box
 * hangs from and how far down it is allowed to reach.
 *
 * # Anchored to the lanes
 *
 * `position: relative` on `.mtg-board__lanes`, declared here rather than in
 * `./mat.ts`, because it exists for this box and a reader who deletes this file
 * should take the containing block with it. It ties with nothing: `./mat.ts`
 * gives that element `display`, `flex-direction`, `gap` and `min-width` and no
 * `position` at all.
 *
 * The two other candidates were both wrong for a stated reason.
 * `.mtg-board__pods` is `overflow-y: auto` (`./rail.ts`), so an absolutely
 * positioned child of it is clipped by the 5rem column that made the flyout
 * necessary in the first place. A grid child of `.mtg-board` placed over a track
 * would take the mat out of the auto-placement `./fit.ts` builds its three
 * columns with. The lanes element is a plain flex column with a definite height
 * under `${TABLE}` and no overflow of its own, so a containing block costs it
 * nothing.
 *
 * # It reaches the top half and stops
 *
 * Pinned to the block-start, capped at 46% of the lanes. the playtester's constraint
 * was that it must not cover her hand or the step bar, and both of those are in
 * the viewer's own band at the bottom of this element (`../../board/Board.ts`
 * hands `steps` to `side(combat.you, ...)`). Pinning it to the top and capping
 * the height is what makes that a geometric fact rather than a hope about how
 * long a move list happens to be.
 *
 * # The cap is spent on the middle of the panel, not on its ends
 *
 * The box used to be the scroller itself, so a panel longer than the cap put its
 * head, its sentence and its controls on one strip and scrolled all three
 * together. `mtg-aqxi.14` is what that costs at the one decision that has no
 * board behind it. Measured at 844x390 in chrome-headless-shell before the fix:
 * 184px of panel in a 171.11px box, 15px of it scrolled, and `Mulligan` — one of
 * the two answers, and the only two things in the game at that moment — sitting
 * 9.52px under the bottom edge. Spec section 11's rule is that a region may
 * scroll and a primary control may not.
 *
 * So this element clips and lays its panel out as a column, and the scrolling is
 * the panel's own: `../views.ts` already gives `.mtg-prompt` a `flex: none` head,
 * a `flex: 1` body that scrolls and, since this bead, a `flex: none` foot. The
 * cap is unchanged and so is the promise it carries; what changed is which part
 * of the panel pays for it. The body's `min-height` is dropped in here alone,
 * because that floor is a promise that a whole move button is visible in a rail
 * that has room to give — and in this box it would push the foot back out
 * through the bottom, which is the defect.
 *
 * `min(26rem, 100%)` wide, which is the whole point of drawing it outside the
 * column: `../views.ts` lays `.mtg-choices` out as
 * `repeat(auto-fit, minmax(min(11rem, 100%), 1fr))`, so at 26rem the moves come
 * out in two columns of one line each instead of one column of three-line labels
 * — which is what her screenshot of an 11rem column shows.
 *
 * # It stops taking presses while a target is being picked
 *
 * `mtg-whyp`. The box hangs over the top-left of the opponent's band, and a
 * board face there measures 100.0px at 1280x800 with four permanents a side and
 * 124.0px at 1440x900, so the 416px strip covers three or four of them. Every
 * one of those is still an answer -- the kernel enumerated it and the flyout's
 * own list holds a button for it -- but pointing at the creature you mean, on
 * the board, is how this seat plays, and while the box was opaque that gesture
 * was gone for the cards underneath it.
 *
 * So `.mtg-board[data-aiming='true'] .mtg-ask-flyout` takes `pointer-events:
 * none` and the controls inside it take `pointer-events: auto`. A press over a
 * covered permanent lands on the permanent; a press on a move lands on the
 * move. Nothing moves and nothing resizes, so the box a player was reading is
 * the same box in the same place, and the only part of the strip that stays
 * unreachable is the area directly under a control.
 *
 * `./aim.ts` is what makes that readable rather than a guess: inside a target
 * choice the illegal faces drop to 0.38 and `./slot.ts` rings the legal ones,
 * so the cards under the box still say which of them are answers.
 *
 * The bead's own two candidates are both worse. Flipping the box to the right
 * edge for the duration of a pick trades the left three or four permanents for
 * the right three or four and uncovers nothing: the band is
 * `justify-content: safe center` (`./band.ts`), not left-packed, so the cards
 * are in the middle either way. Dimming and shifting it leaves the box over the
 * board and costs a second geometry to maintain beside this one.
 *
 * What this does cost is the wheel over the box while aiming: a scroll there
 * goes to the board rather than to the move list, because the scroller is the
 * panel's body and the body is one of the pointer-transparent parts. Tabbing to
 * a move still scrolls it into view, and Escape still dismisses the box, so the
 * list is reachable without the pointer. The trade is deliberate -- keeping the
 * body pressable would leave the strip opaque over almost its whole area, which
 * is the defect.
 *
 * # Over the motion plane
 *
 * z-index 46. The scale in use on this table is 20 for the stack strip, 30 for
 * the turn stops, 40 for `./motion.ts`'s fixed plane and 45 for the picker and
 * the hover zoom. This is above all of them on purpose: it carries the only way
 * this seat can answer the game, and a plane that covered it would recreate the
 * defect. It cannot collide with the picker geometrically — that box is fixed to
 * the bottom-inline-end corner and this one is absolute at the block-start of
 * the lanes — so the order between them is never drawn.
 */
import { cssNumber } from '../number';
import { TABLE } from './geometry';

/** Wide enough for `.mtg-choices` to lay its moves out in two columns. */
const FLYOUT_WIDTH_REM = 26;

/**
 * How much of the lanes the box may take, as a percentage.
 *
 * The viewer's own band — battlefield, step bar, hand — is the bottom of that
 * element, so this number is the promise that the flyout never reaches it.
 */
export const FLYOUT_MAX_PERCENT = 46;

export const ASK_FLYOUT_CSS = `
${TABLE} .mtg-board__lanes { position: relative; }
${TABLE} .mtg-ask-flyout {
  position: absolute; z-index: 46;
  inset-block-start: 0; inset-inline-start: 0;
  width: min(${cssNumber(FLYOUT_WIDTH_REM)}rem, 100%);
  max-block-size: ${cssNumber(FLYOUT_MAX_PERCENT)}%;
  display: flex; flex-direction: column;
  overflow: hidden;
  background: var(--mtg-surface-rail);
  border: 1px solid var(--mtg-line-strong);
  border-radius: var(--mtg-radius-md);
  box-shadow: var(--mtg-shadow-table);
}
/*
 * Aiming: the box gives the board back its presses and keeps its own.
 *
 * The docblock argues it. The second rule is written over the controls rather
 * than over the panel because the panel is the whole box, and handing the
 * presses back to it would undo the first rule exactly.
 */
${TABLE} .mtg-board[data-aiming='true'] .mtg-ask-flyout { pointer-events: none; }
${TABLE} .mtg-board[data-aiming='true'] .mtg-ask-flyout :is(button, input, select, textarea, a[href]) {
  pointer-events: auto;
}
/*
 * The panel inside it keeps its own head and body and loses its box, so the
 * flyout is one bordered thing rather than a border inside a border.
 */
${TABLE} .mtg-ask-flyout > .mtg-panel {
  border: 0; border-radius: 0; background: transparent;
  flex: 1 1 auto; min-block-size: 0;
}
/*
 * The move list gives its floor up to the foot in this box, and only in this
 * box. The docblock says why: the floor keeps a whole option visible where there
 * is room, and here there is not — 46% of the lanes at 844x390 is 171.11px, and
 * a 5rem floor under the body claims 80 of them before the head and the two
 * buttons have been drawn.
 */
${TABLE} .mtg-ask-flyout > .mtg-prompt > .mtg-panel__body { min-height: 0; }
/*
 * The alert, on the strip, drawn whether or not the flyout is.
 *
 * Two stacked words rather than the sentence: the strip is one touch target
 * wide. The button carries the whole sentence as its accessible name and the
 * words are aria-hidden, which is the bargain \`./rail.ts\`'s disclosure already
 * makes with its own label for the same reason.
 */
${TABLE} .mtg-ask-alert { flex: none; padding: var(--mtg-space-1); }
${TABLE} .mtg-ask-alert__button {
  width: 100%; min-width: 0;
  display: flex; flex-direction: column; align-items: center; gap: 0;
  padding: var(--mtg-space-1); line-height: 1.2;
}
/*
 * Not uppercase, unlike every other micro-label on the surface. \`polish.test.ts\`
 * ties uppercase to 600 weight and faint or muted ink, and that pairing is for a
 * label sitting quietly over a panel's content. This one is the loud thing on an
 * accent-filled button, so it takes the weight and leaves the treatment.
 */
${TABLE} .mtg-ask-alert__eyebrow { font-size: var(--mtg-text-xs); font-weight: 700; }
${TABLE} .mtg-ask-alert__detail { font-size: var(--mtg-text-xs); }
`;
