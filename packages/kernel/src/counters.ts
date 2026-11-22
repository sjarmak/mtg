/** Immutable counter placement/removal and the events those game actions expose. */
import type { CounterKind } from '@mtg/dsl';
import { addCounters, counterCount, setCounterCount } from './continuous';
import type { ObjectId } from './ids';
import { hasCardType } from './layers';
import { applyReplacements } from './replacement';
import { removeDefenseCounters } from './siege';
import type { GameState } from './state';
import { tryObject } from './zones';
import type { Trace } from './trace';
import { emit, withState } from './trace';

function reportCounterTotals(trace: Trace, oid: ObjectId, kind: CounterKind): Trace {
  const object = tryObject(trace.state, oid);
  if (object === undefined) return trace;
  if (kind !== 'plusOnePlusOne' && kind !== 'minusOneMinusOne' && kind !== 'loyalty' && kind !== 'defense') {
    return trace;
  }
  return emit(trace, {
    type: 'countersChanged',
    oid,
    plusOnePlusOne: object.counters.plusOnePlusOne,
    minusOneMinusOne: object.counters.minusOneMinusOne,
    ...(kind === 'loyalty' ? { loyalty: counterCount(object.counters, 'loyalty') } : {}),
    ...(kind === 'defense' ? { defense: counterCount(object.counters, 'defense') } : {}),
  });
}

/** Put counters on a live permanent; a departed object receives nothing. */
export function placeCounters(trace: Trace, oid: ObjectId, kind: CounterKind, count: number): Trace {
  if (!Number.isInteger(count) || count <= 0) return trace;
  const object = tryObject(trace.state, oid);
  if (object === undefined || object.zone !== 'battlefield') return trace;
  const replacement = applyReplacements(trace.state, {
    kind: 'counterPlacement',
    oid,
    controller: object.controller,
    counter: kind,
    count,
  });
  const event = replacement.event;
  if (event === null || event.kind !== 'counterPlacement' || event.count <= 0) return trace;
  const counters = addCounters(object.counters, kind, event.count);
  const state: GameState = {
    ...trace.state,
    replacements: replacement.replacements,
    objects: { ...trace.state.objects, [oid]: { ...object, counters } },
  };
  return reportCounterTotals(withState(trace, state), oid, kind);
}

export interface CounterRemoval {
  readonly trace: Trace;
  readonly removed: number;
}

/** Remove no more counters than exist and report the actual removed quantity. */
export function removeCounters(
  trace: Trace,
  oid: ObjectId,
  kind: CounterKind,
  requested: number,
): CounterRemoval {
  if (!Number.isInteger(requested) || requested <= 0) return { trace, removed: 0 };
  const object = tryObject(trace.state, oid);
  if (object === undefined || object.zone !== 'battlefield') return { trace, removed: 0 };
  const available = counterCount(object.counters, kind);
  const removed = Math.min(available, requested);
  if (removed === 0) return { trace, removed: 0 };
  const defenseRemoval =
    kind === 'defense' && hasCardType(trace.state, oid, 'battle')
      ? removeDefenseCounters(trace.state, oid, removed)
      : null;
  const state: GameState = defenseRemoval?.state ?? {
    ...trace.state,
    objects: {
      ...trace.state.objects,
      [oid]: {
        ...object,
        counters: setCounterCount(object.counters, kind, available - removed),
      },
    },
  };
  const changed = emit(withState(trace, state), {
    type: 'counterRemoved',
    oid,
    counter: kind,
    count: removed,
  });
  const reported = reportCounterTotals(changed, oid, kind);
  return {
    trace: defenseRemoval?.defeated === true ? emit(reported, { type: 'battleDefeated', oid }) : reported,
    removed,
  };
}

/** CR 704.5q removes opposing P/T counters simultaneously from one permanent. */
export function removeOpposedCounters(trace: Trace, oid: ObjectId): Trace {
  const object = tryObject(trace.state, oid);
  if (object === undefined || object.zone !== 'battlefield') return trace;
  const removed = Math.min(object.counters.plusOnePlusOne, object.counters.minusOneMinusOne);
  if (removed === 0) return trace;

  const counters = setCounterCount(
    setCounterCount(object.counters, 'plusOnePlusOne', object.counters.plusOnePlusOne - removed),
    'minusOneMinusOne',
    object.counters.minusOneMinusOne - removed,
  );
  const state: GameState = {
    ...trace.state,
    objects: { ...trace.state.objects, [oid]: { ...object, counters } },
  };
  const plusRemoved = emit(withState(trace, state), {
    type: 'counterRemoved',
    oid,
    counter: 'plusOnePlusOne',
    count: removed,
  });
  const minusRemoved = emit(plusRemoved, {
    type: 'counterRemoved',
    oid,
    counter: 'minusOneMinusOne',
    count: removed,
  });
  return reportCounterTotals(minusRemoved, oid, 'minusOneMinusOne');
}
