/**
 * A permanent's current keywords, spelled the way the projection states them.
 *
 * `ObjectView.keywords` is printed English, lowercase, one entry per distinct
 * ability. The kernel keeps a permanent's keywords in two lists because their
 * rules consequences differ (`Characteristics.keywords` are the nine layer-6
 * names, `keywordAbilities` are the ones that carry a parameter or a state-based
 * consequence), and a board label wants neither split, so this reads both and
 * spells them from the DSL's own tables rather than a second copy of the words.
 */
import { COLOR_WORDS, KEYWORD_PRINT_NAMES, assertNever } from '@mtg/dsl';
import type { KeywordAbility } from '@mtg/dsl';
import type { Characteristics } from './characteristics';

export function keywordsOf(
  current: Pick<Characteristics, 'keywords' | 'keywordAbilities'>,
): readonly string[] {
  const spelled = [
    ...current.keywords.map((keyword) => KEYWORD_PRINT_NAMES[keyword]),
    ...current.keywordAbilities.map(spellKeywordAbility),
  ];
  return [...new Set(spelled)];
}

function spellKeywordAbility(ability: KeywordAbility): string {
  switch (ability.kind) {
    case 'defender':
    case 'hexproof':
    case 'indestructible':
    case 'shroud':
    case 'flash':
    case 'intimidate':
    case 'unleash':
      return ability.kind;
    case 'doubleStrike':
      return 'double strike';
    case 'landwalk':
      return `${ability.landType.toLowerCase()}walk`;
    case 'protection':
      return `protection from ${
        ability.quality.kind === 'color'
          ? COLOR_WORDS[ability.quality.color]
          : ability.quality.subtype.toLowerCase()
      }`;
    default:
      return assertNever(ability, 'keywordsOf');
  }
}
