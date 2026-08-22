/**
 * Which of `StaticModificationSchema`'s three machines a record belongs to.
 *
 * `STATIC_MODIFICATION_KINDS` carries three unrelated machines under one
 * union: three members the layer system applies (CR 613 — `statBonus` and
 * `grantKeyword` and `definePt` are layers 7c, 6 and 7a), two the replacement
 * system applies (CR 614 — a doubler rewrites an event before it happens and
 * never touches a characteristic), and six the combat-legality machine
 * applies (CR 508/509 — a restriction or requirement on which attack- and
 * block-declarations are legal, which is neither a characteristic change nor
 * an event rewrite). Four consumers have to split on that difference and none
 * of them can read it off the record's shape: `@mtg/kernel`'s
 * `effectForModification` builds a `ContinuousEffect` and has nothing to
 * build for a replacement or a combat restriction,
 * `static-replacements.ts`'s `replacementsForAbility` registers a
 * `ReplacementEffect` and must not be handed a combat kind either,
 * `oracle.ts`'s `renderStaticAbility` prints a different sentence shape per
 * class, and `validate/abilities.ts`'s `checkStaticScope` holds a rule about
 * creature characteristics that neither a replacement nor a combat
 * restriction is about.
 *
 * Written as a total switch rather than a boolean predicate over one member
 * name, for the reason every other table in this package is total: a
 * further modification kind should stop the compiler and make somebody say
 * which machine runs it. `kind !== 'doubleDamage'` would answer that
 * question by default, and the default is the layer walk, which would then
 * be handed a record it cannot turn into a continuous effect.
 */
import type { CombatModification, LayeredStaticModification, StaticModification } from './ability-shape';
import { assertNever } from './vocabulary';

export type StaticModificationClass = 'layered' | 'replacement' | 'combat';

/**
 * `StaticModification` narrowed to the two CR 614 replacement kinds, named so
 * a function that only prints or only registers replacements can say so in
 * its signature. Written as the complement of the other two classes rather
 * than as its own list, because the three must partition `StaticModification`
 * exactly and a second hand-written list is a second place for that to stop
 * being true.
 */
export type ReplacementStaticModification = Exclude<
  StaticModification,
  LayeredStaticModification | CombatModification
>;

export function classifyStaticModification(modification: StaticModification): StaticModificationClass {
  switch (modification.kind) {
    case 'statBonus':
    case 'grantKeyword':
    case 'definePt':
    case 'statBonusPer':
      return 'layered';
    case 'doubleDamage':
    case 'doubleLifeGain':
      return 'replacement';
    case 'cantAttack':
    case 'cantBlock':
    case 'cantBeBlocked':
    case 'attacksEachCombatIfAble':
    case 'mustBeBlockedIfAble':
    case 'blockOnlyCreaturesWithKeyword':
    case 'cantBeBlockedBySubtype':
      return 'combat';
    default:
      return assertNever(modification, 'classifyStaticModification');
  }
}

/** `classifyStaticModification` as the narrowing its callers actually want. */
export function isLayeredStaticModification(
  modification: StaticModification,
): modification is LayeredStaticModification {
  return classifyStaticModification(modification) === 'layered';
}

/** `classifyStaticModification` as the narrowing its callers actually want. */
export function isCombatStaticModification(
  modification: StaticModification,
): modification is CombatModification {
  return classifyStaticModification(modification) === 'combat';
}
