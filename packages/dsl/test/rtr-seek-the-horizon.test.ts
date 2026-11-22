/** RTR #134 as the retained counted, revealed basic-land search. */
import { describe, expect, it } from 'vitest';
import { CardEffectSchema, ModelEffectSchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';

const SEARCH = {
  kind: 'searchLibrary' as const,
  filter: { cardTypes: ['land' as const], supertypes: ['basic' as const] },
  count: 3,
  reveal: true,
  destination: 'hand' as const,
};

const CARD = parseCard({
  kind: 'sorcery',
  id: 'rtr-134',
  name: 'Seek the Horizon',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 134 },
  manaCost: { generic: 3, G: 1 },
  colors: ['G'],
  effects: [SEARCH],
});

describe('RTR Seek the Horizon authoring', () => {
  it('renders the exact current Oracle paragraph', () => {
    expect(validateCard(CARD)).toEqual([]);
    expect(renderOracleText(CARD)).toBe(
      'Search your library for up to three basic land cards, reveal them, put them into your hand, then shuffle.',
    );
  });

  it('keeps library search outside generator output', () => {
    expect(CardEffectSchema.safeParse(SEARCH).success).toBe(true);
    expect(ModelEffectSchema.safeParse(SEARCH).success).toBe(false);
  });
});
