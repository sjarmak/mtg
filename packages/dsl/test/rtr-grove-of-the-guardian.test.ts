import { describe, expect, it } from 'vitest';
import {
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  type AbilityInput,
  type CardInput,
} from '@mtg/dsl';

const ACTIVATION: AbilityInput = {
  kind: 'activated',
  printedSourceReference: 'thisLand',
  cost: {
    mana: { generic: 3, G: 1, W: 1 },
    printedManaPips: ['G', 'W'],
    tapSelf: true,
    tapMatching: { count: 2, filter: { cardTypes: ['creature'] } },
    sacrificeSelf: true,
  },
  effects: [
    {
      kind: 'createToken',
      count: 1,
      token: {
        name: 'Elemental',
        power: 8,
        toughness: 8,
        colors: ['G', 'W'],
        subtypes: ['Elemental'],
        keywords: ['vigilance'],
      },
    },
  ],
};

const GROVE: CardInput = {
  kind: 'land',
  id: 'rtr-240-grove-of-the-guardian',
  name: 'Grove of the Guardian',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 240 },
  producesMana: ['C'],
  abilities: [ACTIVATION],
};

describe('RTR #240 Grove of the Guardian', () => {
  it('renders exact current Oracle ordering and the source-kind sacrifice', () => {
    expect(renderOracleText(parseCard(GROVE))).toBe(
      [
        '{T}: Add {C}.',
        '{3}{G}{W}, {T}, Tap two untapped creatures you control, Sacrifice this land: Create an 8/8 green and white Elemental creature token with vigilance.',
      ].join('\n'),
    );
  });

  it('keeps the cohort payment and source presentation outside model abilities', () => {
    expect(ModelAbilitySchema.safeParse(ACTIVATION).success).toBe(false);
  });

  it('refuses the land-relative presentation on a source that is not a land', () => {
    const result = safeParseCard({
      kind: 'artifact',
      id: GROVE.id,
      name: GROVE.name,
      rarity: GROVE.rarity,
      set: GROVE.set,
      manaCost: {},
      colors: [],
      subtypes: [],
      abilities: GROVE.abilities,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('an artifact unexpectedly printed a land-relative sacrifice');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
          path: 'abilities[0].printedSourceReference',
        }),
      ]),
    );
  });
});
