/** Exact hand-authored vocabulary and printed text for M11 Liliana Vess. */
import { describe, expect, it } from 'vitest';
import {
  LoyaltyModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  type CardInput,
} from '@mtg/dsl';

const LILIANA: CardInput = {
  kind: 'planeswalker',
  id: 'm11-liliana-vess',
  name: 'Liliana Vess',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 102 },
  manaCost: { generic: 3, B: 2 },
  colors: ['B'],
  supertypes: ['legendary'],
  subtypes: ['Liliana'],
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [{ kind: 'discardCards', count: 1, target: { kind: 'targetPlayer' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [
        {
          kind: 'searchLibrary',
          filter: {},
          destination: 'libraryTop',
          count: 1,
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -8,
      effects: [
        {
          kind: 'returnFromGraveyard',
          scope: 'creatureCardsInAllGraveyards',
          control: 'you',
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
};

describe('Liliana Vess DSL', () => {
  it('parses and renders all three current Oracle abilities exactly', () => {
    const card = parseCard(LILIANA);
    expect(renderOracleText(card)).toBe(
      '[+1]: Target player discards a card.\n' +
        '[−2]: Search your library for a card, then shuffle and put that card on top.\n' +
        '[−8]: Put all creature cards from all graveyards onto the battlefield under your control.',
    );
  });

  it('keeps the two new exact shapes hand-authored and outside model output', () => {
    const card = parseCard(LILIANA);
    if (card.kind !== 'planeswalker') throw new Error('Liliana did not parse as a planeswalker');
    for (const ability of card.abilities)
      expect(LoyaltyModelAbilitySchema.safeParse(ability).success).toBe(false);
    const tutor = card.abilities[1];
    const ultimate = card.abilities[2];
    if (tutor?.kind !== 'activated' || ultimate?.kind !== 'activated') {
      throw new Error('Liliana lost one of her loyalty abilities');
    }
    expect(ModelEffectSchema.safeParse(tutor.effects[0]).success).toBe(false);
    expect(ModelEffectSchema.safeParse(ultimate.effects[0]).success).toBe(false);
  });
});
