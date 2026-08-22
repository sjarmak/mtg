/**
 * Opening packs from a printing's own collation rather than from its rarities.
 *
 * `openSealedPool` derives a recipe from what a card list prints, which is the
 * only thing available for a generated set and is wrong for a real one twice
 * over: it deals thirteen cards where M11 deals fifteen, and it draws every card
 * of a rarity at equal odds where a real sheet weights them. This is the other
 * arm — a caller who *has* the sheets deals from them.
 *
 * The collations here are written out rather than loaded, because this package
 * depends on `@mtg/dsl` alone: the reduced M11 that motivates the feature is
 * `@mtg/data`'s artifact and reaches this function through the play surface, not
 * through an import.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { PackCollation } from '../src/index';
import { openCollatedPool, SealedPoolError } from '../src/index';
import { makeSyntheticPool } from './helpers/pool';

const POOL: readonly Card[] = makeSyntheticPool(20260820, { size: 40, setCode: 'COL' });
const ids = (from: number, count: number): readonly string[] =>
  POOL.slice(from, from + count).map((card) => card.id);

function sheet(name: string, cardIds: readonly string[], weight = 1): PackCollation['sheets'][number] {
  return { name, weights: Object.fromEntries(cardIds.map((id) => [id, weight])) };
}

/** Three sheets and one configuration: the shape of a real printing, in miniature. */
const COLLATION: PackCollation = {
  sheets: [sheet('basic', ids(0, 2)), sheet('common', ids(2, 10)), sheet('rare', ids(30, 4))],
  boosters: [{ contents: { basic: 1, common: 3, rare: 1 }, weight: 1 }],
};

describe('opening from a collation', () => {
  it('deals each sheet the count its booster asks for, and nothing else', () => {
    const pool = openCollatedPool(POOL, COLLATION, { seed: 'collated/v0', boosters: 4 });

    expect(pool.boosters).toHaveLength(4);
    for (const booster of pool.boosters) {
      expect(booster).toHaveLength(5);
      const drawn = booster.map((card) => card.id);
      expect(drawn.filter((id) => ids(0, 2).includes(id))).toHaveLength(1);
      expect(drawn.filter((id) => ids(2, 10).includes(id))).toHaveLength(3);
      expect(drawn.filter((id) => ids(30, 4).includes(id))).toHaveLength(1);
      // Distinct within the slot, the way one pack never holds a card twice.
      expect(new Set(drawn).size).toBe(drawn.length);
    }
    expect(pool.cards).toHaveLength(20);
  });

  it('opens the same packs from the same seed', () => {
    const first = openCollatedPool(POOL, COLLATION, { seed: 'again', boosters: 3 });
    const second = openCollatedPool(POOL, COLLATION, { seed: 'again', boosters: 3 });

    expect(first.cards.map((card) => card.id)).toEqual(second.cards.map((card) => card.id));
    expect(first.seed).toBe('again');
  });

  it('draws a sheet by its weights rather than uniformly over it', () => {
    const heavy = POOL[2];
    const light = POOL[3];
    if (heavy === undefined || light === undefined) throw new Error('fixture pool too small');
    const weighted: PackCollation = {
      sheets: [{ name: 'common', weights: { [heavy.id]: 99, [light.id]: 1 } }],
      boosters: [{ contents: { common: 1 }, weight: 1 }],
    };

    const drawn = openCollatedPool(POOL, weighted, { seed: 'weighted', boosters: 200 }).cards;

    expect(drawn.filter((card) => card.id === heavy.id).length).toBeGreaterThan(180);
    expect(drawn.filter((card) => card.id === light.id).length).toBeGreaterThan(0);
  });

  it('chooses between booster configurations by their weights', () => {
    const configured: PackCollation = {
      sheets: [sheet('common', ids(2, 10)), sheet('rare', ids(30, 4))],
      boosters: [
        { contents: { common: 2 }, weight: 9 },
        { contents: { common: 1, rare: 1 }, weight: 1 },
      ],
    };

    const opened = openCollatedPool(POOL, configured, { seed: 'configured', boosters: 300 });
    const withRare = opened.boosters.filter((booster) =>
      booster.some((card) => ids(30, 4).includes(card.id)),
    ).length;

    expect(withRare).toBeGreaterThan(5);
    expect(withRare).toBeLessThan(90);
    // Every pack is still two cards: the two configurations differ in what they
    // deal, not in how much.
    expect(opened.boosters.every((booster) => booster.length === 2)).toBe(true);
  });

  it('refuses a sheet that names a card the set does not print, by name', () => {
    const stale: PackCollation = {
      sheets: [{ name: 'common', weights: { 'col-999': 1 } }],
      boosters: [{ contents: { common: 1 }, weight: 1 }],
    };

    expect(() => openCollatedPool(POOL, stale, { seed: 'stale' })).toThrowError(
      /sheet common names col-999, which this set does not print/,
    );
  });

  it('refuses a slot deeper than its sheet before it opens anything', () => {
    const short: PackCollation = {
      sheets: [sheet('rare', ids(30, 2))],
      boosters: [{ contents: { rare: 3 }, weight: 1 }],
    };

    expect(() => openCollatedPool(POOL, short, { seed: 'short' })).toThrowError(SealedPoolError);
  });

  it('refuses a booster naming a sheet the collation does not carry', () => {
    const missing: PackCollation = {
      sheets: [sheet('common', ids(2, 10))],
      boosters: [{ contents: { foil: 1 }, weight: 1 }],
    };

    expect(() => openCollatedPool(POOL, missing, { seed: 'missing' })).toThrowError(/foil/);
  });

  it('refuses a collation with no configuration left to open', () => {
    expect(() =>
      openCollatedPool(POOL, { sheets: [sheet('common', ids(2, 10))], boosters: [] }, { seed: 'none' }),
    ).toThrowError(/no booster configuration/);
  });
});
