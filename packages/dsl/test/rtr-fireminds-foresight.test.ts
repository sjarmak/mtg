/** Exact strict-DSL authoring for RTR #162, Firemind's Foresight. */
import { describe, expect, it } from 'vitest';
import { CardFilterSchema, ModelEffectSchema, parseCard, renderOracleText, validateCard } from '../src/index';

const INPUT = {
  kind: 'instant',
  id: 'rtr-162',
  name: "Firemind's Foresight",
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 162 },
  colors: ['U', 'R'],
  manaCost: { generic: 5, U: 1, R: 1 },
  effects: [
    {
      kind: 'searchLibrary',
      filterQuotas: [3, 2, 1].map((manaValue) => ({
        filter: { cardTypes: ['instant'], manaValue },
        count: 1,
      })),
      destination: 'hand',
      reveal: true,
    },
  ],
} as const;

describe("Firemind's Foresight DSL", () => {
  it('accepts an exact mana-value filter without widening the model effect schema', () => {
    expect(CardFilterSchema.parse({ cardTypes: ['instant'], manaValue: 3 })).toEqual({
      cardTypes: ['instant'],
      manaValue: 3,
    });
    expect(CardFilterSchema.safeParse({ manaValue: 3, maxManaValue: 3 }).success).toBe(false);
    expect(
      CardFilterSchema.safeParse({
        anyOf: [{ cardTypes: ['instant'], manaValue: 3, maxManaValue: 3 }, { cardTypes: ['sorcery'] }],
      }).success,
    ).toBe(false);
    expect(ModelEffectSchema.safeParse(INPUT.effects[0]).success).toBe(false);
  });

  it('renders the three exact quotas in current Oracle order', () => {
    const card = parseCard(INPUT);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Search your library for an instant card with mana value 3, reveal it, and put it into your hand. Then repeat this process for instant cards with mana values 2 and 1. Then shuffle.',
    );
  });
});
