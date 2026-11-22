/**
 * A battlefield count constrained by current card name, and the card-level
 * construction rule that is not an in-game ability. Relentless Rats needs both
 * shapes at once; accepting only one would make the card parse while still
 * changing either its layer-7c bonus or Constructed legality.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText } from '../src/index';

const RATS_INPUT = {
  id: 'm11-relentless-rats',
  name: 'Relentless Rats',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 113 },
  kind: 'creature',
  manaCost: { generic: 1, B: 2 },
  colors: ['B'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: {
        kind: 'statBonusPer',
        power: 1,
        toughness: 1,
        each: {
          kind: 'countMatching',
          filter: { cardTypes: ['creature'], names: ['Relentless Rats'] },
          whose: 'each',
          excludeSource: true,
        },
      },
    },
  ],
  deckConstruction: { kind: 'anyNumberOfThisCard' },
} as const;

describe('a count constrained by name', () => {
  it('parses the exact Relentless Rats shape and renders both clauses', () => {
    const card = parseCard(RATS_INPUT);

    expect(renderOracleText(card)).toBe(
      'Relentless Rats gets +1/+1 for each other creature on the battlefield named Relentless Rats.\n' +
        'A deck can have any number of cards named Relentless Rats.',
    );
  });

  it('keeps the name list nonempty instead of admitting a filter that means nothing', () => {
    expect(() =>
      parseCard({
        ...RATS_INPUT,
        abilities: [
          {
            ...RATS_INPUT.abilities[0],
            modification: {
              ...RATS_INPUT.abilities[0].modification,
              each: {
                ...RATS_INPUT.abilities[0].modification.each,
                filter: { cardTypes: ['creature'], names: [] },
              },
            },
          },
        ],
      }),
    ).toThrow(/names/u);
  });
});
