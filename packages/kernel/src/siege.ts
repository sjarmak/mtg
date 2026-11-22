/** Intrinsic Battle/Siege state shared by damage, costs, the stack, and SBAs. */
import type { Card } from '@mtg/dsl';
import { counterCount, setCounterCount } from './continuous';
import type { ObjectId, PlayerId } from './ids';
import { opponentOf } from './ids';
import { copiableValuesOf, hasCardType, hasSubtype } from './layers';
import type { GameState } from './state';

export interface DefenseRemoval {
  readonly state: GameState;
  /** True exactly when this removal took a Siege from positive defense to zero. */
  readonly defeated: boolean;
}

export function isSiegeCard(card: Card): boolean {
  return card.kind === 'battle' && card.subtypes.includes('Siege');
}

/** The two-player answer to a Siege's intrinsic protector choice. */
export function battleProtector(card: Card, controller: PlayerId): PlayerId {
  return isSiegeCard(card) ? opponentOf(controller) : controller;
}

/** Removes defense and marks the exact zero-crossing whose intrinsic trigger is owed. */
export function removeDefenseCounters(state: GameState, oid: ObjectId, amount: number): DefenseRemoval {
  const object = state.objects[oid];
  if (object === undefined || object.zone !== 'battlefield' || !hasCardType(state, oid, 'battle')) {
    return { state, defeated: false };
  }
  const before = counterCount(object.counters, 'defense');
  const counters = setCounterCount(object.counters, 'defense', before - amount);
  const defeated = before > 0 && counterCount(counters, 'defense') === 0 && hasSubtype(state, oid, 'Siege');
  return {
    state: {
      ...state,
      objects: {
        ...state.objects,
        [oid]: {
          ...object,
          counters,
          ...(defeated ? { siegeDefeatPending: true as const } : {}),
        },
      },
    },
    defeated,
  };
}

/** Clears the pending marker only from the source incarnation a trigger represented. */
export function clearSiegeDefeatPending(
  state: GameState,
  oid: ObjectId,
  incarnation: number | undefined,
): GameState {
  const object = state.objects[oid];
  if (
    object?.zone !== 'battlefield' ||
    object.siegeDefeatPending !== true ||
    incarnation === undefined ||
    (object.incarnation ?? 0) !== incarnation
  ) {
    return state;
  }
  const { siegeDefeatPending: _cleared, ...withoutPending } = object;
  return { ...state, objects: { ...state.objects, [oid]: withoutPending } };
}

/** Current values used when a copied Battle enters or an intrinsic trigger fires. */
export function siegeValuesOf(state: GameState, oid: ObjectId): Card | null {
  if (!hasCardType(state, oid, 'battle')) return null;
  const card = copiableValuesOf(state, oid);
  return isSiegeCard(card) ? card : null;
}
