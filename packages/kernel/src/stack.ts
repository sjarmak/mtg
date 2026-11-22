/**
 * The stack: putting spells on it, and resolving them LIFO.
 *
 * Targets are chosen when the spell is put on the stack and rechecked when it
 * resolves (CR 608.2b): a spell whose every target has become illegal doesn't
 * resolve at all, and an individual illegal target only skips its own effect.
 */
import type { AttachingAbility, Card, Effect, InstantCard, SorceryCard } from '@mtg/dsl';
import {
  effectsForActivatedAbility,
  hasAbilityEffects,
  hasTarget,
  isAttachingAbility,
  isAuraCard,
  isCounterTargetSpellUnlessAbility,
  isCounterTriggeringSpellOrAbilityAbility,
  isDamageTargetAndCreaturesWithSameNameAbility,
  isCombatDamageRetaliationAbility,
  isJaceArchitectAttackDebuffAbility,
  isJaceArchitectPilesAbility,
  isJaceArchitectSearchAndCastAbility,
  isGuildFeudAbility,
  isSourceLinkedMatchingPlayCompletionAbility,
  isSourceLinkedTopFiveExileAbility,
  isOptionalTrigger,
  isOpponentCreatureDiesReturnAbility,
  isPaidOptionalTrigger,
  isOptionalDiscardThenDrawAbility,
  isPutCounterThenWinAtThresholdAbility,
  isControllerDamageRemovesSourceCounterAbility,
  isPermanentCard,
  isReferentTarget,
  isRegenerationAbility,
  isReturnAnotherCreatureOrSacrificeSelfAbility,
  isSacrificeSelfUnlessControllerPaysAbility,
  isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility,
  isSourceAttachmentTarget,
  isSourceBodyOnlyTarget,
  effectUsesThatCreatureToughness,
  effectUsesThatPlayersHandSize,
  effectUsesTriggeringCreaturePower,
  effectUsesTriggeringCreatureToughness,
  referentAmountSourceIndex,
  playerReferentAmountSourceIndex,
  referentSourceIndex,
  isTargetedFight,
  spellEffectsFor,
  targetCountOf,
  transformedBackFaceOf,
} from '@mtg/dsl';
import { attachTo, isLegalAuraHost, isLegalHost } from './attach';
import type { ObjectId, PlayerId } from './ids';
import {
  applyDamageToTargetAndCreaturesWithSameName,
  applyOverloadEffects,
  grantOnGraveyardArrival,
  isTargetStillLegal,
  sameTarget,
  survivingMultipleTargets,
} from './effects';
import {
  applyResolutionEffects,
  awaitReturnAnotherCreatureChoice,
  awaitSpellTargets,
  awaitTransformedFreeCast,
  beginJaceArchitectPiles,
  beginJaceArchitectSearchAndCast,
  beginGuildFeudContest,
} from './scry';
import { canPlayerBeTargetedBy } from './keyword-abilities';
import { abilityObjectId, copiedSpellObjectId, opponentOf } from './ids';
export { copySpellOnStack } from './stack-spell-targets';
import { mayChooser } from './may-choice';
import { executePayment, planPayment } from './mana';
import type { TolledStackObject } from './unless-choice';
import { stackAwaitingUnless, stackUnless } from './unless-choice';
import type {
  AbilityOnStack,
  CastingCostChoice,
  GameState,
  LinkedExileReference,
  SourceCharacteristics,
  StackEntry,
  Target,
} from './state';
import { NOTHING_TALLIED } from './state';
import type { Trace } from './trace';
import { emit, putObject, withState } from './trace';
import { withTurn } from './turn';
import { getObject, moveObject, tryObject } from './zones';
import { createRegenerationShield, sacrificePermanent } from './destruction';
import { registerDamageRetaliation } from './damage-retaliation';
import { registerAttackDebuff } from './attack-debuff';
import { linkExileToSource, moveLinkedExile } from './source-linked-exile';
import { canBeTargetedBy } from './keyword-abilities';
import {
  conditionHolds,
  controllerOf,
  derivedCharacteristics,
  isCreatureObject,
  powerOf,
  toughnessOf,
} from './layers';
import { counterStackEntry } from './counter';
import type { RulesSource } from './rules-source';
import { stackedAbilityAt, stackEntryTargetingController } from './abilities';
import { collectTriggers } from './triggers';
import { clearSiegeDefeatPending } from './siege';
import { spellCard } from './stack-spell';
import { placeCounters, removeCounters } from './counters';
import { counterCount } from './continuous';
import { canPlayerWinGame } from './game-rules';
import { endGameWith } from './sba';
import { multiTargetIncarnationsOf, targetIncarnationsOf } from './target-incarnations';
import { isPluralTargetEffect } from './plural-targets';
import { returnAnotherCreatureCandidates } from './return-another-creature';

export function topOfStack(state: GameState): StackEntry | undefined {
  return state.stack[state.stack.length - 1];
}

/** Resolve an Aura or Equipment source's live attachment without retaining an old host. */
function attachmentReferentHost(state: GameState, sourceOid: ObjectId, kind: string): ObjectId | null {
  const source = tryObject(state, sourceOid);
  if (source === undefined || source.zone !== 'battlefield' || source.attachedTo === undefined) return null;
  if (kind === 'enchantedCreature') {
    return isLegalAuraHost(state, source.card, source.attachedTo) ? source.attachedTo : null;
  }
  if (kind !== 'equippedCreature') return null;
  const equipment = source.card.kind === 'artifact' && source.card.subtypes.includes('Equipment');
  return equipment && isCreatureObject(state, source.attachedTo) ? source.attachedTo : null;
}

/**
 * Moves a card from hand onto the stack with its chosen targets, and its
 * chosen mode if it has one (CR 700.2), locked in.
 *
 * `mode` is `null` rather than `undefined` for the same reason `ability` is:
 * `StackEntry` is plain state that must `structuredClone` and fingerprint
 * cleanly, and `null` is this codebase's spelling for "fixed, and there is no
 * such choice on this card" (`state.ts`'s `attachedTo` states the same
 * convention). A non-modal card's entry always carries `mode: null`, which is
 * what lets `@mtg/dsl`'s `spellEffectsFor` read every spell's selected effect
 * list through one call, modal or not.
 */
export function pushSpell(
  trace: Trace,
  player: PlayerId,
  oid: ObjectId,
  targets: readonly (Target | null)[],
  mode: number | null,
  x: number | null,
  multiTargets?: Readonly<Record<number, readonly Target[]>>,
  damageAllocations?: Readonly<Record<number, readonly number[]>>,
  paidSacrificePower?: number,
  paidSacrificeToughness?: number,
  castingCost?: CastingCostChoice,
): Trace {
  const moved = moveObject(trace, oid, 'stack');
  const object = getObject(moved.state, oid);
  const castPlayers = moved.state.turn.playersWhoCastSpellThisTurn;
  const state: GameState = {
    ...moved.state,
    objects: { ...moved.state.objects, [oid]: { ...object, controller: player } },
    turn: {
      ...moved.state.turn,
      playersWhoCastSpellThisTurn: castPlayers.includes(player) ? castPlayers : [...castPlayers, player],
    },
    stack: [
      ...moved.state.stack,
      {
        oid,
        controller: player,
        targets,
        targetIncarnations: targetIncarnationsOf(moved.state, targets),
        ...(multiTargets !== undefined ? { multiTargets } : {}),
        ...(multiTargets !== undefined
          ? { multiTargetIncarnations: multiTargetIncarnationsOf(moved.state, multiTargets) }
          : {}),
        ...(damageAllocations !== undefined ? { damageAllocations } : {}),
        ability: null,
        mode,
        triggerContext: null,
        x,
        ...(castingCost === undefined ? {} : { castingCost }),
        sourceCharacteristics: null,
        ...(paidSacrificePower === undefined ? {} : { paidSacrificePower }),
        ...(paidSacrificeToughness === undefined ? {} : { paidSacrificeToughness }),
      },
    ],
  };
  return emit(withState(moved, state), {
    type: 'spellCast',
    player,
    oid,
    targets,
    ...(multiTargets === undefined ? {} : { multiTargets }),
    ...(damageAllocations === undefined ? {} : { damageAllocations }),
    chosenX: x,
  });
}

/** Builds the stack identity and retained card values for a copied-card cast. */
function copiedCardEntry(
  state: GameState,
  player: PlayerId,
  originalOid: ObjectId,
  card: InstantCard | SorceryCard,
  targets: readonly (Target | null)[],
  mode: number | null,
  x: number | null,
  multiTargets?: Readonly<Record<number, readonly Target[]>>,
  damageAllocations?: Readonly<Record<number, readonly number[]>>,
  paidSacrificePower?: number,
  paidSacrificeToughness?: number,
  castingCost?: CastingCostChoice,
): StackEntry {
  return {
    oid: copiedSpellObjectId(state.nextId),
    controller: player,
    targets,
    targetIncarnations: targetIncarnationsOf(state, targets),
    ...(multiTargets === undefined ? {} : { multiTargets }),
    ...(multiTargets === undefined
      ? {}
      : { multiTargetIncarnations: multiTargetIncarnationsOf(state, multiTargets) }),
    ...(damageAllocations === undefined ? {} : { damageAllocations }),
    ability: null,
    mode,
    triggerContext: null,
    x,
    ...(castingCost === undefined ? {} : { castingCost }),
    sourceCharacteristics: null,
    ...(paidSacrificePower === undefined ? {} : { paidSacrificePower }),
    ...(paidSacrificeToughness === undefined ? {} : { paidSacrificeToughness }),
    copiedSpell: { card, copiedFrom: originalOid, sourceOid: originalOid },
  };
}

/** Casts a transient copy of an exiled card without moving the original card. */
export function pushCopiedCardSpell(
  trace: Trace,
  player: PlayerId,
  originalOid: ObjectId,
  card: InstantCard | SorceryCard,
  targets: readonly (Target | null)[],
  mode: number | null,
  x: number | null,
  multiTargets?: Readonly<Record<number, readonly Target[]>>,
  damageAllocations?: Readonly<Record<number, readonly number[]>>,
  paidSacrificePower?: number,
  paidSacrificeToughness?: number,
  castingCost?: CastingCostChoice,
): Trace {
  const entry = copiedCardEntry(
    trace.state,
    player,
    originalOid,
    card,
    targets,
    mode,
    x,
    multiTargets,
    damageAllocations,
    paidSacrificePower,
    paidSacrificeToughness,
    castingCost,
  );
  const castPlayers = trace.state.turn.playersWhoCastSpellThisTurn;
  const pushed = withState(trace, {
    ...trace.state,
    nextId: trace.state.nextId + 1,
    turn: {
      ...trace.state.turn,
      playersWhoCastSpellThisTurn: castPlayers.includes(player) ? castPlayers : [...castPlayers, player],
    },
    stack: [...trace.state.stack, entry],
  });
  return emit(pushed, {
    type: 'spellCast',
    player,
    oid: entry.oid,
    targets,
    ...(multiTargets === undefined ? {} : { multiTargets }),
    ...(damageAllocations === undefined ? {} : { damageAllocations }),
    chosenX: x,
  });
}

/**
 * Puts an activated ability on the stack as an object of its own (CR 113.7a).
 *
 * The id is minted from the same monotonic counter every other id comes from,
 * so an ability object can never collide with a card, and `ab7` in a log line
 * is visibly not a card. No `GameObject` is created: an ability on the stack is
 * an object without a card, which is why `resolveTop` branches on
 * `entry.ability` before it looks one up.
 *
 * The same shape `putTriggersOnStack` builds, with one difference that is the
 * whole of CR 601.2c: the targets were chosen by the player who activated it
 * and travel in the action, where a trigger's list is always empty.
 *
 * `abilityActivated` is emitted here rather than in the reducer for the reason
 * `spellCast` is emitted in `pushSpell`: the id the event reports is minted on
 * this line, and an event assembled anywhere else would be quoting a number it
 * had to be told.
 *
 * `x` is the value announced for the cost's `{X}` (CR 601.2b through CR
 * 602.2b), or `null` for the overwhelming majority of abilities, which print no
 * X. It arrives already paid: the reducer resolves it into the cost and charges
 * that before this function is reached, so the number banked here is a record
 * of what happened rather than a promise about what will. `applyResolution`
 * reads it back off the entry the same way it does for a cast spell, which is
 * why an activation needed no second field on `StackEntry`.
 *
 * `sourceBattlefieldIncarnation` is captured before costs are paid. The source
 * may leave while paying those costs and the ability still resolves, but a
 * source-bound instruction must not attach itself to a later incarnation that
 * happens to reuse the same object id.
 *
 * `paidSacrificePower` is the layered power of the sole permanent sacrificed
 * while paying this activation. The source can be that permanent, so the
 * reducer captures the value before the cost moves anything and this stack
 * object owns it for the rest of resolution.
 */
export function pushAbility(
  trace: Trace,
  player: PlayerId,
  sourceOid: ObjectId,
  index: number,
  mode: number | null,
  targets: readonly (Target | null)[],
  sourceCharacteristics: SourceCharacteristics,
  x: number | null,
  sourceBattlefieldIncarnation: number,
  sourceCard: Card,
  multiTargets?: Readonly<Record<number, readonly Target[]>>,
  damageAllocations?: Readonly<Record<number, readonly number[]>>,
  paidSacrificePower?: number,
  paidSacrificeToughness?: number,
  paidDiscardManaValue?: number,
): Trace {
  const state = trace.state;
  const oid = abilityObjectId(state.nextId);
  const entry: StackEntry = {
    oid,
    controller: player,
    targets,
    targetIncarnations: targetIncarnationsOf(state, targets),
    ...(multiTargets === undefined ? {} : { multiTargets }),
    ...(multiTargets === undefined
      ? {}
      : { multiTargetIncarnations: multiTargetIncarnationsOf(state, multiTargets) }),
    ...(damageAllocations === undefined ? {} : { damageAllocations }),
    ability: { sourceOid, index },
    sourceCard,
    mode,
    triggerContext: null,
    x,
    sourceCharacteristics,
    sourceBattlefieldIncarnation,
    sourceIncarnationAtStackCreation: sourceBattlefieldIncarnation,
    ...(paidSacrificePower === undefined ? {} : { paidSacrificePower }),
    ...(paidSacrificeToughness === undefined ? {} : { paidSacrificeToughness }),
    ...(paidDiscardManaValue === undefined ? {} : { paidDiscardManaValue }),
  };
  const pushed = withState(trace, {
    ...state,
    nextId: state.nextId + 1,
    stack: [...state.stack, entry],
  });
  return emit(pushed, {
    type: 'abilityActivated',
    player,
    oid,
    source: sourceOid,
    index,
    targets,
    ...(multiTargets === undefined ? {} : { multiTargets }),
    ...(damageAllocations === undefined ? {} : { damageAllocations }),
    chosenX: x,
  });
}

interface ResolutionPlan {
  readonly effects: readonly {
    readonly index: number;
    readonly effect: Effect;
    readonly target: Target | null;
    /** Surviving members for a plural slot; see `StackEntry.multiTargets`. */
    readonly multiTarget?: readonly Target[];
    /** Shares paired by index with the surviving plural targets. */
    readonly damageAllocation?: readonly number[];
    /** Layer-derived LKI for an amount that reads an earlier creature target. */
    readonly referentToughness?: number;
    /** Earlier legal player target retained for a live hand-size reading. */
    readonly referentPlayer?: PlayerId;
    /** Earlier creature target retained when a later cohort says “other.” */
    readonly referentOid?: ObjectId;
    /** Live-or-LKI power retained from the creature that caused this trigger. */
    readonly triggeringCreaturePower?: number;
    /** Live-or-LKI toughness retained from the creature that caused this trigger. */
    readonly triggeringCreatureToughness?: number;
    /** Source-linked exile captured by the enclosing trigger. */
    readonly sourceLinkedExile?: readonly LinkedExileReference[];
    /** The ability source incarnation that must still be current when this applies. */
    readonly sourceBattlefieldIncarnation?: number;
    /** Source provenance fixed when the ability entered the stack. */
    readonly sourceIncarnationAtStackCreation?: number;
    /** Layer-derived LKI retained from a spell's paid sacrifice. */
    readonly paidSacrificePower?: number;
    readonly paidSacrificeToughness?: number;
    readonly paidDiscardManaValue?: number;
  }[];
  readonly illegal: readonly { readonly index: number; readonly reason: string }[];
  readonly hadTargets: boolean;
  /**
   * Whether any one of those targets survived the recheck.
   *
   * Counted separately from `effects` because CR 608.2b asks about the word
   * "target" and not about the instruction list: "Destroy target artifact or
   * enchantment. You gain 4 life" keeps a life gain in `effects` whether or
   * not the artifact is still there, and a plan that read its own length would
   * conclude the spell still had something to do.
   */
  readonly keptTargets: boolean;
}

/**
 * Which of an object's effects still have a legal target, and which do not
 * (CR 608.2b). Written over an effect list because a spell's list and an
 * ability's are rechecked by identical rules — `isTargetStillLegal` never
 * learns which it is looking at, because the recorded target is all it needs.
 */
function planResolution(state: GameState, effects: readonly Effect[], entry: StackEntry): ResolutionPlan {
  const kept: {
    index: number;
    effect: Effect;
    target: Target | null;
    multiTarget?: readonly Target[];
    damageAllocation?: readonly number[];
    referentToughness?: number;
    referentPlayer?: PlayerId;
    referentOid?: ObjectId;
    triggeringCreaturePower?: number;
    triggeringCreatureToughness?: number;
    sourceLinkedExile?: readonly LinkedExileReference[];
    sourceBattlefieldIncarnation?: number;
    sourceIncarnationAtStackCreation?: number;
    paidSacrificePower?: number;
    paidSacrificeToughness?: number;
    paidDiscardManaValue?: number;
    delayedSourceCard?: Card;
    sourceAbilityIndex?: number;
  }[] = [];
  const illegal: { index: number; reason: string }[] = [];
  let hadTargets = false;
  let keptTargets = false;
  const source = entry.ability === null ? undefined : tryObject(state, entry.ability.sourceOid);
  const sourceBattlefieldIncarnation =
    entry.sourceBattlefieldIncarnation !== undefined &&
    source?.zone === 'battlefield' &&
    (source.incarnation ?? 0) === entry.sourceBattlefieldIncarnation
      ? entry.sourceBattlefieldIncarnation
      : undefined;
  const targetingController = stackEntryTargetingController(state, entry);
  const printedAbility = stackedAbilityAt(state, entry);
  for (const [index, effect] of effects.entries()) {
    const amountSourceIndex = referentAmountSourceIndex(effects, index);
    let referentToughness: number | undefined;
    if (amountSourceIndex !== null) {
      const amountSource = effects[amountSourceIndex];
      const referred = entry.targets[amountSourceIndex] ?? null;
      if (
        amountSource !== undefined &&
        referred?.kind === 'permanent' &&
        isTargetStillLegal(
          state,
          amountSource,
          entry.targets,
          amountSourceIndex,
          targetingController,
          targetingSource(state, entry),
          entry.targetIncarnations?.[amountSourceIndex],
        )
      ) {
        // Read before any instruction applies. Condemn moves the permanent in
        // effect 0 and reads this value in effect 1, so a live lookup at the
        // latter point would have no battlefield object left to ask. This is
        // CR 608.2h's last-known value, including the full layer walk.
        referentToughness = toughnessOf(state, referred.oid);
      }
    }
    // A validated linked amount always has a source index. If that source is
    // no longer legal, the amount has no information to read; drop this
    // dependent instruction just as the referent-target branch below does.
    if (effectUsesThatCreatureToughness(effect) && referentToughness === undefined) continue;
    const playerAmountSourceIndex = playerReferentAmountSourceIndex(effects, index);
    let referentPlayer: PlayerId | undefined;
    if (playerAmountSourceIndex !== null) {
      const amountSource = effects[playerAmountSourceIndex];
      const referred = entry.targets[playerAmountSourceIndex] ?? null;
      if (
        amountSource !== undefined &&
        referred?.kind === 'player' &&
        isTargetStillLegal(
          state,
          amountSource,
          entry.targets,
          playerAmountSourceIndex,
          targetingController,
          targetingSource(state, entry),
          entry.targetIncarnations?.[playerAmountSourceIndex],
        )
      ) {
        referentPlayer = referred.player;
      }
    }
    if (effectUsesThatPlayersHandSize(effect) && referentPlayer === undefined) continue;
    let triggeringCreaturePower: number | undefined;
    if (effectUsesTriggeringCreaturePower(effect)) {
      const context = entry.triggerContext;
      if (context !== null && 'triggeringCreature' in context) {
        const object = tryObject(state, context.triggeringCreature);
        triggeringCreaturePower =
          object?.zone === 'battlefield' &&
          (object.incarnation ?? 0) === context.triggeringCreatureIncarnation
            ? powerOf(state, context.triggeringCreature)
            : context.triggeringCreaturePower;
      }
      if (triggeringCreaturePower === undefined) continue;
    }
    let triggeringCreatureToughness: number | undefined;
    if (effectUsesTriggeringCreatureToughness(effect)) {
      const context = entry.triggerContext;
      if (context !== null && 'triggeringCreature' in context) {
        const object = tryObject(state, context.triggeringCreature);
        triggeringCreatureToughness =
          object?.zone === 'battlefield' &&
          (object.incarnation ?? 0) === context.triggeringCreatureIncarnation
            ? toughnessOf(state, context.triggeringCreature)
            : context.triggeringCreatureToughness;
      }
      if (triggeringCreatureToughness === undefined) continue;
    }
    let executableEffect = effect;
    if (
      effect.kind === 'dealDamage' &&
      typeof effect.amount !== 'number' &&
      effect.amount.kind === 'triggeringDamageAmount'
    ) {
      const context = entry.triggerContext;
      if (context?.kind !== 'selfIsDealtDamage') continue;
      executableEffect = { ...effect, amount: context.triggeringDamageAmount };
    }
    if (
      effect.kind === 'millCards' &&
      typeof effect.count !== 'number' &&
      effect.count.kind === 'triggeringDamageAmount'
    ) {
      const context = entry.triggerContext;
      if (context?.kind !== 'selfDealsCombatDamageToPlayer' || context.triggeringDamageAmount === undefined) {
        continue;
      }
      executableEffect = { ...effect, count: context.triggeringDamageAmount };
    }
    if (
      effect.kind === 'putCounters' &&
      typeof effect.count !== 'number' &&
      effect.count.kind === 'triggeringDamageAmount'
    ) {
      const context = entry.triggerContext;
      if (
        context?.kind !== 'controlledCreatureDealsCombatDamageToPlayer' ||
        context.triggeringDamageAmount === undefined
      ) {
        continue;
      }
      executableEffect = { ...effect, count: context.triggeringDamageAmount };
    }
    if (
      effect.kind === 'gainLife' &&
      typeof effect.amount !== 'number' &&
      effect.amount.kind === 'triggeringSpellChosenColorCount'
    ) {
      const context = entry.triggerContext;
      if (context?.kind !== 'youCastSpell' || context.triggeringSpellChosenColorCount === undefined) {
        continue;
      }
      executableEffect = { ...effect, amount: context.triggeringSpellChosenColorCount };
    }
    const retained = {
      ...(referentToughness === undefined ? {} : { referentToughness }),
      ...(referentPlayer === undefined ? {} : { referentPlayer }),
      ...(triggeringCreaturePower === undefined ? {} : { triggeringCreaturePower }),
      ...(triggeringCreatureToughness === undefined ? {} : { triggeringCreatureToughness }),
      ...(entry.sourceLinkedExile === undefined ? {} : { sourceLinkedExile: [...entry.sourceLinkedExile] }),
      ...(sourceBattlefieldIncarnation === undefined ? {} : { sourceBattlefieldIncarnation }),
      ...(entry.sourceIncarnationAtStackCreation === undefined
        ? {}
        : { sourceIncarnationAtStackCreation: entry.sourceIncarnationAtStackCreation }),
      ...(entry.paidSacrificePower === undefined ? {} : { paidSacrificePower: entry.paidSacrificePower }),
      ...(entry.paidSacrificeToughness === undefined
        ? {}
        : { paidSacrificeToughness: entry.paidSacrificeToughness }),
      ...(entry.paidDiscardManaValue === undefined
        ? {}
        : { paidDiscardManaValue: entry.paidDiscardManaValue }),
      ...(entry.sourceCard === undefined ? {} : { delayedSourceCard: entry.sourceCard }),
      ...(entry.ability === null ? {} : { sourceAbilityIndex: entry.ability.index }),
      ...(entry.sourceCharacteristics === null ? {} : { sourceCharacteristics: entry.sourceCharacteristics }),
      ...(printedAbility?.kind === 'triggered' &&
      printedAbility.opponentMaySacrificeCreatureThenTapAndCounterSelf === true &&
      index > 0
        ? { requiresSacrificeThisResolution: true as const }
        : {}),
    };
    const triggerReferentOid =
      effect.kind === 'pumpUntilEndOfTurn' &&
      effect.excludeReferent === true &&
      entry.triggerContext !== null &&
      entry.triggerContext.kind === 'selfAttacks' &&
      'triggeringCreature' in entry.triggerContext
        ? entry.triggerContext.triggeringCreature
        : undefined;
    if (hasTarget(effect) && effect.target.kind === 'triggeringCreature') {
      // Any retained referent answers the slot: `TriggerContext` exists only
      // for conditions that retain one, so the presence of a context is the
      // whole question and its `kind` is not read here.
      const context = entry.triggerContext;
      if (context === null || !('triggeringCreature' in context)) continue;
      const object = tryObject(state, context.triggeringCreature);
      if (
        object === undefined ||
        object.zone !== 'battlefield' ||
        (object.incarnation ?? 0) !== context.triggeringCreatureIncarnation
      ) {
        continue;
      }
      kept.push({
        index,
        effect: executableEffect,
        target: { kind: 'permanent', oid: context.triggeringCreature },
        ...retained,
      });
      continue;
    }
    if (hasTarget(effect) && effect.target.kind === 'triggeringPlayer') {
      const context = entry.triggerContext;
      const triggeringPlayer =
        printedAbility?.kind === 'triggered' &&
        printedAbility.opponentMaySacrificeCreatureThenTapAndCounterSelf === true
          ? opponentOf(entry.controller)
          : context !== null && 'triggeringPlayer' in context
            ? context.triggeringPlayer
            : undefined;
      if (triggeringPlayer === undefined) continue;
      kept.push({
        index,
        effect: executableEffect,
        target: { kind: 'player', player: triggeringPlayer },
        ...retained,
      });
      continue;
    }
    if (hasTarget(effect) && effect.target.kind === 'chosenPlayer') {
      const context = entry.triggerContext;
      if (context?.kind !== 'selfIsDealtDamage') continue;
      kept.push({
        index,
        effect: executableEffect,
        target: { kind: 'player', player: context.chosenPlayer },
        ...retained,
      });
      continue;
    }
    if (hasTarget(effect) && isSourceBodyOnlyTarget(effect.target.kind)) {
      // Retained from the ability itself rather than from an event —
      // `entry.ability` is null only for a resolving spell, and a spell
      // cannot carry either of these kinds (`checkEffectTarget` refuses the
      // whole list), so the source is always present here in practice; the
      // `?.` is defensive rather than a documented escape hatch.
      //
      // One branch for both members, because what it does is read an oid and
      // check the object is still on the battlefield, and neither step asks
      // what card type that object has. `selfPermanent` (`mtg-rji`) needed no
      // kernel work at all beyond being named here: the CR 608.2b-shaped
      // fallback below — a source that has left the battlefield makes the
      // effect a no-op rather than an illegal one — is already the right
      // answer for a Trisigil artifact that got destroyed in response to its
      // own upkeep trigger.
      const sourceOid = entry.ability?.sourceOid;
      if (sourceOid === undefined || sourceBattlefieldIncarnation === undefined) continue;
      const object = tryObject(state, sourceOid);
      if (object === undefined || object.zone !== 'battlefield') continue;
      kept.push({
        index,
        effect,
        target: { kind: 'permanent', oid: sourceOid },
        ...retained,
      });
      continue;
    }
    if (hasTarget(effect) && isSourceAttachmentTarget(effect.target.kind)) {
      const sourceOid = entry.ability?.sourceOid;
      if (sourceOid === undefined || sourceBattlefieldIncarnation === undefined) continue;
      const host = attachmentReferentHost(state, sourceOid, effect.target.kind);
      if (host === null) continue;
      kept.push({ index, effect, target: { kind: 'permanent', oid: host }, ...retained });
      continue;
    }
    if (hasTarget(effect) && isReferentTarget(effect.target.kind)) {
      // The sibling-list retained referents, and the only ones retained from
      // *this same effect list* (`mtg-nhyv.75`). Which slot it reads is derived
      // by `referentSourceIndex` (`@mtg/dsl`), the identical call
      // `checkReferentTargets` makes at validation time — so a card that
      // validated has exactly one earlier chooser here, and the two ends cannot
      // disagree about which slot the printed phrase names. The `null` guard is
      // defensive for the reason the source-body branch above has one: the
      // validator has already refused the shape that produces it.
      //
      // Nothing here touches `hadTargets` or `keptTargets`. A back-reference is
      // not a target (CR 115.1 — the caster chose one object, once), so CR
      // 608.2b must not count it: Chandra's Outrage has exactly one target, and
      // counting the referent as a second would make the spell resolve its
      // damage-to-controller half after the creature had left, which is the
      // opposite of what the rules and the printed card do.
      const sourceIndex = referentSourceIndex(effects, index);
      if (sourceIndex === null) continue;
      const chooser = effects[sourceIndex];
      if (chooser === undefined) continue;
      // The referent inherits the earlier slot's CR 608.2b verdict rather than
      // getting its own. If the chosen creature is no longer a legal target the
      // phrase has nothing to name, so the effect is dropped — and on a card
      // whose only target was that creature the spell has already fizzled by
      // the time this matters, because that slot's own recheck below is what
      // sets `keptTargets`.
      if (
        !isTargetStillLegal(
          state,
          chooser,
          entry.targets,
          sourceIndex,
          targetingController,
          targetingSource(state, entry),
          entry.targetIncarnations?.[sourceIndex],
        )
      ) {
        continue;
      }
      const referred = entry.targets[sourceIndex] ?? null;
      if (referred === null) continue;
      if (effect.target.kind === 'thatCreaturesController') {
        // The one projection in this branch, and it lives here rather than in
        // the effect arms: `dealDamage` takes a `Target` and CR 120.3 lets that
        // be a player or an object, so filling the slot with the player is what
        // keeps "read the controller off this object" out of every primitive
        // that can name a person. A player-kind chooser cannot reach this arm —
        // `referentSourceSpace` asks for a creature slot — so a non-permanent
        // referent here is a validator bug rather than a case to guess at.
        if (referred.kind !== 'permanent') continue;
        kept.push({
          index,
          effect,
          target: { kind: 'player', player: controllerOf(state, referred.oid) },
          ...(effect.kind === 'pumpUntilEndOfTurn' && effect.excludeReferent === true
            ? { referentOid: referred.oid }
            : {}),
          ...retained,
        });
        continue;
      }
      if (effect.target.kind === 'thatPlayerOrPlaneswalkerController') {
        const player = referred.kind === 'player' ? referred.player : controllerOf(state, referred.oid);
        kept.push({ index, effect, target: { kind: 'player', player }, ...retained });
        continue;
      }
      kept.push({ index, effect, target: referred, ...retained });
      continue;
    }
    if (isPluralTargetEffect(effect)) {
      // A plural target slot (`count` or `anyNumber`)
      // is CR 608.2b's partial-survivor case: each chosen member is
      // rechecked on its own, and whichever survive are what the effect
      // applies to. A submitted zero-member choice is legal and resolves with
      // nothing to apply to. A nonempty choice with zero survivors is the
      // ordinary all-targets-illegal fizzle and must retain that reason in the
      // event log.
      const members = entry.multiTargets?.[index] ?? [];
      if (members.length > 0) hadTargets = true;
      const survivors = survivingMultipleTargets(
        state,
        effect,
        members,
        targetingController,
        targetingSource(state, entry),
        entry.multiTargetIncarnations?.[index],
      );
      if (members.length > 0 && survivors.length === 0) {
        illegal.push({ index, reason: 'all chosen targets are no longer legal' });
        continue;
      }
      const allocations = entry.damageAllocations?.[index];
      const survivingAllocations =
        allocations === undefined
          ? undefined
          : members.flatMap((member, memberIndex) => {
              if (!survivors.some((survivor) => sameTarget(survivor, member))) return [];
              const allocation = allocations[memberIndex];
              if (allocation === undefined) {
                throw new Error(`missing damage allocation for plural target ${String(memberIndex)}`);
              }
              return [allocation];
            });
      if (survivors.length > 0) keptTargets = true;
      if (!isTargetedFight(effect) && hasTarget(effect) && targetCountOf(effect.target) === 1) {
        kept.push({
          index,
          effect,
          target: survivors[0] ?? null,
          ...retained,
        });
        continue;
      }
      kept.push({
        index,
        effect,
        target: null,
        multiTarget: survivors,
        ...(survivingAllocations === undefined ? {} : { damageAllocation: survivingAllocations }),
        ...retained,
      });
      continue;
    }
    const target = entry.targets[index] ?? null;
    if (target !== null) hadTargets = true;
    if (
      isTargetStillLegal(
        state,
        effect,
        entry.targets,
        index,
        targetingController,
        targetingSource(state, entry),
        entry.targetIncarnations?.[index],
      )
    ) {
      kept.push({
        index,
        effect: executableEffect,
        target,
        ...(triggerReferentOid === undefined ? {} : { referentOid: triggerReferentOid }),
        ...retained,
      });
      if (target !== null) keptTargets = true;
    } else {
      illegal.push({ index, reason: 'target is no longer legal' });
    }
  }
  return { effects: kept, illegal, hadTargets, keptTargets };
}

/** The characteristics a target sees from a spell or ability on the stack. */
function targetingSource(state: GameState, entry: StackEntry): RulesSource {
  if (entry.copiedSpell !== undefined) return entry.copiedSpell.card;
  const sourceOid = entry.ability?.sourceOid;
  if (sourceOid === undefined) return entry.oid;
  if (state.objects[sourceOid]?.zone === 'battlefield') return sourceOid;
  return entry.sourceCharacteristics ?? sourceOid;
}

/**
 * Resolves an ability on the stack (CR 608.2m): its effects happen and then it
 * simply ceases to exist. There is no zone move, because an ability on the
 * stack was never in a zone anything else can hold.
 *
 * The printed text is read from the copiable source values retained when the
 * ability joined the stack. The physical card may have changed zones more than
 * once since then, but CR 608.2 resolves this ability incarnation anyway. The
 * case that does nothing is a retained ability with no effects, which is a
 * static; no DSL card can put one on the stack, and the lookup stays total so a
 * malformed entry cannot become a crash.
 *
 * Targets are rechecked here, and both kinds go through the same check for the
 * same reason. A trigger's list was chosen as it was put on the stack (CR
 * 603.3d) and an activation's when the player paid for it (CR 601.2c); CR
 * 608.2b removes the whole ability when every one of those targets has since
 * become illegal — the whole ability, so an instruction on the same ability
 * that named no target is removed with it rather than resolving alone.
 *
 * ## The one place resolution stops
 *
 * A triggered ability's yes/no resolution choice asks its controller here, and
 * the question is asked *after* the target recheck rather than before it. For
 * most abilities this is CR 603.3b's "you may"; Faerie Impostor uses it for the
 * optional return cost before its sacrifice instruction. An ability whose
 * every target has gone is removed by CR 608.2b before its controller is ever
 * asked anything, and asking first would offer a player a choice between two
 * identical futures — a "may" they can only answer wrong.
 *
 * Nothing is emitted at the stop and the entry stays exactly where it is, so
 * the answer resumes the resolution rather than repeating it: `resolveAnswered`
 * below is the same tail this function runs, reached from `reduce.ts` with the
 * answer in hand. That is what keeps `resolutionBegan` at one per resolution.
 */
function resolveAbility(trace: Trace, entry: StackEntry, ability: AbilityOnStack): Trace {
  if (entry.delayedZoneChange !== undefined) return resolveDelayedZoneChange(trace, entry);
  if (entry.siegeDefeat === true) return resolveSiegeDefeat(trace, entry, ability);
  if (entry.delayedCounterPlacement !== undefined) return resolveDelayedCounterPlacement(trace, entry);
  if (entry.delayedSpellCopy !== undefined) return resolveDelayedSpellCopy(trace, entry);
  const printed = stackedAbilityAt(trace.state, entry);
  if (printed !== undefined && isRegenerationAbility(printed)) {
    const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
    return createRegenerationShield(popStackEntry(began, entry.oid), ability.sourceOid, entry.controller);
  }
  if (printed !== undefined && isCounterTriggeringSpellOrAbilityAbility(printed)) {
    const pending = stackUnless(trace.state);
    if (pending?.kind !== 'counterTriggeringSpellOrAbility') {
      return popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
    }
    if (stackAwaitingUnless(trace.state) !== null) return awaitUnless(trace, pending.payer);
    return finishCounterUnless(trace, pending, false);
  }
  if (printed !== undefined && isCounterTargetSpellUnlessAbility(printed)) {
    const pending = stackUnless(trace.state);
    if (pending?.kind !== 'counterTargetSpell') {
      return popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
    }
    if (stackAwaitingUnless(trace.state) !== null) return awaitUnless(trace, pending.payer);
    return finishCounterUnless(trace, pending, false);
  }
  if (printed !== undefined && isSacrificeSelfUnlessControllerPaysAbility(printed)) {
    const pending = stackUnless(trace.state);
    if (pending?.kind !== 'sacrificeSelf') {
      return popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
    }
    if (stackAwaitingUnless(trace.state) !== null) return awaitUnless(trace, pending.payer);
  }
  if (printed !== undefined && isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility(printed)) {
    const pending = stackUnless(trace.state);
    if (pending?.kind !== 'sacrificeEnchantedPermanent') {
      return popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
    }
    if (stackAwaitingUnless(trace.state) !== null) return awaitUnless(trace, pending.payer);
    return finishSacrificeEnchantedPermanentUnless(trace, pending, false, pending.payer);
  }
  if (printed !== undefined && isReturnAnotherCreatureOrSacrificeSelfAbility(printed)) {
    const candidates = returnAnotherCreatureCandidates(trace.state, ability.sourceOid, entry.controller);
    if (candidates.length > 0) return awaitOptionalTrigger(trace, entry);
  }
  if (printed !== undefined && isOpponentCreatureDiesReturnAbility(printed)) {
    return resolveOpponentCreatureDiesReturn(trace, entry, printed);
  }
  if (printed !== undefined && isSourceLinkedTopFiveExileAbility(printed)) {
    return resolveSourceLinkedTopFiveExile(trace, entry, ability);
  }
  if (printed !== undefined && isSourceLinkedMatchingPlayCompletionAbility(printed)) {
    const matching = matchingSearchCityReferences(trace.state, entry);
    if (matching.length > 0) return awaitOptionalTrigger(trace, entry);
    return resolveSearchCityCompletion(trace, entry, ability, false);
  }
  if (printed !== undefined && isGuildFeudAbility(printed)) {
    const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
    const popped = popStackEntry(began, entry.oid);
    const target = entry.targets[0];
    if (
      target?.kind !== 'player' ||
      target.player === entry.controller ||
      !canPlayerBeTargetedBy(trace.state, target.player, entry.controller)
    ) {
      return popped;
    }
    return beginGuildFeudContest(popped, ability.sourceOid, entry.controller, target.player);
  }
  if (
    printed !== undefined &&
    isJaceArchitectAttackDebuffAbility(printed) &&
    entry.sourceCard !== undefined &&
    entry.sourceBattlefieldIncarnation !== undefined &&
    entry.sourceCharacteristics !== null
  ) {
    const popped = popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
    return withState(
      popped,
      registerAttackDebuff(popped.state, {
        sourceOid: ability.sourceOid,
        sourceBattlefieldIncarnation: entry.sourceBattlefieldIncarnation,
        sourceCard: entry.sourceCard,
        sourceAbilityIndex: ability.index,
        sourceCharacteristics: entry.sourceCharacteristics,
        controller: entry.controller,
        expirySeat: entry.controller,
      }),
    );
  }
  if (printed !== undefined && isJaceArchitectPilesAbility(printed)) {
    const popped = popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
    return beginJaceArchitectPiles(popped, ability.sourceOid, entry.controller);
  }
  if (printed !== undefined && isJaceArchitectSearchAndCastAbility(printed)) {
    const popped = popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
    return beginJaceArchitectSearchAndCast(popped, ability.sourceOid, entry.controller);
  }
  if (printed === undefined || !hasAbilityEffects(printed)) {
    return popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
  }
  const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
  if (
    printed.kind === 'triggered' &&
    printed.interveningIf !== undefined &&
    !conditionHolds(
      {
        state: trace.state,
        battlefield: trace.state.battlefield,
        map: derivedCharacteristics(trace.state),
      },
      printed.interveningIf,
      ability.sourceOid,
      entry.controller,
    )
  ) {
    return popStackEntry(began, entry.oid);
  }
  if (printed.kind === 'triggered' && printed.triggeringPlayerHandAtMost !== undefined) {
    const context = entry.triggerContext;
    const triggeringPlayer =
      context !== null && context !== undefined && 'triggeringPlayer' in context
        ? context.triggeringPlayer
        : undefined;
    if (
      triggeringPlayer === undefined ||
      trace.state.players[triggeringPlayer].hand.length > printed.triggeringPlayerHandAtMost
    ) {
      return popStackEntry(began, entry.oid);
    }
  }
  if (isAttachingAbility(printed)) return resolveAttach(began, entry, ability.sourceOid, printed);

  const plan = planResolution(
    trace.state,
    printed.kind === 'activated' ? effectsForActivatedAbility(printed, entry.mode) : printed.effects,
    entry,
  );
  if (isOptionalTrigger(printed) && !fizzled(plan)) return awaitOptionalTrigger(trace, entry);
  return applyResolution(began, entry, ability, plan);
}

/** Exile and link exactly the top five cards available as the entry trigger resolves. */
function resolveSourceLinkedTopFiveExile(trace: Trace, entry: StackEntry, ability: AbilityOnStack): Trace {
  const popped = popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
  const top = popped.state.players[entry.controller].library.slice(0, 5);
  const exiled = top.reduce((current, oid) => moveObject(current, oid, 'exile'), popped);
  return linkExileToSource(exiled, ability.sourceOid, entry.sourceBattlefieldIncarnation, top);
}

/** Current exile incarnations retained by one matching-play trigger. */
function liveSearchCityReferences(state: GameState, entry: StackEntry): readonly LinkedExileReference[] {
  return (entry.sourceLinkedExile ?? []).filter((reference) => {
    const object = tryObject(state, reference.oid);
    return object?.zone === 'exile' && object.linkedExileId === reference.linkId;
  });
}

function matchingSearchCityReferences(state: GameState, entry: StackEntry): readonly LinkedExileReference[] {
  return liveSearchCityReferences(state, entry);
}

/** Resolve the optional return, then the mandatory empty-link sacrifice and turn grant. */
function resolveSearchCityCompletion(
  trace: Trace,
  entry: StackEntry,
  ability: AbilityOnStack,
  takeMatchingCard: boolean,
): Trace {
  const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
  let current = popStackEntry(began, entry.oid);
  const matching = matchingSearchCityReferences(current.state, entry);
  if (takeMatchingCard && matching[0] !== undefined) {
    current = moveLinkedExile(current, [matching[0]], 'hand');
  }
  const source = tryObject(current.state, ability.sourceOid);
  const sameSource =
    source?.zone === 'battlefield' &&
    entry.sourceBattlefieldIncarnation !== undefined &&
    (source.incarnation ?? 0) === entry.sourceBattlefieldIncarnation;
  if (!sameSource) return current;
  const remaining = (source.linkedExile ?? []).filter((reference) => {
    const linked = tryObject(current.state, reference.oid);
    return linked?.zone === 'exile' && linked.linkedExileId === reference.linkId;
  });
  current = withState(
    current,
    putObject(current.state, {
      ...source,
      linkedExile: remaining,
    }),
  );
  if (remaining.length > 0) return current;
  if (controllerOf(current.state, ability.sourceOid) !== entry.controller) return current;
  const sacrificed = sacrificePermanent(current, ability.sourceOid, entry.controller);
  const moved = tryObject(sacrificed.state, ability.sourceOid)?.zone !== 'battlefield';
  if (!moved) return sacrificed;
  const prior = sacrificed.state.extraTurnSequence;
  return withState(sacrificed, {
    ...sacrificed.state,
    extraTurnSequence: {
      queue: [entry.controller, ...(prior?.queue ?? [])],
      resume: prior?.resume ?? opponentOf(sacrificed.state.turn.active),
    },
  });
}

/** Resolves Grave Betrayal's closed death-event bundle into one delayed record. */
function resolveOpponentCreatureDiesReturn(
  trace: Trace,
  entry: StackEntry,
  ability: Extract<Card['abilities'][number], { kind: 'triggered' }>,
): Trace {
  const popped = popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
  const context = entry.triggerContext;
  if (!isOpponentCreatureDiesReturnAbility(ability) || context?.kind !== 'controlledCreatureDies') {
    return popped;
  }
  const target = tryObject(popped.state, context.triggeringCreature);
  const graveyardIncarnation = context.triggeringCreatureIncarnation + 1;
  const sourceOid = entry.ability?.sourceOid;
  if (
    target === undefined ||
    target.token ||
    target.zone !== 'graveyard' ||
    (target.incarnation ?? 0) !== graveyardIncarnation ||
    entry.sourceCard === undefined ||
    sourceOid === undefined
  ) {
    return popped;
  }
  const id = popped.state.nextId;
  const dueTurn =
    popped.state.turn.step === 'end' || popped.state.turn.step === 'cleanup'
      ? popped.state.turn.number + 1
      : popped.state.turn.number;
  const bundle = ability.opponentCreatureDiesReturnAtNextEndStep;
  const delayed = {
    id,
    sourceOid,
    sourceCard: entry.sourceCard,
    sourceAbilityIndex: entry.ability?.index ?? 0,
    controller: entry.controller,
    targetOid: context.triggeringCreature,
    targetIncarnation: graveyardIncarnation,
    dueTurn,
    from: 'graveyard' as const,
    destination: 'battlefield' as const,
    tapped: false as const,
    under: 'controller' as const,
    counter: bundle.counter,
    count: bundle.count,
    alsoBecomes: bundle.alsoBecomes,
  };
  const scheduled = withState(popped, {
    ...popped.state,
    nextId: id + 1,
    delayedZoneChanges: [...(popped.state.delayedZoneChanges ?? []), delayed],
  });
  return emit(scheduled, {
    type: 'delayedZoneChangeScheduled',
    id,
    source: delayed.sourceOid,
    target: delayed.targetOid,
    targetIncarnation: delayed.targetIncarnation,
    dueTurn,
  });
}

/** Resolves CR 310.11b against the exact Battle incarnation that triggered. */
function resolveSiegeDefeat(trace: Trace, entry: StackEntry, ability: AbilityOnStack): Trace {
  const since = trace.events.length;
  const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
  const popped = popStackEntry(began, entry.oid);
  const source = tryObject(popped.state, ability.sourceOid);
  if (
    source?.zone !== 'battlefield' ||
    entry.sourceBattlefieldIncarnation === undefined ||
    (source.incarnation ?? 0) !== entry.sourceBattlefieldIncarnation
  ) {
    return popped;
  }
  const back = source.card.kind === 'battle' ? transformedBackFaceOf(source.card) : null;
  const exiled = moveObject(popped, ability.sourceOid, 'exile');
  if (back === null) return exiled;
  return awaitTransformedFreeCast(
    exiled,
    entry.controller,
    ability.sourceOid,
    back,
    collectTriggers(exiled, since),
  );
}

/** Resolves one source-incarnation-bound delayed counter placement. */
function resolveDelayedCounterPlacement(trace: Trace, entry: StackEntry): Trace {
  const delayed = entry.delayedCounterPlacement;
  if (delayed === undefined) return trace;
  const popped = popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
  const target = tryObject(popped.state, delayed.targetOid);
  if (target?.zone !== 'battlefield' || (target.incarnation ?? 0) !== delayed.targetIncarnation) {
    return popped;
  }
  return placeCounters(popped, delayed.targetOid, delayed.counter, delayed.count);
}

/** Resolves a retained next-spell trigger independently of Chandra's survival. */
function resolveDelayedSpellCopy(trace: Trace, entry: StackEntry): Trace {
  const delayed = entry.delayedSpellCopy;
  if (delayed === undefined) return trace;
  const popped = popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
  const original = tryObject(popped.state, delayed.spellOid);
  if (original?.zone !== 'stack' || (original.card.kind !== 'instant' && original.card.kind !== 'sorcery')) {
    return popped;
  }
  return awaitSpellTargets(
    popped,
    delayed.sourceOid,
    delayed.controller,
    delayed.spellOid,
    'copySpell',
    [],
    null,
    null,
    NOTHING_TALLIED,
    [],
  );
}

/** Resolves one exact delayed exile return independently of its source. */
function resolveDelayedZoneChange(trace: Trace, entry: StackEntry): Trace {
  const delayed = entry.delayedZoneChange;
  if (delayed === undefined) return trace;
  const popped = popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
  const target = tryObject(popped.state, delayed.targetOid);
  if (
    target === undefined ||
    target.token ||
    target.zone !== delayed.from ||
    (target.incarnation ?? 0) !== delayed.targetIncarnation
  ) {
    return popped;
  }
  const moved = moveObject(popped, delayed.targetOid, delayed.destination, {
    tapped: delayed.tapped,
    controller: delayed.under === 'owner' ? target.owner : delayed.controller,
  });
  if (delayed.from === 'exile') return moved;
  const arrived = tryObject(moved.state, delayed.targetOid);
  if (arrived?.zone !== 'battlefield' || (arrived.incarnation ?? 0) !== delayed.targetIncarnation + 1) {
    return moved;
  }
  const countered = placeCounters(moved, delayed.targetOid, delayed.counter, delayed.count);
  return grantOnGraveyardArrival(countered, delayed.targetOid, delayed.alsoBecomes, delayed.sourceOid);
}

/**
 * CR 608.2b: it had targets, and not one of them is legal any more.
 *
 * The rule is written over the targets rather than over the instructions, and
 * the difference is a whole spell: Solemn Offering's life gain names no target,
 * so a test that asked whether any instruction survived would resolve the gain
 * on a spell the rules never resolve at all.
 */
function fizzled(plan: ResolutionPlan): boolean {
  return plan.hadTargets && !plan.keptTargets;
}

/**
 * Hands the game back so the controller can answer a "you may".
 *
 * `priority` is left exactly as `onPass` set it. A resolution happens with
 * nobody holding priority, and the player who gets it afterwards (CR 117.3b, the
 * active player) is granted it by whoever finishes the resolution — which is
 * `reduce.ts`'s answer handler rather than `onPass`, since `onPass` is returning
 * early with the question outstanding.
 */
function awaitOptionalTrigger(trace: Trace, entry: StackEntry): Trace {
  return withState(
    trace,
    withTurn(trace.state, { awaiting: 'optionalTrigger', awaitingPlayer: entry.controller }),
  );
}

/**
 * The tail of an ability resolution: report the skipped effects, leave the
 * stack, and apply what is left.
 *
 * Split out so an optional trigger that was accepted runs the same code an
 * ordinary one does. A second copy would be a second set of rules about when
 * `effectSkipped` is emitted and when the entry leaves the stack.
 *
 * `entry.x` is passed where a hardcoded `null` used to be. That constant was
 * true for as long as no ability could announce an X, and `mtg-nhyv.17` made it
 * false: Silklash Spider's damage is a `chosenX` amount, `applyEffect` answers
 * one out of the value threaded here, and a `null` reaching it throws rather
 * than deals zero. A trigger still passes `null` and always will, because it
 * has no cost to announce anything against — the field says which, so this line
 * does not have to ask.
 */
function applyResolution(
  trace: Trace,
  entry: StackEntry,
  ability: AbilityOnStack,
  plan: ResolutionPlan,
): Trace {
  const printed = stackedAbilityAt(trace.state, entry);
  let current = trace;
  for (const skipped of plan.illegal) {
    current = emit(current, {
      type: 'effectSkipped',
      oid: entry.oid,
      index: skipped.index,
      why: skipped.reason,
    });
  }
  current = popStackEntry(current, entry.oid);
  // CR 608.2b takes the whole ability, so an instruction that named no target
  // does not happen either. The skips above are already the log of why.
  if (fizzled(plan)) return current;
  if (
    printed !== undefined &&
    isCombatDamageRetaliationAbility(printed) &&
    entry.sourceCard !== undefined &&
    entry.sourceBattlefieldIncarnation !== undefined &&
    entry.sourceCharacteristics !== null
  ) {
    return withState(
      current,
      registerDamageRetaliation(current.state, {
        sourceOid: ability.sourceOid,
        sourceBattlefieldIncarnation: entry.sourceBattlefieldIncarnation,
        sourceCard: entry.sourceCard,
        sourceAbilityIndex: ability.index,
        sourceCharacteristics: entry.sourceCharacteristics,
        controller: entry.controller,
        expirySeat: entry.controller,
      }),
    );
  }
  if (printed !== undefined && isDamageTargetAndCreaturesWithSameNameAbility(printed)) {
    const target = entry.targets[0];
    if (target?.kind !== 'permanent') return current;
    return applyDamageToTargetAndCreaturesWithSameName(
      current,
      ability.sourceOid,
      entry.controller,
      target.oid,
      entry.sourceCard,
      entry.sourceCharacteristics ?? undefined,
      entry.sourceIncarnationAtStackCreation,
    );
  }
  // Where this resolution starts in the event log. An effect that counts what
  // the resolution has already done ("the number of cards exiled this way")
  // reads the span from here, and it is taken after the skips and the pop so
  // that the span holds the effects and nothing else.
  let resolved = applyResolutionEffects(
    current,
    ability.sourceOid,
    entry.controller,
    plan.effects,
    entry.x,
    null,
  );
  const source = tryObject(resolved.state, ability.sourceOid);
  const sameSource =
    source?.zone === 'battlefield' &&
    entry.sourceBattlefieldIncarnation !== undefined &&
    (source.incarnation ?? 0) === entry.sourceBattlefieldIncarnation;
  if (sameSource && printed !== undefined && isControllerDamageRemovesSourceCounterAbility(printed)) {
    resolved = removeCounters(
      resolved,
      ability.sourceOid,
      printed.controllerDamageRemovesSourceCounter.counter,
      1,
    ).trace;
  }
  if (sameSource && printed !== undefined && isPutCounterThenWinAtThresholdAbility(printed)) {
    const clause = printed.putCounterThenWinAtThreshold;
    const currentSource = tryObject(resolved.state, ability.sourceOid);
    if (
      currentSource?.zone === 'battlefield' &&
      counterCount(currentSource.counters, clause.counter) >= clause.atLeast &&
      canPlayerWinGame(resolved.state, entry.controller)
    ) {
      resolved = endGameWith(resolved, entry.controller, opponentOf(entry.controller), 'spellOrAbility');
    }
  }
  return resolved;
}

/**
 * Finishes the resolution of the yes/no trigger choice on top of the stack,
 * with the answer its controller gave.
 *
 * For an ordinary CR 603.3b optional trigger, accepting resolves the ability
 * exactly as a mandatory trigger resolves. Declining removes it and says so:
 * `triggerDeclined` is the record that the ability was on the stack, was
 * answered, and did nothing — a fact no other event in the log carries, and
 * the difference between a declined trigger and a trigger that never fired.
 * Faerie Impostor is the effect-specific exception: accepting banks the return
 * choice, while declining resolves the printed sacrifice.
 *
 * The plan is recomputed rather than carried across the stop, and it cannot have
 * moved: the only action the kernel will accept while this question stands is
 * the answer to it (`validateAction`), so no state change can have happened in
 * between.
 */
export function resolveAnswered(trace: Trace, accept: boolean): Trace {
  const entry = topOfStack(trace.state);
  const ability = entry?.ability;
  if (entry === undefined || ability === undefined || ability === null) return trace;
  const printed = stackedAbilityAt(trace.state, entry);
  if (printed !== undefined && isSourceLinkedMatchingPlayCompletionAbility(printed)) {
    if (entry.ability === null) return trace;
    return resolveSearchCityCompletion(trace, entry, entry.ability, accept);
  }
  if (printed !== undefined && isReturnAnotherCreatureOrSacrificeSelfAbility(printed)) {
    if (!accept) {
      const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
      return applyResolution(began, entry, ability, planResolution(trace.state, printed.effects, entry));
    }
    const candidates = returnAnotherCreatureCandidates(trace.state, ability.sourceOid, entry.controller);
    if (candidates.length === 0) throw new Error(`${entry.oid} has no creature to return`);
    const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
    const popped = popStackEntry(began, entry.oid);
    return awaitReturnAnotherCreatureChoice(popped, ability.sourceOid, entry.controller, candidates);
  }
  if (!accept) {
    const declined = emit(trace, {
      type: 'triggerDeclined',
      oid: entry.oid,
      source: ability.sourceOid,
    });
    return popStackEntry(declined, entry.oid);
  }
  let paid = trace;
  if (printed !== undefined && isPaidOptionalTrigger(printed)) {
    const payment = planPayment(trace.state, entry.controller, printed.optionalControllerPayment.cost);
    if (payment === null)
      throw new Error(`${String(entry.controller)} cannot pay ${entry.oid}'s optional cost`);
    paid = executePayment(trace, entry.controller, printed.optionalControllerPayment.cost, payment);
  }
  const began = emit(paid, { type: 'resolutionBegan', oid: entry.oid });
  if (printed === undefined || !hasAbilityEffects(printed)) return popStackEntry(began, entry.oid);
  // Viashino Racketeer's draw is conditional on actually discarding a card.
  // With an empty hand the discard cost cannot be paid, so accepting the UI's
  // optional branch still resolves the trigger without applying either effect.
  if (
    printed.kind === 'triggered' &&
    isOptionalDiscardThenDrawAbility(printed) &&
    trace.state.players[entry.controller].hand.length === 0
  ) {
    return popStackEntry(began, entry.oid);
  }
  return applyResolution(began, entry, ability, planResolution(trace.state, printed.effects, entry));
}

/**
 * Resolves an equip ability (CR 702.6b): the source becomes attached to the
 * creature the player chose when they paid for it.
 *
 * The target is rechecked here for the reason every other target is (CR
 * 608.2b): the creature may have died, stopped being a creature or changed
 * hands while the ability waited, and an ability whose only target has become
 * illegal does not resolve. `isLegalHost` is the check the enumeration and
 * `validateActivation` already used, so all three agree by construction.
 *
 * The source is checked too, and that is not the same question: CR 701.3a
 * attaches a *permanent*, so a weapon that left the battlefield in response
 * attaches nothing. The skip is reported as `effectSkipped` at index 0 rather
 * than through a new event, because the attachment is this ability's only slot
 * and a replay reading "skipped, target is no longer legal" is exactly what
 * happened.
 */
function resolveAttach(
  trace: Trace,
  entry: StackEntry,
  sourceOid: ObjectId,
  ability: AttachingAbility,
): Trace {
  const target = entry.targets[0] ?? null;
  const host = target !== null && target.kind === 'permanent' ? target.oid : null;
  const source = tryObject(trace.state, sourceOid);
  const legal =
    host !== null &&
    source !== undefined &&
    source.zone === 'battlefield' &&
    isLegalHost(trace.state, entry.controller, host, sourceOid);
  if (!legal) {
    const skipped = emit(trace, {
      type: 'effectSkipped',
      oid: entry.oid,
      index: 0,
      why: 'target is no longer legal',
    });
    return popStackEntry(skipped, entry.oid);
  }
  return attachTo(popStackEntry(trace, entry.oid), sourceOid, host, ability);
}

/**
 * Resolves the top object of the stack. Permanent spells enter the
 * battlefield; instants and sorceries apply their effects and go to the
 * graveyard; a triggered ability runs its effects and stops existing.
 *
 * ## The one place a spell's resolution stops
 *
 * A "you may" spell (CR 601.2c) asks its named chooser here, mirroring
 * `resolveAbility`'s optional-trigger stop exactly (see its docblock): the
 * question is asked *after* the target recheck, because a spell whose every
 * target is gone fizzles under CR 608.2b before anyone is asked anything, and
 * `resolutionBegan` is not emitted for the pause — it is emitted once, either
 * here on an unconditional spell or in `resolveMayAnswered` when the answer
 * comes back "yes", so a "you may" spell's resolution starts exactly once
 * however it is answered.
 */
export function resolveTop(trace: Trace): Trace {
  const entry = topOfStack(trace.state);
  if (entry === undefined) return trace;
  if (entry.ability !== null) return resolveAbility(trace, entry, entry.ability);
  const object = entry.copiedSpell === undefined ? getObject(trace.state, entry.oid) : null;
  const card = spellCard(trace.state, entry);
  if (card === null) throw new Error(`spell ${entry.oid} has no card`);

  const isPermanentSpell = isPermanentCard(card);
  if (isPermanentSpell) {
    if (object === null) throw new Error('a copied permanent spell is outside this stack primitive');
    if (isAuraCard(card)) {
      const target = entry.targets[0] ?? null;
      const legal =
        target !== null &&
        target.kind === 'permanent' &&
        isLegalAuraHost(trace.state, card, target.oid) &&
        canBeTargetedBy(trace.state, target.oid, entry.oid, entry.controller);
      if (!legal) {
        const fizzledTrace = emit(trace, { type: 'spellFizzled', oid: entry.oid });
        const popped = popStackEntry(fizzledTrace, entry.oid);
        return moveObject(popped, entry.oid, 'graveyard');
      }
      const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
      const popped = popStackEntry(began, entry.oid);
      return moveObject(popped, entry.oid, 'battlefield', {
        chosenX: entry.x ?? 0,
        auraHost: target.oid,
      });
    }
    const current = popStackEntry(emit(trace, { type: 'resolutionBegan', oid: entry.oid }), entry.oid);
    return moveObject(current, entry.oid, 'battlefield', { chosenX: entry.x ?? 0 });
  }

  if (entry.castingCost === 'overload') {
    if (card.kind !== 'instant' && card.kind !== 'sorcery') {
      throw new Error('a permanent spell retained an overload profile');
    }
    const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
    const popped = popStackEntry(began, entry.oid);
    const applied = applyOverloadEffects(
      popped,
      entry.oid,
      entry.controller,
      spellEffectsFor(card, null, 'overload'),
      entry.x,
      entry.copiedSpell?.card,
    );
    return entry.copiedSpell === undefined ? moveObject(applied, entry.oid, 'graveyard') : applied;
  }
  const plan = planResolution(trace.state, spellEffectsFor(card, entry.mode, 'ordinary'), entry);
  if (!fizzled(plan)) {
    if (card.may !== undefined) return awaitMay(trace, mayChooser(card.may, entry.controller));
    const tolled = stackAwaitingUnless(trace.state);
    if (tolled !== null) return awaitUnless(trace, tolled.payer);
  }
  const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
  return finishSpellResolution(began, entry, plan);
}

/**
 * The tail of a spell resolution: fizzle outright if every targeted effect's
 * target is gone (CR 608.2b, checked first — a fizzled spell never gets to
 * ask its "you may" either), or report the skipped effects, leave the stack
 * and apply what remains.
 *
 * Split out so a "you may" spell that was accepted (`resolveMayAnswered`)
 * runs the same code an unconditional spell does, the reason
 * `applyResolution` is split out from `resolveAbility` for abilities.
 */
function finishSpellResolution(trace: Trace, entry: StackEntry, plan: ResolutionPlan): Trace {
  const isCopy = entry.copiedSpell !== undefined;
  if (fizzled(plan)) {
    const declared = emit(trace, { type: 'spellFizzled', oid: entry.oid });
    const popped = popStackEntry(declared, entry.oid);
    return isCopy ? popped : moveObject(popped, entry.oid, 'graveyard');
  }
  let current = trace;
  for (const skipped of plan.illegal) {
    current = emit(current, {
      type: 'effectSkipped',
      oid: entry.oid,
      index: skipped.index,
      why: skipped.reason,
    });
  }
  // The spell leaves the stack before its effects run, so a spell that copies
  // or counts the stack sees the same thing the rules say it sees.
  current = popStackEntry(current, entry.oid);
  return applyResolutionEffects(
    current,
    entry.oid,
    entry.controller,
    plan.effects,
    entry.x,
    isCopy ? null : entry.oid,
    undefined,
    undefined,
    entry.copiedSpell?.card,
  );
}

/**
 * Hands the game back so the named chooser can answer a spell's "you may".
 * `awaitOptionalTrigger`'s shape, for a spell rather than a triggered
 * ability — see that function's docblock for why `priority` is left alone.
 *
 * Takes the chooser directly rather than an entry to read `controller` off
 * of, unlike `awaitOptionalTrigger`: CR 601.2c's chooser is not always the
 * spell's controller (an opponent-choice card asks the opponent), so the
 * caller has already resolved `card.may` through `mayChooser` by the time
 * this runs, and there is nothing left here to derive from the entry itself.
 */
function awaitMay(trace: Trace, chooser: PlayerId): Trace {
  return withState(trace, withTurn(trace.state, { awaiting: 'may', awaitingPlayer: chooser }));
}

/**
 * Hands the game back so the player a spell is aimed at can answer its toll
 * (CR 118.8). `awaitMay`'s shape, and it takes the payer for `awaitMay`'s
 * reason one step further: the seat is not on the card at all, it is read off
 * the entry's targets, so the caller has already resolved it through
 * `spellAwaitingUnless` and there is nothing here left to derive.
 */
function awaitUnless(trace: Trace, payer: PlayerId): Trace {
  return withState(trace, withTurn(trace.state, { awaiting: 'unless', awaitingPlayer: payer }));
}

/**
 * Finishes the resolution of the "you may" spell on top of the stack, with
 * the answer its chooser gave (CR 601.2c). Mirrors `resolveAnswered` exactly,
 * for a spell rather than a triggered ability: declining pops it with a
 * record that it was asked and said no (`spellDeclined`) and sends it to the
 * graveyard — a spell, unlike an ability, was always a card in a zone, so
 * unlike `triggerDeclined` this has a zone to move to. Accepting resolves it
 * exactly as an unconditional spell resolves. Both arms read the card and the
 * departure zone past `entry.copiedSpell` first, for `resolveTop`'s reason: a
 * copy has no object in the table and no graveyard to be sent to.
 *
 * `player` is passed in rather than recomputed, because it was already
 * validated against the pending decision's chooser before this is called
 * (`validateAction`'s generic `decision.player !== action.player` guard); a
 * second `mayChooser` call here would only recompute a fact already checked.
 *
 * The plan is recomputed rather than carried across the stop, and it cannot
 * have moved, for the reason `resolveAnswered` gives: the only action the
 * kernel will accept while this question stands is the answer to it.
 */
export function resolveMayAnswered(trace: Trace, player: PlayerId, accept: boolean): Trace {
  const entry = topOfStack(trace.state);
  if (entry === undefined) return trace;
  if (!accept) {
    const declined = emit(trace, { type: 'spellDeclined', oid: entry.oid, player });
    const popped = popStackEntry(declined, entry.oid);
    return entry.copiedSpell === undefined ? moveObject(popped, entry.oid, 'graveyard') : popped;
  }
  const card = spellCard(trace.state, entry);
  if (card === null) throw new Error(`spell ${entry.oid} has no card`);
  const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
  const plan = planResolution(trace.state, spellEffectsFor(card, entry.mode, 'ordinary'), entry);
  return finishSpellResolution(began, entry, plan);
}

/**
 * Finishes the resolution of the tolled spell or triggered ability on top of
 * the stack, with the answer its payer gave (CR 118.8).
 *
 * `resolveMayAnswered`'s shape, and the two answers land the two ways that
 * function's do. Declining runs the spell exactly as an untolled spell runs,
 * which is the whole point of the clause: the toll bought nothing, so the
 * printed effect happens. Paying charges the mana, records `unlessPaid` and
 * sends the card to the graveyard without a `resolutionBegan` — the same
 * choice `resolveMayAnswered` makes for a declined "you may", and for the same
 * reason: `resolutionBegan` is the marker that a spell's effects are about to
 * run, and here they are not.
 *
 * The plan and the payer are both recomputed rather than carried across the
 * stop. `resolveMayAnswered`'s reason covers the plan (the only action the
 * kernel accepts while the question stands is the answer to it), and the payer
 * needs it more, not less: `validateUnless` re-derives the same seat from the
 * same board, so an agent holding a stale decision cannot pay a toll on behalf
 * of a player who is no longer the one being charged.
 *
 * A payment plan that comes back `null` throws rather than silently resolving
 * the stack object. `stackAwaitingUnless` refuses to ask a player who cannot
 * pay, and
 * nothing between the question and the answer can change what they can pay, so
 * a `null` here is a broken invariant and not a player who ran out of mana.
 */
export function resolveUnlessAnswered(trace: Trace, player: PlayerId, pay: boolean): Trace {
  const pending = stackUnless(trace.state);
  if (pending === null) return trace;
  if (pending.kind === 'counterTriggeringSpellOrAbility' || pending.kind === 'counterTargetSpell') {
    return finishCounterUnless(trace, pending, pay, player);
  }
  if (pending.kind === 'sacrificeSelf') {
    return finishSacrificeSelfUnless(trace, pending, pay, player);
  }
  if (pending.kind === 'sacrificeEnchantedPermanent') {
    return finishSacrificeEnchantedPermanentUnless(trace, pending, pay, player);
  }
  const entry = pending.entry;
  // `entry.copiedSpell` first, for `resolveTop`'s reason: a copied spell has no
  // object in the table, and a copy prints the toll the original printed.
  const card = spellCard(trace.state, entry);
  if (card === null) throw new Error(`spell ${entry.oid} has no card`);
  if (!pay) {
    const began = emit(trace, { type: 'resolutionBegan', oid: entry.oid });
    const plan = planResolution(trace.state, spellEffectsFor(card, entry.mode, 'ordinary'), entry);
    return finishSpellResolution(began, entry, plan);
  }
  const payment = planPayment(trace.state, player, pending.cost);
  if (payment === null) throw new Error(`${player} cannot pay the toll on ${entry.oid}`);
  const paid = executePayment(trace, player, pending.cost, payment);
  const recorded = emit(paid, { type: 'unlessPaid', oid: entry.oid, player });
  const popped = popStackEntry(recorded, entry.oid);
  // A copy is not a card and has no graveyard to go to; it ceases to exist
  // where a real spell is moved (CR 707.10), which is `finishSpellResolution`'s
  // `isCopy` branch said once more for the path that never reaches it.
  return entry.copiedSpell === undefined ? moveObject(popped, entry.oid, 'graveyard') : popped;
}

/** Resolves Transguild Promenade's retained trigger after its controller answers. */
function finishSacrificeSelfUnless(
  trace: Trace,
  pending: Extract<TolledStackObject, { readonly kind: 'sacrificeSelf' }>,
  pay: boolean,
  player: PlayerId,
): Trace {
  const source = pending.entry.ability?.sourceOid;
  if (source === undefined) throw new Error(`${pending.entry.oid} is not a triggered ability`);
  if (pay) {
    const payment = planPayment(trace.state, player, pending.cost);
    if (payment === null) throw new Error(`${player} cannot pay the toll on ${pending.entry.oid}`);
    const paid = executePayment(trace, player, pending.cost, payment);
    const recorded = emit(paid, {
      type: 'unlessPaid',
      oid: pending.entry.oid,
      player,
      source,
    });
    return popStackEntry(recorded, pending.entry.oid);
  }
  const began = emit(trace, { type: 'resolutionBegan', oid: pending.entry.oid });
  const plan = planResolution(trace.state, pending.ability.effects, pending.entry);
  return applyResolution(began, pending.entry, pending.entry.ability!, plan);
}

/** Resolves Soul Tithe's dynamic payment or sacrifices its retained live host. */
function finishSacrificeEnchantedPermanentUnless(
  trace: Trace,
  pending: Extract<TolledStackObject, { readonly kind: 'sacrificeEnchantedPermanent' }>,
  pay: boolean,
  player: PlayerId,
): Trace {
  const source = pending.entry.ability?.sourceOid;
  if (source === undefined) throw new Error(`${pending.entry.oid} is not a triggered ability`);
  if (pay) {
    const payment = planPayment(trace.state, player, pending.cost);
    if (payment === null) throw new Error(`${player} cannot pay the toll on ${pending.entry.oid}`);
    const paid = executePayment(trace, player, pending.cost, payment);
    return popStackEntry(
      emit(paid, { type: 'unlessPaid', oid: pending.entry.oid, player, source }),
      pending.entry.oid,
    );
  }
  const began = emit(trace, { type: 'resolutionBegan', oid: pending.entry.oid });
  const popped = popStackEntry(began, pending.entry.oid);
  const host = tryObject(popped.state, pending.permanent);
  return host?.zone === 'battlefield' && controllerOf(popped.state, pending.permanent) === player
    ? sacrificePermanent(popped, pending.permanent, player)
    : popped;
}

type CounterTriggerUnless = Extract<
  TolledStackObject,
  { readonly kind: 'counterTriggeringSpellOrAbility' | 'counterTargetSpell' }
>;

/** Resolves a retained-stack-object toll after an answer or automatic decline. */
function finishCounterUnless(
  trace: Trace,
  pending: CounterTriggerUnless,
  pay: boolean,
  player: PlayerId = pending.payer,
): Trace {
  if (pay) {
    const payment = planPayment(trace.state, player, pending.cost);
    if (payment === null) throw new Error(`${player} cannot pay the toll on ${pending.entry.oid}`);
    const paid = executePayment(trace, player, pending.cost, payment);
    const source = pending.entry.ability?.sourceOid;
    if (source === undefined) throw new Error(`${pending.entry.oid} is not a triggered ability`);
    const recorded = emit(paid, {
      type: 'unlessPaid',
      oid: pending.entry.oid,
      player,
      source,
    });
    return popStackEntry(recorded, pending.entry.oid);
  }
  const began = emit(trace, { type: 'resolutionBegan', oid: pending.entry.oid });
  const resolved = popStackEntry(began, pending.entry.oid);
  const source = pending.entry.ability?.sourceOid;
  if (source === undefined) throw new Error(`${pending.entry.oid} is not a triggered ability`);
  const target =
    pending.kind === 'counterTriggeringSpellOrAbility' ? pending.triggeringEntry : pending.targetEntry;
  return counterStackEntry(resolved, target.oid, source);
}

/**
 * Removes an entry from the stack list. The object keeps `zone: 'stack'` until
 * `moveObject` places it, so the move still reports the right origin zone.
 */
function popStackEntry(trace: Trace, oid: ObjectId): Trace {
  const removed = trace.state.stack.find((entry) => entry.oid === oid);
  const withoutEntry: GameState = {
    ...trace.state,
    stack: trace.state.stack.filter((entry) => entry.oid !== oid),
  };
  const state =
    removed?.siegeDefeat === true && removed.ability !== null
      ? clearSiegeDefeatPending(withoutEntry, removed.ability.sourceOid, removed.sourceBattlefieldIncarnation)
      : withoutEntry;
  return withState(trace, state);
}
