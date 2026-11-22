/** Gatecreeper Vine uses one search over an OR of complete printed qualities. */
import { CardFilterSchema, ModelEffectSchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

export const GATECREEPER_SEARCH = {
  kind: 'searchLibrary' as const,
  filter: {
    anyOf: [{ cardTypes: ['land' as const], supertypes: ['basic' as const] }, { subtypes: ['Gate'] }],
  },
  destination: 'hand' as const,
  reveal: true,
};

describe("Gatecreeper Vine's printed-quality search", () => {
  it('accepts only a nonempty whole-filter OR and keeps it hand-authored', () => {
    expect(CardFilterSchema.safeParse(GATECREEPER_SEARCH.filter).success).toBe(true);
    expect(CardFilterSchema.safeParse({ anyOf: [{}, { subtypes: ['Gate'] }] }).success).toBe(false);
    expect(
      CardFilterSchema.safeParse({
        cardTypes: ['land'],
        anyOf: [{ supertypes: ['basic'] }, { subtypes: ['Gate'] }],
      }).success,
    ).toBe(false);
    expect(ModelEffectSchema.safeParse(GATECREEPER_SEARCH).success).toBe(false);
  });

  it('renders the exact current Oracle ordering', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-124-gatecreeper-vine',
      name: 'Gatecreeper Vine',
      rarity: 'common',
      set: { code: 'RTR', collectorNumber: 124 },
      manaCost: { generic: 1, G: 1 },
      colors: ['G'],
      subtypes: ['Plant'],
      power: 0,
      toughness: 2,
      keywordAbilities: [{ kind: 'defender' }],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          optional: true,
          printedSourceReference: 'thisCreature',
          effects: [GATECREEPER_SEARCH],
        },
      ],
    });

    expect(renderOracleText(card)).toBe(
      'Defender\nWhen this creature enters, you may search your library for a basic land card or a Gate card, reveal it, put it into your hand, then shuffle.',
    );
  });
});
