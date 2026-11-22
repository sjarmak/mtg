/** Demon of Death's Gate's hand-authored alternative casting cost. */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';

const DEMON = {
  kind: 'creature',
  id: 'm11-92-demon-of-deaths-gate',
  name: "Demon of Death's Gate",
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 92 },
  colors: ['B'],
  manaCost: { generic: 6, B: 3 },
  subtypes: ['Demon'],
  power: 9,
  toughness: 9,
  keywords: ['flying', 'trample'],
  alternativeCost: {
    payLife: 6,
    sacrificeMatching: {
      count: 3,
      filter: { cardTypes: ['creature'], colors: ['B'] },
    },
  },
} as unknown as CardInput;

describe("Demon of Death's Gate DSL", () => {
  it('parses the strict typed cost and renders current Oracle exactly', () => {
    const card = parseCard(DEMON);

    expect(card.kind).toBe('creature');
    if (card.kind !== 'creature') throw new Error('Demon did not parse as a creature');
    expect(card.alternativeCost).toEqual({
      payLife: 6,
      sacrificeMatching: {
        count: 3,
        filter: { cardTypes: ['creature'], colors: ['B'] },
      },
    });
    expect(card.keywords).toEqual(['flying', 'trample']);
    expect(renderOracleText(card)).toBe(
      [
        "You may pay 6 life and sacrifice three black creatures rather than pay this spell's mana cost.",
        'Flying, trample',
      ].join('\n'),
    );
  });

  it('refuses free, partial, and open-ended alternatives at the strict boundary', () => {
    const withAlternative = (alternativeCost: unknown): Record<string, unknown> => ({
      ...(DEMON as unknown as Record<string, unknown>),
      alternativeCost,
    });

    expect(
      safeParseCard(
        withAlternative({
          payLife: 0,
          sacrificeMatching: { count: 3, filter: { cardTypes: ['creature'], colors: ['B'] } },
        }),
      ).ok,
    ).toBe(false);
    expect(
      safeParseCard(
        withAlternative({
          payLife: 6,
          sacrificeMatching: { count: 0, filter: { cardTypes: ['creature'], colors: ['B'] } },
        }),
      ).ok,
    ).toBe(false);
    expect(
      safeParseCard(
        withAlternative({
          payLife: 6,
          sacrificeMatching: { count: 3, filter: { cardTypes: ['creature'], colors: ['B'] } },
          mana: {},
        }),
      ).ok,
    ).toBe(false);

    const instant: Record<string, unknown> = {
      ...(DEMON as unknown as Record<string, unknown>),
      kind: 'instant',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    };
    delete instant.power;
    delete instant.toughness;
    delete instant.subtypes;
    delete instant.keywords;
    expect(
      safeParseCard({
        ...instant,
        additionalCost: {
          sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
        },
      }).ok,
    ).toBe(false);
    expect(safeParseCard({ ...instant, manaCost: { hasX: true, B: 3 } }).ok).toBe(false);
  });
});
