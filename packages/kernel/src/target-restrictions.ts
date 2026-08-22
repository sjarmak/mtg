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
import type { ObjectId } from './ids';
import { counterCount } from './continuous';
import { hasKeyword, powerOf } from './layers';
import type { GameState } from './state';
import { getObject } from './zones';

/** True when this permanent is one the restriction admits. */
export function satisfiesTargetRestriction(
  state: GameState,
  oid: ObjectId,
  restriction: TargetRestriction,
): boolean {
  switch (restriction.kind) {
    case 'maxPower':
      return powerOf(state, oid) <= restriction.power;
    case 'minPower':
      return powerOf(state, oid) >= restriction.power;
    case 'tapped':
      return getObject(state, oid).tapped;
    case 'untapped':
      return !getObject(state, oid).tapped;
    case 'withKeyword':
      return hasKeyword(state, oid, restriction.keyword);
    case 'withoutKeyword':
      return !hasKeyword(state, oid, restriction.keyword);
    // A counter is stored on the object rather than derived from it, so this
    // arm reads `getObject` directly where its neighbors go through the layer
    // system. That is not an inconsistency: layer 7d reads these same counters
    // to produce power, so asking the layers "does it carry a gloom counter"
    // would be asking a derived value about its own input.
    case 'withCounter':
      return counterCount(getObject(state, oid).counters, restriction.counter) > 0;
    default:
      return assertNever(restriction, 'satisfiesTargetRestriction');
  }
}
