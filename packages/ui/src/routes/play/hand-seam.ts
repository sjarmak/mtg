/**
 * Where the table stops and the hand starts, when the player has said.
 *
 * `mtg-7rhk`, and `mtg-gohr` is what made it worth asking. That bead settled
 * the *default*: on a table, on a sparse board, off combat, a held card and a
 * permanent draw the same face. A default is the right answer to "how big
 * should these be for somebody who has not said", and it is the wrong answer to
 * "how big do I want them" -- a player counting an opponent's board wants the
 * table, a player deciding out of a full grip wants the grip, and the same
 * player wants both within one turn. Every other split in the lab became
 * draggable in `mtg-rgc.19` for exactly that reason; this is the last constant
 * on the played mat and the one a player looks at longest.
 *
 * # What the share means, and why the hand carries it
 *
 * `../../panel/SplitHandle.ts` hands back the share of the container the
 * divider was dragged to, and the container is the near lane, so the share is
 * the **battlefield's**: the divider sits that far down the lane and the hand
 * has what is under it. That is the number stored, because it is the number the
 * handle announces and the one a pointer position is measured into.
 *
 * What the stylesheet needs is the other one. `../../styles/board/hand.ts`
 * sizes the hand row and lets the battlefield take the remainder -- the row is
 * as tall as its cards and no taller, and has been since that file existed --
 * so the property written here is the hand's height and the complement is taken
 * in the `calc`. Writing the battlefield's height instead would invert which
 * zone is sized and which is left over, which is a change to the arrangement
 * rather than a way of stating it.
 *
 * # Why a height moves a card at all
 *
 * A hand slot is width-driven off a seventh of its row, capped by
 * `--hand-face-cap`, so on a table nothing about the hand's *height* decides how
 * big a held card is. Under a dragged seam it does: the row is given a height,
 * the slot stretches to it, and the printed trim turns that into the width.
 * Measured over `../../../tools/seam-probe.ts` at 1440x900 on the resting
 * position, the hand face runs from 171px at the divider's top limit to 48px at
 * its bottom one, against 124px undragged, and the near battlefield face runs
 * the other way from 44px to 124px -- so the drag is a genuine trade in both
 * directions rather than a control that only shrinks.
 *
 * The trade is not symmetric, and the sweep is the only place that says so. The
 * battlefield stops growing partway up: at 1440x900 it reaches its own ceiling
 * of 124px at 0.70 and is still 124px at 0.85, and at 2560x1440 it is at 160px
 * from 0.50 up. Above those points a drag buys the mat, not the board, and
 * spends the hand to do it. Downward there is no such stop before the limit --
 * every viewport keeps handing the hand pixels -- which is why the interesting
 * half of this control is the half that makes the grip bigger, and why the
 * default sits where parity already put it rather than in the middle of the
 * range.
 *
 * # A first visit is untouched
 *
 * Nothing here draws until somebody drags: no share means no `data-seam` and no
 * property, and every rule in `hand.ts`'s seamed arm is selected on that
 * attribute. The handle itself sits in the lane's own 8px gap under negative
 * margins, the way `../../styles/panel.ts` puts the draft's divider in its
 * gutter, so an undragged table is the table `mtg-gohr` measured to the pixel.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { SplitHandle } from '../../panel/SplitHandle';
import { seatPossessive } from '../../seat';
import { useSplit } from '../../panel/split';
import type { SplitLimits, SplitState } from '../../panel/split';

/** Where this table's seam is kept. One split, one surface, one key. */
export const HAND_SEAM_NAME = 'play.hand-seam';

/**
 * What the stylesheet's own arrangement is worth, announced and never drawn.
 *
 * Measured rather than chosen, over `../../../tools/seam-probe.ts` on the
 * resting position. The undragged battlefield takes 0.679 of the near lane at
 * 1024x768, 0.668 at 1280x801, 0.646 at 1440x900 and 0.624 at 1920x1080, so
 * 0.64 is within four hundredths of every desktop reading and within one at the
 * one this table was drawn against. A handle whose `aria-valuenow` said
 * something the sheet never drew would be a divider that reports one
 * arrangement and shows another, and the first drag replaces it with a measured
 * number anyway.
 *
 * The two tall viewports sit outside that band -- 0.706 at 2560x1440 and 0.739
 * at 768x1024 -- because a taller lane spends its surplus on the battlefield
 * once both faces are at their ceilings. One number cannot be all six and this
 * one is not a layout input; it is what the handle announces before anybody has
 * moved it.
 */
export const HAND_SEAM_DEFAULT_SHARE = 0.64;

/**
 * How far the divider may be dragged, as the battlefield's share of the lane.
 *
 * Neither end is `DEFAULT_SPLIT_LIMITS`, and the two ends are floored by
 * different things. Measured over `../../../tools/seam-probe.ts` across six
 * viewports on the resting position.
 *
 * **0.85 is where the hand has already stopped.** The sheet floors the row at
 * `min-content` -- 85px, 95px at 768x1024 -- so the drag saturates before the
 * limit on five of the six: asking for 0.90 draws 0.806 at 1024x768, 0.825 at
 * 1440x900, 0.849 at 1920x1080, and the face is 48px, which is
 * `MIN_SLOT_WIDTH_REM` exactly. Only 2560x1440 still has room at the limit, at
 * a 67px face. So the number is a stop on a handle that has run out of travel
 * rather than a decision about a card, and it is stated at 0.85 so the wide
 * table can reach the same floor the others hit on their own.
 *
 * **0.45 is a stop on a trade the player is making deliberately.** At 1440x900
 * it draws a 171px hand face against a 44px board one; at 1920x1080, 209px
 * against 85px; at 2560x1440, 280px against 141px. Below about 0.55 on a
 * 1440-wide table the board face is under `BOARD_FACE_MIN_REM`'s 72px and a
 * permanent's name starts clipping -- and that is the room overruling the
 * floor, which is the rule `../../styles/board/hand.ts` already settled in
 * `mtg-aqxi.6` for a dense row and is exactly what a player dragging toward
 * their grip is asking for. A limit that kept every board face legible at every
 * viewport would have to be about 0.70, which is above four of the six resting
 * positions: it would be a control that only ever shrinks the hand.
 *
 * The stylesheet holds the hard floor under both ends
 * (`../../styles/board/hand.ts`), the way `../../panel/split.ts` says a
 * stylesheet should; these are the softer question of where a handle stops.
 */
export const HAND_SEAM_LIMITS: SplitLimits = { min: 0.45, max: 0.85 };

/**
 * The near lane's inline height for the hand, once somebody has dragged.
 *
 * `undefined` while nobody has, so the lane carries no style attribute at all
 * and the whole feature is out of the way of every gate that reads the DOM of a
 * first visit.
 *
 * The complement is taken here rather than in the stylesheet because the
 * stylesheet may not do arithmetic on a share it cannot see: `calc(100% - X%)`
 * needs the number, and the number is this module's.
 */
export function handSeamStyle(share: number | null): Readonly<Record<string, string>> | undefined {
  if (share === null) return undefined;
  return { '--hand-seam': `calc(100% - ${(share * 100).toFixed(2)}%)` };
}

/** This table's seam, read from the store on mount and written back on change. */
export function useHandSeam(): SplitState {
  return useSplit(HAND_SEAM_NAME, HAND_SEAM_LIMITS);
}

/**
 * The divider, drawn between the step bar and the hand.
 *
 * Under the bar rather than over it, because the bar belongs to the battlefield
 * half: `../../board/Board.ts` places it as "the seam between what is on the
 * table and what you are holding", and a control that moves the hand's own edge
 * has to be on the hand's own edge or it reports the wrong thing while it is
 * being dragged.
 *
 * The name it announces is **possessive rather than second person**, out of the
 * near seat's own label, for the reason `./position.ts` names every zone that
 * seat owns the same way: a hotseat table's near seat is `Player one`, and a
 * divider that calls the row below it `your hand` tells the person holding the
 * device it is theirs when the surface has just finished saying it is not.
 * `../../../test/play/seat-voice.test.ts` reads the accessible name in its sweep,
 * so the fixed string failed the moment the handle was drawn.
 */
export function handSeamHandle(split: SplitState, near: string): ReactElement {
  return createElement(SplitHandle, {
    label: `the table and ${seatPossessive(near)} hand`,
    orientation: 'horizontal',
    share: split.share,
    defaultShare: HAND_SEAM_DEFAULT_SHARE,
    limits: HAND_SEAM_LIMITS,
    onShare: split.setShare,
  });
}
