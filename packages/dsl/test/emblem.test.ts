/** Persistent hand-authored emblems remain outside the generator vocabulary. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText } from '../src/index';

describe('createEmblem', () => {
  const effect = {
    kind: 'createEmblem' as const,
    emblem: {
      name: 'Liliana of the Dark Realms Emblem',
      grantsManaAbility: {
        filter: { cardTypes: ['land' as const], subtypes: ['Swamp'] },
        produces: ['B' as const],
        amount: 4,
      },
    },
  };

  it('parses and renders a filtered granted mana ability', () => {
    const card = parseCard({
      kind: 'planeswalker',
      id: 'tst-liliana-emblem',
      name: 'Liliana, Emblem Probe',
      rarity: 'mythic',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 2, B: 2 },
      colors: ['B'],
      supertypes: ['legendary'],
      subtypes: ['Liliana'],
      startingLoyalty: 3,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {} },
          loyaltyCost: -6,
          effects: [effect],
        },
      ],
    });

    expect(renderOracleText(card)).toBe(
      '[−6]: You get an emblem with "Swamps you control have \'{T}: Add {B}{B}{B}{B}.\'"',
    );
  });

  it('does not widen ModelEffectSchema', () => {
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });
});
