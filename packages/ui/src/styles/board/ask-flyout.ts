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
 * long a move list happens to be. A panel longer than the cap scrolls inside the
 * box, which is the same bargain every rail block already makes (`./rail.ts`).
 *
 * `min(26rem, 100%)` wide, which is the whole point of drawing it outside the
 * column: `../views.ts` lays `.mtg-choices` out as
 * `repeat(auto-fit, minmax(min(11rem, 100%), 1fr))`, so at 26rem the moves come
 * out in two columns of one line each instead of one column of three-line labels
 * — which is what her screenshot of an 11rem column shows.
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
const FLYOUT_MAX_PERCENT = 46;

export const ASK_FLYOUT_CSS = `
${TABLE} .mtg-board__lanes { position: relative; }
${TABLE} .mtg-ask-flyout {
  position: absolute; z-index: 46;
  inset-block-start: 0; inset-inline-start: 0;
  width: min(${cssNumber(FLYOUT_WIDTH_REM)}rem, 100%);
  max-block-size: ${cssNumber(FLYOUT_MAX_PERCENT)}%;
  overflow-y: auto;
  background: var(--mtg-surface-rail);
  border: 1px solid var(--mtg-line-strong);
  border-radius: var(--mtg-radius-md);
  box-shadow: var(--mtg-shadow-table);
}
/*
 * The panel inside it keeps its own head and body and loses its box, so the
 * flyout is one bordered thing rather than a border inside a border.
 */
${TABLE} .mtg-ask-flyout > .mtg-panel { border: 0; border-radius: 0; background: transparent; }
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
