/**
 * The board sheet, registered one surface at a time.
 *
 * `BOARD_CSS` was one 848-line module and is now a file per surface, because eight
 * of the fourteen surfaces `mtg-bz2` breaks the play client into want to edit it
 * and they cannot all edit one file. The split changed no emitted declaration:
 * the blocks were already named and already concatenated in this order, and the
 * work was giving each one a file and this list. The blocks after it are that
 * epic's lanes adding their own — `./cast.ts` is `mtg-bz2.3`'s, and it sits
 * straight after `./picker.ts` because it styles the inside of that block's box,
 * and `./declare.ts` is `mtg-y1t`'s and sits straight after `./rail.ts` for the
 * same reason.
 *
 * **The order is the cascade and it is load-bearing.** Three pairs of rules in
 * here tie on specificity and are separated only by which comes later:
 *
 *  - `./attach.ts` is after `./fit.ts` because `.mtg-attach__held > .mtg-slot` weighs the
 *    same as `./fit.ts`'s `[data-ui-mode='play'] .mtg-slot`, and a tucked card
 *    keeps its 70% height only by coming after it.
 *  - `./browser.ts` sits straight after `./zone.ts`, where it reads beside the
 *    rules it extends, and before `./fit.ts` and `./rail.ts`, so the play
 *    route's sizing and the rail's floor and clip reach a browser exactly as
 *    they reach every other block above them. `./log.ts` follows it for the same
 *    two reasons — it extends the browser's head and strip, and it has one rule
 *    that must beat `./rail.ts`'s 30% cap on a rail block, which it does by
 *    being more specific rather than by being later.
 *  - `./hand.ts` is after `./fit.ts` because it re-sizes the two things that file
 *    sizes: a hand slot, which it takes off the height axis entirely, and a
 *    battlefield slot, which it caps. Every one of its selectors already outweighs
 *    `./fit.ts`'s `[data-ui-mode='play'] .mtg-slot` on specificity, so the order is
 *    where a reader expects the override rather than what makes it win.
 *  - `./band.ts` is after `./mat.ts` because `.mtg-board__divider` is declared
 *    in both and the seam is a bar rather than a keyline. It is after
 *    `./attach.ts` rather than merely after the mat because its own rules tie
 *    with nothing else in here, so the end of the list is where a surface that
 *    only has to beat one earlier rule belongs. `./fit.ts` keeps the divider's
 *    play-route margin, which is more specific than either.
 *
 * `./ask-flyout.ts` sits straight after `./declare.ts`, at the near end of the
 * ask column's own run: `./rail.ts` is what shuts that column, `./declare.ts`
 * styles the inside of a panel it draws, and this is where those panels go once
 * the column is a strip. It ties with nothing — `.mtg-ask-flyout` and
 * `.mtg-ask-alert` are declared nowhere else, and `.mtg-board__lanes` gets a
 * `position` that `./mat.ts` never gave it — so the position is where a reader
 * will look for it rather than what makes it win.
 *
 * `./beat.ts` follows it, because the two are read together: the flyout is where
 * an ask goes when the column is a strip, and this is where a beat goes when the
 * board is answering it instead of the column (`mtg-gt4q`). Its own placement in
 * the list is load-bearing for one rule and not for the rest. `.mtg-beat` is
 * declared nowhere else, but `./beat.ts` also moves `.mtg-stack-seam`'s end edge
 * while a beat is up, and that selector ties on specificity with `./stack.ts`'s
 * own — so this block has to come after `./stack.ts`, which it does by four
 * places. Its second rule reserves the same column out of an open combat band
 * and outweighs `./band.ts`'s padding shorthand, so being *before* `./band.ts`
 * costs nothing.
 *
 * `./aim.ts` sits straight after `./slot.ts` for the reason `./cast.ts` sits
 * straight after `./picker.ts`: it is the other half of that file's statement
 * about a card face — the lit rule says what a card you may act on looks like,
 * and this says what the rest of the table looks like while a spell is being
 * aimed at one. It declares `opacity` and nothing else, which no other block in
 * here declares on a face, so it ties with nothing and the position is where a
 * reader will look rather than what makes it win.
 *
 * `./arrival.ts` is last for the reason `./band.ts` is near the end: it declares
 * one property (`animation`) that no other block in here declares, so it ties
 * with nothing and the end of the list is where a surface that has to beat
 * nothing belongs. Its `prefers-reduced-motion` block does have to come after
 * `../base.ts`'s global clamp, and does, because that sheet is joined before
 * this one in `../index.ts`.
 *
 * `./motion.ts` is after `./arrival.ts` and last, because it is the surface that
 * supersedes it: `../../motion/runner.ts` writes `data-motion='on'` on the board
 * it is driving, the arrival rule is scoped to a board without that attribute,
 * and one object may never wear two motion vocabularies at once. Nothing in it
 * ties with anything — a fixed plane and a box-shadow are declared nowhere else
 * in here — so the end of the list is where a surface that has to beat nothing
 * belongs, and it reads beside the rule it replaces.
 *
 * Joined with no separator rather than a newline, which is what `../index.ts`
 * uses between the top-level sheets. That is not a style choice: the blocks each
 * open with their own newline, and joining them any other way moves bytes in a
 * sheet three tests compare declaration by declaration.
 */
import { MAT_CSS } from './mat';
import { ZONE_CSS } from './zone';
import { BROWSER_CSS } from './browser';
import { LOG_CSS } from './log';
import { SLOT_CSS } from './slot';
import { AIM_CSS } from './aim';
import { LANDS_CSS } from './lands';
import { PICKER_CSS } from './picker';
import { CAST_CSS } from './cast';
import { HIDDEN_CSS } from './hidden';
import { STACK_CSS } from './stack';
import { STATUS_CSS } from './status';
import { FIT_CSS } from './fit';
import { HAND_CSS } from './hand';
import { RAIL_CSS } from './rail';
import { DECLARE_CSS } from './declare';
import { ASK_FLYOUT_CSS } from './ask-flyout';
import { BEAT_CSS } from './beat';
import { ATTACH_CSS } from './attach';
import { BAND_CSS } from './band';
import { ARRIVAL_CSS } from './arrival';
import { MOTION_CSS } from './motion';

/** Every board surface, in cascade order. */
export const BOARD_SHEETS: readonly string[] = [
  MAT_CSS,
  ZONE_CSS,
  BROWSER_CSS,
  LOG_CSS,
  SLOT_CSS,
  AIM_CSS,
  LANDS_CSS,
  PICKER_CSS,
  CAST_CSS,
  HIDDEN_CSS,
  STACK_CSS,
  STATUS_CSS,
  FIT_CSS,
  HAND_CSS,
  RAIL_CSS,
  DECLARE_CSS,
  ASK_FLYOUT_CSS,
  BEAT_CSS,
  ATTACH_CSS,
  BAND_CSS,
  ARRIVAL_CSS,
  MOTION_CSS,
];

export const BOARD_CSS = BOARD_SHEETS.join('');

export { PICKER_INSET_REM, PICKER_WIDTH_REM } from './picker';
export { PLAY_ASK_REM, PLAY_RAIL_REM } from './rail';
