/** Exact authoring contract for RTR Jarad, Golgari Lich Lord. */
import { ModelAbilitySchema, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

export const JARAD_INPUT = {
  kind: 'creature',
  id: 'rtr-174-jarad-golgari-lich-lord',
  name: 'Jarad, Golgari Lich Lord',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 174 },
  manaCost: { B: 2, G: 2 },
  colors: ['B', 'G'],
  supertypes: ['legendary'],
  subtypes: ['Zombie', 'Elf'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      printedSubjectReference: 'cardNameBeforeComma',
      modification: {
        kind: 'statBonusPer',
        power: 1,
        toughness: 1,
        each: {
          kind: 'countMatching',
          filter: { cardTypes: ['creature'] },
          whose: 'you',
          zone: 'controllerGraveyard',
        },
      },
    },
    {
      kind: 'activated',
      cost: {
        mana: { generic: 1, B: 1, G: 1 },
        sacrificeMatching: {
          count: 1,
          excludeSource: true,
          filter: { cardTypes: ['creature'] },
        },
      },
      effects: [
        {
          kind: 'loseLife',
          amount: { kind: 'paidSacrificePower' },
          players: 'eachOpponent',
          target: { kind: 'noTarget' },
        },
      ],
    },
    {
      kind: 'activated',
      activationZone: 'graveyard',
      printedSourceReference: 'thisCard',
      cost: { mana: {}, sacrificeLandSubtypePair: ['Swamp', 'Forest'] },
      effects: [{ kind: 'returnSourceFromGraveyard', destination: 'hand' }],
    },
  ],
} as const satisfies CardInput;

describe('Jarad, Golgari Lich Lord authoring', () => {
  it('renders all current Oracle clauses in source order', () => {
    expect(renderOracleText(parseCard(JARAD_INPUT))).toBe(
      'Jarad gets +1/+1 for each creature card in your graveyard.\n' +
        "{1}{B}{G}, Sacrifice another creature: Each opponent loses life equal to the sacrificed creature's power.\n" +
        'Sacrifice a Swamp and a Forest: Return this card from your graveyard to your hand.',
    );
  });

  it('keeps all three authored clauses outside model output', () => {
    for (const ability of JARAD_INPUT.abilities) {
      expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    }
  });

  it('rejects one permanent offered as both subtype payments at the schema boundary', () => {
    expect(() =>
      parseCard({
        ...JARAD_INPUT,
        abilities: [
          ...JARAD_INPUT.abilities.slice(0, 2),
          {
            ...JARAD_INPUT.abilities[2],
            cost: { mana: {}, sacrificeLandSubtypePair: ['Swamp', 'Swamp'] },
          },
        ],
      }),
    ).toThrow();
  });

  it('keeps the graveyard tally and land pair as closed capability bundles', () => {
    const staticAbility = JARAD_INPUT.abilities[0];
    expect(() =>
      parseCard({
        ...JARAD_INPUT,
        abilities: [
          {
            ...staticAbility,
            modification: {
              ...staticAbility.modification,
              each: {
                ...staticAbility.modification.each,
                filter: { cardTypes: ['land'] },
              },
            },
          },
          ...JARAD_INPUT.abilities.slice(1),
        ],
      }),
    ).toThrow(/controller-graveyard tally/u);

    const returnAbility = JARAD_INPUT.abilities[2];
    expect(() =>
      parseCard({
        ...JARAD_INPUT,
        abilities: [
          ...JARAD_INPUT.abilities.slice(0, 2),
          {
            ...returnAbility,
            cost: {
              ...returnAbility.cost,
              sacrificeMatching: { count: 1, filter: { cardTypes: ['land'] } },
            },
          },
        ],
      }),
    ).toThrow(/complete sacrifice predicate/u);
  });
});
