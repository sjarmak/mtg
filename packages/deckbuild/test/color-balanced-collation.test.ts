import { describe, expect, it } from 'vitest';
import { openCollatedPool } from '../src/collation';

const colors = ['W', 'U', 'B', 'R', 'G'];
const cards = [
  ...colors.flatMap((color) =>
    Array.from({ length: 4 }, (_, index) => ({ id: `${color}${index}`, colors: [color] })),
  ),
  ...Array.from({ length: 4 }, (_, index) => ({ id: `other${index}`, colors: [] as string[] })),
];
const collation = {
  sheets: [
    {
      name: 'common',
      weights: Object.fromEntries(cards.map((card) => [card.id, 1])),
      foil: false,
      balanceColors: true,
    },
  ],
  boosters: [{ weight: 1, contents: { common: 10 } }],
};

describe('opt-in color-balanced printed sheets', () => {
  it('includes every mono color, no repeated printing, and deterministic shuffled slots', () => {
    const options = {
      seed: 'balanced/v1',
      boosters: 100,
      colorsOf: (card: (typeof cards)[number]) => card.colors,
    };
    const pool = openCollatedPool(cards, collation, options);
    expect(openCollatedPool(cards, collation, options)).toEqual(pool);
    for (const pack of pool.boosters) {
      expect(pack).toHaveLength(10);
      expect(new Set(pack.map((card) => card.id)).size).toBe(10);
      for (const color of colors) expect(pack.some((card) => card.colors.join('') === color)).toBe(true);
    }
    expect(new Set(pool.boosters.map((pack) => pack[0]?.colors.join(''))).size).toBeGreaterThan(3);
  });

  it('does not silently ignore a balance flag when colors are missing or the sheet cannot fill', () => {
    expect(() => openCollatedPool(cards, collation)).toThrow(/color.*resolver/i);
    expect(() => openCollatedPool(cards, collation, { colorsOf: () => [] })).toThrow(/color|balance/i);
    expect(() =>
      openCollatedPool(
        cards,
        { ...collation, boosters: [{ weight: 1, contents: { common: 4 } }] },
        { colorsOf: (card) => card.colors },
      ),
    ).toThrow(/five|5/);
  });

  it('compensates guaranteed mono-color slots to retain the other-card share', () => {
    const pool = openCollatedPool(cards, collation, {
      seed: 'balanced/density',
      boosters: 1000,
      colorsOf: (card) => card.colors,
    });
    const fraction = pool.cards.filter((card) => card.colors.length !== 1).length / pool.cards.length;
    expect(fraction).toBeGreaterThan(0.15);
    expect(fraction).toBeLessThan(0.18);
  });
});
