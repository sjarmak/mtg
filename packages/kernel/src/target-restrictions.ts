/**
 * Whether one permanent satisfies a target slot's restriction, right now.
 *
 * One module and one function because the answer has to be identical at two
 * moments that are hours of game time apart in principle and two files apart in
 * practice: `target-choices.ts` asks it to build the space a caster may choose
 * from (CR 601.2c), and `effects.ts` asks it again on resolution (CR 608.2b), by
 * which point the creature may have been pumped, tapped, or given flying. A
 * restriction that was enforced only at the first moment would be a card whose
 * printed condition stops applying the instant it matters.
 *
 * Everything here reads the *current* characteristics through the layer system
 * rather than the printed card, for the same reason: "power 3 or less" is a
 * question about the object on the battlefield, and an Aura or a counter is part
 * of the answer.
 */
import type { TargetRestriction } from '@mtg/dsl';
import { assertNever } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import { counterCount } from './continuous';
import { hasKeyword, powerOf, toughnessOf } from './layers';
import type { GameState } from './state';
import { getObject } from './zones';

/** True when this permanent or player is one the typed restriction admits. */
export function satisfiesTargetRestriction(
  state: GameState,
  subject: ObjectId | PlayerId,
  restriction: TargetRestriction,
): boolean {
  if (restriction.kind === 'playerLostLifeThisTurn') {
    return typeof subject === 'number' && state.turn.lifeLostThisTurn[subject] > 0;
  }
  if (typeof subject !== 'string') return false;
  switch (restriction.kind) {
    case 'maxPower':
      return powerOf(state, subject) <= restriction.power;
    case 'maxToughness':
      return toughnessOf(state, subject) <= restriction.toughness;
    case 'minPower':
      return powerOf(state, subject) >= restriction.power;
    case 'tapped':
      return getObject(state, subject).tapped;
    case 'untapped':
      return !getObject(state, subject).tapped;
    case 'withKeyword':
      return hasKeyword(state, subject, restriction.keyword);
    case 'withoutKeyword':
      return !hasKeyword(state, subject, restriction.keyword);
    // A counter is stored on the object rather than derived from it, so this
    // arm reads `getObject` directly where its neighbors go through the layer
    // system. That is not an inconsistency: layer 7d reads these same counters
    // to produce power, so asking the layers "does it carry a gloom counter"
    // would be asking a derived value about its own input.
    case 'withCounter':
      return counterCount(getObject(state, subject).counters, restriction.counter) > 0;
    default:
      return assertNever(restriction, 'satisfiesTargetRestriction');
  }
}
