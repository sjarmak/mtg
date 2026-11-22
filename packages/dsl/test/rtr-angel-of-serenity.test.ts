/** Angel of Serenity's closed mixed-zone plural linked-exile bundle. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard } from '../src/index';

export const ANGEL_OF_SERENITY = {
  kind: 'creature',
  id: 'rtr-1-angel-of-serenity',
  name: 'Angel of Serenity',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 1 },
  manaCost: { generic: 4, W: 3 },
  colors: ['W'],
  power: 5,
  toughness: 6,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisCreature',
      optional: true,
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetPermanent',
            filter: { cardTypes: ['creature'] },
            excludeSource: true,
            count: 3,
          },
          linkToSource: true,
          creatureBattlefieldOrGraveyard: true,
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'moveSourceLinkedExile', destination: 'hand', plural: true }],
    },
  ],
} as const;

describe('Angel of Serenity DSL', () => {
  it('renders current Oracle exactly and stays outside the model', () => {
    const card = parseCard(ANGEL_OF_SERENITY);
    expect(renderOracleText(card)).toBe(
      'Flying\n' +
        'When this creature enters, you may exile up to three other target creatures from the battlefield and/or creature cards from graveyards.\n' +
        "When this creature leaves the battlefield, return the exiled cards to their owners' hands.",
    );
    expect(ModelEffectSchema.safeParse(ANGEL_OF_SERENITY.abilities[0].effects[0]).success).toBe(false);
  });

  it.each([
    { optional: undefined },
    {
      effects: [
        {
          ...ANGEL_OF_SERENITY.abilities[0].effects[0],
          target: { ...ANGEL_OF_SERENITY.abilities[0].effects[0].target, count: 2 },
        },
      ],
    },
    {
      effects: [
        {
          ...ANGEL_OF_SERENITY.abilities[0].effects[0],
          target: { ...ANGEL_OF_SERENITY.abilities[0].effects[0].target, excludeSource: undefined },
        },
      ],
    },
  ])('refuses a widened entry bundle %#', (change) => {
    const result = safeParseCard({
      ...ANGEL_OF_SERENITY,
      abilities: [{ ...ANGEL_OF_SERENITY.abilities[0], ...change }, ANGEL_OF_SERENITY.abilities[1]],
    });
    expect(result.ok).toBe(false);
  });

  it.each([{ plural: undefined }, { destination: 'battlefieldUnderOwner' }])(
    'refuses a widened linked return %#',
    (change) => {
      const result = safeParseCard({
        ...ANGEL_OF_SERENITY,
        abilities: [
          ANGEL_OF_SERENITY.abilities[0],
          {
            ...ANGEL_OF_SERENITY.abilities[1],
            effects: [{ ...ANGEL_OF_SERENITY.abilities[1].effects[0], ...change }],
          },
        ],
      });
      expect(result.ok).toBe(false);
    },
  );

  it('does not widen ordinary exile effects to plural creature targets', () => {
    const result = safeParseCard({
      kind: 'instant',
      id: 'plural-exile-without-angel-bundle',
      name: 'Plural Exile Without Angel Bundle',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { W: 1 },
      colors: ['W'],
      effects: [{ kind: 'exileTarget', target: { kind: 'targetCreature', count: 3 } }],
    });
    expect(result.ok).toBe(false);
  });
});
