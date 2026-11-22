/** Exact authoring contract for RTR Rakdos, Lord of Riots. */
import { parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

export const RAKDOS_LORD_OF_RIOTS_INPUT = {
  kind: 'creature',
  id: 'rtr-187-rakdos-lord-of-riots',
  name: 'Rakdos, Lord of Riots',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 187 },
  manaCost: { B: 2, R: 2 },
  colors: ['B', 'R'],
  supertypes: ['legendary'],
  subtypes: ['Demon'],
  power: 6,
  toughness: 6,
  keywords: ['flying', 'trample'],
  opponentsLifeLostThisTurnCasting: true,
} as const;

describe('Rakdos, Lord of Riots authoring', () => {
  it('renders all three current Oracle paragraphs in source order', () => {
    expect(renderOracleText(parseCard(RAKDOS_LORD_OF_RIOTS_INPUT))).toBe(
      "You can't cast Rakdos unless an opponent lost life this turn.\n" +
        'Flying, trample\n' +
        'Creature spells you cast cost {1} less to cast for each 1 life your opponents have lost this turn.',
    );
  });

  it('keeps the linked permission and dynamic reduction outside model output', async () => {
    const { FilledCardSchema } = await import('@mtg/setgen');
    expect(FilledCardSchema.safeParse(RAKDOS_LORD_OF_RIOTS_INPUT).success).toBe(false);
  });

  it('admits the capability only as one atomic creature-card bundle', () => {
    expect(() =>
      parseCard({
        ...RAKDOS_LORD_OF_RIOTS_INPUT,
        kind: 'instant',
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      }),
    ).toThrow();
  });
});
