import { describe, expect, it } from 'vitest';
import { ModelAuraSchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';

export const URBAN_BURGEONING_INPUT = {
  kind: 'enchantment',
  id: 'rtr-138-urban-burgeoning-dsl',
  name: 'Urban Burgeoning',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 138 },
  manaCost: { G: 1 },
  colors: ['G'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'land',
    modifications: [],
    untapsDuringEachOtherPlayersUntapStep: true,
  },
} as const;

describe('RTR #138 Urban Burgeoning', () => {
  it('renders the source-attested granted untap rule in exact Oracle order', () => {
    const card = parseCard(URBAN_BURGEONING_INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Enchant land\nEnchanted land has "Untap this land during each other player\'s untap step."',
    );
  });

  it('keeps the other-player untap permission outside the generator Aura vocabulary', () => {
    const card = parseCard(URBAN_BURGEONING_INPUT);
    expect(card.kind).toBe('enchantment');
    if (card.kind !== 'enchantment' || card.aura === undefined) throw new Error('Aura missing');
    expect(ModelAuraSchema.safeParse(card.aura).success).toBe(false);
  });
});
