/** Autumn's Veil as one color-parameterized, hand-authored turn rule. */
import { describe, expect, it } from 'vitest';
import { CardEffectSchema, ModelEffectSchema, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';

const EFFECT = {
  kind: 'protectSpellsAndCreaturesFromSpellColorsThisTurn' as const,
  colors: ['U', 'B'] as const,
};

const AUTUMNS_VEIL = {
  kind: 'instant' as const,
  id: 'm11-162-autumns-veil',
  name: "Autumn's Veil",
  rarity: 'uncommon' as const,
  set: { code: 'M11', collectorNumber: 162 },
  manaCost: { G: 1 },
  colors: ['G'] as const,
  effects: [EFFECT],
};

describe("Autumn's Veil authoring", () => {
  it('parses and prints the exact current Oracle sentence', () => {
    expect(CardEffectSchema.safeParse(EFFECT).success).toBe(true);
    expect(renderOracleText(parseCard(AUTUMNS_VEIL as unknown as CardInput))).toBe(
      "Spells you control can't be countered by blue or black spells this turn, and creatures you control can't be the targets of blue or black spells this turn.",
    );
  });

  it('keeps the rule-changing effect outside generator output', () => {
    expect(ModelEffectSchema.safeParse(EFFECT).success).toBe(false);
  });

  it('refuses empty or repeated color lists', () => {
    expect(CardEffectSchema.safeParse({ ...EFFECT, colors: [] }).success).toBe(false);
    expect(CardEffectSchema.safeParse({ ...EFFECT, colors: ['U', 'U'] }).success).toBe(false);
  });
});
