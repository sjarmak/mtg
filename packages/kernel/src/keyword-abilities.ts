import { assertNever, type Color, type KeywordAbility, type TargetingRestriction } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import { characteristicsOf, controllerOf, keywordAbilitiesOf } from './layers';
import { staticPlayerRuleApplies } from './player-rules';
import { rulesSourceQualities, type RulesSource } from './rules-source';
import type { GameState } from './state';

export type ProtectionSource = RulesSource;

/** Whether an effect controlled by `sourceController` may target `target`. */
export function canPlayerBeTargetedBy(
  state: GameState,
  target: PlayerId,
  sourceController: PlayerId,
): boolean {
  return target === sourceController || !staticPlayerRuleApplies(state, target, 'hasHexproof');
}

function sourceRestrictionDenies(restriction: TargetingRestriction, sourceColors: readonly Color[]): boolean {
  switch (restriction.kind) {
    case 'sourceLacksColor':
      return !sourceColors.includes(restriction.color);
    default:
      return assertNever(restriction.kind, 'sourceRestrictionDenies');
  }
}

export function isProtectedFrom(state: GameState, protectedOid: ObjectId, source: ProtectionSource): boolean {
  const qualities = rulesSourceQualities(state, source);
  if (qualities === null) return false;
  return keywordAbilitiesOf(state, protectedOid).some((ability) => {
    if (ability.kind !== 'protection') return false;
    return ability.quality.kind === 'color'
      ? qualities.colors.includes(ability.quality.color)
      : qualities.subtypes.includes(ability.quality.subtype);
  });
}

export function canBeTargetedBy(
  state: GameState,
  targetOid: ObjectId,
  source: ProtectionSource,
  chooser: PlayerId,
): boolean {
  const current = characteristicsOf(state, targetOid);
  const abilities: readonly KeywordAbility[] = current.keywordAbilities;
  if (abilities.some((ability) => ability.kind === 'shroud')) return false;
  if (
    abilities.some((ability) => ability.kind === 'hexproof') &&
    controllerOf(state, targetOid) !== chooser
  ) {
    return false;
  }
  const qualities = rulesSourceQualities(state, source);
  if (
    qualities !== null &&
    current.targetingRestrictions.some((restriction) =>
      sourceRestrictionDenies(restriction, qualities.colors),
    )
  ) {
    return false;
  }
  if (
    qualities !== null &&
    qualities.kind === 'spell' &&
    state.turnPlayerRules.some(
      (rule) =>
        rule.rule === 'creaturesCantBeTargetedBySpellColors' &&
        rule.player === controllerOf(state, targetOid) &&
        current.cardTypes.includes('creature') &&
        qualities.colors.some((color) => rule.colors.includes(color)),
    )
  ) {
    return false;
  }
  return !isProtectedFrom(state, targetOid, source);
}
