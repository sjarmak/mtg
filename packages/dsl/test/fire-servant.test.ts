/** Fire Servant's hand-authored spell-source damage filter. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';

const SOURCE_FILTER = {
  controller: 'you' as const,
  cardTypes: ['instant', 'sorcery'] as const,
  colors: ['R'] as const,
};

const ABILITY = {
  kind: 'static' as const,
  scope: 'self' as const,
  subtype: null,
  modification: { kind: 'doubleDamage' as const, sourceFilter: SOURCE_FILTER },
};

const FIRE_SERVANT = {
  kind: 'creature' as const,
  id: 'tst-fire-servant',
  name: 'Fire Servant',
  rarity: 'uncommon' as const,
  set: { code: 'M11', collectorNumber: 137 },
  colors: ['R'] as const,
  manaCost: { generic: 3, R: 2 },
  power: 4,
  toughness: 3,
  subtypes: ['Elemental'],
  abilities: [ABILITY],
};

describe('Fire Servant authoring', () => {
  it('prints the filtered replacement in current Oracle wording', () => {
    expect(renderOracleText(parseCard(FIRE_SERVANT))).toBe(
      'If a red instant or sorcery spell you control would deal damage, it deals double that damage instead.',
    );
  });

  it('keeps both filtered and unfiltered damage doublers outside model output', () => {
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
    expect(
      ModelAbilitySchema.safeParse({
        ...ABILITY,
        modification: { kind: 'doubleDamage' },
      }).success,
    ).toBe(false);
  });
});
