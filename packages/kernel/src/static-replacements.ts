/**
 * The static-ability seam into CR 614: a printed static whose modification
 * replaces an event rather than changing a characteristic.
 *
 * ## Why this is not `state.continuous`
 *
 * `cost.ts` argues the identical shape for the identical reason, one layer
 * over. A `StaticModification` used to compile one-to-one to a
 * `ContinuousEffect` (`effectForModification`, `abilities.ts`) and the layer
 * walk was its only consumer, so the union carried exactly the three
 * modifications CR 613 knows how to apply. A doubler is not one of those: CR
 * 614 rewrites an event *before* it happens and never asks what an object is,
 * and there is no layer for it to sit in. So the two replacement members of
 * `STATIC_MODIFICATION_KINDS` compile here instead, into the array the kernel
 * already has for exactly this (`GameState.replacements`), through the same
 * two choke points the other two seams use — `completeArrival` (`zones.ts`)
 * registers, `moveObject` (`zones.ts`) expires — because a printed static
 * exists exactly while its source is on the battlefield (CR 604.3).
 *
 * ## What was already here
 *
 * All of the machinery below the registration. `applyReplacements`
 * (`replacement.ts`) already sequenced CR 614.5, CR 614.15 and CR 616.1;
 * `ReplacementModification` already carried `multiplyDamage` and
 * `multiplyLifeGain`; `applyDamageModification` already multiplied. What did
 * not exist was any way for a *card* to put one of those in
 * `state.replacements`: the three writers were regeneration (an activated
 * ability, `destruction.ts`), an intrinsic tapped land (`zones.ts`, filtered
 * straight back out) and an ephemeral protection shield that is passed as
 * `additionalEffects` and never persisted (`damage.ts`). This file is that
 * missing arrow, and it is the whole of what the doublers needed.
 *
 * ## Controller is baked at registration
 *
 * `RegisteredCostModifier` already decided this and the same caveat holds:
 * `controller` is read once, when the permanent arrives, so a permanent that
 * changes controller afterward keeps registering its replacement for the
 * player who controlled it on entry. That matters for `doubleLifeGain`, whose
 * trigger names a player. It is a real limitation and it is the existing one
 * rather than a new one — the DSL prints no way to steal a permanent, so
 * nothing in a generated set can reach it.
 */
import type { Ability, Card } from '@mtg/dsl';
import { assertNever, isCombatStaticModification, isLayeredStaticModification } from '@mtg/dsl';
import type { ReplacementStaticModification } from '@mtg/dsl';
import { staticReplacementId } from './ids';
import type { ObjectId, PlayerId } from './ids';
import { controllerOf } from './layers';
import type { ReplacementEffect } from './replacement-effects';
import type { GameState } from './state';

export interface StaticReplacementRegistration {
  readonly replacements: readonly ReplacementEffect[];
  /** The state's id counter after minting one id per registered effect. */
  readonly nextId: number;
}

/**
 * One replacement modification as the effect it registers.
 *
 * `selfReplacement` is `false` for both. CR 614.15 is about an effect that
 * modifies an event its own source is part of — a permanent entering *as*
 * something, a spell that "enters with" — and neither doubler is: Furnace of
 * Rath rewrites damage between two other objects entirely. Claiming it would
 * make these jump the CR 616.1 queue ahead of a prevention shield, which is
 * the ordering the affected player is supposed to choose.
 *
 * `duration` is `whileOnBattlefield`, which is what makes
 * `staticReplacementsRegisteredBy` able to find these again on the way out
 * without matching on the modification kind the way the regeneration sweep
 * does.
 */
function replacementFor(
  modification: ReplacementStaticModification,
  id: string,
  source: ObjectId,
  controller: PlayerId,
  timestamp: number,
): ReplacementEffect {
  const common = {
    id,
    sourceOid: source,
    controller,
    timestamp,
    duration: 'whileOnBattlefield',
    selfReplacement: false,
  } as const;
  switch (modification.kind) {
    case 'doubleDamage':
      // Furnace of Rath: every field of the trigger is the "any" null, because
      // the printed card filters nothing — any source, any recipient, combat
      // or not. `ReplacementTrigger.fromSource` is one `ObjectId`, so the
      // narrower printings that read "a red instant or sorcery spell you
      // control" (Fire Servant) or "a creature you control" (Gratuitous
      // Violence) are not expressible here and are not offered by the DSL.
      return {
        ...common,
        trigger: { kind: 'damage', toPlayer: null, toPermanent: null, fromSource: null, combatOnly: false },
        modification: { kind: 'multiplyDamage', factor: 2 },
      };
    case 'doubleLifeGain':
      // Rhox Faithmender: "if *you* would gain life", so the trigger names the
      // controller rather than passing `null`. A null there would double an
      // opponent's life gain too, which is a card nobody printed.
      return {
        ...common,
        trigger: { kind: 'lifeGain', player: controller },
        modification: { kind: 'multiplyLifeGain', factor: 2 },
      };
    default:
      return assertNever(modification, 'replacementFor');
  }
}

/**
 * The replacement effects one printed ability registers on entry, or none.
 *
 * A triggered or activated ability registers nothing, for `continuousEffectsFor`'s
 * reason: neither is a continuous or replacement effect, and each is read off
 * the printed card at the moment it is used.
 *
 * The combat guard was added by `mtg-t3ik` alongside the layered one, and for
 * the identical reason: `STATIC_MODIFICATION_KINDS` grew a third class that is
 * not `ReplacementStaticModification` either, and `replacementFor`'s switch
 * below still covers only the two doublers. Before this guard existed, a
 * combat modification (not `isLayeredStaticModification`, since it isn't
 * layered) would have fallen through to `replacementFor` and hit its
 * `assertNever` default at runtime — this file's `ReplacementStaticModification`
 * type already excludes `CombatModification` (`static-modification-class.ts`),
 * so skipping this check would now fail to typecheck instead, but the
 * explicit early return keeps the reason visible here rather than as a type
 * error two functions away.
 */
function replacementsForAbility(
  ability: Ability,
  source: ObjectId,
  controller: PlayerId,
  counter: number,
): ReplacementEffect | null {
  if (ability.kind !== 'static') return null;
  const modification = ability.modification;
  if (isLayeredStaticModification(modification) || isCombatStaticModification(modification)) return null;
  return replacementFor(
    modification,
    staticReplacementId(counter),
    source,
    controller,
    // CR 613.7's timestamp rule reused for CR 614.15's ordering: the moment the
    // permanent entered, which is what `nextId` is at registration time. Two
    // doublers therefore apply oldest-first under `earliestTimestamp`, and the
    // order does not change the product.
    counter,
  );
}

/**
 * Every replacement effect a card's printed abilities register when it enters
 * the battlefield, plus the counter the caller must write back. Mirrors
 * `staticEffectsFor` (`abilities.ts`) exactly, over the other array.
 */
export function staticReplacementsFor(
  card: Card,
  source: ObjectId,
  controller: PlayerId,
  nextId: number,
): StaticReplacementRegistration {
  if (card.abilities.length === 0) return { replacements: [], nextId };
  const replacements: ReplacementEffect[] = [];
  let counter = nextId;
  for (const ability of card.abilities) {
    const effect = replacementsForAbility(ability, source, controller, counter);
    if (effect === null) continue;
    replacements.push(effect);
    counter += 1;
  }
  return { replacements, nextId: counter };
}

/**
 * Adds one battlefield permanent's static replacement effects to a state.
 *
 * One owner rather than two call sites doing it themselves, for the reason
 * `registerCostModifiers` and `registerStatics` both state: `completeArrival`
 * is the choke point every real arrival goes through and `scenario()` writes
 * battlefield objects directly, so both must register the same records or a
 * scenario-built Furnace of Rath does nothing in exactly the tests written to
 * prove it works.
 */
export function registerStaticReplacements(state: GameState, oid: ObjectId): GameState {
  const object = state.objects[oid];
  if (object === undefined) return state;
  const registration = staticReplacementsFor(object.card, oid, controllerOf(state, oid), state.nextId);
  if (registration.replacements.length === 0) return state;
  return {
    ...state,
    replacements: [...state.replacements, ...registration.replacements],
    nextId: registration.nextId,
  };
}

/**
 * Replacement effects a permanent registered on entry, dropped when it leaves.
 *
 * Keyed on the duration as well as the source, so the sweep cannot reach the
 * ephemeral shields and the intrinsic entry effects that share this array and
 * are not registered here: `damage.ts`'s protection shields are passed as
 * `additionalEffects` and never persisted, and `zones.ts`'s
 * `intrinsic:<oid>:entry` is filtered out by the arrival that created it.
 */
export function staticReplacementsRegisteredBy(
  replacements: readonly ReplacementEffect[],
  source: ObjectId,
): readonly ReplacementEffect[] {
  return replacements.filter(
    (effect) => effect.sourceOid === source && effect.duration === 'whileOnBattlefield',
  );
}
