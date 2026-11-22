/** Exact authoring contract for RTR Azor's Elocutors. */
import { parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

export const AZORS_ELOCUTORS_INPUT = {
  kind: 'creature',
  id: 'rtr-210-azors-elocutors',
  name: "Azor's Elocutors",
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 210 },
  manaCost: { generic: 3, hybrid: { 'W/U': 2 } },
  colors: ['W', 'U'],
  subtypes: ['Human', 'Advisor'],
  power: 3,
  toughness: 5,
  keywords: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [{ kind: 'putCounters', counter: 'filibuster', count: 1, target: { kind: 'selfPermanent' } }],
      putCounterThenWinAtThreshold: { counter: 'filibuster', atLeast: 5 },
      printedSourceReference: 'thisCreature',
    },
    {
      kind: 'triggered',
      condition: 'selfIsDealtDamage',
      effects: [],
      controllerDamageRemovesSourceCounter: { counter: 'filibuster' },
      printedSourceReference: 'thisCreature',
    },
  ],
} as const;

describe("Azor's Elocutors authoring", () => {
  it('renders both current Oracle paragraphs in source order', () => {
    expect(renderOracleText(parseCard(AZORS_ELOCUTORS_INPUT))).toBe(
      'At the beginning of your upkeep, put a filibuster counter on this creature. Then if this creature has five or more filibuster counters on it, you win the game.\n' +
        'Whenever a source deals damage to you, remove a filibuster counter from this creature.',
    );
  });

  it('keeps the linked counter race outside model output', async () => {
    const { FilledCardSchema } = await import('@mtg/setgen');
    expect(FilledCardSchema.safeParse(AZORS_ELOCUTORS_INPUT).success).toBe(false);
  });

  it('rejects either half outside its exact carrier condition', () => {
    const malformed = {
      ...AZORS_ELOCUTORS_INPUT,
      abilities: [
        { ...AZORS_ELOCUTORS_INPUT.abilities[0], condition: 'selfEnters' },
        AZORS_ELOCUTORS_INPUT.abilities[1],
      ],
    };
    expect(() => parseCard(malformed)).toThrow();
  });

  it('requires both counter-race clauses and one shared counter kind', () => {
    expect(() =>
      parseCard({ ...AZORS_ELOCUTORS_INPUT, abilities: [AZORS_ELOCUTORS_INPUT.abilities[0]] }),
    ).toThrow(/source counter race/u);
    expect(() =>
      parseCard({
        ...AZORS_ELOCUTORS_INPUT,
        abilities: [
          AZORS_ELOCUTORS_INPUT.abilities[0],
          {
            ...AZORS_ELOCUTORS_INPUT.abilities[1],
            controllerDamageRemovesSourceCounter: { counter: 'plusOnePlusOne' },
          },
        ],
      }),
    ).toThrow(/source counter race/u);
  });
});
