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
 * modifications CR 613 knows how to apply. A replacement is not one of those:
 * CR 614 rewrites an event *before* it happens and never asks what an object is,
 * and there is no layer for it to sit in. So the replacement members of
 * `STATIC_MODIFICATION_KINDS` compile here instead. Battlefield replacements
 * register in `GameState.replacements` through `completeArrival`
 * (`zones.ts`) and expire through `moveObject`; Obstinate Baloth's third member
 * functions in hand and is compiled only for the proposed discard, then passed
 * as an ephemeral `additionalEffect` to the same pipeline.
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
 * missing arrow. The hand compiler below is the parallel arrow for a printed
 * static whose explicit zone is not the battlefield.
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
import {
  assertNever,
  isCombatStaticModification,
  isDamagePreventionStaticModification,
  isLayeredStaticModification,
} from '@mtg/dsl';
import type { ReplacementStaticModification } from '@mtg/dsl';
import { staticReplacementId } from './ids';
import type { ObjectId, PlayerId } from './ids';
import { controllerOf } from './layers';
import type { ReplacementEffect } from './replacement-effects';
import { copiableCardOf } from './state';
import type { GameState } from './state';

type BattlefieldReplacementStaticModification = Exclude<
  ReplacementStaticModification,
  | { readonly kind: 'discardedByOpponentEntersBattlefield' }
  | { readonly kind: 'damageCannotReduceControllerLifeBelow' }
>;

export interface StaticReplacementRegistration {
  readonly replacements: readonly ReplacementEffect[];
  /** The state's id counter after minting one id per registered effect. */
  readonly nextId: number;
}

/**
 * One replacement modification as the effect it registers.
 *
 * `selfReplacement` is `false` for every member here. CR 614.15 self-
 * replacements are resolving effects that replace part of their own spell or
 * ability. These are continuous effects from static abilities, including the
 * source-bound prevention shield, so the affected player chooses their order
 * under CR 616.1.
 *
 * `duration` is `whileOnBattlefield`, which is what makes
 * `staticReplacementsRegisteredBy` able to find these again on the way out
 * without matching on the modification kind the way the regeneration sweep
 * does.
 */
function replacementFor(
  modification: BattlefieldReplacementStaticModification,
  id: string,
  source: ObjectId,
  controller: PlayerId,
  timestamp: number,
  sourceBattlefieldIncarnation: number,
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
      // Furnace of Rath leaves `fromSpellSource` null. Fire Servant compiles
      // its typed spell filter into the same trigger; matching reads this
      // replacement's source controller live after any layer-2 control change.
      return {
        ...common,
        trigger: {
          kind: 'damage',
          toPlayer: null,
          toPermanent: null,
          toController: null,
          toPermanentCardType: null,
          fromSource: null,
          fromSpellSource:
            modification.sourceFilter === undefined
              ? null
              : {
                  cardTypes: modification.sourceFilter.cardTypes,
                  colors: modification.sourceFilter.colors,
                },
          combatOnly: false,
        },
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
    case 'doublePlusOnePlusOneCountersOnCreaturesYouControl':
      return {
        ...common,
        trigger: {
          kind: 'counterPlacement',
          controller,
          counter: 'plusOnePlusOne',
          creatureOnly: true,
        },
        modification: { kind: 'multiplyCounterPlacement', factor: 2 },
      };
    case 'preventDamageToSelfAndRemoveCounters':
      return {
        ...common,
        trigger: {
          kind: 'damage',
          toPlayer: null,
          toPermanent: source,
          toController: null,
          toPermanentCardType: null,
          fromSource: null,
          fromSpellSource: null,
          combatOnly: false,
        },
        modification: { kind: 'preventDamage', amount: 'all' },
        damageReplacementFollowUp: {
          kind: 'removeCounters',
          counter: modification.counter,
          sourceBattlefieldIncarnation,
          amountFrom: 'damageEvent',
        },
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
 * not `ReplacementStaticModification` either. The explicit hand-active guard
 * then narrows the replacement class to the battlefield-active members before
 * `replacementFor`. Before the combat guard existed, a
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
  sourceBattlefieldIncarnation: number,
): ReplacementEffect | null {
  if (ability.kind !== 'static') return null;
  const modification = ability.modification;
  if (
    isLayeredStaticModification(modification) ||
    isCombatStaticModification(modification) ||
    isDamagePreventionStaticModification(modification)
  )
    return null;
  // This replacement functions from the printed card in its owner's hand. It
  // is compiled event-locally by `handDiscardReplacementsFor` below and must
  // never be registered by the battlefield arrival path.
  if (modification.kind === 'discardedByOpponentEntersBattlefield') return null;
  // This one reads current life, controller and copied abilities for every
  // proposed damage event, so `damage.ts` compiles it event-locally instead of
  // freezing a registered record when the permanent enters.
  if (modification.kind === 'damageCannotReduceControllerLifeBelow') return null;
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
    sourceBattlefieldIncarnation,
  );
}

/**
 * Intrinsic replacement effects the named card contributes to one proposed
 * discard while it is still in hand. They are passed to `applyReplacements`
 * as additional effects and are never written into `GameState.replacements`.
 */
export function handDiscardReplacementsFor(
  card: Card,
  source: ObjectId,
  owner: PlayerId,
): readonly ReplacementEffect[] {
  return card.abilities.flatMap((ability) => {
    if (ability.kind !== 'static' || ability.modification.kind !== 'discardedByOpponentEntersBattlefield') {
      return [];
    }
    return [
      {
        id: `intrinsic:${source}:opponent-discard`,
        sourceOid: source,
        controller: owner,
        timestamp: -1,
        duration: 'whileInHand',
        selfReplacement: true,
        trigger: { kind: 'discard', oid: source, player: owner, byOpponent: true },
        modification: { kind: 'putDiscardedOntoBattlefield' },
      },
    ];
  });
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
  sourceBattlefieldIncarnation: number,
): StaticReplacementRegistration {
  if (card.abilities.length === 0) return { replacements: [], nextId };
  const replacements: ReplacementEffect[] = [];
  let counter = nextId;
  for (const ability of card.abilities) {
    const effect = replacementsForAbility(ability, source, controller, counter, sourceBattlefieldIncarnation);
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
  const registration = staticReplacementsFor(
    copiableCardOf(object),
    oid,
    controllerOf(state, oid),
    state.nextId,
    object.incarnation ?? 0,
  );
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
