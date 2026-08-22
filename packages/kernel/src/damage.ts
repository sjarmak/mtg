/**
 * Damage application, shared by spells and combat.
 *
 * Damage inside one combat damage step is simultaneous (CR 510.2), so callers
 * build every instance first and hand the whole batch over here. Lifelink is
 * applied with the damage (CR 702.15b) and deathtouch only *marks* the damage —
 * the kill is a state-based action, which is what makes deathtouch interact
 * correctly with trample and first strike.
 */
import type { Card } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import type { GameEvent } from './events';
import { applyReplacements, earliestTimestamp } from './replacement';
import type { DamageRecipient, ReplaceableEvent, ReplaceableEventKind } from './replacement-effects';
import type { GameState } from './state';
import type { Trace } from './trace';
import { emit, updatePlayer, withState } from './trace';
import { battlefieldObjects, getObject, isOnBattlefield, tryObject } from './zones';
import { counterCount, setCounterCount } from './continuous';
import { hasCardType, isCreatureObject } from './layers';
import { isProtectedFrom } from './keyword-abilities';

export type { DamageRecipient };

export interface DamageInstance {
  readonly sourceOid: ObjectId;
  /** Copiable characteristics for a spell copy, which has no GameObject of its own. */
  readonly sourceCard?: Card;
  readonly controller: PlayerId;
  readonly recipient: DamageRecipient;
  readonly amount: number;
  readonly deathtouch: boolean;
  readonly lifelink: boolean;
  readonly combat: boolean;
}

function markPermanent(state: GameState, oid: ObjectId, amount: number, deathtouch: boolean): GameState {
  const object = getObject(state, oid);
  const isCreature = isCreatureObject(state, oid);
  const isPlaneswalker = hasCardType(state, oid, 'planeswalker');
  const counters = isPlaneswalker
    ? setCounterCount(object.counters, 'loyalty', counterCount(object.counters, 'loyalty') - amount)
    : object.counters;
  return {
    ...state,
    objects: {
      ...state.objects,
      [oid]: {
        ...object,
        damage: isCreature ? object.damage + amount : object.damage,
        deathtouched: object.deathtouched || (isCreature && deathtouch && amount > 0),
        counters,
      },
    },
  };
}

/**
 * Records that this turn dealt damage to a seat, so a `Condition` reading turn
 * history has a fact rather than an inference (`noOpponentDealtDamageThisTurn`,
 * `@mtg/dsl`'s `condition.ts`).
 *
 * Called from the one branch that damages a player, and after replacement, so
 * damage that was prevented outright or moved onto a permanent is not recorded
 * as having reached anybody. `TurnState.damagedPlayers` is reset by `beginTurn`
 * along with the rest of the turn record, which is why nothing here has a
 * clearing counterpart.
 */
function noteDamagedPlayer(trace: Trace, player: PlayerId): Trace {
  const damaged = trace.state.turn.damagedPlayers;
  if (damaged.includes(player)) return trace;
  return withState(trace, {
    ...trace.state,
    turn: { ...trace.state.turn, damagedPlayers: [...damaged, player] },
  });
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
  const state = updatePlayer(trace.state, player, (seat) => ({ ...seat, life: seat.life - amount }));
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
function damageEventFor(instance: DamageInstance): ReplaceableEvent {
  return {
    kind: 'damage',
    sourceOid: instance.sourceOid,
    controller: instance.controller,
    recipient: instance.recipient,
    amount: instance.amount,
    deathtouch: instance.deathtouch,
    lifelink: instance.lifelink,
    combat: instance.combat,
  };
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
export function applyDamage(trace: Trace, instances: readonly DamageInstance[]): Trace {
  let current = trace;
  const lifelinkGains = new Map<PlayerId, number>();

  for (const instance of instances) {
    if (instance.amount <= 0) continue;
    const protectionEffects = battlefieldObjects(current.state)
      .filter((object) =>
        isProtectedFrom(current.state, object.oid, instance.sourceCard ?? instance.sourceOid),
      )
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
          fromSource: instance.sourceOid,
          combatOnly: false,
        },
        modification: { kind: 'preventDamage' as const, amount: 'all' as const },
      }));
    const outcome = applyReplacements(
      current.state,
      damageEventFor(instance),
      earliestTimestamp,
      protectionEffects,
    );
    current = noteReplacements(
      withState(current, { ...current.state, replacements: outcome.replacements }),
      outcome.appliedIds,
      'damage',
    );
    const replaced = outcome.event;
    if (replaced === null || replaced.kind !== 'damage') {
      current = emit(current, {
        type: 'damagePrevented',
        sourceOid: instance.sourceOid,
        target:
          outcome.appliedIds.some((id) => id.startsWith('protection:')) &&
          protectionEffects.find((effect) => outcome.appliedIds.includes(effect.id)) !== undefined
            ? {
                kind: 'permanent',
                oid: protectionEffects.find((effect) => outcome.appliedIds.includes(effect.id))!.sourceOid,
              }
            : instance.recipient,
        amount: instance.amount,
      });
      continue;
    }
    if (replaced.amount <= 0) continue;

    if (replaced.recipient.kind === 'permanent') {
      const oid = replaced.recipient.oid;
      // Damage to something that has already left the battlefield is dropped.
      if (!isOnBattlefield(current.state, oid)) continue;
      const state = markPermanent(current.state, oid, replaced.amount, replaced.deathtouch);
      current = withState(current, state);
      if (hasCardType(state, oid, 'planeswalker')) {
        const object = getObject(state, oid);
        current = emit(current, {
          type: 'countersChanged',
          oid,
          plusOnePlusOne: object.counters.plusOnePlusOne,
          minusOneMinusOne: object.counters.minusOneMinusOne,
          loyalty: counterCount(object.counters, 'loyalty'),
        });
      }
    } else {
      current = noteDamagedPlayer(
        loseLife(current, replaced.recipient.player, replaced.amount),
        replaced.recipient.player,
      );
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
      lifelinkGains.set(replaced.controller, (lifelinkGains.get(replaced.controller) ?? 0) + replaced.amount);
    }
  }

  for (const player of [0, 1] as const) {
    const gained = lifelinkGains.get(player);
    if (gained !== undefined && gained > 0) current = gainLife(current, player, gained, true);
  }
  return current;
}

/** Damage already marked on a permanent, 0 when it is not on the battlefield. */
export function markedDamage(state: GameState, oid: ObjectId): number {
  const object = tryObject(state, oid);
  return object === undefined || object.zone !== 'battlefield' ? 0 : object.damage;
}
