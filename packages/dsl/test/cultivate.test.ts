/** Cultivate's one-search, two-destination authoring shape. */
import { describe, expect, it } from 'vitest';
import { CardEffectSchema, ModelEffectSchema, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';

const SEARCH = {
  kind: 'searchLibrary' as const,
  filter: { cardTypes: ['land' as const], supertypes: ['basic' as const] },
  count: 2,
  reveal: true,
  destination: {
    kind: 'oneAndRest' as const,
    one: 'battlefieldTapped' as const,
    rest: 'hand' as const,
  },
};

const CULTIVATE = {
  kind: 'sorcery' as const,
  id: 'm11-cultivate',
  name: 'Cultivate',
  rarity: 'common' as const,
  set: { code: 'M11', collectorNumber: 168 },
  manaCost: { generic: 2, G: 1 },
  colors: ['G'] as const,
  effects: [SEARCH],
};

describe('Cultivate authoring', () => {
  it('accepts one chosen destination and a destination for the rest', () => {
    expect(CardEffectSchema.safeParse(SEARCH).success).toBe(true);
    expect(renderOracleText(parseCard(CULTIVATE as unknown as CardInput))).toBe(
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    );
  });

  it('keeps split searches outside generator output', () => {
    expect(ModelEffectSchema.safeParse(SEARCH).success).toBe(false);
  });
});
