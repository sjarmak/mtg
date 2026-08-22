/**
 * The open target slot read as a gesture on the table: which permanents may be
 * aimed at, and which spell is doing the aiming.
 *
 * `mtg-bz2.6`. A spell that needs a target puts the surface in a targeting
 * state, the legal targets light up on the battlefield, everything else goes
 * visibly inert, and clicking a lit card attaches it. The last clause of the
 * bead is the one that decides the shape: *no target choice can produce a
 * post-hoc error*. That property is already true and it is not this module's to
 * defend — every candidate on the stage came out of `Decision.options`, so the
 * board can only offer aims the kernel enumerated, and the last press of a cast
 * is still an index into that list (`./cast.ts`). What was missing was that the
 * enumeration was only readable as a column of text buttons; this is the same
 * answer drawn where the cards are.
 *
 * It is a *derivation*, not a second copy of the question. `./selection.ts`
 * already holds the picks a cast has been aimed with, `castStage` already turns
 * those picks into the slot being asked and its candidates, and this reads that
 * stage. Nothing here has state of its own. That is `mtg-5t05`'s rule and
 * `./combat.ts` records what breaking it cost: two independent records of one
 * declaration produced two live confirms that disagreed about what was staged.
 * A board that held its own idea of the legal targets would be the same defect,
 * one decision earlier — it could light a card the panel had already ruled out.
 *
 * **Only permanents.** A slot's candidates can also name a player (`anyTarget`,
 * `targetPlayer`) or a spell on the stack (`counterSpell`), and neither is a
 * card on the battlefield: a seat's pod is a vitals block rather than an object,
 * and a stack entry is drawn on the seam as a line of text. Those aims stay
 * where they already are — in the cast panel, which keeps listing every
 * candidate whatever this module says. The panel is also the keyboard and
 * screen-reader path, which is the same contract `./rail.ts` holds for the move
 * list: the board is an added door to the enumeration, never a narrowing of it.
 * A slot with no permanent among its candidates therefore lights nothing, and
 * the table still goes quiet, because the true sentence at that moment is that
 * no card on the battlefield is a legal target.
 */
import type { ObjectId, Target } from '@mtg/kernel';
import type { CastTargetStage } from './cast';

/**
 * The two fields the board reads, named structurally for the reason
 * `./declare.ts`'s `DeclarationView` is: `./selection.ts`'s `TargetControl`
 * satisfies it and this module cannot name that type, because the import arrow
 * already runs the other way and closing it would be a cycle.
 */
export interface TargetView {
  /** The spell being aimed, by the id the board keys its card on. */
  readonly oid: ObjectId;
  /** The slot being answered and the aims it offers; `castStage` derived it. */
  readonly stage: CastTargetStage;
}

export interface TargetGesture {
  /**
   * The spell whose slot is open, or null when nothing is being aimed.
   *
   * Also the whole of "is the table in a targeting state": non-null is what
   * dims the cards that are not answers, and it stays non-null for a slot whose
   * candidates are all players, because "no card here is a legal target" is a
   * thing the board should say rather than a reason to say nothing.
   */
  readonly source: ObjectId | null;
  /** Permanents this slot may be aimed at. Empty while nothing is being aimed. */
  readonly answers: ReadonlySet<ObjectId>;
}

/** The gesture nothing is offering: no cast is staged, or its open stage is the payment. */
export const NO_TARGET_GESTURE: TargetGesture = {
  source: null,
  answers: new Set<ObjectId>(),
};

/**
 * The permanents an open slot may be aimed at, each with the aim that names it.
 *
 * A map rather than a set because the click has to send a `Target` and the board
 * only knows an object id: `{ kind: 'permanent', oid }` is reconstructible, but
 * reconstructing it would be a second spelling of a value the candidate list is
 * already carrying, and the two could drift the day a target grows a field.
 * Shared by the gesture below and by the `aim` that answers a click, so the set
 * that lights and the set that can be pressed are one derivation.
 */
export function aimableTargets(stage: CastTargetStage): ReadonlyMap<ObjectId, Target> {
  const aims = new Map<ObjectId, Target>();
  for (const candidate of stage.candidates) {
    const target = candidate.target;
    if (target === null || target.kind !== 'permanent') continue;
    aims.set(target.oid, target);
  }
  return aims;
}

export function targetGesture(view: TargetView | null): TargetGesture {
  if (view === null) return NO_TARGET_GESTURE;
  return { source: view.oid, answers: new Set(aimableTargets(view.stage).keys()) };
}
