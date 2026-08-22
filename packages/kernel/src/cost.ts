/**
 * The cost-modification seam (CR 601.2f, CR 601.2b/107.3f for X): the one
 * place a spell's mana cost is computed, so `canPay`, `planPayment`,
 * `castOptions`, `validateCast` and `onCastSpell` are always handed what a
 * spell actually costs rather than what it is printed for.
 *
 * ## Why this is not `state.continuous`
 *
 * `@mtg/dsl`'s `cost-reduction.ts` argues the DSL side of this at length: a
 * `StaticModification` compiles one-to-one to a `ContinuousEffect`
 * (`effectForModification`, `abilities.ts`), and five files `assertNever` on
 * `StaticModification['kind']`, so folding cost reduction in there means a new
 * case in all five or a broken invariant. It is also the wrong layer
 * semantically: CR 613 resolves what an object *is*, and a spell's cost is
 * decided before the spell exists as an object the layer walk could reach. So
 * this is a parallel array (`GameState.costModifiers`, `state.ts`) and a
 * parallel compiler, registered and expired through the same two choke points
 * `abilities.ts` uses for `state.continuous` — `completeArrival` (`zones.ts`)
 * registers, `moveObject` (`zones.ts`) expires — because a printed cost
 * reduction exists exactly while its source is on the battlefield, the same
 * CR 604.3 lifetime a static ability has.
 *
 * ## Order: X first, then the reduction
 *
 * CR 601.2b fixes X as part of the cost before CR 601.2f reduces it, so
 * `effectiveManaCost` resolves X into `generic` first and reduces the total
 * afterward. Reducing first and resolving X second would double-count a
 * reduction bigger than the printed generic cost: an `{X}{R}` spell under a
 * cost-2 reducer would float from a floored `{R}` back up toward `{X}{R}` as
 * soon as X > 0, which is not what "this costs {2} less" means.
 *
 * ## What this does not do
 *
 * Only the generic part of a cost is ever reduced, because that is the only
 * shape `@mtg/dsl`'s `CostReductionSchema` prints — a generated set's
 * vocabulary keeps rarer colored-mana reductions out the same way
 * `checkCostReduction` keeps a reduction off an instant or sorcery. And this
 * seam is spell costs only: an activated ability's cost is a different call
 * site (`legal.ts`'s `activationBlocker`), never routed through here, because
 * `CostReduction.cardType` names card types (CR 300.1), not the abilities
 * printed on them — nothing in the DSL claims to reduce what a permanent's own
 * ability costs to activate.
 *
 * No dedicated expiry event is emitted when a modifier drops off, unlike
 * `continuousEffectsExpired`: `state.replacements` manages its own array the
 * same silent way, and wiring a new `GameEvent` variant here would pull
 * `@mtg/ui`'s exhaustive event-log switches (`narrate.ts`, `group.ts`,
 * `visibility.ts`, `replay/log-schema.ts`) into this bead's diff for no
 * requirement this seam has. `state.costModifiers` itself is the record a test
 * or a future log line can read.
 */
import type { Card, CastableCard, ManaCost } from '@mtg/dsl';
import { printedCardTypes, resolveX } from '@mtg/dsl';
import { costModifierId } from './ids';
import type { ObjectId, PlayerId } from './ids';
import { controllerOf } from './layers';
import { availableMana, canPay } from './mana';
import type { GameState, RegisteredCostModifier } from './state';

export interface CostModifierRegistration {
  readonly modifiers: readonly RegisteredCostModifier[];
  /** The state's id counter after minting one id per registered modifier. */
  readonly nextId: number;
}

/**
 * The cost modifier one card's printed reduction registers on entry, plus the
 * counter the caller must write back. Mirrors `staticEffectsFor`
 * (`abilities.ts`), narrowed to at most one modifier per card: unlike
 * `card.abilities`, `Card.costReduction` is a single field, not a list.
 */
function costModifiersFor(
  card: Card,
  source: ObjectId,
  controller: PlayerId,
  nextId: number,
): CostModifierRegistration {
  if (card.costReduction === null) return { modifiers: [], nextId };
  const modifier: RegisteredCostModifier = {
    id: costModifierId(nextId),
    sourceOid: source,
    controller,
    amount: card.costReduction.amount,
    cardType: card.costReduction.cardType,
  };
  return { modifiers: [modifier], nextId: nextId + 1 };
}

/**
 * Adds one battlefield permanent's cost modifier to a state, if it prints
 * one. One owner rather than two call sites doing it themselves:
 * `completeArrival` is the choke point every real arrival goes through, and
 * `scenario()` writes battlefield objects directly, so both must register the
 * same record or a scenario-built reducer does nothing in exactly the tests
 * written to prove it works (`registerStatics`' docblock states the identical
 * reason for the identical shape).
 */
export function registerCostModifiers(state: GameState, oid: ObjectId): GameState {
  const object = state.objects[oid];
  if (object === undefined) return state;
  const registration = costModifiersFor(object.card, oid, controllerOf(state, oid), state.nextId);
  if (registration.modifiers.length === 0) return state;
  return {
    ...state,
    costModifiers: [...state.costModifiers, ...registration.modifiers],
    nextId: registration.nextId,
  };
}

/** Modifiers a permanent registered on entry, dropped when it leaves. */
export function costModifiersRegisteredBy(
  modifiers: readonly RegisteredCostModifier[],
  source: ObjectId,
): readonly RegisteredCostModifier[] {
  return modifiers.filter((modifier) => modifier.sourceOid === source);
}

/**
 * What `card` actually costs `player` to cast right now: CR 601.2b's X
 * resolved first, then every registered CR 601.2f reduction that applies to
 * this player and this card's type, folded into generic mana and floored at
 * zero (CR 601.2f: a reduction never touches colored requirements and never
 * goes negative). The one seam `canPay`, `planPayment` and `onCastSpell` are
 * handed instead of `card.manaCost` directly.
 *
 * `x` is ignored when the cost has no X — `resolveX` is a no-op there — so a
 * caller that has not yet decided whether a cost needs one can always pass it
 * through unconditionally.
 */
export function effectiveManaCost(
  state: GameState,
  player: PlayerId,
  card: CastableCard,
  x?: number,
): ManaCost {
  const withX = resolveX(card.manaCost, x ?? 0);
  let reduction = 0;
  for (const modifier of state.costModifiers) {
    if (modifier.controller !== player) continue;
    // Read through `printedCardTypes` rather than off `card.kind`, so an
    // artifact creature spell is reduced by "artifact spells you cast cost {1}
    // less". Its discriminant is `creature` and its type line reads both, and
    // the comparison against the discriminant skipped half the artifacts a
    // generated set prints (`mtg-0zhm`, the CR 205.1a class of `mtg-6y4g`).
    if (modifier.cardType !== null && !printedCardTypes(card).includes(modifier.cardType)) continue;
    reduction += modifier.amount;
  }
  if (reduction === 0) return withX;
  return { ...withX, generic: Math.max(0, withX.generic - reduction) };
}

/**
 * The largest X this player could announce for `card` right now, or `null`
 * when the cost has no X, or when even X = 0 is unpayable.
 *
 * `availableMana` (pool plus untapped sources) is an upper bound rather than
 * an answer on its own — it ignores which colors those sources produce — so
 * the search still checks `canPay` at every candidate counting down from it.
 * That makes this at most `availableMana + 1` calls to the same blind planner
 * `canPay` already runs at every priority, not a new algorithm.
 */
export function maxPayableX(state: GameState, player: PlayerId, card: CastableCard): number | null {
  if (!card.manaCost.hasX) return null;
  const ceiling = availableMana(state, player);
  for (let x = ceiling; x >= 0; x -= 1) {
    if (canPay(state, player, effectiveManaCost(state, player, card, x))) return x;
  }
  return null;
}
