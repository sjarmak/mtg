/**
 * CR 603 triggered abilities: which printed triggers a run of events fired, and
 * putting them on the stack.
 *
 * This is not `replacement-effects.ts`, and the difference is the one that file
 * already draws. A `ReplaceableEvent` is a *proposal* the pipeline may rewrite
 * or delete before the kernel carries it out; a `GameEvent` is a *record* of
 * something that already happened. A trigger reads records. It never changes
 * the event it read: it puts a new object on the stack (CR 113.7a) that
 * resolves later, after state-based actions and before anybody gets priority.
 * "Enters tapped" and "enters with a counter" are replacement effects and live
 * over there; `zones.ts` says so at the arrival itself.
 *
 * Source conditions and the bounded event conditions all read events the
 * kernel already emitted. Exalted retains the sole attacker from
 * `attackersDeclared`, `selfDealsCombatDamageToCreature` retains the damaged
 * creature from `damageDealt`, and `selfBlocksCreature` retains the attacker
 * from one block pairing. The two other-creature entry conditions retain the
 * arriving creature too, because Hamletback Goliath and Trostani read its live
 * characteristics at resolution. Other board- and event-scanning conditions
 * (another permanent entering, a spell being cast, a step beginning, life
 * being gained, a card being drawn, an opponent taking noncombat damage)
 * retain no referent because none of this slice's effects need one.
 */
import type { Card, Color, StateTriggerCondition, TriggerCondition, TriggeredAbility } from '@mtg/dsl';
import {
  COLOR_CAST_TRIGGER_CONDITIONS,
  TRIGGERING_CREATURE_CONDITIONS,
  TRIGGERING_PLAYER_CONDITIONS,
  TRIGGER_POWER_THRESHOLD,
  isOpponentCreatureDiesReturnAbility,
  isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility,
  isSourceLinkedMatchingPlayCompletionAbility,
} from '@mtg/dsl';
import { counterCount } from './continuous';
import type { GameEvent } from './events';
import type { ObjectId, PlayerId } from './ids';
import { abilityObjectId } from './ids';
import {
  characteristicsOf,
  conditionHolds,
  controllerOf,
  copiableValuesOf,
  derivedCharacteristics,
  hasCardType,
  isCreatureObject,
  toughnessOf,
} from './layers';
import type {
  Attack,
  Block,
  DelayedCounterPlacement,
  DelayedSpellCopy,
  DelayedSpellCopyTrigger,
  DelayedZoneChange,
  GameState,
  IntrinsicTriggerCondition,
  LinkedExileReference,
  SourceCharacteristics,
  StackEntry,
  Target,
  TriggerContext,
} from './state';
import { targetIsCurrentIncarnation } from './target-incarnations';
import { apnapOrder, lastKnownCopiableCardOf } from './state';
import type { Trace } from './trace';
import { emit, withState } from './trace';
import { tryObject } from './zones';
import { siegeValuesOf } from './siege';

/** A printed trigger whose condition was met, before it is on the stack. */
export interface PendingTrigger {
  readonly sourceOid: ObjectId;
  /** Copiable source values retained from the exact incarnation that fired. */
  readonly sourceCard: Card;
  /** Index into `sourceCard.abilities`. */
  readonly index: number;
  readonly condition: TriggerCondition | StateTriggerCondition['kind'] | IntrinsicTriggerCondition;
  /** CR 603.3a: the player who controlled the source as it triggered. */
  readonly controller: PlayerId;
  /**
   * The creature this trigger retained from its own event — exalted's lone
   * attacker, a creature from an entry event, the creature the source just
   * dealt combat damage to, the attacker it just blocked, or the larger
   * creature it just met in a block. Absent on ordinary source triggers.
   */
  readonly triggeringCreature?: ObjectId;
  /** Battlefield incarnation paired with `triggeringCreature` under CR 400.7. */
  readonly triggeringCreatureIncarnation?: number;
  /** Power retained from the triggering event, updated with departure LKI. */
  readonly triggeringCreaturePower?: number;
  /** Toughness retained from the triggering event, updated with departure LKI. */
  readonly triggeringCreatureToughness?: number;
  /** Final post-replacement amount of the damage event. */
  readonly triggeringDamageAmount?: number;
  readonly triggeringSpellChosenColorCount?: number;
  /** Player fixed on the source incarnation when the damage event occurred. */
  readonly chosenPlayer?: PlayerId;
  /** The player named by the triggering event, never a CR 115 target. */
  readonly triggeringPlayer?: PlayerId;
  /** Soul Tithe's fallback host if its Aura leaves before resolution. */
  readonly enchantedPermanent?: ObjectId;
  readonly enchantedPermanentIncarnation?: number;
  /** The spell or ability whose target choice caused this trigger. */
  readonly triggeringStackObject?: ObjectId;
  readonly sourceCharacteristics: SourceCharacteristics;
  /** Battlefield incarnation retained when the trigger fired, if it had one. */
  readonly sourceBattlefieldIncarnation?: number;
  /** Exact source incarnation in its current zone when the trigger fired. */
  readonly sourceIncarnationAtStackCreation?: number;
  /** Source-linked exile captured from the source's last battlefield state. */
  readonly sourceLinkedExile?: readonly LinkedExileReference[];
  /** A created one-shot trigger rather than a printed triggered ability. */
  readonly delayedZoneChange?: DelayedZoneChange;
  /** CR 310.11b's intrinsic Siege trigger rather than a printed ability. */
  readonly siegeDefeat?: true;
  readonly delayedCounterPlacement?: DelayedCounterPlacement;
  readonly delayedSpellCopy?: DelayedSpellCopyTrigger;
  readonly damageRetaliation?: {
    readonly creatureOid: ObjectId;
    readonly creatureIncarnation: number;
  };
}

function attackDebuffsFrom(state: GameState, event: GameEvent): readonly PendingTrigger[] {
  if (event.type !== 'attackersDeclared') return [];
  return state.attackDebuffs
    .filter((rule) => rule.controller !== event.player)
    .flatMap((rule) =>
      event.attacks.flatMap((attack): readonly PendingTrigger[] => {
        const creature = tryObject(state, attack.oid);
        if (creature?.zone !== 'battlefield' || !isCreatureObject(state, attack.oid)) return [];
        const debuffAbility = {
          kind: 'triggered' as const,
          condition: 'selfAttacks' as const,
          effects: [
            {
              kind: 'pumpUntilEndOfTurn' as const,
              power: -1,
              toughness: 0,
              target: { kind: 'triggeringCreature' as const },
            },
          ],
        };
        return [
          {
            sourceOid: rule.sourceOid,
            sourceCard: {
              ...rule.sourceCard,
              abilities: rule.sourceCard.abilities.map((ability, index) =>
                index === rule.sourceAbilityIndex ? debuffAbility : ability,
              ),
            },
            index: rule.sourceAbilityIndex,
            condition: 'selfAttacks',
            controller: rule.controller,
            triggeringCreature: attack.oid,
            triggeringCreatureIncarnation: creature.incarnation ?? 0,
            chosenPlayer: rule.controller,
            sourceCharacteristics: rule.sourceCharacteristics,
            sourceBattlefieldIncarnation: rule.sourceBattlefieldIncarnation,
            sourceIncarnationAtStackCreation: rule.sourceBattlefieldIncarnation,
          },
        ];
      }),
    );
}

function damageRetaliationsFrom(state: GameState, event: GameEvent): readonly PendingTrigger[] {
  if (
    event.type !== 'damageDealt' ||
    !event.combat ||
    event.amount <= 0 ||
    event.target.kind !== 'permanent'
  ) {
    return [];
  }
  const damaged = tryObject(state, event.target.oid);
  const creature = tryObject(state, event.sourceOid);
  if (
    damaged?.zone !== 'battlefield' ||
    creature?.zone !== 'battlefield' ||
    !isCreatureObject(state, event.sourceOid)
  ) {
    return [];
  }
  const damagedOid = event.target.oid;
  return state.damageRetaliations
    .filter(
      (rule) =>
        rule.sourceOid === damagedOid && rule.sourceBattlefieldIncarnation === (damaged.incarnation ?? 0),
    )
    .map((rule) => {
      const retaliationAbility = {
        kind: 'triggered' as const,
        condition: 'selfIsDealtDamage' as const,
        effects: [
          {
            kind: 'destroyPermanent' as const,
            target: { kind: 'triggeringCreature' as const },
          },
        ],
      };
      return {
        sourceOid: rule.sourceOid,
        sourceCard: {
          ...rule.sourceCard,
          abilities: rule.sourceCard.abilities.map((ability, index) =>
            index === rule.sourceAbilityIndex ? retaliationAbility : ability,
          ),
        },
        index: rule.sourceAbilityIndex,
        condition: 'selfIsDealtDamage',
        controller: rule.controller,
        triggeringCreature: event.sourceOid,
        triggeringCreatureIncarnation: creature.incarnation ?? 0,
        triggeringDamageAmount: event.amount,
        chosenPlayer: rule.controller,
        sourceCharacteristics: rule.sourceCharacteristics,
        sourceBattlefieldIncarnation: rule.sourceBattlefieldIncarnation,
        sourceIncarnationAtStackCreation: damaged.incarnation ?? 0,
        damageRetaliation: {
          creatureOid: event.sourceOid,
          creatureIncarnation: creature.incarnation ?? 0,
        },
      };
    });
}

function interveningIfHolds(
  state: GameState,
  ability: TriggeredAbility,
  sourceOid: ObjectId,
  controller: PlayerId,
): boolean {
  if (ability.interveningIf === undefined) return true;
  return conditionHolds(
    { state, battlefield: state.battlefield, map: derivedCharacteristics(state) },
    ability.interveningIf,
    sourceOid,
    controller,
  );
}

interface ConditionMatch {
  readonly oid: ObjectId;
  readonly condition: TriggerCondition;
  /** This beginningOfEndStep carrier represents the atomic each-combat opponent-sacrifice hook. */
  readonly opponentSacrificeCombat?: true;
  /** This controlledCreatureDies carrier uses the opposing-source bundle. */
  readonly opponentCreatureDeathReturn?: true;
  /** This selfDealsCombatDamageToPlayer match came from noncombat damage. */
  readonly noncombatDamage?: true;
  /** The damage recipient was this permanent's controller, not the permanent itself. */
  readonly controllerWasDealtDamage?: true;
  /** Colors of the spell that supplied a controller-scoped cast match. */
  readonly spellColors?: readonly Color[];
  /** The physical card moved from a graveyard to the stack for this cast. */
  readonly castFromGraveyard?: true;
  /** Printed name retained from a spell cast or land played event. */
  readonly triggeringCardName?: string;
  readonly triggeringCreature?: ObjectId;
  readonly triggeringCreatureIncarnation?: number;
  readonly triggeringCreaturePower?: number;
  readonly triggeringCreatureToughness?: number;
  readonly triggeringDamageAmount?: number;
  readonly chosenPlayer?: PlayerId;
  readonly triggeringPlayer?: PlayerId;
  /** This each-player match came from the active player's draw step. */
  readonly enchantedControllerDrawStep?: true;
  readonly triggeringStackObject?: ObjectId;
  /** Basic land types on the permanent whose entry supplied this match. */
  readonly enteredLandSubtypes?: readonly string[];
  /**
   * Subtypes of one controlled attacker for the engine-only filtered attack
   * bundle. Presence distinguishes this board scan from reflexive selfAttacks.
   */
  readonly attackingCreatureSubtypes?: readonly string[];
}

/**
 * The unique battlefield objects one spell or ability just made targets.
 *
 * Ordinary target slots are recorded directly on the event. A plural slot
 * stays on its stack entry as
 * `multiTargets`, so the scan reads both representations before deduplicating.
 * CR 603.2c fires once per spell or ability, not once per slot that happens to
 * repeat the same object.
 */
function becameTargetMatches(
  state: GameState,
  stackOid: ObjectId,
  targets: readonly (Target | null)[],
  includeMultiTargets = true,
): readonly ConditionMatch[] {
  const entry = state.stack.find((candidate) => candidate.oid === stackOid);
  const currentOrdinaryOids =
    entry === undefined
      ? null
      : new Set(
          entry.targets.flatMap((target, index) =>
            target?.kind === 'permanent' &&
            targetIsCurrentIncarnation(state, target, entry.targetIncarnations?.[index])
              ? [target.oid]
              : [],
          ),
        );
  const currentPluralOids =
    entry?.multiTargets === undefined
      ? []
      : Object.entries(entry.multiTargets).flatMap(([effectIndex, members]) =>
          members.flatMap((target, memberIndex) =>
            target.kind === 'permanent' &&
            targetIsCurrentIncarnation(
              state,
              target,
              entry.multiTargetIncarnations?.[Number(effectIndex)]?.[memberIndex],
            )
              ? [target.oid]
              : [],
          ),
        );
  const currentTargetOids =
    currentOrdinaryOids === null ? null : new Set([...currentOrdinaryOids, ...currentPluralOids]);
  const oids = [
    ...targets.flatMap((target) =>
      target?.kind === 'permanent' && (currentTargetOids === null || currentTargetOids.has(target.oid))
        ? [target.oid]
        : [],
    ),
    ...(includeMultiTargets ? currentPluralOids : []),
  ];
  return [...new Set(oids)].flatMap((oid): ConditionMatch[] => {
    const matches: ConditionMatch[] = [
      { oid, condition: 'selfBecomesTarget' },
      ...attachedHostTargetMatches(state, oid),
    ];
    const target = tryObject(state, oid);
    if (entry !== undefined && target !== undefined && entry.controller !== controllerOf(state, oid)) {
      matches.push({
        oid,
        condition: 'selfBecomesTargetByOpponent',
        triggeringStackObject: stackOid,
      });
    }
    return matches;
  });
}

/** Aura sources whose current attachment is the permanent that became a target. */
function attachedHostTargetMatches(state: GameState, host: ObjectId): readonly ConditionMatch[] {
  return state.battlefield.flatMap((oid): ConditionMatch[] =>
    state.objects[oid]?.attachedTo === host ? [{ oid, condition: 'enchantedCreatureBecomesTarget' }] : [],
  );
}

/** Aura sources currently attached to the land that genuinely became tapped. */
function attachedLandTapMatches(state: GameState, host: ObjectId): readonly ConditionMatch[] {
  const triggeringPlayer = controllerOf(state, host);
  return state.battlefield.flatMap((oid): ConditionMatch[] =>
    state.objects[oid]?.attachedTo === host
      ? [{ oid, condition: 'enchantedLandBecomesTapped', triggeringPlayer }]
      : [],
  );
}

/**
 * Was this object a creature at the moment its condition is asked about?
 *
 * Asked of the layer system while the object is still on the battlefield, and
 * of its printed face once it has left. The fallback is not a shortcut: state-
 * based actions run *before* the trigger scan (`reduce.ts`'s `settle`), so a
 * creature that died to the very damage that fired the trigger is already in a
 * graveyard by the time this is asked, and `characteristicsOf` has nothing left
 * to read. `lastKnownSourceCharacteristics` carries colors and subtypes but no
 * card types, so the printed kind is the last-known answer available.
 *
 * Two callers, one question asked at two different moments: `damageDealt`
 * asks it of the *recipient*, already resolved by the time the event is
 * scanned; `permanentEntered` asks it of the *arriving* object, which is
 * already on the battlefield by the time that event fires (`zones.ts`), so
 * both reads land on the same branch.
 */
function wasCreature(state: GameState, oid: ObjectId): boolean {
  const object = tryObject(state, oid);
  if (object === undefined) return false;
  return object.zone === 'battlefield'
    ? isCreatureObject(state, oid)
    : lastKnownCopiableCardOf(object).kind === 'creature';
}

/**
 * A creature's layered power, or `null` when the object is not one.
 *
 * Two callers ask it at two moments: `blockersDeclared`, for the two halves of
 * a block, and `permanentEntered`, for the power threshold on an arrival.
 *
 * `characteristicsOf` throws on an id it cannot find, and this runs over a
 * `blockersDeclared` event that may be several events behind the current state
 * — a blocker destroyed by a first-strike replacement before the scan reaches
 * this event is gone by now — so the lookup is guarded rather than assumed. A
 * missing body reports `null` and the pairing it belonged to is simply not a
 * match, which is the same answer CR 509.1 gives: a creature that has left
 * combat is not blocking anything.
 */
function combatPower(state: GameState, oid: ObjectId): number | null {
  if (tryObject(state, oid) === undefined) return null;
  if (!isCreatureObject(state, oid)) return null;
  return characteristicsOf(state, oid).power;
}

/**
 * CR 509.1: the two halves of one block, filtered by power.
 *
 * One match per qualifying *creature*, not per block, because the condition
 * names a creature and CR 603.2 fires a trigger once per event that satisfies
 * it — a double block by two larger creatures gives the attacker two triggers
 * with two different referents, and each larger blocker also gives itself none,
 * since the source it blocked is the smaller one.
 *
 * Strictly greater in both directions, so equal power produces nothing at all
 * rather than firing both sides. That is the design intent stated on the
 * condition in `@mtg/dsl`'s vocabulary: the mechanic rewards standing in front
 * of something bigger, and two equal creatures trading is the ordinary combat
 * it is meant to be an alternative to.
 *
 * Power is read here, at declaration, and never again. A pump resolving later
 * in the declare-blockers step does not retroactively add or remove a trigger,
 * which matches how CR 509.1a checks its own legality: at the moment blockers
 * are declared, against the characteristics that exist then.
 */
function greaterPowerMatches(state: GameState, block: Block): readonly ConditionMatch[] {
  const attackerPower = combatPower(state, block.attacker);
  if (attackerPower === null) return [];
  const matches: ConditionMatch[] = [];
  for (const blockerOid of block.blockers) {
    const blockerPower = combatPower(state, blockerOid);
    if (blockerPower === null) continue;
    if (attackerPower > blockerPower) {
      matches.push({
        oid: blockerOid,
        condition: 'selfBlocksOrIsBlockedByGreaterPower',
        triggeringCreature: block.attacker,
      });
    }
    if (blockerPower > attackerPower) {
      matches.push({
        oid: block.attacker,
        condition: 'selfBlocksOrIsBlockedByGreaterPower',
        triggeringCreature: blockerOid,
      });
    }
  }
  return matches;
}

/** Whether one attack is aimed at a source controller or their planeswalker. */
function attacksControllerOrPlaneswalker(state: GameState, attack: Attack, controller: PlayerId): boolean {
  if (typeof attack.defender === 'number') return attack.defender === controller;
  return (
    attack.defender.kind === 'planeswalker' &&
    controllerOf(state, attack.defender.oid) === controller &&
    hasCardType(state, attack.defender.oid, 'planeswalker')
  );
}

/**
 * Which condition one event satisfies, and for which objects.
 *
 * Nine events answer the whole trigger vocabulary: `permanentEntered` (which
 * every arrival emits, tokens included, since `mtg-4vf`), a `zoneChanged` from
 * the battlefield to a graveyard (which covers destruction, lethal damage and
 * zero toughness alike, because all three route through `moveObject`),
 * `attackersDeclared`, `damageDealt`, `stepBegan`, `spellCast`,
 * `blockersDeclared`, `lifeChanged` and `cardDrawn`. Every other event answers none, and the
 * default says so rather than asserting: `GameEvent` grows for reasons that
 * have nothing to do with this file.
 *
 * The source-scanning conditions (`selfEnters`, `selfAttacks`, `selfDies`,
 * `selfDealsCombatDamageToCreature`, `selfDealsCombatDamageToPlayer`,
 * `selfBlocks`, `selfEntersOrAttacks`) match against the event's own object.
 * `selfEntersOrAttacks` is the one that answers two of those events rather than
 * one, and it answers each of them exactly once: it is emitted beside
 * `selfEnters` on an arrival and beside `selfAttacks` on a declaration, so a
 * permanent that enters and later attacks fires it twice, in two events, and a
 * permanent that does one of the two fires it once. The board-scanning
 * conditions (`controlledCreatureAttacksAlone`,
 * `anotherControlledPermanentEnters`, `controlledCreatureEnters`,
 * `anotherControlledCreatureEnters`,
 * `beginningOfYourUpkeep`, `beginningOfEachPlayersUpkeep`,
 * `beginningOfYourEndStep`, `youCastSpell`,
 * `youCastInstantOrSorcery`, `youGainLife`, `youDrawCard`,
 * `anotherControlledCreatureWithPowerThreeOrGreaterEnters`) enumerate every
 * permanent this player controls, because the ability that might hold the
 * condition is not the event's own object — the generic per-object ability-list
 * check in `collectTriggers` decides which of those permanents actually print
 * it.
 *
 * Two conditions scan wider than one player's half of the board, and each says
 * why at its own arm. The five `aPlayerCasts<Color>Spell` members scan every
 * permanent in play, because the printed line says "a player" and the M11
 * artifact cycle sits on either seat's battlefield reading both.
 * `opponentDealtNoncombatDamage` scans on the inverse filter — every permanent
 * whose controller is *not* the damaged player — because "an opponent" is said
 * from each permanent's controller's side, and the damaged player's own
 * permanents are the ones that must stay silent.
 */
function conditionsFrom(
  state: GameState,
  event: GameEvent,
  sacrificed: Set<ObjectId>,
  castFromGraveyard: boolean,
): readonly ConditionMatch[] {
  switch (event.type) {
    case 'permanentEntered': {
      const enteredIsCreature = wasCreature(state, event.oid);
      // CR 603.2 checks the condition against the game as it stands immediately
      // after the event, and `zones.ts` emits this one with the object already
      // on the battlefield, so the power is the layered power an anthem or a
      // -2/-0 effect has already had its say about. `combatPower` guards the
      // lookup for the reason it guards a blocker's: the object may be gone.
      const enteredPower = enteredIsCreature ? combatPower(state, event.oid) : null;
      const enteredToughness = enteredIsCreature ? toughnessOf(state, event.oid) : null;
      const enteredIsBig = enteredPower !== null && enteredPower >= TRIGGER_POWER_THRESHOLD;
      const enteredLandSubtypes = hasCardType(state, event.oid, 'land')
        ? characteristicsOf(state, event.oid).subtypes
        : [];
      const landSubtypeSources =
        enteredLandSubtypes.length === 0
          ? []
          : [
              ...state.battlefield.filter((oid) => controllerOf(state, oid) === event.controller),
              ...state.players[event.controller].graveyard,
            ].map((oid): ConditionMatch => ({
              oid,
              condition: 'controlledLandSubtypeEnters',
              enteredLandSubtypes,
            }));
      const controlledCreatureSources = enteredIsCreature
        ? state.battlefield
            .filter((oid) => controllerOf(state, oid) === event.controller)
            .map((oid): ConditionMatch => ({ oid, condition: 'controlledCreatureEnters' }))
        : [];
      const others = state.battlefield
        .filter((oid) => oid !== event.oid && controllerOf(state, oid) === event.controller)
        .flatMap((oid): ConditionMatch[] => [
          { oid, condition: 'anotherControlledPermanentEnters' },
          ...(enteredIsCreature
            ? [
                {
                  oid,
                  condition: 'anotherControlledCreatureEnters' as const,
                  triggeringCreature: event.oid,
                  ...(enteredToughness === null ? {} : { triggeringCreatureToughness: enteredToughness }),
                },
              ]
            : []),
          ...(enteredIsBig
            ? [{ oid, condition: 'anotherControlledCreatureWithPowerThreeOrGreaterEnters' as const }]
            : []),
        ]);
      const allOtherCreatureSources =
        enteredPower === null
          ? []
          : state.battlefield
              .filter((oid) => oid !== event.oid)
              .map((oid): ConditionMatch => ({
                oid,
                condition: 'anotherCreatureEnters',
                triggeringCreature: event.oid,
                triggeringCreaturePower: enteredPower,
              }));
      return [
        { oid: event.oid, condition: 'selfEnters' },
        { oid: event.oid, condition: 'selfEntersOrAttacks' },
        ...controlledCreatureSources,
        ...landSubtypeSources,
        ...others,
        ...allOtherCreatureSources,
      ];
    }
    case 'stepBegan': {
      if (
        event.step !== 'upkeep' &&
        event.step !== 'draw' &&
        event.step !== 'end' &&
        event.step !== 'beginCombat'
      )
        return [];
      const mine =
        event.step === 'draw' || event.step === 'beginCombat'
          ? []
          : state.battlefield
              .filter((oid) => controllerOf(state, oid) === event.active)
              .map((oid): ConditionMatch => ({
                oid,
                condition: event.step === 'upkeep' ? 'beginningOfYourUpkeep' : 'beginningOfYourEndStep',
              }));
      const eachUpkeep =
        event.step === 'upkeep'
          ? state.battlefield.map((oid): ConditionMatch => ({
              oid,
              condition: 'beginningOfEachPlayersUpkeep',
              triggeringPlayer: event.active,
            }))
          : [];
      const eachDrawStep =
        event.step === 'draw'
          ? state.battlefield.map((oid): ConditionMatch => ({
              oid,
              condition: 'beginningOfEachPlayersUpkeep',
              triggeringPlayer: event.active,
              enchantedControllerDrawStep: true,
            }))
          : [];
      const eachCombat =
        event.step === 'beginCombat'
          ? state.battlefield
              .filter((oid) =>
                characteristicsOf(state, oid).abilities.some(
                  (ability) =>
                    ability.kind === 'triggered' &&
                    ability.opponentMaySacrificeCreatureThenTapAndCounterSelf === true,
                ),
              )
              .map((oid): ConditionMatch => ({
                oid,
                condition: 'beginningOfEndStep',
                opponentSacrificeCombat: true,
              }))
          : [];
      // "At the beginning of the end step" is every permanent on the
      // battlefield, whoever controls it — the printed word is "the", not
      // "your". Two scans over the one event rather than a widened filter,
      // because a card that prints the filtered line and a card that prints
      // this one both fire on the active player's turn and only this one fires
      // on the other player's, and a single scan cannot say both.
      const everyone =
        event.step === 'end'
          ? state.battlefield.map((oid): ConditionMatch => ({ oid, condition: 'beginningOfEndStep' }))
          : [];
      return [...mine, ...eachUpkeep, ...eachDrawStep, ...eachCombat, ...everyone];
    }
    case 'spellCast': {
      const cast = tryObject(state, event.oid);
      const isInstantOrSorcery =
        cast !== undefined && (cast.card.kind === 'instant' || cast.card.kind === 'sorcery');
      // CR 105.2: the spell's colors, one condition each, so a white-blue spell
      // answers two members once apiece rather than one member twice. Read off
      // the printed card because a spell on the stack is not a permanent — the
      // layer system does not reach it, and nothing in this vocabulary changes
      // a spell's color while it is there.
      const castColors = cast === undefined ? [] : cast.card.colors;
      const colorConditions = castColors.map((color) => COLOR_CAST_TRIGGER_CONDITIONS[color]);
      return [
        ...becameTargetMatches(state, event.oid, event.targets),
        ...state.battlefield
          .filter((oid) => controllerOf(state, oid) === event.player)
          .flatMap((oid): ConditionMatch[] => [
            {
              oid,
              condition: 'youCastSpell',
              spellColors: castColors,
              ...(cast === undefined ? {} : { triggeringCardName: cast.card.name }),
            },
            ...(isInstantOrSorcery ? [{ oid, condition: 'youCastInstantOrSorcery' as const }] : []),
          ]),
        // The whole battlefield, not the caster's half: the printed line on the
        // M11 artifact cycle says "a player", so a permanent the other seat
        // controls answers this event too.
        ...state.battlefield.flatMap((oid): ConditionMatch[] =>
          colorConditions.map((condition): ConditionMatch => ({ oid, condition })),
        ),
        ...(castFromGraveyard
          ? state.battlefield.map((oid): ConditionMatch => ({
              oid,
              condition: 'youCastSpell',
              castFromGraveyard: true,
              triggeringPlayer: event.player,
            }))
          : []),
      ];
    }
    case 'landPlayed': {
      const played = tryObject(state, event.oid);
      if (played === undefined) return [];
      return state.battlefield
        .filter((oid) => controllerOf(state, oid) === event.player)
        .filter((oid) =>
          characteristicsOf(state, oid).abilities.some(isSourceLinkedMatchingPlayCompletionAbility),
        )
        .map((oid): ConditionMatch => ({
          oid,
          condition: 'youCastSpell',
          triggeringCardName: played.card.name,
        }));
    }
    case 'spellCopied':
    case 'abilityActivated':
    case 'triggerTargetsChosen':
      return becameTargetMatches(state, event.oid, event.targets);
    case 'spellTargetsChanged':
      return becameTargetMatches(state, event.oid, event.targets, false);
    case 'blockersDeclared':
      return event.blocks.flatMap((block, blockIndex): ConditionMatch[] => [
        ...block.blockers.flatMap((oid): ConditionMatch[] => [
          // CR 509.3a: the unqualified "blocks" event occurs once for the
          // creature this combat, even when an effect lets it block more than
          // one attacker. Preserve first-pair order without a mutable seen set.
          ...(event.blocks.slice(0, blockIndex).some((earlier) => earlier.blockers.includes(oid))
            ? []
            : [{ oid, condition: 'selfBlocks' as const }, ...attachedHostCombatMatches(state, oid)]),
          // CR 509.3b: a condition naming "a creature" fires per pairing and
          // retains that attacker without turning it into a CR 115 target.
          {
            oid,
            condition: 'selfBlocksCreature',
            triggeringCreature: block.attacker,
          },
        ]),
        ...greaterPowerMatches(state, block),
      ]);
    case 'lifeChanged': {
      // `gainLife` (`damage.ts`) is the only source of a `'gainLife'` or
      // `'lifelink'` reason, and it early-returns on a non-positive amount, so
      // every event reaching this branch is a real gain, never a loss dressed
      // as one.
      if (event.reason !== 'gainLife' && event.reason !== 'lifelink') return [];
      return state.battlefield
        .filter((oid) => controllerOf(state, oid) === event.player)
        .map((oid): ConditionMatch => ({ oid, condition: 'youGainLife' }));
    }
    case 'cardDrawn':
      // One event per card, emitted only after that card reaches the hand.
      // Scanning the drawer's permanents makes "you" source-relative without
      // retaining or exposing the hidden identity of the card that was drawn.
      return state.battlefield
        .filter((oid) => controllerOf(state, oid) === event.player)
        .map((oid): ConditionMatch => ({ oid, condition: 'youDrawCard' }));
    case 'permanentTapped':
      return attachedLandTapMatches(state, event.oid);
    case 'cardsDiscarded': {
      // The event batches the cards one effect discarded, while the printed
      // condition names one card. Repeat the source match once per oid so two
      // cards discarded together create two independent triggers, retaining
      // the same discarding player on each.
      const opposingSources = state.battlefield.filter((oid) => controllerOf(state, oid) !== event.player);
      return event.oids.flatMap(() =>
        opposingSources.map((oid): ConditionMatch => ({
          oid,
          condition: 'opponentDiscardsCard',
          triggeringPlayer: event.player,
        })),
      );
    }
    case 'counterRemoved':
      if (event.counter !== 'plusOnePlusOne') return [];
      return Array.from({ length: event.count }, (): ConditionMatch => ({
        oid: event.oid,
        condition: 'selfPlusOnePlusOneCounterRemoved',
      }));
    case 'zoneChanged': {
      const fromAnywhereMatches: readonly ConditionMatch[] =
        event.to === 'graveyard' ? [{ oid: event.oid, condition: 'selfPutIntoGraveyardFromAnywhere' }] : [];
      if (event.from !== 'battlefield') return fromAnywhereMatches;
      const departureMatches: readonly ConditionMatch[] = [
        ...fromAnywhereMatches,
        { oid: event.oid, condition: 'selfLeavesBattlefield' },
        ...(event.to === 'graveyard'
          ? [{ oid: event.oid, condition: 'selfPutIntoGraveyardFromBattlefield' as const }]
          : []),
      ];
      if (event.to !== 'graveyard') return departureMatches;
      // One departure, two printed conditions, and the narrower one is a
      // filter on the wider rather than a replacement for it: a card printing
      // `selfDies` still fires on a sacrifice, because "dies" in CR 700.4 is
      // the zone change and says nothing about the cause.
      // `delete` rather than `has`: the id is consumed by the zone change it
      // belongs to, so a permanent sacrificed, returned and destroyed inside one
      // scan window is read correctly both times.
      const selfMatches: readonly ConditionMatch[] = sacrificed.delete(event.oid)
        ? [{ oid: event.oid, condition: 'selfDies' }]
        : [
            { oid: event.oid, condition: 'selfDies' },
            { oid: event.oid, condition: 'selfDiesNotSacrificed' },
          ];
      const auraMatches = (event.attachedSources ?? []).map((oid): ConditionMatch => ({
        oid,
        condition: 'enchantedCreatureDies',
        ...(event.lastKnownController === undefined ? {} : { triggeringPlayer: event.lastKnownController }),
      }));
      const departed = tryObject(state, event.oid);
      const lastKnownController = departed?.lastKnownController;
      const departingCreaturePower = event.departingCreaturePower;
      const departingBattlefieldIncarnation = event.departingBattlefieldIncarnation;
      const controlledCreatureMatches: readonly ConditionMatch[] =
        departingCreaturePower === undefined ||
        departingBattlefieldIncarnation === undefined ||
        lastKnownController === undefined
          ? []
          : state.battlefield
              .filter((oid) => controllerOf(state, oid) === lastKnownController)
              .map((oid): ConditionMatch => ({
                oid,
                condition: 'controlledCreatureDies',
                triggeringCreature: event.oid,
                triggeringCreatureIncarnation: departingBattlefieldIncarnation,
                triggeringCreaturePower: departingCreaturePower,
              }));
      const opponentCreatureMatches: readonly ConditionMatch[] =
        departingCreaturePower === undefined ||
        departingBattlefieldIncarnation === undefined ||
        lastKnownController === undefined
          ? []
          : state.battlefield
              .filter((oid) => controllerOf(state, oid) !== lastKnownController)
              .map((oid): ConditionMatch => ({
                oid,
                condition: 'controlledCreatureDies',
                opponentCreatureDeathReturn: true,
                triggeringCreature: event.oid,
                triggeringCreatureIncarnation: departingBattlefieldIncarnation,
                triggeringCreaturePower: departingCreaturePower,
              }));
      return [
        ...departureMatches,
        ...selfMatches,
        ...auraMatches,
        ...controlledCreatureMatches,
        ...opponentCreatureMatches,
      ];
    }
    case 'damageDealt': {
      const damagedPermanent =
        event.target.kind === 'permanent' ? tryObject(state, event.target.oid) : undefined;
      const received: readonly ConditionMatch[] =
        event.target.kind === 'permanent' && event.amount > 0
          ? [
              {
                oid: event.target.oid,
                condition: 'selfIsDealtDamage',
                ...(damagedPermanent?.chosenPlayer === undefined
                  ? {}
                  : {
                      triggeringDamageAmount: event.amount,
                      chosenPlayer: damagedPermanent.chosenPlayer,
                    }),
              },
            ]
          : [];
      const damagedPlayer = event.target.kind === 'player' ? event.target.player : undefined;
      const controllerReceived: readonly ConditionMatch[] =
        damagedPlayer !== undefined && event.amount > 0
          ? state.battlefield
              .filter((oid) => controllerOf(state, oid) === damagedPlayer)
              .map((oid): ConditionMatch => ({
                oid,
                condition: 'selfIsDealtDamage',
                controllerWasDealtDamage: true,
              }))
          : [];
      // `combat` is the flag `applyDamage` carries through the replacement
      // pipeline, so damage from a spell or an activated ability answers
      // neither branch below. The two branches after it are the two shapes
      // `DamageTarget` has: a player, or a permanent that also has to be a
      // creature, because a planeswalker is a permanent too.
      if (!event.combat) {
        // The complement of the two combat branches below, and the one board
        // scan in this file that runs on an inverted filter: the seat that took
        // the damage is exactly the seat that must not fire, because "an
        // opponent" is said from each permanent's own controller's side. A
        // permanent damaged by a noncombat source answers nothing here — the
        // printed condition names a player.
        if (event.target.kind !== 'player') return received;
        const damaged = event.target.player;
        return [
          ...received,
          ...controllerReceived,
          {
            oid: event.sourceOid,
            condition: 'selfDealsCombatDamageToPlayer',
            noncombatDamage: true,
            triggeringPlayer: damaged,
          },
          ...state.battlefield
            .filter((oid) => controllerOf(state, oid) !== damaged)
            .map((oid): ConditionMatch => ({ oid, condition: 'opponentDealtNoncombatDamage' })),
        ];
      }
      if (event.target.kind === 'player') {
        const damageSource = tryObject(state, event.sourceOid);
        const controlledCreatureMatches: readonly ConditionMatch[] =
          event.amount <= 0 || damageSource?.zone !== 'battlefield' || !wasCreature(state, event.sourceOid)
            ? []
            : state.battlefield
                .filter((oid) => controllerOf(state, oid) === controllerOf(state, event.sourceOid))
                .map((oid): ConditionMatch => ({
                  oid,
                  condition: 'controlledCreatureDealsCombatDamageToPlayer',
                  triggeringCreature: event.sourceOid,
                  triggeringCreatureIncarnation: damageSource.incarnation ?? 0,
                  triggeringDamageAmount: event.amount,
                }));
        return [
          ...received,
          ...controllerReceived,
          {
            oid: event.sourceOid,
            condition: 'selfDealsCombatDamageToPlayer',
            triggeringPlayer: event.target.player,
            triggeringDamageAmount: event.amount,
          },
          ...controlledCreatureMatches,
        ];
      }
      if (!wasCreature(state, event.target.oid)) return received;
      return [
        ...received,
        {
          oid: event.sourceOid,
          condition: 'selfDealsCombatDamageToCreature',
          triggeringCreature: event.target.oid,
        },
      ];
    }
    case 'attackersDeclared': {
      const loneAttack = event.attacks[0];
      const defendingPlayer =
        loneAttack === undefined ? undefined : defendingPlayerOfAttack(state, loneAttack);
      return [
        ...event.attacks.flatMap((attack): ConditionMatch[] => [
          { oid: attack.oid, condition: 'selfAttacks', triggeringCreature: attack.oid },
          { oid: attack.oid, condition: 'selfEntersOrAttacks' },
          ...(event.attacks.length >= 4
            ? [{ oid: attack.oid, condition: 'selfAndThreeOthersAttack' as const }]
            : []),
          ...attachedHostCombatMatches(state, attack.oid),
        ]),
        ...(event.attacks.length === 1 && loneAttack !== undefined && defendingPlayer !== undefined
          ? [
              {
                oid: loneAttack.oid,
                condition: 'selfAttacksAlone' as const,
                triggeringPlayer: defendingPlayer,
              },
            ]
          : []),
        ...(event.attacks.length === 1 && loneAttack !== undefined
          ? state.battlefield
              .filter((oid) => controllerOf(state, oid) === event.player)
              .map((oid): ConditionMatch => ({
                oid,
                condition: 'controlledCreatureAttacksAlone',
                triggeringCreature: loneAttack.oid,
              }))
          : []),
        ...event.attacks.flatMap((attack) =>
          state.battlefield
            .filter((oid) => attacksControllerOrPlaneswalker(state, attack, controllerOf(state, oid)))
            .map((oid): ConditionMatch => ({
              oid,
              condition: 'creatureAttacksYouOrPlaneswalkerYouControl',
              triggeringPlayer: event.player,
            })),
        ),
        ...event.attacks.flatMap((attack): ConditionMatch[] => {
          if (!hasCardType(state, attack.oid, 'creature')) return [];
          const attackingCreatureSubtypes = characteristicsOf(state, attack.oid).subtypes;
          return state.battlefield
            .filter((oid) => controllerOf(state, oid) === event.player)
            .filter((oid) =>
              characteristicsOf(state, oid).abilities.some(
                (ability) =>
                  ability.kind === 'triggered' &&
                  ability.attackingCreatureSubtype !== undefined &&
                  attackingCreatureSubtypes.includes(ability.attackingCreatureSubtype),
              ),
            )
            .map((oid): ConditionMatch => ({
              oid,
              condition: 'selfAttacks',
              attackingCreatureSubtypes,
            }));
        }),
      ];
    }
    default:
      return [];
  }
}

/** The player defending one attack, including attacks aimed at their permanent. */
function defendingPlayerOfAttack(state: GameState, attack: Attack): PlayerId | undefined {
  if (attack.defender === 0 || attack.defender === 1) return attack.defender;
  const defender = tryObject(state, attack.defender.oid);
  if (defender === undefined || defender.zone !== 'battlefield') return undefined;
  if (attack.defender.kind === 'battle') return defender.protector;
  return controllerOf(state, attack.defender.oid);
}

/** Aura sources whose current attachment is the creature entering combat. */
function attachedHostCombatMatches(state: GameState, host: ObjectId): readonly ConditionMatch[] {
  return state.battlefield.flatMap((oid): ConditionMatch[] =>
    state.objects[oid]?.attachedTo === host ? [{ oid, condition: 'enchantedCreatureAttacksOrBlocks' }] : [],
  );
}

/**
 * CR 603.3a asks who controlled the source when the ability triggered. A
 * permanent still on the battlefield is asked of the layer system, because
 * layer 2 owns control; one that has already left keeps the controller its
 * object record carries, which is what a death trigger needs — the creature is
 * in the graveyard by the time the event is scanned.
 */
function controllerAsTriggered(state: GameState, oid: ObjectId): PlayerId | null {
  const object = tryObject(state, oid);
  if (object === undefined) return null;
  return object.zone === 'battlefield'
    ? controllerOf(state, oid)
    : (object.lastKnownController ?? object.controller);
}

/**
 * CR 603.3b: simultaneous triggers go on the stack in APNAP order, each player
 * choosing among their own. The slice is two-player, so APNAP is "the active
 * player's first", and within one player v1 orders deterministically — the
 * order the events were emitted, then printed ability order — rather than
 * asking. Making that a decision is a fifth `AwaitKind` and a `Decision`
 * variant, which is its own bead.
 */
export function orderTriggers(state: GameState, fired: readonly PendingTrigger[]): readonly PendingTrigger[] {
  return apnapOrder(state).flatMap((player) => fired.filter((trigger) => trigger.controller === player));
}

/** Builds the rules-created trigger for the exact Siege that just reached zero defense. */
function siegeDefeatFrom(state: GameState, event: GameEvent): PendingTrigger | null {
  if (event.type !== 'battleDefeated') return null;
  const object = tryObject(state, event.oid);
  const sourceCard = siegeValuesOf(state, event.oid);
  if (object?.zone !== 'battlefield' || object.siegeDefeatPending !== true || sourceCard === null) {
    return null;
  }
  const current = characteristicsOf(state, event.oid);
  return {
    sourceOid: event.oid,
    sourceCard,
    index: sourceCard.abilities.length,
    condition: 'siegeDefeated',
    controller: current.controller,
    sourceCharacteristics: {
      colors: [...current.colors],
      subtypes: [...current.subtypes],
      keywords: [...current.keywords],
    },
    sourceBattlefieldIncarnation: object.incarnation ?? 0,
    siegeDefeat: true,
  };
}

/**
 * Every printed trigger fired by the events from `from` onward, in the order
 * they belong on the stack.
 *
 * The watermark is an index into the trace's own events rather than state,
 * which is sound because `settle` is the only caller and never returns while an
 * event is unscanned.
 */
export function collectTriggers(trace: Trace, from: number): readonly PendingTrigger[] {
  let fired: readonly PendingTrigger[] = [];
  // CR 701.17b's half of `selfDiesNotSacrificed`, carried forward across the
  // scan rather than looked up per event, because a sacrifice is two events:
  // `permanentSacrificed` is emitted and the `zoneChanged` follows it
  // (`reduce.ts`). The id is *consumed* when its zone change is read, so a
  // permanent sacrificed, returned and then destroyed inside one scan window
  // gets the right answer both times — a plain accumulating set would call the
  // second death a sacrifice too.
  const sacrificed = new Set<ObjectId>();
  for (const [offset, event] of trace.events.slice(from).entries()) {
    const state = trace.eventStates?.[from + offset] ?? trace.state;
    if (event.type === 'permanentSacrificed') sacrificed.add(event.oid);
    if (
      event.type === 'zoneChanged' &&
      event.departingBattlefieldIncarnation !== undefined &&
      (event.departingCreaturePower !== undefined || event.departingCreatureToughness !== undefined)
    ) {
      const departingBattlefieldIncarnation = event.departingBattlefieldIncarnation;
      const departingCharacteristics = {
        ...(event.departingCreaturePower === undefined
          ? {}
          : { triggeringCreaturePower: event.departingCreaturePower }),
        ...(event.departingCreatureToughness === undefined
          ? {}
          : { triggeringCreatureToughness: event.departingCreatureToughness }),
      };
      fired = fired.map((trigger) =>
        trigger.triggeringCreature === event.oid &&
        trigger.triggeringCreatureIncarnation === departingBattlefieldIncarnation
          ? { ...trigger, ...departingCharacteristics }
          : trigger,
      );
    }
    fired = [...fired, ...delayedZoneChangesFrom(state, event)];
    fired = [...fired, ...attackDebuffsFrom(state, event)];
    fired = [...fired, ...damageRetaliationsFrom(state, event)];
    const siegeDefeat = siegeDefeatFrom(state, event);
    if (siegeDefeat !== null) fired = [...fired, siegeDefeat];
    fired = [...fired, ...delayedCounterPlacementsFrom(state, event)];
    fired = [...fired, ...delayedSpellCopiesFrom(state, event)];
    // A real cast is recorded as the physical card's move to the stack and
    // then `spellCast`, adjacently (`pushSpell`). A copied-card cast emits only
    // `spellCast` (`pushCopiedCardSpell`). Reading that public event sequence
    // keeps cast origin attributable without widening GameEvent or the replay
    // schema, and the id/to checks reject unrelated preceding zone changes.
    const previous = trace.events[from + offset - 1];
    const castFromGraveyard =
      event.type === 'spellCast' &&
      previous?.type === 'zoneChanged' &&
      previous.oid === event.oid &&
      previous.from === 'graveyard' &&
      previous.to === 'stack';
    for (const match of conditionsFrom(state, event, sacrificed, castFromGraveyard)) {
      const object = tryObject(state, match.oid);
      const destinationZoneTrigger = match.condition === 'selfPutIntoGraveyardFromAnywhere';
      const graveyardSourceTrigger =
        match.condition === 'controlledLandSubtypeEnters' && object?.zone === 'graveyard';
      const controller =
        destinationZoneTrigger || graveyardSourceTrigger
          ? (object?.owner ?? null)
          : controllerAsTriggered(state, match.oid);
      if (object === undefined || controller === null) continue;
      const current =
        object.zone === 'battlefield' || destinationZoneTrigger
          ? characteristicsOf(state, match.oid)
          : undefined;
      const copied = graveyardSourceTrigger
        ? copiableValuesOf(state, match.oid)
        : object.zone === 'battlefield' || destinationZoneTrigger
          ? copiableValuesOf(state, match.oid)
          : lastKnownCopiableCardOf(object);
      const sourceCharacteristics = graveyardSourceTrigger
        ? { colors: [...copied.colors], subtypes: [...copied.subtypes], keywords: [...copied.keywords] }
        : (current ?? object.lastKnownSourceCharacteristics);
      if (sourceCharacteristics === undefined) continue;
      const sourceCard: Card = graveyardSourceTrigger
        ? copied
        : current === undefined
          ? { ...copied, abilities: [...(object.lastKnownAbilities ?? copied.abilities)] }
          : { ...copied, abilities: [...current.abilities] };
      for (const [index, ability] of sourceCard.abilities.entries()) {
        if (ability.kind !== 'triggered' || ability.condition !== match.condition) continue;
        if (isOpponentCreatureDiesReturnAbility(ability) !== (match.opponentCreatureDeathReturn === true)) {
          continue;
        }
        if (
          (ability.opponentMaySacrificeCreatureThenTapAndCounterSelf === true) !==
          (match.opponentSacrificeCombat === true)
        ) {
          continue;
        }
        if (
          (ability.enchantedControllerDrawStepAdditionalDraw === true) !==
          (match.enchantedControllerDrawStep === true)
        ) {
          continue;
        }
        if (match.noncombatDamage === true && ability.includesNoncombatDamage !== true) continue;
        const isFilteredAttackMatch = match.attackingCreatureSubtypes !== undefined;
        const isFilteredAttackAbility = ability.attackingCreatureSubtype !== undefined;
        if (isFilteredAttackMatch !== isFilteredAttackAbility) continue;
        if (
          isFilteredAttackMatch &&
          match.attackingCreatureSubtypes?.includes(ability.attackingCreatureSubtype!) !== true
        ) {
          continue;
        }
        if (
          match.condition === 'youCastSpell' &&
          (match.castFromGraveyard === true) !== (ability.castFromGraveyardByAnyPlayer === true)
        ) {
          continue;
        }
        if (isSourceLinkedMatchingPlayCompletionAbility(ability)) {
          const playedName = match.triggeringCardName;
          const hasMatchingLink =
            playedName !== undefined &&
            (object.linkedExile ?? []).some((reference) => {
              const linked = tryObject(state, reference.oid);
              return (
                linked?.zone === 'exile' &&
                linked.linkedExileId === reference.linkId &&
                linked.card.name === playedName
              );
            });
          if (!hasMatchingLink) continue;
        }
        if (
          (match.controllerWasDealtDamage === true) !==
          (ability.controllerDamageRemovesSourceCounter !== undefined)
        ) {
          continue;
        }
        if (
          ability.triggeringPlayerIsEnchantedCreatureController === true &&
          (match.triggeringPlayer === undefined ||
            object.attachedTo === undefined ||
            controllerOf(state, object.attachedTo) !== match.triggeringPlayer)
        ) {
          continue;
        }
        if (
          ability.triggeringPlayerIsOpponent === true &&
          (match.triggeringPlayer === undefined || match.triggeringPlayer === controller)
        ) {
          continue;
        }
        if (
          ability.triggeringPlayerHandAtMost !== undefined &&
          (match.triggeringPlayer === undefined ||
            state.players[match.triggeringPlayer].hand.length > ability.triggeringPlayerHandAtMost)
        ) {
          continue;
        }
        if (
          match.condition === 'controlledLandSubtypeEnters' &&
          (ability.landSubtype === undefined ||
            match.enteredLandSubtypes?.includes(ability.landSubtype) !== true ||
            (ability.triggerZone === 'graveyard'
              ? object.zone !== 'graveyard'
              : object.zone !== 'battlefield'))
        ) {
          continue;
        }
        if (!interveningIfHolds(state, ability, match.oid, controller)) continue;
        if (
          ability.spellColors !== undefined &&
          !ability.spellColors.some((color) => match.spellColors?.includes(color) === true)
        ) {
          continue;
        }
        if (ability.spellIsMulticolored === true && (match.spellColors?.length ?? 0) < 2) continue;
        const chosenColorCount =
          ability.spellSharesChosenColors === true
            ? (match.spellColors?.filter((color) => object.chosenColors?.includes(color) === true).length ??
              0)
            : undefined;
        if (ability.spellSharesChosenColors === true && chosenColorCount === 0) continue;
        const allSourceLinkedExile =
          object.zone === 'battlefield' ? object.linkedExile : object.lastKnownLinkedExile;
        const sourceLinkedExile = isSourceLinkedMatchingPlayCompletionAbility(ability)
          ? (allSourceLinkedExile ?? []).filter((reference) => {
              const linked = tryObject(state, reference.oid);
              return (
                linked?.zone === 'exile' &&
                linked.linkedExileId === reference.linkId &&
                linked.card.name === match.triggeringCardName
              );
            })
          : allSourceLinkedExile;
        const sourceBattlefieldIncarnation =
          object.zone === 'battlefield' ? (object.incarnation ?? 0) : undefined;
        const sourceIncarnationAtStackCreation = object.incarnation ?? 0;
        const triggeringCreature =
          match.triggeringCreature === undefined ? undefined : tryObject(state, match.triggeringCreature);
        if (
          match.triggeringCreature !== undefined &&
          (triggeringCreature === undefined ||
            (match.triggeringCreatureIncarnation === undefined && triggeringCreature.zone !== 'battlefield'))
        ) {
          throw new Error(
            `${match.condition} retained ${match.triggeringCreature}, which was not a battlefield object when it triggered`,
          );
        }
        fired = [
          ...fired,
          {
            sourceOid: match.oid,
            sourceCard,
            index,
            condition: match.condition,
            controller,
            ...(match.triggeringCreature === undefined
              ? {}
              : {
                  triggeringCreature: match.triggeringCreature,
                  triggeringCreatureIncarnation:
                    match.triggeringCreatureIncarnation ?? triggeringCreature?.incarnation ?? 0,
                  ...(match.triggeringCreaturePower === undefined
                    ? {}
                    : { triggeringCreaturePower: match.triggeringCreaturePower }),
                  ...(match.triggeringCreatureToughness === undefined
                    ? {}
                    : { triggeringCreatureToughness: match.triggeringCreatureToughness }),
                }),
            ...(match.triggeringPlayer === undefined ? {} : { triggeringPlayer: match.triggeringPlayer }),
            ...(isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility(ability) &&
            object.attachedTo !== undefined
              ? {
                  enchantedPermanent: object.attachedTo,
                  enchantedPermanentIncarnation: tryObject(state, object.attachedTo)?.incarnation ?? 0,
                }
              : {}),
            ...(match.triggeringDamageAmount === undefined
              ? {}
              : { triggeringDamageAmount: match.triggeringDamageAmount }),
            ...(chosenColorCount === undefined ? {} : { triggeringSpellChosenColorCount: chosenColorCount }),
            ...(match.chosenPlayer === undefined ? {} : { chosenPlayer: match.chosenPlayer }),
            ...(match.triggeringStackObject === undefined
              ? {}
              : { triggeringStackObject: match.triggeringStackObject }),
            sourceCharacteristics: {
              colors: [...sourceCharacteristics.colors],
              subtypes: [...sourceCharacteristics.subtypes],
              keywords: [...(sourceCharacteristics.keywords ?? sourceCard.keywords)],
            },
            ...(sourceBattlefieldIncarnation === undefined ? {} : { sourceBattlefieldIncarnation }),
            sourceIncarnationAtStackCreation,
            ...(sourceLinkedExile === undefined ? {} : { sourceLinkedExile: [...sourceLinkedExile] }),
          },
        ];
      }
    }
  }
  return orderTriggers(trace.state, fired);
}

/**
 * Every triggered ability that would fire if `attacks` were declared now.
 *
 * A forecast rather than a record: nothing is emitted, no state moves, and the
 * caller is a bot policy deciding whether an attack is worth making. It exists
 * so that question is answered by the matcher that will actually answer it a
 * moment later (`conditionsFrom`'s `attackersDeclared` arm, plus
 * `collectTriggers`' printed-ability filter) rather than by a second list of
 * attack-shaped condition names kept in another package. Six conditions reach
 * an attacking creature and one of them sits on an Aura attached to it; a
 * seventh added to the matcher is answered here the day it is added, which a
 * copied list is not.
 *
 * The declaration is hypothetical, so the two conditions that read the shape of
 * the whole declaration — `selfAttacksAlone` and `selfAndThreeOthersAttack` —
 * answer for the list passed in and not for the attack the policy eventually
 * makes. A policy asking about one creature at a time therefore hears "attacks
 * alone" answered yes; that is the permissive direction, and the cost of being
 * wrong is one attack made rather than one attack missed.
 */
export function attackDeclarationTriggers(
  state: GameState,
  player: PlayerId,
  attacks: readonly Attack[],
): readonly PendingTrigger[] {
  return collectTriggers({ state, events: [{ type: 'attackersDeclared', player, attacks }] }, 0);
}

/** Every CR 603.8 ability whose current board condition is true and not already stacked. */
export function collectStateTriggers(state: GameState): readonly PendingTrigger[] {
  const fired: PendingTrigger[] = [];
  for (const sourceOid of state.battlefield) {
    const object = tryObject(state, sourceOid);
    if (object === undefined) continue;
    const controller = controllerOf(state, sourceOid);
    const current = characteristicsOf(state, sourceOid);
    const sourceCard: Card = { ...copiableValuesOf(state, sourceOid), abilities: [...current.abilities] };
    for (const [index, ability] of sourceCard.abilities.entries()) {
      if (ability.kind !== 'stateTriggered') continue;
      const alreadyOnStack = state.stack.some(
        (entry) =>
          entry.ability?.sourceOid === sourceOid &&
          entry.ability.index === index &&
          entry.sourceBattlefieldIncarnation === (object.incarnation ?? 0),
      );
      if (alreadyOnStack) continue;
      const condition = ability.condition;
      const hasRequiredCounter = state.battlefield.some(
        (candidate) =>
          controllerOf(state, candidate) === controller &&
          counterCount(state.objects[candidate]!.counters, condition.counter) > 0,
      );
      if (hasRequiredCounter) continue;
      fired.push({
        sourceOid,
        sourceCard,
        index,
        condition: condition.kind,
        controller,
        sourceCharacteristics: {
          colors: [...current.colors],
          subtypes: [...current.subtypes],
        },
        sourceBattlefieldIncarnation: object.incarnation ?? 0,
        ...(object.linkedExile === undefined ? {} : { sourceLinkedExile: [...object.linkedExile] }),
      });
    }
  }
  return fired;
}

/** Delayed records due on this exact end-step-begin event. */
function delayedZoneChangesFrom(state: GameState, event: GameEvent): readonly PendingTrigger[] {
  if (event.type !== 'stepBegan' || event.step !== 'end') return [];
  return (state.delayedZoneChanges ?? [])
    .filter((delayed) => delayed.dueTurn <= event.turn)
    .map((delayed): PendingTrigger => ({
      sourceOid: delayed.sourceOid,
      sourceCard: delayed.sourceCard,
      index: delayed.sourceAbilityIndex,
      condition: 'beginningOfEndStep',
      controller: delayed.controller,
      sourceCharacteristics: {
        colors: [...delayed.sourceCard.colors],
        subtypes: 'subtypes' in delayed.sourceCard ? [...delayed.sourceCard.subtypes] : [],
      },
      delayedZoneChange: delayed,
    }));
}

/** Delayed counter records due on this exact end-step-begin event. */
function delayedCounterPlacementsFrom(state: GameState, event: GameEvent): readonly PendingTrigger[] {
  if (event.type !== 'stepBegan' || event.step !== 'end') return [];
  return (state.delayedCounterPlacements ?? [])
    .filter((delayed) => delayed.dueTurn <= event.turn)
    .map((delayed): PendingTrigger => ({
      sourceOid: delayed.sourceOid,
      sourceCard: delayed.sourceCard,
      index: delayed.sourceAbilityIndex,
      condition: 'beginningOfEndStep',
      controller: delayed.controller,
      sourceCharacteristics: {
        colors: [...delayed.sourceCard.colors],
        subtypes: 'subtypes' in delayed.sourceCard ? [...delayed.sourceCard.subtypes] : [],
      },
      delayedCounterPlacement: delayed,
    }));
}

/** Controller-bound, one-shot triggers created by Chandra's resolved effect. */
function delayedSpellCopiesFrom(state: GameState, event: GameEvent): readonly PendingTrigger[] {
  if (event.type !== 'spellCast') return [];
  const spell = tryObject(state, event.oid);
  if (spell?.card.kind !== 'instant' && spell?.card.kind !== 'sorcery') return [];
  return (state.delayedSpellCopies ?? [])
    .filter((delayed: DelayedSpellCopy) => delayed.controller === event.player)
    .map((delayed): PendingTrigger => ({
      sourceOid: delayed.sourceOid,
      sourceCard: delayed.sourceCard,
      index: delayed.sourceAbilityIndex,
      condition: 'youCastInstantOrSorcery',
      controller: delayed.controller,
      sourceCharacteristics: {
        colors: [...delayed.sourceCard.colors],
        subtypes: 'subtypes' in delayed.sourceCard ? [...delayed.sourceCard.subtypes] : [],
      },
      delayedSpellCopy: { ...delayed, spellOid: event.oid },
    }));
}

/**
 * The referent a fired trigger retained, or `null` when it retained none.
 *
 * The condition and retained field are assembled here so one cannot disagree
 * with the other on the stack.
 */
function readsCombatDamageAmount(trigger: PendingTrigger): boolean {
  const ability = trigger.sourceCard.abilities[trigger.index];
  return (
    ability?.kind === 'triggered' &&
    ability.effects.some(
      (effect) =>
        effect.kind === 'millCards' &&
        typeof effect.count !== 'number' &&
        effect.count.kind === 'triggeringDamageAmount',
    )
  );
}

function contextFor(trigger: PendingTrigger): TriggerContext | null {
  if (trigger.damageRetaliation !== undefined) {
    return {
      kind: 'selfIsDealtDamage',
      triggeringDamageAmount: trigger.triggeringDamageAmount ?? 0,
      chosenPlayer: trigger.controller,
      triggeringCreature: trigger.damageRetaliation.creatureOid,
      triggeringCreatureIncarnation: trigger.damageRetaliation.creatureIncarnation,
    };
  }
  if (trigger.triggeringSpellChosenColorCount !== undefined) {
    if (trigger.condition !== 'youCastSpell') {
      throw new Error('chosen-color count retained outside a youCastSpell trigger');
    }
    return {
      kind: 'youCastSpell',
      triggeringPlayer: trigger.controller,
      triggeringSpellChosenColorCount: trigger.triggeringSpellChosenColorCount,
    };
  }
  if (trigger.condition === 'selfDealsCombatDamageToPlayer') {
    if (trigger.triggeringPlayer === undefined) {
      throw new Error('selfDealsCombatDamageToPlayer retained no damaged player');
    }
    const retainsAmount = readsCombatDamageAmount(trigger);
    if (retainsAmount && trigger.triggeringDamageAmount === undefined) {
      throw new Error('damage-linked combat trigger retained no damage amount');
    }
    return {
      kind: trigger.condition,
      triggeringPlayer: trigger.triggeringPlayer,
      ...(retainsAmount ? { triggeringDamageAmount: trigger.triggeringDamageAmount } : {}),
    };
  }
  if (
    trigger.triggeringDamageAmount !== undefined &&
    trigger.condition !== 'controlledCreatureDealsCombatDamageToPlayer'
  ) {
    if (trigger.condition !== 'selfIsDealtDamage' || trigger.chosenPlayer === undefined) {
      throw new Error('selfIsDealtDamage retained damage without its chosen player');
    }
    return {
      kind: 'selfIsDealtDamage',
      triggeringDamageAmount: trigger.triggeringDamageAmount,
      chosenPlayer: trigger.chosenPlayer,
    };
  }
  if (trigger.triggeringPlayer !== undefined) {
    const kind = TRIGGERING_PLAYER_CONDITIONS.find((condition) => condition === trigger.condition);
    if (kind === undefined || kind === 'selfDealsCombatDamageToPlayer') {
      throw new Error(`${trigger.condition} retained a player without being a player-referent condition`);
    }
    return {
      kind,
      triggeringPlayer: trigger.triggeringPlayer,
      ...(trigger.enchantedPermanent === undefined
        ? {}
        : {
            enchantedPermanent: trigger.enchantedPermanent,
            enchantedPermanentIncarnation: trigger.enchantedPermanentIncarnation ?? 0,
          }),
    };
  }
  if (trigger.triggeringStackObject !== undefined) {
    return {
      kind: 'selfBecomesTargetByOpponent',
      triggeringStackObject: trigger.triggeringStackObject,
    };
  }
  if (trigger.triggeringCreature === undefined) return null;
  if (trigger.triggeringCreatureIncarnation === undefined) {
    throw new Error(`${trigger.condition} retained a creature without its battlefield incarnation`);
  }
  const kind = TRIGGERING_CREATURE_CONDITIONS.find((condition) => condition === trigger.condition);
  if (kind === undefined) {
    throw new Error(`${trigger.condition} retained a creature without being a creature-referent condition`);
  }
  if (kind === 'anotherCreatureEnters' && trigger.triggeringCreaturePower === undefined) {
    throw new Error('anotherCreatureEnters retained a creature without its power');
  }
  if (kind === 'anotherControlledCreatureEnters' && trigger.triggeringCreatureToughness === undefined) {
    throw new Error('anotherControlledCreatureEnters retained a creature without its toughness');
  }
  if (
    kind === 'controlledCreatureDealsCombatDamageToPlayer' &&
    trigger.triggeringDamageAmount === undefined
  ) {
    throw new Error('controlled combat-damage trigger retained no damage amount');
  }
  return {
    kind,
    triggeringCreature: trigger.triggeringCreature,
    triggeringCreatureIncarnation: trigger.triggeringCreatureIncarnation,
    ...(trigger.triggeringCreaturePower === undefined
      ? {}
      : { triggeringCreaturePower: trigger.triggeringCreaturePower }),
    ...(trigger.triggeringCreatureToughness === undefined
      ? {}
      : { triggeringCreatureToughness: trigger.triggeringCreatureToughness }),
    ...(trigger.triggeringDamageAmount === undefined
      ? {}
      : { triggeringDamageAmount: trigger.triggeringDamageAmount }),
  };
}

/**
 * Puts fired triggers on the stack as objects of their own (CR 113.7a), and
 * records that each one fired.
 *
 * Each entry mints an id from the same monotonic counter every other id comes
 * from, so an ability object can never collide with a card — and it is only an
 * id: an ability on the stack has no `GameObject`, which is why `resolveTop`
 * branches on `entry.ability` before it looks one up.
 *
 * `abilityTriggered` is emitted here, one per entry, for the reason
 * `abilityActivated` is emitted in `pushAbility` rather than in the reducer:
 * the id the event reports is minted on this line, and an event assembled
 * anywhere else would be quoting a number it had to be told. The entries go on
 * one at a time rather than as a batch so each event follows the state that
 * carries it, which is what a replay reading the log step by step needs.
 */
export function putTriggersOnStack(trace: Trace, fired: readonly PendingTrigger[]): Trace {
  let current = trace;
  for (const trigger of fired) {
    const state = current.state;
    const oid = abilityObjectId(state.nextId);
    const entry: StackEntry = {
      oid,
      controller: trigger.controller,
      targets: [],
      ability: { sourceOid: trigger.sourceOid, index: trigger.index },
      sourceCard: trigger.sourceCard,
      mode: null,
      triggerContext: contextFor(trigger),
      x: null,
      sourceCharacteristics: trigger.sourceCharacteristics,
      ...(trigger.sourceBattlefieldIncarnation === undefined
        ? {}
        : { sourceBattlefieldIncarnation: trigger.sourceBattlefieldIncarnation }),
      ...(trigger.sourceIncarnationAtStackCreation === undefined
        ? {}
        : { sourceIncarnationAtStackCreation: trigger.sourceIncarnationAtStackCreation }),
      ...(trigger.sourceLinkedExile === undefined
        ? {}
        : { sourceLinkedExile: [...trigger.sourceLinkedExile] }),
      ...(trigger.delayedZoneChange === undefined ? {} : { delayedZoneChange: trigger.delayedZoneChange }),
      ...(trigger.siegeDefeat === undefined ? {} : { siegeDefeat: true }),
      ...(trigger.delayedCounterPlacement === undefined
        ? {}
        : { delayedCounterPlacement: trigger.delayedCounterPlacement }),
      ...(trigger.delayedSpellCopy === undefined ? {} : { delayedSpellCopy: trigger.delayedSpellCopy }),
    };
    const consumedZoneChange = consumeDelayedZoneChange(state, trigger.delayedZoneChange?.id);
    const consumedCounter = consumeDelayedCounterPlacement(
      consumedZoneChange,
      trigger.delayedCounterPlacement?.id,
    );
    const consumed = consumeDelayedSpellCopy(consumedCounter, trigger.delayedSpellCopy?.id);
    const pushed = withState(current, {
      ...consumed,
      nextId: state.nextId + 1,
      stack: [...state.stack, entry],
    });
    current = emit(pushed, {
      type: 'abilityTriggered',
      player: trigger.controller,
      oid,
      source: trigger.sourceOid,
      index: trigger.index,
      condition: trigger.condition,
    });
  }
  return current;
}

/** Consumes a one-shot next-spell copy when its trigger reaches the stack. */
function consumeDelayedSpellCopy(state: GameState, id: number | undefined): GameState {
  if (id === undefined || state.delayedSpellCopies === undefined) return state;
  const remaining = state.delayedSpellCopies.filter((delayed) => delayed.id !== id);
  const { delayedSpellCopies: _consumed, ...withoutDelayed } = state;
  return remaining.length === 0 ? withoutDelayed : { ...withoutDelayed, delayedSpellCopies: remaining };
}

/** Consumes a one-shot delayed counter record when its trigger is stacked. */
function consumeDelayedCounterPlacement(state: GameState, id: number | undefined): GameState {
  if (id === undefined || state.delayedCounterPlacements === undefined) return state;
  const remaining = state.delayedCounterPlacements.filter((delayed) => delayed.id !== id);
  const { delayedCounterPlacements: _consumed, ...withoutDelayed } = state;
  return remaining.length === 0 ? withoutDelayed : { ...withoutDelayed, delayedCounterPlacements: remaining };
}

/** Consumes a one-shot record when its trigger is put on the stack. */
function consumeDelayedZoneChange(state: GameState, id: number | undefined): GameState {
  if (id === undefined || state.delayedZoneChanges === undefined) return state;
  const remaining = state.delayedZoneChanges.filter((delayed) => delayed.id !== id);
  const { delayedZoneChanges: _consumed, ...withoutDelayed } = state;
  return remaining.length === 0 ? withoutDelayed : { ...withoutDelayed, delayedZoneChanges: remaining };
}
