/**
 * Damage application, shared by spells and combat.
 *
 * Damage inside one combat damage step is simultaneous (CR 510.2), so callers
 * build every instance first and hand the whole batch over here. Lifelink is
 * applied with the damage (CR 702.15b) and deathtouch only *marks* the damage —
 * the kill is a state-based action, which is what makes deathtouch interact
 * correctly with trample and first strike.
 */
import { isDamagePreventionStaticModification } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import type { GameEvent } from './events';
import {
  affectedPlayerFor,
  applyReplacements,
  consumeReplacementEffect,
  earliestTimestamp,
  type ReplacementOutcome,
} from './replacement';
import type {
  DamageRecipient,
  ReplaceableEvent,
  ReplaceableEventKind,
  ReplacementEffect,
} from './replacement-effects';
import type { GameState, PendingDamagePrevention } from './state';
import type { Trace } from './trace';
import { emit, updatePlayer, withState } from './trace';
import { battlefieldObjects, getObject, isOnBattlefield, tryObject } from './zones';
import { counterCount, setCounterCount } from './continuous';
import { recordLifeLostThisTurn } from './life-history';
import { removeCounters } from './counters';
import {
  abilitiesOf,
  controllerOf,
  copiableValuesOf,
  hasCardType,
  hasKeyword,
  isCreatureObject,
} from './layers';
import { isProtectedFrom } from './keyword-abilities';
import { canDamageBePrevented, canPlayerGainLife } from './game-rules';
import { removeDefenseCounters } from './siege';
import type {
  DamageInstance,
  DamagePreventionAllocation,
  DamagePreventionPlan,
  DamagePreventionSource,
} from './damage-types';
import { liveStaticAbilityAffects } from './live-static';

export type { DamageInstance, DamageRecipient };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function recipientKey(recipient: DamageRecipient): string {
  return recipient.kind === 'player' ? `player:${String(recipient.player)}` : `permanent:${recipient.oid}`;
}

function damageInstanceKey(instance: DamageInstance): string {
  return [
    instance.sourceOid,
    String(instance.sourceIncarnation),
    recipientKey(instance.recipient),
    String(instance.controller),
    String(instance.amount),
    instance.deathtouch ? '1' : '0',
    instance.lifelink ? '1' : '0',
    instance.combat ? '1' : '0',
    instance.preventable ? '1' : '0',
    instance.exileDamagedCreatureIfItWouldDieThisTurn === true ? '1' : '0',
    instance.sourceCard?.id ?? '',
  ].join('|');
}

/** Stamps legacy inputs without changing simultaneous-event observation order. */
function normalizedDamageInstances(
  state: GameState,
  instances: readonly DamageInstance[],
): readonly DamageInstance[] {
  return instances.map((instance) => ({
    ...instance,
    // Runtime compatibility for stored positions and untyped callers written
    // before source incarnations became part of the damage contract.
    sourceIncarnation: instance.sourceIncarnation ?? state.objects[instance.sourceOid]?.incarnation ?? 0,
  }));
}

/** A batch entering a decision has one canonical spelling independent of caller order. */
function canonicalDamageInstances(instances: readonly DamageInstance[]): readonly DamageInstance[] {
  return [...instances]
    .filter((instance) => instance.amount > 0)
    .sort((left, right) => compareText(damageInstanceKey(left), damageInstanceKey(right)));
}

function markPermanent(
  state: GameState,
  oid: ObjectId,
  amount: number,
  deathtouch: boolean,
): { readonly state: GameState; readonly battleDefeated: boolean } {
  const isCreature = isCreatureObject(state, oid);
  const isPlaneswalker = hasCardType(state, oid, 'planeswalker');
  const isBattle = hasCardType(state, oid, 'battle');
  const removed = isBattle ? removeDefenseCounters(state, oid, amount) : { state, defeated: false };
  const current = getObject(removed.state, oid);
  const counters = isPlaneswalker
    ? setCounterCount(current.counters, 'loyalty', counterCount(current.counters, 'loyalty') - amount)
    : current.counters;
  return {
    battleDefeated: removed.defeated,
    state: {
      ...removed.state,
      objects: {
        ...removed.state.objects,
        [oid]: {
          ...current,
          damage: isCreature ? current.damage + amount : current.damage,
          deathtouched: current.deathtouched || (isCreature && deathtouch && amount > 0),
          counters,
        },
      },
    },
  };
}

/**
 * Records that replacement effects rewrote an event. Without this the log shows
 * the *outcome* with no trace of the rewrite, which is exactly the divergence a
 * parity run against another engine would be unable to explain.
 */
export function noteReplacements(
  trace: Trace,
  appliedIds: readonly string[],
  event: ReplaceableEventKind,
): Trace {
  let current = trace;
  for (const id of appliedIds) {
    current = emit(current, { type: 'replacementApplied', id, event });
  }
  return current;
}

function loseLife(trace: Trace, player: PlayerId, amount: number): Trace {
  const state = recordLifeLostThisTurn(
    updatePlayer(trace.state, player, (seat) => ({ ...seat, life: seat.life - amount })),
    player,
    amount,
  );
  return emit(withState(trace, state), {
    type: 'lifeChanged',
    player,
    delta: -amount,
    life: state.players[player].life,
    reason: 'damage',
  });
}

/**
 * Life gain runs through the replacement pipeline (CR 614): "if you would gain
 * life, gain twice that much" is a replacement effect, not a trigger.
 */
export function gainLife(trace: Trace, player: PlayerId, amount: number, lifelink: boolean): Trace {
  if (amount <= 0) return trace;
  if (!canPlayerGainLife(trace.state, player)) return trace;
  const outcome = applyReplacements(trace.state, { kind: 'lifeGain', player, amount });
  const withEffects = noteReplacements(
    withState(trace, { ...trace.state, replacements: outcome.replacements }),
    outcome.appliedIds,
    'lifeGain',
  );
  const replaced = outcome.event;
  if (replaced === null || replaced.kind !== 'lifeGain' || replaced.amount <= 0) return withEffects;
  const state = updatePlayer(withEffects.state, player, (seat) => ({
    ...seat,
    life: seat.life + replaced.amount,
  }));
  return emit(withState(withEffects, state), {
    type: 'lifeChanged',
    player,
    delta: replaced.amount,
    life: state.players[player].life,
    reason: lifelink ? 'lifelink' : 'gainLife',
  });
}

/** One damage instance, after CR 614/615 have had their say. */
function damageEventFor(state: GameState, instance: DamageInstance): ReplaceableEvent {
  return {
    kind: 'damage',
    sourceOid: instance.sourceOid,
    sourceIncarnation: instance.sourceIncarnation ?? state.objects[instance.sourceOid]?.incarnation ?? 0,
    controller: instance.controller,
    recipient: instance.recipient,
    amount: instance.amount,
    deathtouch: instance.deathtouch,
    lifelink: instance.lifelink,
    combat: instance.combat,
    preventable: instance.preventable && canDamageBePrevented(state),
    ...(instance.exileDamagedCreatureIfItWouldDieThisTurn === undefined
      ? {}
      : { exileDamagedCreatureIfItWouldDieThisTurn: instance.exileDamagedCreatureIfItWouldDieThisTurn }),
    ...(instance.sourceCard === undefined ? {} : { sourceCard: instance.sourceCard }),
  };
}

/** Applies the non-prevention instruction attached to one damage replacement. */
function applyDamageReplacementFollowUp(trace: Trace, effect: ReplacementEffect, amount: number): Trace {
  const followUp = effect.damageReplacementFollowUp;
  if (followUp === undefined || amount <= 0) return trace;
  const source = tryObject(trace.state, effect.sourceOid);
  const sameLiveIncarnation =
    source?.zone === 'battlefield' && (source.incarnation ?? 0) === followUp.sourceBattlefieldIncarnation;
  if (followUp.kind === 'removeCounters') {
    return sameLiveIncarnation
      ? removeCounters(trace, effect.sourceOid, followUp.counter, amount).trace
      : trace;
  }
  if (followUp.target.kind === 'permanent') {
    const target = tryObject(trace.state, followUp.target.oid);
    if (
      !('targetBattlefieldIncarnation' in followUp) ||
      target?.zone !== 'battlefield' ||
      (target.incarnation ?? 0) !== followUp.targetBattlefieldIncarnation
    )
      return trace;
  }
  const damage: DamageInstance = {
    sourceOid: effect.sourceOid,
    sourceIncarnation: followUp.sourceBattlefieldIncarnation,
    controller: effect.controller,
    recipient: followUp.target,
    amount,
    deathtouch: sameLiveIncarnation && hasKeyword(trace.state, effect.sourceOid, 'deathtouch'),
    lifelink: sameLiveIncarnation && hasKeyword(trace.state, effect.sourceOid, 'lifelink'),
    combat: false,
    preventable: true,
  };
  return applyDamage(trace, [damage]);
}

/** Protection is an event-local blanket shield, rebuilt against each recipient. */
function protectionEffectsFor(state: GameState, instance: DamageInstance): readonly ReplacementEffect[] {
  return battlefieldObjects(state)
    .filter((object) => isProtectedFrom(state, object.oid, instance.sourceCard ?? instance.sourceOid))
    .map((object, index) => ({
      id: `protection:${instance.sourceOid}:${object.oid}`,
      sourceOid: object.oid,
      controller: object.controller,
      timestamp: Number.MAX_SAFE_INTEGER - index,
      duration: 'permanent' as const,
      selfReplacement: false,
      trigger: {
        kind: 'damage' as const,
        toPlayer: null,
        toPermanent: object.oid,
        toController: null,
        toPermanentCardType: null,
        fromSource: instance.sourceOid,
        fromSpellSource: null,
        combatOnly: false,
      },
      modification: { kind: 'preventDamage' as const, amount: 'all' as const },
    }));
}

/**
 * Live CR 615 statics, rebuilt for each damage event from current abilities.
 * Source and recipient effects are separate because a redirect must keep a
 * source-scoped prevention but shed a recipient-scoped one (and vice versa).
 */
function staticCombatPreventionEffectsFor(
  state: GameState,
  instance: DamageInstance,
): readonly ReplacementEffect[] {
  if (!instance.combat) return [];
  return battlefieldObjects(state).flatMap((source) => {
    const card = copiableValuesOf(state, source.oid);
    return abilitiesOf(state, source.oid).flatMap((ability, abilityIndex): readonly ReplacementEffect[] => {
      if (ability.kind !== 'static') return [];
      if (!isDamagePreventionStaticModification(ability.modification)) return [];
      if (card.kind === 'creature' && card.redirectControllerAndOtherPermanentsDamageToSelf === true) {
        return [];
      }
      const common = {
        sourceOid: source.oid,
        controller: controllerOf(state, source.oid),
        timestamp: source.battlefieldTimestamp ?? Number.MAX_SAFE_INTEGER,
        duration: 'permanent' as const,
        selfReplacement: false,
        modification: { kind: 'preventDamage' as const, amount: 'all' as const },
      };
      const sourceEffect: readonly ReplacementEffect[] =
        isOnBattlefield(state, instance.sourceOid) &&
        liveStaticAbilityAffects(state, ability, source.oid, instance.sourceOid)
          ? [
              {
                ...common,
                id: `static-combat-prevention:${source.oid}:${String(abilityIndex)}:from:${instance.sourceOid}`,
                trigger: {
                  kind: 'damage',
                  toPlayer: null,
                  toPermanent: null,
                  toController: null,
                  toPermanentCardType: null,
                  fromSource: instance.sourceOid,
                  fromSpellSource: null,
                  combatOnly: true,
                },
              },
            ]
          : [];
      const recipientEffects = battlefieldObjects(state).flatMap((target): readonly ReplacementEffect[] =>
        liveStaticAbilityAffects(state, ability, source.oid, target.oid)
          ? [
              {
                ...common,
                id: `static-combat-prevention:${source.oid}:${String(abilityIndex)}:to:${target.oid}`,
                trigger: {
                  kind: 'damage',
                  toPlayer: null,
                  toPermanent: target.oid,
                  toController: null,
                  toPermanentCardType: null,
                  fromSource: null,
                  fromSpellSource: null,
                  combatOnly: true,
                },
              },
            ]
          : [],
      );
      return [...sourceEffect, ...recipientEffects];
    });
  });
}

/** Live life-floor replacements, rebuilt from current layer-1 abilities. */
function staticLifeFloorEffectsFor(state: GameState): readonly ReplacementEffect[] {
  return battlefieldObjects(state).flatMap((source) =>
    abilitiesOf(state, source.oid).flatMap((ability, abilityIndex): readonly ReplacementEffect[] => {
      if (
        ability.kind !== 'static' ||
        ability.modification.kind !== 'damageCannotReduceControllerLifeBelow'
      ) {
        return [];
      }
      const controller = controllerOf(state, source.oid);
      const minimum = ability.modification.minimum;
      return [
        {
          id: `static-life-floor:${source.oid}:${String(abilityIndex)}`,
          sourceOid: source.oid,
          controller,
          timestamp: source.battlefieldTimestamp ?? Number.MAX_SAFE_INTEGER,
          duration: 'permanent',
          selfReplacement: false,
          trigger: {
            kind: 'damage',
            toPlayer: controller,
            toPermanent: null,
            toController: null,
            toPermanentCardType: null,
            fromSource: null,
            fromSpellSource: null,
            recipientLifeFloor: minimum,
            combatOnly: false,
          },
          modification: { kind: 'damageToLifeFloor', minimum },
        },
      ];
    }),
  );
}

/** Palisade Giant's live source/controller-relative redirection records. */
function staticPalisadeEffectsFor(state: GameState): readonly ReplacementEffect[] {
  return battlefieldObjects(state).flatMap((source) =>
    abilitiesOf(state, source.oid).flatMap((ability, abilityIndex): readonly ReplacementEffect[] => {
      const card = copiableValuesOf(state, source.oid);
      if (
        card.kind !== 'creature' ||
        card.redirectControllerAndOtherPermanentsDamageToSelf !== true ||
        ability.kind !== 'static' ||
        ability.scope !== 'self' ||
        ability.modification.kind !== 'preventCombatDamage'
      ) {
        return [];
      }
      const controller = controllerOf(state, source.oid);
      return [
        {
          id: `static-palisade:${source.oid}:${String(abilityIndex)}`,
          sourceOid: source.oid,
          controller,
          timestamp: source.battlefieldTimestamp ?? Number.MAX_SAFE_INTEGER,
          duration: 'permanent',
          selfReplacement: false,
          trigger: {
            kind: 'damage',
            toPlayer: null,
            toPermanent: null,
            toController: controller,
            excludeSourcePermanent: true,
            toPermanentCardType: null,
            fromSource: null,
            fromSpellSource: null,
            combatOnly: false,
          },
          modification: { kind: 'redirectDamage', to: { kind: 'permanent', oid: source.oid } },
        },
      ];
    }),
  );
}

/** All event-local damage replacements, including protection and live statics. */
function eventLocalDamageEffectsFor(
  state: GameState,
  instance: DamageInstance,
): readonly ReplacementEffect[] {
  return [
    ...protectionEffectsFor(state, instance),
    ...staticCombatPreventionEffectsFor(state, instance),
    ...staticLifeFloorEffectsFor(state),
    ...staticPalisadeEffectsFor(state),
  ];
}

function byReplacementOrder(left: ReplacementEffect, right: ReplacementEffect): number {
  if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
  return compareText(left.id, right.id);
}

/** Maximum amount this exact shield can reach on one source's event. */
function potentialFor(
  state: GameState,
  instance: DamageInstance,
  effectId: string,
): { readonly player: PlayerId; readonly amount: number } | null {
  const event = damageEventFor(state, instance);
  const outcome = applyReplacements(
    state,
    event,
    earliestTimestamp,
    eventLocalDamageEffectsFor(state, instance),
  );
  const amount = outcome.preventions
    .filter((prevention) => prevention.effect.id === effectId)
    .reduce((sum, prevention) => sum + prevention.amount, 0);
  return amount <= 0 ? null : { player: affectedPlayerFor(state, event), amount };
}

/**
 * CR 615.7 questions in stable shield/source order.
 *
 * A plan is needed only when one numeric pool can reach multiple sources and
 * cannot cover them all. A single source and a pool large enough for every
 * source each have only one outcome, so the kernel performs them directly.
 */
function damagePreventionPlans(
  state: GameState,
  instances: readonly DamageInstance[],
): readonly DamagePreventionPlan[] {
  const plans: DamagePreventionPlan[] = [];
  for (const shield of [...state.replacements].sort(byReplacementOrder)) {
    if (shield.modification.kind !== 'preventDamage' || shield.modification.amount === 'all') continue;
    const potentials = instances.flatMap((instance) => {
      const reached = potentialFor(state, instance, shield.id);
      return reached === null ? [] : [{ sourceOid: instance.sourceOid, ...reached }];
    });
    const players = [...new Set(potentials.map((potential) => potential.player))];
    if (players.length !== 1) continue;
    const player = players[0];
    if (player === undefined) continue;
    const bySource = new Map<ObjectId, number>();
    for (const potential of potentials) {
      bySource.set(potential.sourceOid, (bySource.get(potential.sourceOid) ?? 0) + potential.amount);
    }
    const sources: DamagePreventionSource[] = [...bySource]
      .map(([sourceOid, damage]) => ({ sourceOid, damage }))
      .sort((left, right) => compareText(left.sourceOid, right.sourceOid));
    const total = sources.reduce((sum, source) => sum + source.damage, 0);
    if (sources.length <= 1 || shield.modification.amount >= total) continue;
    plans.push({ effectId: shield.id, player, amount: shield.modification.amount, sources });
  }
  return plans;
}

/** The legal allocation interval for the current source, retaining room for the rest. */
export function damagePreventionRange(pending: PendingDamagePrevention): {
  readonly minimum: number;
  readonly maximum: number;
} {
  const source = pending.plan.sources[0];
  if (source === undefined) throw new Error('damagePreventionRange: no source is awaiting allocation');
  const laterCapacity = pending.plan.sources.slice(1).reduce((sum, candidate) => sum + candidate.damage, 0);
  return {
    minimum: Math.max(0, pending.remainingAmount - laterCapacity),
    maximum: Math.min(source.damage, pending.remainingAmount),
  };
}

type AllocationAdvance =
  | { readonly kind: 'choice'; readonly pending: PendingDamagePrevention }
  | {
      readonly kind: 'complete';
      readonly allocations: readonly DamagePreventionAllocation[];
      readonly instances: readonly DamageInstance[];
    };

/** Banks forced source shares and moves to the next real question or completion. */
function advanceDamagePrevention(pending: PendingDamagePrevention): AllocationAdvance {
  let current = pending;
  for (;;) {
    const source = current.plan.sources[0];
    if (source !== undefined) {
      const range = damagePreventionRange(current);
      if (range.minimum !== range.maximum) return { kind: 'choice', pending: current };
      current = {
        ...current,
        plan: { ...current.plan, sources: current.plan.sources.slice(1) },
        remainingAmount: current.remainingAmount - range.minimum,
        chosen: [...current.chosen, { sourceOid: source.sourceOid, amount: range.minimum }],
      };
      continue;
    }
    if (current.remainingAmount !== 0) {
      throw new Error('advanceDamagePrevention: allocation ended before the shield was assigned');
    }
    const allocations: readonly DamagePreventionAllocation[] = [
      ...current.allocations,
      { effectId: current.plan.effectId, sources: current.chosen },
    ];
    const [next, ...remainingPlans] = current.remainingPlans;
    if (next === undefined) {
      return {
        kind: 'complete',
        allocations,
        instances: current.instances,
      };
    }
    current = {
      ...current,
      player: next.player,
      plan: next,
      remainingPlans,
      remainingAmount: next.amount,
      chosen: [],
      allocations,
    };
  }
}

function awaitDamagePrevention(
  trace: Trace,
  instances: readonly DamageInstance[],
  plans: readonly DamagePreventionPlan[],
): Trace {
  const [plan, ...remainingPlans] = plans;
  if (plan === undefined) return trace;
  const advanced = advanceDamagePrevention({
    player: plan.player,
    instances,
    plan,
    remainingPlans,
    remainingAmount: plan.amount,
    chosen: [],
    allocations: [],
    resumePriority: trace.state.turn.priority,
  });
  if (advanced.kind === 'complete') {
    return applyDamageNow(trace, advanced.instances, advanced.allocations);
  }
  const pending = advanced.pending;
  return withState(trace, {
    ...trace.state,
    turn: {
      ...trace.state.turn,
      priority: null,
      awaiting: 'damagePrevention',
      awaitingPlayer: pending.player,
    },
    pendingDamagePrevention: pending,
  });
}

function allocatedFor(
  allocations: readonly DamagePreventionAllocation[],
  effectId: string,
  sourceOid: ObjectId,
): number {
  const allocation = allocations.find((candidate) => candidate.effectId === effectId);
  return allocation?.sources.find((source) => source.sourceOid === sourceOid)?.amount ?? 0;
}

function spendAllocated(
  allocations: readonly DamagePreventionAllocation[],
  effectId: string,
  sourceOid: ObjectId,
  amount: number,
): readonly DamagePreventionAllocation[] {
  if (amount <= 0) return allocations;
  return allocations.map((allocation) =>
    allocation.effectId !== effectId
      ? allocation
      : {
          ...allocation,
          sources: allocation.sources.map((source) =>
            source.sourceOid === sourceOid ? { ...source, amount: source.amount - amount } : source,
          ),
        },
  );
}

/** Applies one event with every chosen shield capped to this source's assigned share. */
function replacementsForAllocatedDamage(
  state: GameState,
  instance: DamageInstance,
  allocations: readonly DamagePreventionAllocation[],
): { readonly outcome: ReplacementOutcome; readonly allocations: readonly DamagePreventionAllocation[] } {
  if (allocations.length === 0) {
    return {
      outcome: applyReplacements(
        state,
        damageEventFor(state, instance),
        earliestTimestamp,
        eventLocalDamageEffectsFor(state, instance),
      ),
      allocations,
    };
  }
  const plannedIds = new Set(allocations.map((allocation) => allocation.effectId));
  const allocatedEffects = state.replacements.flatMap((effect): readonly ReplacementEffect[] => {
    if (!plannedIds.has(effect.id)) return [];
    const amount = allocatedFor(allocations, effect.id, instance.sourceOid);
    if (amount <= 0 || effect.modification.kind !== 'preventDamage' || effect.modification.amount === 'all')
      return [];
    return [
      {
        ...effect,
        modification: { kind: 'preventDamage', amount: Math.min(amount, effect.modification.amount) },
      },
    ];
  });
  const withoutPlanned: GameState = {
    ...state,
    replacements: state.replacements.filter((effect) => !plannedIds.has(effect.id)),
  };
  const raw = applyReplacements(withoutPlanned, damageEventFor(state, instance), earliestTimestamp, [
    ...eventLocalDamageEffectsFor(state, instance),
    ...allocatedEffects,
  ]);
  let remainingAllocations = allocations;
  const spentById = new Map<string, number>();
  for (const prevention of raw.preventions) {
    if (!plannedIds.has(prevention.effect.id)) continue;
    spentById.set(prevention.effect.id, (spentById.get(prevention.effect.id) ?? 0) + prevention.amount);
    remainingAllocations = spendAllocated(
      remainingAllocations,
      prevention.effect.id,
      instance.sourceOid,
      prevention.amount,
    );
  }
  const unplannedById = new Map(raw.replacements.map((effect) => [effect.id, effect]));
  const replacements = state.replacements.flatMap((effect): readonly ReplacementEffect[] => {
    if (!plannedIds.has(effect.id)) {
      const updated = unplannedById.get(effect.id);
      return updated === undefined ? [] : [updated];
    }
    const consumed = consumeReplacementEffect(effect, spentById.get(effect.id) ?? 0);
    return consumed === null ? [] : [consumed];
  });
  return { outcome: { ...raw, replacements }, allocations: remainingAllocations };
}

/**
 * Applies a batch of damage instances as one simultaneous event.
 *
 * Each instance is put through the replacement and prevention pipeline
 * individually, which is correct: CR 615 prevention shields are per damage
 * event, so a shield that eats one attacker's damage does not also eat the
 * next attacker's. The batch is still simultaneous in the sense that matters —
 * nothing dies until state-based actions run after the whole batch.
 */
function applyDamageNow(
  trace: Trace,
  instances: readonly DamageInstance[],
  allocations: readonly DamagePreventionAllocation[] = [],
): Trace {
  let current = trace;
  let remainingAllocations = allocations;
  const lifelinkGains = new Map<PlayerId, number>();

  for (const instance of instances) {
    if (instance.amount <= 0) continue;
    const applied = replacementsForAllocatedDamage(current.state, instance, remainingAllocations);
    const outcome = applied.outcome;
    remainingAllocations = applied.allocations;
    current = noteReplacements(
      withState(current, { ...current.state, replacements: outcome.replacements }),
      outcome.appliedIds,
      'damage',
    );
    for (const prevention of outcome.preventions) {
      current = emit(current, {
        type: 'damagePrevented',
        sourceOid: instance.sourceOid,
        target: prevention.recipient,
        amount: prevention.amount,
      });
    }
    const replaced = outcome.event;
    if (replaced !== null && replaced.kind === 'damage' && replaced.amount > 0) {
      let dealt = true;
      if (replaced.recipient.kind === 'permanent') {
        const oid = replaced.recipient.oid;
        // Damage to something that has already left the battlefield is dropped.
        if (!isOnBattlefield(current.state, oid)) {
          dealt = false;
        } else {
          const marked = markPermanent(current.state, oid, replaced.amount, replaced.deathtouch);
          current = withState(current, marked.state);
          if (hasCardType(marked.state, oid, 'planeswalker') || hasCardType(marked.state, oid, 'battle')) {
            const object = getObject(marked.state, oid);
            current = emit(current, {
              type: 'countersChanged',
              oid,
              plusOnePlusOne: object.counters.plusOnePlusOne,
              minusOneMinusOne: object.counters.minusOneMinusOne,
              ...(hasCardType(marked.state, oid, 'planeswalker')
                ? { loyalty: counterCount(object.counters, 'loyalty') }
                : {}),
              ...(hasCardType(marked.state, oid, 'battle')
                ? { defense: counterCount(object.counters, 'defense') }
                : {}),
            });
          }
          if (marked.battleDefeated) current = emit(current, { type: 'battleDefeated', oid });
        }
      } else {
        current = loseLife(current, replaced.recipient.player, replaced.amount);
        const damaged = current.state.turn.playersDealtDamageThisTurn;
        if (!damaged.includes(replaced.recipient.player)) {
          current = withState(current, {
            ...current.state,
            turn: {
              ...current.state.turn,
              playersDealtDamageThisTurn: [...damaged, replaced.recipient.player],
            },
          });
        }
      }
      if (dealt) {
        const sourceIncarnation = replaced.sourceIncarnation;
        if (sourceIncarnation === undefined) {
          throw new Error(`damage event from ${replaced.sourceOid} lost its source incarnation`);
        }
        const sources = current.state.turn.damageSourcesThisTurn ?? [];
        if (
          !sources.some(
            (source) => source.oid === replaced.sourceOid && source.incarnation === sourceIncarnation,
          )
        ) {
          current = withState(current, {
            ...current.state,
            turn: {
              ...current.state.turn,
              damageSourcesThisTurn: [
                ...sources,
                { oid: replaced.sourceOid, incarnation: sourceIncarnation },
              ],
            },
          });
        }
        if (
          replaced.recipient.kind === 'permanent' &&
          replaced.exileDamagedCreatureIfItWouldDieThisTurn === true &&
          isCreatureObject(current.state, replaced.recipient.oid)
        ) {
          const oid = replaced.recipient.oid;
          const incarnation = current.state.objects[oid]?.incarnation ?? 0;
          const marked = current.state.turn.damageLinkedDeathExileThisTurn ?? [];
          if (!marked.some((entry) => entry.oid === oid && entry.incarnation === incarnation)) {
            current = withState(current, {
              ...current.state,
              nextId: current.state.nextId + 1,
              turn: {
                ...current.state.turn,
                damageLinkedDeathExileThisTurn: [
                  ...marked,
                  {
                    oid,
                    incarnation,
                    sourceOid: replaced.sourceOid,
                    sourceIncarnation,
                    controller: replaced.controller,
                    timestamp: current.state.nextId,
                  },
                ],
              },
            });
          }
        }
        const event: GameEvent = {
          type: 'damageDealt',
          sourceOid: replaced.sourceOid,
          target: replaced.recipient,
          amount: replaced.amount,
          deathtouch: replaced.deathtouch,
          combat: replaced.combat,
        };
        current = emit(current, event);
        if (replaced.lifelink) {
          lifelinkGains.set(
            replaced.controller,
            (lifelinkGains.get(replaced.controller) ?? 0) + replaced.amount,
          );
        }
      }
    }

    for (const followUp of outcome.damageFollowUps) {
      current = applyDamageReplacementFollowUp(current, followUp.effect, followUp.amount);
    }
  }

  for (const player of [0, 1] as const) {
    const gained = lifelinkGains.get(player);
    if (gained !== undefined && gained > 0) current = gainLife(current, player, gained, true);
  }
  return current;
}

/**
 * Applies one simultaneous damage batch, pausing for CR 615.7 when a numeric
 * shield cannot cover every source it can reach.
 */
export function applyDamage(trace: Trace, instances: readonly DamageInstance[]): Trace {
  const normalized = normalizedDamageInstances(trace.state, instances);
  const canonical = canonicalDamageInstances(normalized);
  const plans = damagePreventionPlans(trace.state, canonical);
  return plans.length === 0
    ? applyDamageNow(trace, normalized)
    : awaitDamagePrevention(trace, canonical, plans);
}

/** Banks one source share and applies the batch after the final share is known. */
export function answerDamagePrevention(trace: Trace, sourceOid: ObjectId, amount: number): Trace {
  const pending = trace.state.pendingDamagePrevention;
  if (pending === undefined) throw new Error('answerDamagePrevention: no allocation is pending');
  const source = pending.plan.sources[0];
  if (source === undefined || source.sourceOid !== sourceOid) {
    throw new Error('answerDamagePrevention: the submitted source is not being allocated');
  }
  const advanced = advanceDamagePrevention({
    ...pending,
    plan: { ...pending.plan, sources: pending.plan.sources.slice(1) },
    remainingAmount: pending.remainingAmount - amount,
    chosen: [...pending.chosen, { sourceOid, amount }],
  });
  if (advanced.kind === 'choice') {
    return withState(trace, {
      ...trace.state,
      turn: {
        ...trace.state.turn,
        priority: null,
        awaiting: 'damagePrevention',
        awaitingPlayer: advanced.pending.player,
      },
      pendingDamagePrevention: advanced.pending,
    });
  }
  const clearedTurn = {
    ...trace.state.turn,
    priority: null,
    awaiting: null,
    awaitingPlayer: null,
  };
  const { pendingDamagePrevention: _answered, ...withoutPending } = trace.state;
  const cleared = withState(trace, { ...withoutPending, turn: clearedTurn });
  return applyDamageNow(cleared, advanced.instances, advanced.allocations);
}

/** Damage already marked on a permanent, 0 when it is not on the battlefield. */
export function markedDamage(state: GameState, oid: ObjectId): number {
  const object = tryObject(state, oid);
  return object === undefined || object.zone !== 'battlefield' ? 0 : object.damage;
}
