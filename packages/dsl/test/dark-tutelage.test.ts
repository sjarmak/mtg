/** Dark Tutelage's linked top-card reveal, move, and mana-value reading. */
import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

const REVEAL_TO_HAND = { kind: 'revealTopCardToHand' } as const;
const LOSE_REVEALED_VALUE = {
  kind: 'loseLife',
  amount: { kind: 'revealedCardManaValueThisResolution' },
  target: { kind: 'noTarget' },
} as const;

function darkTutelageInput(effects: readonly unknown[] = [REVEAL_TO_HAND, LOSE_REVEALED_VALUE]): CardInput {
  return {
    kind: 'enchantment',
    id: 'm11-090-dark-tutelage',
    name: 'Dark Tutelage',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 90 },
    manaCost: { generic: 2, B: 1 },
    colors: ['B'],
    abilities: [
      {
        kind: 'triggered',
        condition: 'beginningOfYourUpkeep',
        effects,
      },
    ],
  } as CardInput;
}

describe('Dark Tutelage DSL vocabulary', () => {
  it('parses and renders the current Oracle text exactly', () => {
    const card = parseCard(darkTutelageInput());

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.',
    );
  });

  it('keeps both linked pieces hand-authored and outside the generator answer schema', () => {
    expect(CardEffectSchema.safeParse(REVEAL_TO_HAND).success).toBe(true);
    expect(CardEffectSchema.safeParse(LOSE_REVEALED_VALUE).success).toBe(true);
    expect(ModelEffectSchema.safeParse(REVEAL_TO_HAND).success).toBe(false);
    expect(ModelEffectSchema.safeParse(LOSE_REVEALED_VALUE).success).toBe(false);
  });

  it('refuses a mana-value reader with no earlier revealed-card writer', () => {
    const result = safeParseCard(darkTutelageInput([LOSE_REVEALED_VALUE]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_REFERENT_AMOUNT',
        path: 'abilities[0].effects[0].amount.kind',
      }),
    );
  });

  it('refuses a mana-value reader that precedes its revealed-card writer', () => {
    const result = safeParseCard(darkTutelageInput([LOSE_REVEALED_VALUE, REVEAL_TO_HAND]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_REFERENT_AMOUNT',
        path: 'abilities[0].effects[0].amount.kind',
      }),
    );
  });
});
