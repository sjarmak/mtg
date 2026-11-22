import { parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const INPUT = {
  kind: 'creature',
  id: 'm13-serra-avenger',
  name: 'Serra Avenger',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 33 },
  manaCost: { W: 2 },
  colors: ['W'],
  subtypes: ['Angel'],
  power: 3,
  toughness: 3,
  keywords: ['flying', 'vigilance'],
  castingRestriction: { kind: 'prohibitedPlayerTurns', turns: [1, 2, 3] },
} as const;

describe('M13 #33 Serra Avenger DSL', () => {
  it('authors the exact source card and Oracle text', () => {
    const card = parseCard(INPUT);
    expect(renderOracleText(card)).toBe(
      "You can't cast Serra Avenger during your first, second, or third turns of the game.\nFlying, vigilance",
    );
  });

  it('keeps the engine-only casting restriction out of model-authored cards', async () => {
    const { FilledCardSchema } = await import('@mtg/setgen');
    expect(FilledCardSchema.safeParse(INPUT).success).toBe(false);
  });

  it('rejects duplicate or unordered turn lists', () => {
    expect(() =>
      parseCard({ ...INPUT, castingRestriction: { kind: 'prohibitedPlayerTurns', turns: [1, 1] } }),
    ).toThrow();
    expect(() =>
      parseCard({ ...INPUT, castingRestriction: { kind: 'prohibitedPlayerTurns', turns: [2, 1] } }),
    ).toThrow();
  });
});
