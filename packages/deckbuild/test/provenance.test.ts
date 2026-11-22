/**
 * Which slot each dealt card came off (`mtg-11yd`).
 *
 * The bead was filed on a foil arriving as a plain duplicate: `openCollatedPool`
 * deals a foil slot off a named foil sheet, flattens the pack into a list of
 * cards, and by the time a surface sees the pool the foil is an ordinary second
 * copy. The fix is provenance on the pool rather than a `foil` field on the
 * card, and this file holds the two halves of that decision that a later change
 * could quietly undo.
 *
 * The first is alignment. Provenance is only worth anything if `slots[p][i]`
 * describes `boosters[p][i]`, and the collated opener builds the two lists in
 * one loop over the same draw, so nothing but a test stops them drifting apart
 * the next time a slot is inserted somewhere else in that loop.
 *
 * The second is what the sealed opener answers. It deals by rarity, so a foil
 * question has no measurement behind it at all — not a `false`, which would
 * claim one. `Rarity` being a closed union is what makes that a fact about the
 * arm rather than a search that came back empty, and the assertions here are on
 * the behavior that follows from it.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { PackCollation, PoolProvenance } from '../src/index';
import { foilPositions, foilSlots, openCollatedPool, openSealedPool } from '../src/index';
import { makeSyntheticPool } from './helpers/pool';

const POOL: readonly Card[] = makeSyntheticPool(20260827, { size: 40, setCode: 'PRV' });
const ids = (from: number, count: number): readonly string[] =>
  POOL.slice(from, from + count).map((card) => card.id);

function sheet(name: string, cardIds: readonly string[], foil?: boolean): PackCollation['sheets'][number] {
  return {
    name,
    weights: Object.fromEntries(cardIds.map((id) => [id, 1])),
    ...(foil === undefined ? {} : { foil }),
  };
}

/** M11's shape in miniature: a foil sheet that is the whole set, on 9 packs in 40. */
const M11_SHAPED: PackCollation = {
  sheets: [
    sheet('basic', ids(0, 2), false),
    sheet('common', ids(2, 10), false),
    sheet('rare', ids(30, 4), false),
    sheet(
      'foil',
      POOL.map((card) => card.id),
      true,
    ),
  ],
  boosters: [
    { contents: { basic: 1, common: 3, rare: 1 }, weight: 31 },
    { contents: { basic: 1, common: 2, foil: 1, rare: 1 }, weight: 9 },
  ],
};

/** The same printing staged before the flag was carried through: no sheet says. */
const UNSTATED: PackCollation = {
  sheets: M11_SHAPED.sheets.map((entry) => sheet(entry.name, Object.keys(entry.weights))),
  boosters: M11_SHAPED.boosters,
};

function sheetsArm(provenance: PoolProvenance): Extract<PoolProvenance, { kind: 'sheets' }> {
  if (provenance.kind !== 'sheets') throw new Error('expected a pool dealt off named sheets');
  return provenance;
}

describe('a pool dealt off a printing’s sheets', () => {
  it('names a slot for every card, pack for pack and position for position', () => {
    const pool = openCollatedPool(POOL, M11_SHAPED, { seed: 'aligned', boosters: 12 });
    const { slots } = sheetsArm(pool.provenance);

    expect(slots).toHaveLength(pool.boosters.length);
    for (const [pack, booster] of pool.boosters.entries()) {
      expect(slots[pack]).toHaveLength(booster.length);
    }
  });

  it('names the sheet each card was actually drawn from, not the one it could have been', () => {
    const pool = openCollatedPool(POOL, M11_SHAPED, { seed: 'attributed', boosters: 60 });
    const { slots } = sheetsArm(pool.provenance);
    const on: Readonly<Record<string, readonly string[]>> = {
      basic: ids(0, 2),
      common: ids(2, 10),
      rare: ids(30, 4),
      foil: POOL.map((card) => card.id),
    };

    for (const [pack, booster] of pool.boosters.entries()) {
      for (const [index, card] of booster.entries()) {
        const slot = slots[pack]?.[index];
        expect(slot).toBeDefined();
        expect(on[slot?.sheet ?? '']).toContain(card.id);
      }
    }
  });

  it('separates the two copies of a card the foil slot repeated', () => {
    // The whole defect, stated as one pack: two commons off a two-card sheet and
    // a foil off a sheet holding exactly those two, so every pack repeats. The
    // cards are indistinguishable and the provenance is not.
    const overlapping: PackCollation = {
      sheets: [sheet('common', ids(2, 2), false), sheet('foil', ids(2, 2), true)],
      boosters: [{ contents: { common: 2, foil: 1 }, weight: 1 }],
    };
    const pool = openCollatedPool(POOL, overlapping, { seed: 'overlapping', boosters: 5 });
    const positions = foilSlots(pool.provenance);

    expect(positions).not.toBeNull();
    for (const [pack, booster] of pool.boosters.entries()) {
      expect(new Set(booster.map((card) => card.id)).size).toBe(2);
      // One foil, and the two copies of the repeated card are told apart by
      // where they came from rather than by anything on the card.
      expect(positions?.[pack]).toHaveLength(1);
      const foilAt = positions?.[pack]?.[0] ?? -1;
      expect(booster.filter((card) => card.id === booster[foilAt]?.id).length).toBe(2);
    }
  });

  it('reports a foil only where a pack was dealt the configuration that holds one', () => {
    const pool = openCollatedPool(POOL, M11_SHAPED, { seed: 'configurations', boosters: 200 });
    const positions = foilSlots(pool.provenance);
    const { slots } = sheetsArm(pool.provenance);

    expect(positions).not.toBeNull();
    const withFoil = positions?.filter((pack) => pack.length > 0) ?? [];
    // 9 in 40 of packs carry the foil configuration, so both outcomes appear.
    expect(withFoil.length).toBeGreaterThan(0);
    expect(withFoil.length).toBeLessThan(pool.boosters.length);
    for (const [pack, foilAt] of (positions ?? []).entries()) {
      expect(foilAt).toEqual(
        (slots[pack] ?? []).flatMap((slot, index) => (slot.sheet === 'foil' ? [index] : [])),
      );
    }
  });

  it('names the same cards against the flat pool a surface actually indexes', () => {
    // A builder holds `cards`, not `boosters`, and identity in it is the index.
    // So the flat answer is the one a treatment keys off, and it is only worth
    // anything if it lands on the same cards the per-pack answer names.
    const pool = openCollatedPool(POOL, M11_SHAPED, { seed: 'flattened', boosters: 40 });
    const packs = foilSlots(pool.provenance);
    const flat = foilPositions(pool.provenance);
    const { slots } = sheetsArm(pool.provenance);

    expect(flat).not.toBeNull();
    expect(flat).toHaveLength((packs ?? []).flat().length);
    for (const position of flat ?? []) {
      expect(slots.flat()[position]?.sheet).toBe('foil');
      expect(pool.cards[position]).toBeDefined();
    }
    expect([...(flat ?? [])].sort((a, b) => a - b)).toEqual(flat);
  });

  it('offsets by the packs before it rather than by a pack size', () => {
    // Both of M11's configurations happen to deal five cards, so a flattening
    // that multiplied the pack number by a constant would pass against it. This
    // collation deals three cards or six, so a constant is wrong on the second
    // pack onwards and the assertion below is what catches it.
    const ragged: PackCollation = {
      sheets: [sheet('common', ids(2, 10), false), sheet('foil', ids(2, 10), true)],
      boosters: [
        { contents: { common: 2, foil: 1 }, weight: 1 },
        { contents: { common: 5, foil: 1 }, weight: 1 },
      ],
    };
    const pool = openCollatedPool(POOL, ragged, { seed: 'ragged', boosters: 30 });
    const flat = foilPositions(pool.provenance);
    const { slots } = sheetsArm(pool.provenance);

    expect(new Set(pool.boosters.map((booster) => booster.length))).toEqual(new Set([3, 6]));
    expect(flat).toHaveLength(pool.boosters.length);
    for (const position of flat ?? []) expect(slots.flat()[position]?.sheet).toBe('foil');
  });

  it('refuses to answer for a collation that never stated the flag', () => {
    // Absent is not `false`. A bundle staged before the flag was carried through
    // took no measurement, and reporting every card as non-foil would invent one.
    const pool = openCollatedPool(POOL, UNSTATED, { seed: 'unstated', boosters: 20 });
    const { slots } = sheetsArm(pool.provenance);

    expect(foilSlots(pool.provenance)).toBeNull();
    expect(slots.every((pack) => pack.every((slot) => slot.foil === null))).toBe(true);
    // The sheet names still arrive, so a pool report loses nothing by it.
    expect(new Set(slots.flat().map((slot) => slot.sheet))).toEqual(
      new Set(['basic', 'common', 'rare', 'foil']),
    );
  });

  it('answers null for a pool where only some sheets stated it', () => {
    const partly: PackCollation = {
      sheets: [sheet('common', ids(2, 10), false), sheet('foil', ids(2, 10))],
      boosters: [{ contents: { common: 2, foil: 1 }, weight: 1 }],
    };
    const pool = openCollatedPool(POOL, partly, { seed: 'partly', boosters: 4 });

    // Reporting the stated half as if it were all of it would name no foil in a
    // pool that holds one per pack, which is worse than declining.
    expect(foilSlots(pool.provenance)).toBeNull();
  });
});

describe('a pool dealt from what the card list prints', () => {
  it('names the slot each card came off by the slot’s rarity', () => {
    const pool = openSealedPool(POOL, { seed: 'rarities', boosters: 6 });
    if (pool.provenance.kind !== 'rarities') throw new Error('expected a pool dealt by rarity');
    const { slots } = pool.provenance;

    expect(slots).toHaveLength(pool.boosters.length);
    for (const [pack, booster] of pool.boosters.entries()) {
      expect(slots[pack]).toHaveLength(booster.length);
    }
    // Nine commons and three uncommons, which is `SLICE_BOOSTER` for a set that
    // prints no rare. Every slot in the recipe is fixed, so the slot's rarity
    // and the drawn card's agree here and the two readings can be compared.
    for (const [pack, booster] of pool.boosters.entries()) {
      expect(slots[pack]).toEqual(booster.map((card) => card.rarity));
    }
  });

  it('has no foil slot to deal off, rather than dealing nothing off one', () => {
    const pool = openSealedPool(POOL, { seed: 'no-foil', boosters: 6 });

    // The distinction the two arms exist for. A rarity recipe cannot express a
    // foil sheet, so this is a fact about the instrument and not a measurement
    // that came back empty; `null` says so where `[]` would have claimed one.
    expect(foilSlots(pool.provenance)).toBeNull();
    // Both readings decline together. A surface that asked the flat one and got
    // `[]` would draw "every card here is an ordinary copy", which this pool
    // never measured.
    expect(foilPositions(pool.provenance)).toBeNull();
  });
});
