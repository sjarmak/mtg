/** Jarad's Orders' one-search, hand-and-graveyard destination contract. */
import { describe, expect, it } from 'vitest';
import { CardEffectSchema, ModelEffectSchema, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';

const SEARCH = {
  kind: 'searchLibrary' as const,
  filter: { cardTypes: ['creature' as const] },
  count: 2,
  reveal: true,
  destination: {
    kind: 'oneToHandRestToGraveyard' as const,
    one: 'hand' as const,
  },
};

const JARADS_ORDERS = {
  kind: 'sorcery' as const,
  id: 'rtr-jarads-orders',
  name: "Jarad's Orders",
  rarity: 'rare' as const,
  set: { code: 'RTR', collectorNumber: 175 },
  manaCost: { generic: 2, B: 1, G: 1 },
  colors: ['B', 'G'] as const,
  effects: [SEARCH],
};

describe("Jarad's Orders authoring", () => {
  it('accepts the reviewed graveyard arm and renders current Oracle exactly', () => {
    expect(CardEffectSchema.safeParse(SEARCH).success).toBe(true);
    expect(renderOracleText(parseCard(JARADS_ORDERS as unknown as CardInput))).toBe(
      'Search your library for up to two creature cards and reveal them. Put one into your hand and the other into your graveyard. Then shuffle.',
    );
  });

  it('keeps the split search outside generator output', () => {
    expect(ModelEffectSchema.safeParse(SEARCH).success).toBe(false);
  });
});
