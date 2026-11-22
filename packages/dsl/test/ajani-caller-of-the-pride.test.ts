/** Exact hand-authored vocabulary and printed text for M13 Ajani, Caller of the Pride. */
import { describe, expect, it } from 'vitest';
import {
  LoyaltyModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  type CardInput,
} from '@mtg/dsl';

export const AJANI_CALLER_OF_THE_PRIDE: CardInput = {
  kind: 'planeswalker',
  id: 'm13-1-ajani-caller-of-the-pride',
  name: 'Ajani, Caller of the Pride',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 1 },
  manaCost: { generic: 1, W: 2 },
  colors: ['W'],
  supertypes: ['legendary'],
  subtypes: ['Ajani'],
  startingLoyalty: 4,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'targetCreature', count: 1 },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -3,
      effects: [
        {
          kind: 'grantKeywordUntilEndOfTurn',
          keyword: 'flying',
          additionalKeywords: ['doubleStrike'],
          target: { kind: 'targetCreature' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -8,
      effects: [
        {
          kind: 'createToken',
          count: { kind: 'controllerLifeTotal' },
          token: {
            name: 'Cat',
            power: 2,
            toughness: 2,
            colors: ['W'],
            subtypes: ['Cat'],
            keywords: [],
          },
        },
      ],
    },
  ],
};

describe('Ajani, Caller of the Pride DSL', () => {
  it('parses and renders all three current Oracle abilities exactly', () => {
    const card = parseCard(AJANI_CALLER_OF_THE_PRIDE);
    expect(renderOracleText(card)).toBe(
      '[+1]: Put a +1/+1 counter on up to one target creature.\n' +
        '[−3]: Target creature gains flying and double strike until end of turn.\n' +
        '[−8]: Create X 2/2 white Cat creature tokens, where X is your life total.',
    );
  });

  it('keeps optional targeting and a live life-total count outside model output', () => {
    const card = parseCard(AJANI_CALLER_OF_THE_PRIDE);
    if (card.kind !== 'planeswalker') throw new Error('Ajani did not parse as a planeswalker');
    const plus = card.abilities[0];
    const ultimate = card.abilities[2];
    if (plus?.kind !== 'activated' || ultimate?.kind !== 'activated') {
      throw new Error('Ajani lost a loyalty ability');
    }
    expect(LoyaltyModelAbilitySchema.safeParse(plus).success).toBe(false);
    expect(ModelEffectSchema.safeParse(plus.effects[0]).success).toBe(false);
    expect(ModelEffectSchema.safeParse(ultimate.effects[0]).success).toBe(false);
  });
});
