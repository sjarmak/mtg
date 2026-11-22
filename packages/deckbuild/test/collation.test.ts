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
import { basicLand, BASIC_LAND_TYPES } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { PackCollation } from '../src/index';
import { openCollatedPool, SealedPoolError, withoutBasicLands } from '../src/index';
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

  /**
   * Two seats at one table, which is the case a sealed room runs.
   *
   * The seeds are spelled the way `@mtg/netplay`'s `poolSeedFor` spells them and
   * written out rather than imported: this package depends on `@mtg/dsl` alone,
   * and the arrow runs netplay -> deckbuild. What is being asserted is a
   * property of the sampler, not of that spelling.
   */
  it('opens two seats from one table seed independently, not off a shared stream', () => {
    const table = 'table-2dm8';
    const forSeat = (seat: number): readonly string[] =>
      openCollatedPool(POOL, COLLATION, { seed: `${table}/seat${String(seat)}`, boosters: 3 }).cards.map(
        (card) => card.id,
      );

    const alone = forSeat(1);
    // The other seat opens first, twice, and the second seat's pool does not move.
    forSeat(0);
    forSeat(0);
    expect(forSeat(1)).toEqual(alone);
    // Independent, so the two seats are not handed the same cards in the same order.
    expect(forSeat(0)).not.toEqual(alone);
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

/**
 * The decision `mtg-vvio` settled, pinned so the docblock cannot rot.
 *
 * `collation.ts` says a slot may repeat a card the pack already dealt, and
 * argues it from M11, whose foil sheet is the whole set: every card on every
 * other sheet is also on the foil sheet, so the 9-in-40 foil configuration can
 * deal a second copy of anything the other four slots dealt. Nothing checked
 * that, and a docblock claim no test holds to is a claim that goes quietly wrong
 * the first time somebody adds a distinctness pass.
 *
 * Both halves are pinned, because the rule is a boundary rather than a license:
 * across sheets a repeat is allowed, within one sheet it is still refused.
 */
describe('a slot repeating a card the pack already dealt', () => {
  /** M11's shape in miniature: a foil sheet carrying every card the set prints. */
  const FOIL_COLLATION: PackCollation = {
    sheets: [
      sheet('basic', ids(0, 2)),
      sheet('common', ids(2, 10)),
      sheet('rare', ids(30, 4)),
      sheet(
        'foil',
        POOL.map((card) => card.id),
      ),
    ],
    boosters: [
      { contents: { basic: 1, common: 3, rare: 1 }, weight: 31 },
      { contents: { basic: 1, common: 2, foil: 1, rare: 1 }, weight: 9 },
    ],
  };

  it('deals the duplicate rather than refusing it, where the sheets overlap outright', () => {
    // Two commons off a two-card sheet, then a foil off a sheet holding exactly
    // those two: every pack must repeat. Forced rather than found at a lucky
    // seed, so the assertion is about the rule and not about the stream.
    const overlapping: PackCollation = {
      sheets: [sheet('common', ids(2, 2)), sheet('foil', ids(2, 2))],
      boosters: [{ contents: { common: 2, foil: 1 }, weight: 1 }],
    };

    const opened = openCollatedPool(POOL, overlapping, { seed: 'overlapping', boosters: 5 });

    for (const booster of opened.boosters) {
      expect(booster).toHaveLength(3);
      expect(new Set(booster.map((card) => card.id)).size).toBe(2);
    }
  });

  it('lets a foil slot repeat a card the same pack dealt off another sheet', () => {
    const opened = openCollatedPool(POOL, FOIL_COLLATION, { seed: 'foil-overlap', boosters: 200 });
    const repeated = opened.boosters.filter(
      (booster) => new Set(booster.map((card) => card.id)).size < booster.length,
    );

    // 5 of 200 at this seed. The foil configuration is 9 in 40 of packs and its
    // foil slot draws the whole 40-card pool, of which 4 cards are already in
    // the pack, so a few percent is the rate the overlap predicts.
    expect(repeated.length).toBeGreaterThan(0);
    expect(repeated.length).toBeLessThan(opened.boosters.length);
    // One foil slot, so at most one card comes back twice.
    for (const booster of repeated) {
      expect(booster.length - new Set(booster.map((card) => card.id)).size).toBe(1);
    }
  });

  it('carries the duplicate into the pool rather than collapsing it on the way out', () => {
    const opened = openCollatedPool(POOL, FOIL_COLLATION, { seed: 'foil-overlap', boosters: 200 });
    const dealt = opened.boosters.reduce((total, booster) => total + booster.length, 0);

    expect(opened.cards).toHaveLength(dealt);
    // A pool is a bag, so the second copy is a second entry and not a set member.
    expect(new Set(opened.cards.map((card) => card.id)).size).toBeLessThan(opened.cards.length);
  });

  it('still refuses a repeat inside one slot, which is the half that did not move', () => {
    const twoFoils: PackCollation = {
      sheets: [
        sheet(
          'foil',
          POOL.map((card) => card.id),
        ),
      ],
      boosters: [{ contents: { foil: 2 }, weight: 1 }],
    };

    const opened = openCollatedPool(POOL, twoFoils, { seed: 'two-foils', boosters: 50 });

    for (const booster of opened.boosters) {
      expect(new Set(booster.map((card) => card.id)).size).toBe(2);
    }
  });

  it('measures slot depth against the sheet a slot draws from, not against the pack', () => {
    // The foil sheet holds two cards and the common sheet holds the same two, so
    // a pack-wide distinctness rule would need four and refuse this. It resolves.
    const shallow: PackCollation = {
      sheets: [sheet('common', ids(2, 2)), sheet('foil', ids(2, 2))],
      boosters: [{ contents: { common: 2, foil: 2 }, weight: 1 }],
    };

    expect(openCollatedPool(POOL, shallow, { seed: 'shallow', boosters: 1 }).cards).toHaveLength(4);
  });
});

/**
 * The reduced M11's shape in miniature: a sheet of nothing but basics, a foil
 * sheet that is the whole card list, and three sheets carrying no basic at all.
 */
const BASICS: readonly Card[] = BASIC_LAND_TYPES.slice(0, 3).map((type, index) =>
  basicLand(type, 'COL', 60 + index),
);
const LANDED: readonly Card[] = [...POOL, ...BASICS];
const BASIC_IDS = BASICS.map((card) => card.id);
const PRINTING: PackCollation = {
  sheets: [
    sheet('basic', BASIC_IDS),
    sheet('common', ids(2, 10)),
    sheet('rare', ids(30, 4)),
    sheet('foil', [...LANDED.map((card) => card.id)]),
  ],
  boosters: [
    { contents: { basic: 1, common: 3, rare: 1 }, weight: 31 },
    { contents: { basic: 1, common: 2, rare: 1, foil: 1 }, weight: 9 },
  ],
};

describe('taking the basic lands out of a printing', () => {
  it('drops the slot whose sheet is nothing but basics', () => {
    const [dealable, removal] = withoutBasicLands(LANDED, PRINTING);

    expect(removal.droppedSheets).toEqual(['basic']);
    expect(dealable.sheets.map((entry) => entry.name)).not.toContain('basic');
    for (const booster of dealable.boosters) {
      expect(Object.keys(booster.contents)).not.toContain('basic');
    }
  });

  it('thins the mixed sheet instead of dropping it, which is the second source', () => {
    const [dealable, removal] = withoutBasicLands(LANDED, PRINTING);
    const foil = dealable.sheets.find((entry) => entry.name === 'foil');

    expect(removal.thinnedSheets).toEqual(['foil']);
    expect(Object.keys(foil?.weights ?? {})).toHaveLength(POOL.length);
    for (const id of BASIC_IDS) expect(foil?.weights).not.toHaveProperty(id);
  });

  it('says the pack shrank rather than quietly dealing a shorter one', () => {
    const [, removal] = withoutBasicLands(LANDED, PRINTING);

    expect(removal.printedPackSizes).toEqual([5]);
    expect(removal.dealtPackSizes).toEqual([4]);
    expect(removal.unfillableBoosters).toBe(0);
  });

  it('deals no basic land over a run of packs, off either configuration', () => {
    const [dealable] = withoutBasicLands(LANDED, PRINTING);
    const opened = openCollatedPool(LANDED, dealable, { seed: 'no-basics', boosters: 200 });

    expect(opened.cards).toHaveLength(800);
    expect(opened.cards.filter((card) => BASIC_IDS.includes(card.id))).toEqual([]);
    // Both configurations still deal: the foil slot is what the 9-in-40 arm adds.
    expect(
      opened.provenance.kind === 'sheets' &&
        opened.provenance.slots.flat().some((slot) => slot.sheet === 'foil'),
    ).toBe(true);
  });

  it('leaves a printing that collates no basic land exactly as it was', () => {
    const [dealable, removal] = withoutBasicLands(POOL, COLLATION);

    expect(dealable).toEqual(COLLATION);
    expect(removal.droppedSheets).toEqual([]);
    expect(removal.thinnedSheets).toEqual([]);
    expect(removal.dealtPackSizes).toEqual(removal.printedPackSizes);
  });

  it('drops a configuration whose slot outgrew its thinned sheet rather than dealing it short', () => {
    const thin: PackCollation = {
      sheets: [sheet('common', ids(2, 2)), sheet('mixed', [...ids(4, 2), ...BASIC_IDS])],
      boosters: [
        { contents: { common: 1, mixed: 4 }, weight: 1 },
        { contents: { common: 1, mixed: 2 }, weight: 1 },
      ],
    };

    const [dealable, removal] = withoutBasicLands(LANDED, thin);

    expect(removal.unfillableBoosters).toBe(1);
    expect(dealable.boosters).toHaveLength(1);
    expect(removal.printedPackSizes).toEqual([3, 5]);
    expect(removal.dealtPackSizes).toEqual([3]);
    expect(openCollatedPool(LANDED, dealable, { seed: 'thin', boosters: 3 }).cards).toHaveLength(9);
  });

  it('leaves a slot naming a sheet that is not here for the opener to refuse', () => {
    const stale: PackCollation = {
      sheets: [sheet('common', ids(2, 4))],
      boosters: [{ contents: { common: 1, gone: 1 }, weight: 1 }],
    };

    const [dealable] = withoutBasicLands(LANDED, stale);

    expect(() => openCollatedPool(LANDED, dealable, { seed: 'stale-sheet' })).toThrowError(
      /not a sheet here/,
    );
  });
});
