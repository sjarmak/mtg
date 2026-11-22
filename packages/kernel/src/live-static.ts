/** Live queries shared by static rules that do not compile into CR 613 layers. */
import type { Condition, StaticAbility } from '@mtg/dsl';
import { assertNever } from '@mtg/dsl';
import { selectMatching } from './characteristics';
import { counterCount, objectFilter } from './continuous';
import type { ObjectId } from './ids';
import { opponentOf } from './ids';
import { controllerOf, derivedCharacteristics, hasCardType, hasSubtype, isCreatureObject } from './layers';
import type { GameState } from './state';
import { satisfiesTargetFilter } from './target-filter';
import { getObject } from './zones';

/** CR 611.2c evaluated through current state rather than a layer-build context. */
function liveStaticConditionHolds(state: GameState, condition: Condition, source: ObjectId): boolean {
  switch (condition.kind) {
    case 'controlsSubtype': {
      const controller = controllerOf(state, source);
      return (
        state.battlefield.filter(
          (oid) => controllerOf(state, oid) === controller && hasSubtype(state, oid, condition.subtype),
        ).length >= condition.atLeast
      );
    }
    case 'anyCreatureHasCounter':
      return state.battlefield.some(
        (oid) =>
          isCreatureObject(state, oid) && counterCount(getObject(state, oid).counters, condition.counter) > 0,
      );
    case 'opponentGraveyardAtLeast':
      return state.players[opponentOf(controllerOf(state, source))].graveyard.length >= condition.atLeast;
    case 'opponentUndamagedThisTurn':
      return !state.turn.playersDealtDamageThisTurn.includes(opponentOf(controllerOf(state, source)));
    case 'controllerLifeAtLeast':
      return state.players[controllerOf(state, source)].life >= condition.atLeast;
    case 'controllerLifeBelow':
      return state.players[controllerOf(state, source)].life < condition.fewerThan;
    case 'controllerLibraryAtLeast':
      return state.players[controllerOf(state, source)].library.length >= condition.atLeast;
    case 'controllerTopLibraryHasColor': {
      const top = state.players[controllerOf(state, source)].library[0];
      return top !== undefined && getObject(state, top).card.colors.includes(condition.color);
    }
    case 'battlefieldCountBelow':
      return (
        selectMatching(
          state,
          state.battlefield,
          derivedCharacteristics(state),
          objectFilter({
            cardTypes: condition.filter.cardTypes ?? null,
            subtypes: condition.filter.subtypes ?? null,
            names: condition.filter.names ?? null,
          }),
        ).length < condition.fewerThan
      );
    case 'controlsNoneOfSubtypes':
      return !state.battlefield.some(
        (oid) =>
          controllerOf(state, oid) === controllerOf(state, source) &&
          condition.subtypes.some((subtype) => hasSubtype(state, oid, subtype)),
      );
    case 'selfCounterCountBelow':
      return counterCount(getObject(state, source).counters, condition.counter) < condition.fewerThan;
    case 'selfCounterCountAtLeast':
      return counterCount(getObject(state, source).counters, condition.counter) >= condition.atLeast;
    default:
      return assertNever(condition, 'liveStaticConditionHolds');
  }
}

/** Whether one current static ability reaches one current battlefield permanent. */
export function liveStaticAbilityAffects(
  state: GameState,
  ability: StaticAbility,
  source: ObjectId,
  target: ObjectId,
): boolean {
  if (ability.activeDuring === 'turnsOtherThanYours' && state.turn.active === controllerOf(state, source))
    return false;
  const condition = ability.enabledWhile ?? null;
  if (condition !== null && !liveStaticConditionHolds(state, condition, source)) return false;
  if (ability.subtype !== null && !hasSubtype(state, target, ability.subtype)) return false;
  if (
    ability.filter !== undefined &&
    !satisfiesTargetFilter(state, target, {
      ...(ability.filter.colors === undefined ? {} : { colors: ability.filter.colors }),
      ...(ability.filter.excludeColors === undefined ? {} : { excludeColors: ability.filter.excludeColors }),
    })
  )
    return false;
  if (ability.filter?.tapped === true && getObject(state, target).tapped !== true) return false;
  switch (ability.scope) {
    case 'self':
      return target === source;
    case 'creaturesYouControl':
      return (
        hasCardType(state, target, 'creature') && controllerOf(state, target) === controllerOf(state, source)
      );
    case 'otherCreaturesYouControl':
      return (
        target !== source &&
        hasCardType(state, target, 'creature') &&
        controllerOf(state, target) === controllerOf(state, source)
      );
    case 'landsYouControl':
      return (
        hasCardType(state, target, 'land') && controllerOf(state, target) === controllerOf(state, source)
      );
    case 'allLands':
      return hasCardType(state, target, 'land');
    case 'allCreatures':
      return hasCardType(state, target, 'creature');
    default:
      return assertNever(ability.scope, 'liveStaticAbilityAffects');
  }
}
