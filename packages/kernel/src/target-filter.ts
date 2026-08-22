/**
 * The DSL's `TargetFilter`, evaluated against this board.
 *
 * One module because the same filter is asked twice about the same object at
 * two different moments — `targetChoicesForEffects` enumerates the space as the
 * spell goes on the stack (CR 601.2c) and `isTargetStillLegal` rechecks the
 * chosen target as it resolves (CR 608.2b) — and a kind wired into one and
 * forgotten in the other is the regression `artifact-enchantment-target.test.ts`
 * was written for. Both callers land here.
 *
 * The characteristic half is not evaluated here at all: it is compiled to an
 * `ObjectFilter` and handed to `matchesFilter`, the same function the CR 613
 * layer walk uses to decide who an anthem reaches. That is the whole point of
 * `TargetFilterSchema` being a subset of `ObjectFilter` rather than a filter
 * type of its own — a removal spell that says "black creature" and a lord that
 * says "black creature" have to reach the same bodies, and two evaluators would
 * eventually disagree about one of them (`mtg-6y4g`).
 *
 * The combat half is evaluated here, because it is not a characteristic. CR
 * 506.4 makes "attacking" a property of the *combat* rather than of the object:
 * nothing on the permanent records it, `characteristicsOf` cannot report it,
 * and it stops being true the moment the combat ends. So the filter is answered
 * in two pieces against two sources, and this module is where the seam is.
 */
import type { TargetFilter } from '@mtg/dsl';
import { assertNever } from '@mtg/dsl';
import type { ObjectFilter } from './continuous';
import { objectFilter } from './continuous';
import { matchesFilter, printedCharacteristics } from './characteristics';
import type { ObjectId } from './ids';
import { characteristicsOf } from './layers';
import type { GameState } from './state';

/**
 * The DSL filter as a kernel filter.
 *
 * `undefined` becomes `null` ("no constraint"), which is the identical
 * translation `countMatching` makes for `CountFilter` and `objectsInEffectScope`
 * makes for `EffectScope`: `@mtg/dsl` has zero dependencies and cannot import
 * `ObjectFilter`, so the two shapes are written independently and joined at
 * exactly these seams. `combat` is deliberately dropped — it is not a
 * characteristic and `matchesFilter` has no field for it, so an `ObjectFilter`
 * that carried it would be a filter half the kernel silently ignored.
 *
 * `subtypes` is the whole kernel half of `mtg-nhyv.56`, and that is the point
 * of the subset arrangement rather than an accident of it: `ObjectFilter`
 * already carried the field, `matchesFilter` already read it with `anyOf`, and
 * `printedCharacteristics` already folds a basic land's `basicLandType` in
 * beside its printed subtypes (CR 205.3i). So "untap target Forest" finds a
 * Forest through the same line an anthem finds a Merfolk through, and a Forest
 * is a legal target for it without the card naming a land type the printed
 * card does not carry in `subtypes`.
 *
 * `keywords` is the same story once more (`mtg-nhyv.62`), and it is the field
 * where the subset arrangement pays for itself most plainly. "Each creature
 * with flying" has to mean the creature's *current* keywords, granted ones
 * included, because that is what CR 613 says a permanent has; `matchesFilter`
 * is handed `characteristicsOf`'s answer above, which is the same walk
 * `hasKeyword` returns to `canBlock` in `combat.ts`. So the creature a Spider
 * can be blocked by and the creature its sweep burns are decided by one
 * derivation. A filter evaluated here off `card.keywords` would have printed
 * the same sentence and disagreed with the blocking rules about an enchanted
 * bear.
 */
export function targetObjectFilter(filter: TargetFilter): ObjectFilter {
  return objectFilter({
    cardTypes: filter.cardTypes ?? null,
    allCardTypes: filter.allCardTypes ?? null,
    excludeCardTypes: filter.excludeCardTypes ?? null,
    subtypes: filter.subtypes ?? null,
    colors: filter.colors ?? null,
    excludeColors: filter.excludeColors ?? null,
    keywords: filter.keywords ?? null,
  });
}

/** CR 506.4: is this permanent an attacking creature right now? */
export function isAttacking(state: GameState, oid: ObjectId): boolean {
  return state.combat.attacks.some((attack) => attack.oid === oid);
}

/** CR 509.1: is this permanent blocking an attacker right now? */
export function isBlocking(state: GameState, oid: ObjectId): boolean {
  return state.combat.blocks.some((block) => block.blockers.includes(oid));
}

/**
 * Does this permanent satisfy the whole filter, characteristics and combat
 * both?
 *
 * Read through `characteristicsOf` rather than off the printed card, for the
 * reason `hasCardType` is: a permanent whose color or card type a continuous
 * effect changed is what it currently is, at both of the two moments this is
 * asked. A Doom Blade aimed at a creature that a later effect turns black has
 * stopped having a legal target, and that is the same sentence CR 608.2b writes
 * about a creature that grows past "power 3 or less".
 */
export function satisfiesTargetFilter(state: GameState, oid: ObjectId, filter: TargetFilter): boolean {
  if (!matchesFilter(targetObjectFilter(filter), oid, characteristicsOf(state, oid))) return false;
  const combat = filter.combat;
  if (combat === undefined) return true;
  switch (combat) {
    case 'attacking':
      return isAttacking(state, oid);
    case 'blocking':
      return isBlocking(state, oid);
    case 'attackingOrBlocking':
      return isAttacking(state, oid) || isBlocking(state, oid);
    default:
      return assertNever(combat, 'satisfiesTargetFilter');
  }
}

/**
 * The same filter asked about a spell on the stack, which is a different object
 * in a different zone.
 *
 * Printed characteristics rather than derived ones, and that is not a shortcut:
 * `characteristicsOf` walks the CR 613 layer system, and the layer system
 * applies to permanents on the battlefield (CR 613.1). A spell on the stack has
 * no entry in that walk, so asking it there would answer about an object the
 * map does not hold. `zone-filter.ts` reads a card in a non-battlefield zone
 * the same way and for the same reason.
 *
 * A combat role never reaches here: `checkSpellFilter` refuses the field on a
 * `spellFilter` outright, because nothing on the stack is attacking. A keyword
 * never reaches here either, and the reason is this paragraph rather than a
 * second one — printed values are the only honest answer off the battlefield,
 * so "with flying" would mean something narrower here than it means in the one
 * place the field is admitted, and one field must not have two meanings.
 */
export function spellSatisfiesFilter(state: GameState, oid: ObjectId, filter: TargetFilter): boolean {
  const object = state.objects[oid];
  if (object === undefined) return false;
  return matchesFilter(targetObjectFilter(filter), oid, printedCharacteristics(object));
}
