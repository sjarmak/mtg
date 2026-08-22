import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { EXAMPLE_CARDS, cardManaValue, isLand } from '@mtg/dsl';
import type { DeckBuildResult } from '@mtg/deckbuild';
import {
  buildDeck,
  cardColors,
  CURVE_BUCKETS,
  curveTotal,
  deckColors,
  formatDeckReport,
  hasShortfall,
  spellCount,
} from '@mtg/deckbuild';
import { makeMixedPool, makeSyntheticPool } from './helpers/pool';

/** Seeds used for the property-style sweep. */
const SEEDS = Array.from({ length: 25 }, (_unused, index) => index + 1);

function deckIds(result: DeckBuildResult): string[] {
  return result.deck.map((card) => card.id);
}

describe('buildDeck over randomized pools', () => {
  it.each(SEEDS)('seed %i builds a legal 40-card, 17-land deck', (seed) => {
    const pool = makeMixedPool(seed);
    const result = buildDeck(pool);

    expect(result.deck).toHaveLength(result.config.deckSize);
    expect(result.lands).toHaveLength(result.config.landCount);
    expect(result.spells).toHaveLength(spellCount(result.config));
    expect(result.lands.every(isLand)).toBe(true);
    expect(result.spells.every((card) => !isLand(card))).toBe(true);
  });

  it.each(SEEDS)('seed %i keeps color discipline: no off-pair spell, no off-pair land', (seed) => {
    const result = buildDeck(makeMixedPool(seed));
    const pair: readonly string[] = result.colorPair;

    for (const spell of result.spells) {
      for (const color of cardColors(spell)) {
        expect(pair).toContain(color);
      }
    }
    for (const land of result.lands) {
      if (!isLand(land)) throw new Error('land list contained a non-land');
      for (const produced of land.producesMana) {
        expect(pair).toContain(produced);
      }
    }
    for (const color of deckColors(result)) {
      expect(pair).toContain(color);
    }
  });

  it.each(SEEDS)('seed %i respects the curve and creature invariants', (seed) => {
    const result = buildDeck(makeMixedPool(seed));

    expect(curveTotal(result.curve.achieved)).toBe(result.spells.length);
    for (const bucket of CURVE_BUCKETS) {
      const slot = result.curve.slots.find((entry) => entry.bucket === bucket);
      expect(slot?.achieved).toBe(result.curve.achieved[bucket]);
      expect(slot?.delta).toBe(result.curve.achieved[bucket] - result.curve.target[bucket]);
    }

    // A sealed-sized pool always supports the mass; if it ever cannot, the gap
    // must be reported rather than silently absorbed.
    if (!hasShortfall(result.shortfalls, 'curveSlot')) {
      expect(result.curve.massTwoToFour).toBe(17);
      expect(result.curve.topEnd).toBe(3);
    }
    if (!hasShortfall(result.shortfalls, 'creatureFloor')) {
      expect(result.creatureCount).toBeGreaterThanOrEqual(result.config.minCreatures);
    }
  });

  it.each(SEEDS)('seed %i never plays the same pool card twice', (seed) => {
    const result = buildDeck(makeMixedPool(seed));
    const indices = result.picks.map((pick) => pick.poolIndex);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it.each(SEEDS)('seed %i apportions every land to a color the deck casts', (seed) => {
    const result = buildDeck(makeMixedPool(seed));
    const assigned = Object.values(result.manaBase.landsByColor).reduce((sum, count) => sum + count, 0);
    expect(assigned).toBe(result.config.landCount);
    for (const report of result.manaBase.reports) {
      if (report.pipCount === 0) continue;
      expect(report.sources).toBeGreaterThan(0);
      expect(report.demandShare).toBeGreaterThan(0);
    }
  });

  it('produces different decks for different pools', () => {
    const decks = new Set(SEEDS.map((seed) => deckIds(buildDeck(makeMixedPool(seed))).join(',')));
    expect(decks.size).toBeGreaterThan(SEEDS.length / 2);
  });
});

describe('determinism', () => {
  it('returns an identical deck for a fixed pool and config', () => {
    const pool = makeMixedPool(1234);
    const first = buildDeck(pool);
    const second = buildDeck(pool);
    expect(deckIds(first)).toEqual(deckIds(second));
    expect(first.colorPair).toEqual(second.colorPair);
    expect(first.manaBase.landsByColor).toEqual(second.manaBase.landsByColor);
    expect(first.picks.map((pick) => pick.score)).toEqual(second.picks.map((pick) => pick.score));
  });

  it('does not depend on the pool being freshly constructed', () => {
    const first = buildDeck(makeMixedPool(77));
    const second = buildDeck(makeMixedPool(77));
    expect(deckIds(first)).toEqual(deckIds(second));
  });

  it('is sensitive to weights: raising the removal premium changes the picks', () => {
    const pool = makeMixedPool(5);
    const base = buildDeck(pool);
    const removalHeavy = buildDeck(pool, { weights: { removalPremium: 12 } });
    expect(removalHeavy.removalCount).toBeGreaterThanOrEqual(base.removalCount);
    expect(deckIds(removalHeavy)).not.toEqual(deckIds(base));
  });
});

describe('graceful degradation', () => {
  it('reports every gap and still ships the full land count on a starved pool', () => {
    const pool = makeSyntheticPool(9, { size: 14, palette: ['R'] });
    const result = buildDeck(pool);

    expect(result.complete).toBe(false);
    expect(hasShortfall(result.shortfalls, 'spellSlots')).toBe(true);
    expect(result.lands).toHaveLength(result.config.landCount);
    expect(result.deck).toHaveLength(result.lands.length + result.spells.length);
    expect(result.spells.length).toBeLessThan(spellCount(result.config));
  });

  it('reports the creature floor when the pool has almost no creatures', () => {
    const spellsOnly = makeSyntheticPool(3, { size: 400 }).filter(
      (card) => card.kind === 'instant' || card.kind === 'sorcery',
    );
    const result = buildDeck(spellsOnly);
    expect(result.creatureCount).toBe(0);
    expect(hasShortfall(result.shortfalls, 'creatureFloor')).toBe(true);
    expect(result.complete).toBe(false);
  });

  it('reports curve gaps when the pool has no expensive cards', () => {
    const cheapOnly = makeSyntheticPool(4, { size: 400 }).filter((card) => cardManaValue(card) <= 2);
    const result = buildDeck(cheapOnly);
    expect(hasShortfall(result.shortfalls, 'curveSlot')).toBe(true);
    expect(result.curve.achieved[5]).toBe(0);
    expect(result.curve.achieved[6]).toBe(0);
    // The slots are refilled from the cheap end rather than left empty.
    expect(result.spells).toHaveLength(spellCount(result.config));
  });

  it('marks a well-supplied build complete', () => {
    const result = buildDeck(makeMixedPool(2, { size: 200 }));
    expect(result.shortfalls).toEqual([]);
    expect(result.complete).toBe(true);
  });
});

describe('input validation', () => {
  it('rejects an empty pool', () => {
    expect(() => buildDeck([])).toThrow(/pool is empty/);
  });

  it('rejects a target curve that does not match the spell count', () => {
    expect(() => buildDeck(EXAMPLE_CARDS, { targetCurve: { 2: 1 } })).toThrow(/targetCurve sums to/);
  });

  it('rejects a land count that leaves no room for spells', () => {
    expect(() => buildDeck(EXAMPLE_CARDS, { landCount: 40 })).toThrow(/no room for spells/);
  });

  it('rejects a curve priority that skips a bucket', () => {
    expect(() => buildDeck(EXAMPLE_CARDS, { curvePriority: [2, 3, 4] })).toThrow(/every bucket/);
  });

  it('accepts a smaller deck when the whole shape is given consistently', () => {
    const result = buildDeck(makeMixedPool(6), {
      deckSize: 30,
      landCount: 12,
      minCreatures: 8,
      targetCurve: { 0: 0, 1: 2, 2: 6, 3: 5, 4: 3, 5: 1, 6: 1 },
    });
    expect(result.deck).toHaveLength(30);
    expect(result.lands).toHaveLength(12);
    expect(result.spells).toHaveLength(18);
  });
});

describe('result surface', () => {
  it('carries the color-pair ranking, pool color counts and sideboard', () => {
    const pool = makeMixedPool(8);
    const result = buildDeck(pool);

    expect(result.colorPairs).toHaveLength(10);
    expect(result.colorPairs[0]?.pair).toEqual(result.colorPair);

    const totalNonLand = pool.filter((card: Card) => !isLand(card)).length;
    const counted =
      Object.values(result.poolColors.byColor).reduce((sum, count) => sum + count, 0) +
      result.poolColors.colorless;
    // Every non-land card is counted once per color; the slice DSL has no gold
    // cards, so the totals match exactly.
    expect(counted).toBe(totalNonLand);

    expect(result.picks).toHaveLength(result.spells.length);
    expect(result.sideboard.every((pick) => !result.picks.includes(pick))).toBe(true);
  });

  it('renders a report naming the colors, curve, mana base and shortfalls', () => {
    const built = buildDeck(makeMixedPool(12));
    const report = formatDeckReport(built);
    expect(report).toContain('Deck: 40 cards');
    expect(report).toContain('Curve (achieved/target)');
    expect(report).toContain('Mana base:');
    expect(report).toContain('Shortfalls:');
    expect(report.split('\n').length).toBeGreaterThan(20);
    // The pair line answers "why these colors", and depth is only half of that
    // answer: a pair with a full curve and nothing that kills anything is the
    // shape `mtg-qntb` was filed about. `removalCount` was computed and read by
    // nothing until this line, so the assertion is that it reaches a reader.
    const best = built.colorPairs[0];
    expect(best).toBeDefined();
    expect(report).toContain(
      `(${String(best?.playableCount)} playable, ${String(best?.removalCount)} answers)`,
    );
  });
});
