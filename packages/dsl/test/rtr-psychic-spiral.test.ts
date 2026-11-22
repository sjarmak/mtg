import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, validateCard } from '@mtg/dsl';

export const PSYCHIC_SPIRAL_INPUT = {
  kind: 'instant',
  id: 'rtr-47-psychic-spiral',
  name: 'Psychic Spiral',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 47 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  effects: [
    { kind: 'shuffleGraveyardIntoLibrary', printedAllCardsFromYourGraveyard: true },
    {
      kind: 'millCards',
      count: { kind: 'cardsShuffledFromGraveyardThisResolution' },
      target: { kind: 'targetPlayer' },
    },
  ],
} as const;

describe('RTR #47 Psychic Spiral', () => {
  it('renders the source-attested clauses in exact current Oracle order', () => {
    const card = parseCard(PSYCHIC_SPIRAL_INPUT);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Shuffle all cards from your graveyard into your library. Target player mills that many cards.',
    );
  });

  it('keeps the linked shuffle count outside the generator vocabulary', () => {
    const card = parseCard(PSYCHIC_SPIRAL_INPUT);
    expect(ModelEffectSchema.safeParse(card.effects[0]).success).toBe(false);
    expect(ModelEffectSchema.safeParse(card.effects[1]).success).toBe(false);
  });

  it('refuses a linked count without exactly one earlier graveyard shuffle-back', () => {
    for (const effects of [
      [PSYCHIC_SPIRAL_INPUT.effects[1]],
      [PSYCHIC_SPIRAL_INPUT.effects[0], PSYCHIC_SPIRAL_INPUT.effects[0], PSYCHIC_SPIRAL_INPUT.effects[1]],
    ]) {
      const parsed = safeParseCard({ ...PSYCHIC_SPIRAL_INPUT, effects });
      expect(parsed.ok).toBe(false);
      expect((parsed.ok ? [] : parsed.violations).map((violation) => violation.code)).toContain(
        'ILLEGAL_REFERENT_AMOUNT',
      );
    }
  });
});
