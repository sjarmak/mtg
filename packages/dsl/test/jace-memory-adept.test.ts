/** Exact hand-authored vocabulary and printed text for M13 Jace, Memory Adept. */
import { describe, expect, it } from 'vitest';
import {
  LoyaltyModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  type CardInput,
} from '@mtg/dsl';

export const JACE_MEMORY_ADEPT: CardInput = {
  kind: 'planeswalker',
  id: 'm13-56-jace-memory-adept',
  name: 'Jace, Memory Adept',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 56 },
  manaCost: { generic: 3, U: 2 },
  colors: ['U'],
  supertypes: ['legendary'],
  subtypes: ['Jace'],
  startingLoyalty: 4,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
        { kind: 'millCards', count: 1, target: { kind: 'targetPlayer' } },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 0,
      effects: [{ kind: 'millCards', count: 10, target: { kind: 'targetPlayer' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -7,
      effects: [
        {
          kind: 'drawCards',
          count: 20,
          target: { kind: 'targetPlayer', anyNumber: true },
        },
      ],
    },
  ],
};

describe('Jace, Memory Adept DSL', () => {
  it('parses and renders all three current Oracle abilities exactly', () => {
    const card = parseCard(JACE_MEMORY_ADEPT);
    expect(renderOracleText(card)).toBe(
      '[+1]: Draw a card. Target player mills a card.\n' +
        '[0]: Target player mills ten cards.\n' +
        '[−7]: Any number of target players each draw twenty cards.',
    );
  });

  it('keeps plural player draws hand-authored and outside model output', () => {
    const card = parseCard(JACE_MEMORY_ADEPT);
    if (card.kind !== 'planeswalker') throw new Error('Jace did not parse as a planeswalker');
    const ultimate = card.abilities[2];
    if (ultimate?.kind !== 'activated') throw new Error('Jace lost his ultimate');
    expect(LoyaltyModelAbilitySchema.safeParse(ultimate).success).toBe(false);
    expect(ModelEffectSchema.safeParse(ultimate.effects[0]).success).toBe(false);
  });
});
