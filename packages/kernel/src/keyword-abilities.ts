import type { Card, Color, KeywordAbility } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import { characteristicsOf, controllerOf, keywordAbilitiesOf } from './layers';
import type { GameState, SourceCharacteristics } from './state';

export type ProtectionSource = ObjectId | Card | SourceCharacteristics;

function sourceQualities(
  state: GameState,
  source: ProtectionSource,
): { readonly colors: readonly Color[]; readonly subtypes: readonly string[] } | null {
  if (typeof source === 'string') {
    if (state.objects[source] === undefined) return null;
    const current = characteristicsOf(state, source);
    return { colors: current.colors, subtypes: current.subtypes };
  }
  return { colors: source.colors, subtypes: source.subtypes };
}

export function isProtectedFrom(state: GameState, protectedOid: ObjectId, source: ProtectionSource): boolean {
  const qualities = sourceQualities(state, source);
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
  const abilities: readonly KeywordAbility[] = keywordAbilitiesOf(state, targetOid);
  if (
    abilities.some((ability) => ability.kind === 'hexproof') &&
    controllerOf(state, targetOid) !== chooser
  ) {
    return false;
  }
  return !isProtectedFrom(state, targetOid, source);
}
