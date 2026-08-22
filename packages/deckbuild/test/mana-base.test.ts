import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Color } from '@mtg/dsl';
import { BASIC_LANDS, isLand, parseCard } from '@mtg/dsl';
import {
  buildChosenManaBase,
  buildManaBase,
  DEFAULT_SCORE_WEIGHTS,
  demandedColors,
  dominantSetCode,
  evaluatePool,
  hypergeometricAtLeast,
  measureDemand,
  minSourcesFor,
  resolveConfig,
} from '@mtg/deckbuild';
import type { BasicLandCounts } from '@mtg/deckbuild';

const CONFIG = resolveConfig();

function costCard(index: number, color: Color, pips: number, manaValue: number): Card {
  const cost: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  cost[color] = pips;
  return parseCard({
    kind: 'creature',
    id: `mb-${index}`,
    name: `Mana Base ${index}`,
    rarity: 'common',
    set: { code: 'MBT', collectorNumber: index + 1 },
    manaCost: { generic: manaValue - pips, ...cost },
    colors: [color],
    power: Math.max(1, manaValue - 1),
    toughness: Math.max(1, manaValue - 1),
  } satisfies CardInput);
}

function colorlessCard(index: number, manaValue: number): Card {
  return parseCard({
    kind: 'creature',
    id: `mbc-${index}`,
    name: `Colorless ${index}`,
    rarity: 'common',
    set: { code: 'MBT', collectorNumber: index + 500 },
    manaCost: { generic: manaValue },
    artifact: true,
    power: 2,
    toughness: 2,
  } satisfies CardInput);
}

function manaBaseFor(spellCards: readonly Card[], colors: readonly Color[], pool: readonly Card[] = []) {
  const evaluated = evaluatePool(spellCards, DEFAULT_SCORE_WEIGHTS);
  return buildManaBase(evaluated, colors, pool, CONFIG);
}

describe('measureDemand', () => {
  it('counts pips and records the earliest and heaviest requirement per color', () => {
    const spells = [costCard(1, 'R', 1, 2), costCard(2, 'R', 2, 5), costCard(3, 'G', 1, 4)];
    const demand = measureDemand(evaluatePool(spells, DEFAULT_SCORE_WEIGHTS), CONFIG.manaBase);
    expect(demand.R.pipCount).toBe(3);
    expect(demand.R.earliest?.manaValue).toBe(2);
    expect(demand.R.heaviest?.pips).toBe(2);
    expect(demand.G.pipCount).toBe(1);
    expect(demand.U.pipCount).toBe(0);
    expect(demand.U.earliest).toBeUndefined();
  });

  it('weights early pips more heavily than late ones', () => {
    const early = measureDemand(
      evaluatePool([costCard(1, 'R', 1, 1)], DEFAULT_SCORE_WEIGHTS),
      CONFIG.manaBase,
    );
    const late = measureDemand(
      evaluatePool([costCard(2, 'R', 1, 6)], DEFAULT_SCORE_WEIGHTS),
      CONFIG.manaBase,
    );
    expect(early.R.weightedDemand).toBeGreaterThan(late.R.weightedDemand);
  });
});

describe('buildManaBase', () => {
  it('always produces exactly the configured land count', () => {
    const spells = [
      ...Array.from({ length: 14 }, (_unused, index) => costCard(index, 'R', 1, 2 + (index % 4))),
      ...Array.from({ length: 9 }, (_unused, index) => costCard(index + 100, 'G', 1, 2 + (index % 3))),
    ];
    const manaBase = manaBaseFor(spells, ['R', 'G']);
    expect(manaBase.lands).toHaveLength(CONFIG.landCount);
    expect(manaBase.landsByColor.R + manaBase.landsByColor.G).toBe(CONFIG.landCount);
  });

  it('splits by pip demand rather than evenly', () => {
    const spells = [
      ...Array.from({ length: 17 }, (_unused, index) => costCard(index, 'R', 1, 2)),
      ...Array.from({ length: 6 }, (_unused, index) => costCard(index + 100, 'G', 1, 2)),
    ];
    const manaBase = manaBaseFor(spells, ['R', 'G']);
    expect(manaBase.landsByColor.R).toBeGreaterThan(manaBase.landsByColor.G);
    expect(manaBase.landsByColor.R).toBeGreaterThan(9);
    expect(manaBase.landsByColor.R + manaBase.landsByColor.G).toBe(17);
  });

  it('follows double pips: the same card count with heavier pips takes more sources', () => {
    const singlePip = manaBaseFor(
      [
        ...Array.from({ length: 12 }, (_unused, index) => costCard(index, 'R', 1, 3)),
        ...Array.from({ length: 11 }, (_unused, index) => costCard(index + 100, 'U', 1, 3)),
      ],
      ['U', 'R'],
    );
    const doublePip = manaBaseFor(
      [
        ...Array.from({ length: 12 }, (_unused, index) => costCard(index, 'R', 2, 3)),
        ...Array.from({ length: 11 }, (_unused, index) => costCard(index + 100, 'U', 1, 3)),
      ],
      ['U', 'R'],
    );
    expect(doublePip.landsByColor.R).toBeGreaterThan(singlePip.landsByColor.R);
  });

  it('floors a pip-light but real second color instead of shaving it to a splash', () => {
    const spells = [
      ...Array.from({ length: 18 }, (_unused, index) => costCard(index, 'W', 1, 2)),
      ...Array.from({ length: 5 }, (_unused, index) => costCard(index + 100, 'B', 1, 5)),
    ];
    const manaBase = manaBaseFor(spells, ['W', 'B']);
    expect(manaBase.landsByColor.B).toBeGreaterThanOrEqual(CONFIG.manaBase.minSourcesPerColor);
    expect(manaBase.shortfalls).toHaveLength(0);
  });

  it('gives every land to the color that is actually played', () => {
    const spells = Array.from({ length: 23 }, (_unused, index) => costCard(index, 'B', 1, 2 + (index % 4)));
    const manaBase = manaBaseFor(spells, ['U', 'B']);
    expect(manaBase.landsByColor.B).toBe(17);
    expect(manaBase.landsByColor.U).toBe(0);
    expect(manaBase.shortfalls).toHaveLength(0);
  });

  it('splits evenly when the deck has no colored pips at all', () => {
    const spells = Array.from({ length: 23 }, (_unused, index) => colorlessCard(index, 2 + (index % 4)));
    const manaBase = manaBaseFor(spells, ['W', 'U']);
    expect(manaBase.landsByColor.W).toBe(9);
    expect(manaBase.landsByColor.U).toBe(8);
  });

  it('reports the shortfall when the floors cannot all be met', () => {
    const spells = [
      ...Array.from({ length: 12 }, (_unused, index) => costCard(index, 'W', 1, 2)),
      ...Array.from({ length: 11 }, (_unused, index) => costCard(index + 100, 'U', 1, 2)),
    ];
    const evaluated = evaluatePool(spells, DEFAULT_SCORE_WEIGHTS);
    const tightConfig = resolveConfig({ manaBase: { minSourcesPerColor: 12 } });
    const manaBase = buildManaBase(evaluated, ['W', 'U'], [], tightConfig);
    expect(manaBase.lands).toHaveLength(17);
    expect(manaBase.shortfalls.length).toBeGreaterThan(0);
    expect(manaBase.shortfalls[0]?.kind).toBe('colorSources');
  });

  it('reports castability against the Karsten target', () => {
    const spells = [
      ...Array.from({ length: 12 }, (_unused, index) => costCard(index, 'R', 1, 2)),
      ...Array.from({ length: 11 }, (_unused, index) => costCard(index + 100, 'G', 1, 4)),
    ];
    const manaBase = manaBaseFor(spells, ['R', 'G']);
    const red = manaBase.reports.find((report) => report.color === 'R');
    expect(red).toBeDefined();
    expect(red?.earliestCastability).toBeGreaterThan(0);
    expect(red?.earliestCastability).toBeLessThanOrEqual(1);
    expect(red?.earliest?.manaValue).toBe(2);
    // More sources than the rest of the deck would be needed to clear 90% on a
    // turn-two color requirement, so the flag must be honest about missing it.
    expect(red?.meetsCastabilityTarget).toBe(red !== undefined && red.earliestCastability >= 0.9);
  });

  it('prefers the pool’s own basics and synthesizes them otherwise', () => {
    const spells = Array.from({ length: 23 }, (_unused, index) => costCard(index, 'G', 1, 2));
    const withPoolLands = manaBaseFor(spells, ['R', 'G'], [...BASIC_LANDS]);
    expect(withPoolLands.lands.every((land) => BASIC_LANDS.includes(land))).toBe(true);

    const synthesized = manaBaseFor(spells, ['R', 'G'], spells);
    expect(synthesized.lands).toHaveLength(17);
    for (const land of synthesized.lands) {
      expect(isLand(land)).toBe(true);
      if (isLand(land)) {
        expect(land.basicLandType).toBe('Forest');
        expect(land.set.code).toBe('MBT');
      }
    }
  });
});

describe('more colors than a pair', () => {
  const threeColors = [
    ...Array.from({ length: 9 }, (_unused, index) => costCard(index, 'W', 1, 2)),
    ...Array.from({ length: 9 }, (_unused, index) => costCard(index + 100, 'R', 1, 2)),
    ...Array.from({ length: 5 }, (_unused, index) => costCard(index + 200, 'G', 1, 3)),
  ];

  it('apportions across every color it is given', () => {
    const manaBase = manaBaseFor(threeColors, ['W', 'R', 'G']);
    expect(manaBase.lands).toHaveLength(CONFIG.landCount);
    expect(manaBase.landsByColor.W).toBeGreaterThan(0);
    expect(manaBase.landsByColor.R).toBeGreaterThan(0);
    expect(manaBase.landsByColor.G).toBeGreaterThan(0);
    expect(manaBase.reports).toHaveLength(3);
  });

  it('reports a demanded color the caller left out instead of ignoring it', () => {
    // Left out, not paid: the split is the caller's two colors, and the third
    // color's demand comes back as a shortfall rather than vanishing.
    const manaBase = manaBaseFor(threeColors, ['W', 'R']);
    expect(manaBase.landsByColor.G).toBe(0);
    expect(manaBase.lands).toHaveLength(CONFIG.landCount);
    expect(manaBase.shortfalls).toContainEqual({
      kind: 'colorSources',
      color: 'G',
      target: CONFIG.manaBase.minSourcesPerColor,
      achieved: 0,
      missing: CONFIG.manaBase.minSourcesPerColor,
    });
  });

  it('names the colors a spell list demands', () => {
    const demand = measureDemand(evaluatePool(threeColors, DEFAULT_SCORE_WEIGHTS), CONFIG.manaBase);
    expect(demandedColors(demand)).toEqual(['W', 'R', 'G']);
  });
});

describe('buildChosenManaBase', () => {
  const spells = [
    ...Array.from({ length: 12 }, (_unused, index) => costCard(index, 'B', 1, 2)),
    ...Array.from({ length: 11 }, (_unused, index) => costCard(index + 100, 'G', 1, 3)),
  ];

  function chosen(basics: BasicLandCounts) {
    return buildChosenManaBase(evaluatePool(spells, DEFAULT_SCORE_WEIGHTS), basics, [], CONFIG);
  }

  it('prints the counts it was handed and no others', () => {
    const manaBase = chosen({ B: 10, G: 6, R: 1 });
    expect(manaBase.landsByColor).toEqual({ W: 0, U: 0, B: 10, R: 1, G: 6 });
    expect(manaBase.lands).toHaveLength(17);
  });

  it('does not rebalance a base that is short, it says so', () => {
    const manaBase = chosen({ B: 15, G: 2 });
    expect(manaBase.landsByColor.G).toBe(2);
    expect(manaBase.shortfalls).toContainEqual({
      kind: 'colorSources',
      color: 'G',
      target: CONFIG.manaBase.minSourcesPerColor,
      achieved: 2,
      missing: CONFIG.manaBase.minSourcesPerColor - 2,
    });
  });

  it('measures castability the same way the apportioned base is measured', () => {
    const counted = chosen({ B: 9, G: 8 });
    const apportioned = manaBaseFor(spells, ['B', 'G']);
    const countedBlack = counted.reports.find((report) => report.color === 'B');
    const apportionedBlack = apportioned.reports.find((report) => report.color === 'B');

    expect(countedBlack?.demandShare).toBeCloseTo(apportionedBlack?.demandShare ?? -1, 10);
    expect(countedBlack?.sources).toBe(9);
    expect(countedBlack?.earliestCastability).toBeGreaterThan(0);
  });

  it('reports a color with sources the deck does not demand, rather than dropping the land', () => {
    const manaBase = chosen({ B: 9, G: 7, U: 1 });
    const blue = manaBase.reports.find((report) => report.color === 'U');
    expect(blue?.sources).toBe(1);
    expect(blue?.pipCount).toBe(0);
    expect(manaBase.lands).toHaveLength(17);
  });

  it('refuses a count that is not a whole number of lands', () => {
    expect(() => chosen({ B: 1.5 })).toThrow(/non-negative integer/);
    expect(() => chosen({ B: -3 })).toThrow(/non-negative integer/);
  });
});

/**
 * The mtg-bc2.67 decision, kept falsifiable.
 *
 * decklab derives each color's floor by inverting the same hypergeometric
 * predicate it reports against; this file uses a share threshold instead. These
 * are the numbers that decide which a format can afford, so a change to the
 * draw model that makes the inversion reachable at 40 cards fails here rather
 * than leaving the module docstring quietly wrong.
 */
describe('why 40-card Limited keeps a share threshold', () => {
  /** Cards seen by the turn a card of this mana value wants to be cast, on the play. */
  const cardsSeen = (manaValue: number): number => 7 + Math.max(0, Math.ceil(manaValue) - 1);

  it('cannot pay two colors the floor its cheapest card alone asks for', () => {
    // One source by turn two is ten of forty; a turn-one card wants eleven.
    // Either way two colors want more than the seventeen lands there are.
    expect(minSourcesFor(1, 0.9, cardsSeen(1), 40)).toBe(11);
    expect(minSourcesFor(1, 0.9, cardsSeen(2), 40)).toBe(10);
    expect(2 * minSourcesFor(1, 0.9, cardsSeen(2), 40)).toBeGreaterThan(CONFIG.landCount);
  });

  it('cannot pay a double pip its floor at either band', () => {
    expect(minSourcesFor(2, 0.9, cardsSeen(2), 40)).toBe(16);
    // 0.8 is the band decklab holds heavy requirements to; thirteen of
    // seventeen lands for one color is not a two-color mana base either.
    expect(minSourcesFor(2, 0.8, cardsSeen(2), 40)).toBe(13);
  });

  it('holds a floor that is anti-degeneracy rather than castability', () => {
    // Six sources is 76% for a two-drop, not 90%. The threshold exists to stop
    // demand apportionment rounding a real second color down to a splash.
    const chance = hypergeometricAtLeast(1, CONFIG.manaBase.minSourcesPerColor, cardsSeen(2), 40);
    expect(chance).toBeCloseTo(0.7639, 4);
    expect(chance).toBeLessThan(CONFIG.manaBase.castabilityTarget);
  });
});

describe('dominantSetCode', () => {
  it('takes the most common code, breaking ties alphabetically', () => {
    expect(dominantSetCode([costCard(1, 'R', 1, 2), costCard(2, 'R', 1, 2)])).toBe('MBT');
    expect(dominantSetCode([])).toBe('BAS');
  });
});
