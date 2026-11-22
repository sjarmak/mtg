/** RTR Search Warrant's linked player target and live hand-size reading. */
import { describe, expect, it } from 'vitest';
import {
  AmountSchema,
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

const REVEAL = { kind: 'revealHand', target: { kind: 'targetPlayer' } } as const;
const GAIN_FOR_HAND = {
  kind: 'gainLife',
  amount: 0,
  amountFrom: 'thatPlayersHandSize',
  target: { kind: 'noTarget' },
} as const;

function searchWarrantInput(effects: readonly unknown[] = [REVEAL, GAIN_FOR_HAND]): CardInput {
  return {
    kind: 'sorcery',
    id: 'rtr-193-search-warrant',
    name: 'Search Warrant',
    rarity: 'uncommon',
    set: { code: 'RTR', collectorNumber: 193 },
    manaCost: { W: 1, U: 1 },
    colors: ['W', 'U'],
    effects,
  } as unknown as CardInput;
}

describe('RTR #193 Search Warrant DSL vocabulary', () => {
  it('parses and renders the current Oracle text exactly', () => {
    const card = parseCard(searchWarrantInput());

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Target player reveals their hand. You gain life equal to the number of cards in that player's hand.",
    );
  });

  it('keeps the linked amount hand-authored and outside the generator answer schema', () => {
    expect(AmountSchema.safeParse({ kind: 'thatPlayersHandSize' }).success).toBe(false);
    expect(CardEffectSchema.safeParse(GAIN_FOR_HAND).success).toBe(true);
    expect(ModelEffectSchema.safeParse(GAIN_FOR_HAND).success).toBe(false);
  });

  it('refuses a hand-size reader without exactly one earlier player target', () => {
    const absent = safeParseCard(searchWarrantInput([GAIN_FOR_HAND]));
    expect(absent.ok).toBe(false);
    if (!absent.ok) {
      expect(absent.violations).toContainEqual(
        expect.objectContaining({
          code: 'ILLEGAL_REFERENT_AMOUNT',
          path: 'effects[0].amountFrom',
        }),
      );
    }

    const ambiguous = safeParseCard(searchWarrantInput([REVEAL, REVEAL, GAIN_FOR_HAND]));
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.violations).toContainEqual(
        expect.objectContaining({
          code: 'ILLEGAL_REFERENT_AMOUNT',
          path: 'effects[2].amountFrom',
        }),
      );
    }

    const competingLiteral = safeParseCard(searchWarrantInput([REVEAL, { ...GAIN_FOR_HAND, amount: 1 }]));
    expect(competingLiteral.ok).toBe(false);
    if (!competingLiteral.ok) {
      expect(competingLiteral.violations).toContainEqual(
        expect.objectContaining({
          code: 'ILLEGAL_REFERENT_AMOUNT',
          path: 'effects[1].amount',
        }),
      );
    }
  });
});
