/**
 * The damage assignment order in progress: which blocker sits where, and the one
 * enumerated ordering that sequence names.
 *
 * # The third decision whose option count outruns a list
 *
 * `declare.ts` names the two combat declarations whose enumeration is
 * exponential in the board. CR 509.2's ordering is the third, and it is worse
 * than either: an attacker blocked by n creatures has n! orderings, and the
 * kernel enumerates the cartesian product of those over every multiply-blocked
 * attacker.
 *
 *   blockers on one attacker   2   3    4     5      6       8
 *   orderings                  2   6   24   120    720   40,320
 *
 * `mtg-2aca` took the first bite out of that: two blockers the position has
 * nothing to say about separately are one slot, so a gang block by three copies
 * of one card is one decision rather than six spellings of it, and
 * `@mtg/kernel`'s `damage-order.ts` carries the argument. It made every line on
 * the rail a real decision. It did not make the rail usable — the eight-blocker
 * board that filed the bead still offers **3,360 genuine orderings**, and no
 * list of 3,360 prose sentences is a surface anybody can read.
 *
 * # So the player builds the order instead of finding it
 *
 * `mtg-0pca`, and the playtester's own words for what it is worth: "closer to the UX
 * of MTGO and less clicking pop up sentences". An ordering is an assignment the
 * player constructs, so the treatment is `declare.ts`'s — press the blockers, in
 * the order damage should reach them, and confirm. n blockers make n+1 controls
 * instead of n!, and the count is linear in the block rather than factorial in
 * it.
 *
 * **Nothing here re-derives legality.** The blockers a group offers are
 * `Decision.blocks`, which is the kernel's own statement of who is blocking what
 * and is linear in the board, so no cap can reach it — the same rule that put
 * `declare.ts`'s roster on `Decision.candidates` rather than on `options`.
 *
 * **The confirm submits the index wherever there is one**, and there is one far
 * more often than a bare lookup would find. Two spellings of one ordering differ
 * only in which twin went first, and the enumeration keeps one of them; a player
 * pressing the other has made the same move and must record the same integer. So
 * `orderChoice` asks the kernel: `settledAction` folds the spelling onto the one
 * the enumeration built and `indexOfAction` finds it, which is `chooseAction`'s
 * own two steps rather than a second copy of them here. Past the 512-option cap
 * there is no index to find, and the constructed ordering goes over as itself,
 * checked by `validateAction` first — `declare.ts` and `combat.ts` reached the
 * same place from the same direction.
 *
 * # A partial order is a state, not an error
 *
 * Half a sequence is where every player building one starts, and the rules have
 * nothing to say about it: CR 509.2 asks for an order over *all* the blockers,
 * so an ordering missing one is not a move the kernel can be offered. The
 * confirm is therefore absent until every blocker in every group is placed, the
 * same way it is absent for a half-built menace block, and every blocker stays
 * pressable so the half-built state is escapable as well as reachable.
 */
import type { Action, Choice, Decision, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { indexOfAction, settledAction, validateAction } from '@mtg/kernel';
import { permanentName, targetName } from './naming';
import type { SeatNames } from './position';

/** One creature blocking one attacker, as a row reads it. */
export interface OrderBlocker {
  readonly oid: ObjectId;
  /**
   * Said as its controller's, which is `naming.ts`'s rule for a permanent that
   * is not the asked seat's own. Every blocker in this decision belongs to the
   * other player — the attacking player is the one being asked (CR 509.2) — so
   * the possessive is doing the same work it does on a target.
   */
  readonly name: string;
}

/** One multiply-blocked attacker and the creatures whose order it needs. */
export interface OrderGroup {
  readonly attacker: ObjectId;
  /** The asked seat's own creature, so it is named without the possessive. */
  readonly attackerName: string;
  /** Never shorter than two: a single blocker needs no order (CR 509.2). */
  readonly blockers: readonly OrderBlocker[];
}

/**
 * What the player has placed so far, per attacker, first in the list first.
 *
 * A blocker absent from its attacker's list has not been placed yet. Absent
 * rather than held at a null position, because "not yet ordered" is the state
 * the panel draws and the kernel is never shown it.
 */
export type Ordering = ReadonlyMap<ObjectId, readonly ObjectId[]>;

export interface OrderPlan {
  /** The seat being asked, which is the ordering's own `player`. */
  readonly player: PlayerId;
  /** One per multiply-blocked attacker, in the order the kernel listed them. */
  readonly groups: readonly OrderGroup[];
  /**
   * The enumerated orderings, carried for the index lookup and read for nothing
   * else. The groups above are what the panel is built from, for the reason
   * `declare.ts` states: a capped list is a list with whole creatures missing
   * from it, and this one is capped at 512 of 3,360 on the bead's own board.
   */
  readonly options: readonly Action[];
}

/** The empty ordering, which is what every panel opens on. */
export const NOTHING_ORDERED: Ordering = new Map<ObjectId, readonly ObjectId[]>();

/** The ordering decision on its own, so `blocks` is reachable without a retest. */
type OrderDecision = Extract<Decision, { kind: 'orderBlockers' }>;

/**
 * The plan for this decision, or `null` when the kernel is asking anything else.
 *
 * A decision the kernel enumerated one option for gets no plan, which is
 * `declare.ts`'s rule and `cast.ts`'s before it: a question with one answer is
 * not a question, and the flat rail's single line is already the whole truth
 * about it. **Only when the enumeration finished**, for the same reason the
 * declaration checks `complete` — a one-option truncated list means the opposite
 * of a settled question.
 */
export function orderPlan(state: GameState, names: SeatNames, decision: Decision): OrderPlan | null {
  if (decision.kind !== 'orderBlockers') return null;
  if (decision.options.length < 2 && decision.complete) return null;
  const groups = groupsOf(state, names, decision);
  if (groups.length === 0) return null;
  return { player: decision.player, groups, options: decision.options };
}

function groupsOf(state: GameState, names: SeatNames, decision: OrderDecision): readonly OrderGroup[] {
  return decision.blocks.map((block): OrderGroup => ({
    attacker: block.attacker,
    attackerName: permanentName(state, block.attacker),
    blockers: block.blockers.map((oid): OrderBlocker => ({ oid, name: targetName(state, names, oid) })),
  }));
}

/** Where a blocker sits in its attacker's order, 1 first, or `null` when unplaced. */
export function placeOf(ordering: Ordering, group: OrderGroup, oid: ObjectId): number | null {
  const placed = ordering.get(group.attacker) ?? [];
  const at = placed.indexOf(oid);
  return at === -1 ? null : at + 1;
}

/**
 * What pressing a blocker does: place it next, or take it back out.
 *
 * One rule, and it is the toggle `rosterPress` gives a creature with one
 * candidate. Taking a blocker out closes the gap behind it rather than leaving a
 * hole, because a damage assignment order has no holes in it — the creatures
 * after it move up one, which is what the player would have written by hand.
 */
export function withPress(ordering: Ordering, group: OrderGroup, oid: ObjectId): Ordering {
  const placed = ordering.get(group.attacker) ?? [];
  const next = placed.includes(oid) ? placed.filter((member) => member !== oid) : [...placed, oid];
  const written = new Map(ordering);
  written.set(group.attacker, next);
  return written;
}

/** The ordering with every group emptied. Nothing here has reached the kernel. */
export function clearedOrder(): Ordering {
  return NOTHING_ORDERED;
}

/**
 * The ordering as the kernel's own action, or `null` while a blocker is unplaced.
 *
 * The `null` is the whole of the partial-order state: CR 509.2 orders every
 * blocker, so a sequence short of one names no move and there is nothing to
 * validate, look up or submit.
 */
function actionOf(plan: OrderPlan, ordering: Ordering): Action | null {
  const orders: { readonly attacker: ObjectId; readonly blockers: readonly ObjectId[] }[] = [];
  for (const group of plan.groups) {
    const placed = ordering.get(group.attacker) ?? [];
    if (placed.length !== group.blockers.length) return null;
    orders.push({ attacker: group.attacker, blockers: placed });
  }
  return { type: 'orderBlockers', player: plan.player, orders };
}

/**
 * What confirming this ordering would submit, or `null` when it is not yet a
 * move.
 *
 * Two shapes and the order between them is the rule `declare.ts` states: the
 * enumeration's index where the kernel has one, so an ordinary block records the
 * integer it always did, and the constructed ordering where it does not — past
 * the cap, which the bead's own eight-blocker board is a long way past.
 *
 * `settledAction` before the lookup is what makes the first branch the common
 * one rather than the lucky one. The enumeration keeps one spelling per set of
 * interchangeable blockers (`mtg-2aca`), and a player pressing three identical
 * creatures picks a spelling at random; folding it the way the kernel folds it
 * lands every one of those presses on the option it belongs to.
 */
export function orderChoice(state: GameState, plan: OrderPlan, ordering: Ordering): Choice | null {
  const action = actionOf(plan, ordering);
  if (action === null) return null;
  if (validateAction(state, action) !== null) return null;
  return indexOfAction(plan.options, settledAction(state, action)) ?? action;
}

/** How many blockers are placed across every group, which is what the confirm counts. */
export function placedCount(plan: OrderPlan, ordering: Ordering): number {
  return plan.groups.reduce((total, group) => total + (ordering.get(group.attacker)?.length ?? 0), 0);
}

/** How many blockers there are to place, which is what it counts against. */
export function blockerCount(plan: OrderPlan): number {
  return plan.groups.reduce((total, group) => total + group.blockers.length, 0);
}

/**
 * The same ordering read as a gesture on the table: which cards may be pressed,
 * and what each pressed one is holding.
 *
 * `declare.ts`'s `blockGesture` for the decision one step later in combat, and it
 * is deliberately the same shape. The cards are the *opponent's* here — the
 * attacking player orders the creatures blocking their attacker — which is the
 * one thing that differs, and it differs at the wiring rather than in the model:
 * `table.ts` lights whichever row the pressable keys turn up in.
 */
export interface OrderGesture {
  /** Blockers a press may reach. Empty at every decision that is not an ordering. */
  readonly pressable: ReadonlySet<ObjectId>;
  /** Where each placed blocker sits, 1 first. Unplaced blockers are absent. */
  readonly places: ReadonlyMap<ObjectId, number>;
}

/** The gesture nothing is offering: no ordering is being built. */
export const NO_ORDER_GESTURE: OrderGesture = {
  pressable: new Set<ObjectId>(),
  places: new Map<ObjectId, number>(),
};

/** The two fields the board reads, named structurally for `blockGesture`'s reason. */
export interface OrderView {
  readonly plan: OrderPlan;
  readonly ordering: Ordering;
}

export function orderGesture(view: OrderView | null): OrderGesture {
  if (view === null) return NO_ORDER_GESTURE;
  const pressable = new Set<ObjectId>();
  const places = new Map<ObjectId, number>();
  for (const group of view.plan.groups) {
    for (const blocker of group.blockers) {
      pressable.add(blocker.oid);
      const place = placeOf(view.ordering, group, blocker.oid);
      if (place !== null) places.set(blocker.oid, place);
    }
  }
  return { pressable, places };
}

/** The group a blocker belongs to, or `null` for a key this decision never named. */
export function groupOf(plan: OrderPlan, oid: ObjectId): OrderGroup | null {
  return plan.groups.find((group) => group.blockers.some((blocker) => blocker.oid === oid)) ?? null;
}
