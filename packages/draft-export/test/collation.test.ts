/**
 * Sheets and layouts: how a set becomes packs.
 *
 * The collation half is where a wrong file is most expensive, because both
 * failure modes are silent. A sheet no layout draws from holds cards nobody
 * can ever pick; a slot that asks for more cards than its sheet holds cannot
 * fill a pack. Neither is visible in the emitted text, so both are reported.
 */
import { describe, expect, it } from 'vitest';
import type { BoosterRecipe } from '@mtg/deckbuild';
import { boosterSize, SLICE_BOOSTER } from '@mtg/deckbuild';
import { EXAMPLE_SET, RARITIES } from '@mtg/dsl';
import {
  buildLayouts,
  buildSheets,
  collationReport,
  DEFAULT_LAYOUT_NAME,
  formatCollationReport,
  sheetName,
} from '@mtg/draft-export';

const SHEETS = buildSheets(EXAMPLE_SET);
const LAYOUTS = buildLayouts(SLICE_BOOSTER);

describe('sheets', () => {
  it('partitions the set by rarity: every card in exactly one sheet', () => {
    const ids = SHEETS.flatMap((sheet) => sheet.cards.map((card) => card.id));
    expect(ids).toHaveLength(EXAMPLE_SET.length);
    expect(new Set(ids).size).toBe(EXAMPLE_SET.length);
    expect([...ids].sort()).toEqual([...EXAMPLE_SET.map((card) => card.id)].sort());
  });

  it('puts a card only in the sheet named for its rarity', () => {
    for (const sheet of SHEETS) {
      for (const card of sheet.cards) {
        expect(card.rarity).toBe(sheet.rarity);
        expect(sheet.name).toBe(sheetName(card.rarity));
      }
    }
  });

  it('names sheets for the rarity they hold, in rarity order', () => {
    expect(SHEETS.map((sheet) => sheet.name)).toEqual(['Common', 'Uncommon', 'Rare']);
    expect(RARITIES.map(sheetName)).toEqual(['Common', 'Uncommon', 'Rare', 'Mythic']);
  });

  it('emits no sheet for a rarity the set does not print', () => {
    const noRares = EXAMPLE_SET.filter((card) => card.rarity !== 'rare');
    expect(buildSheets(noRares).map((sheet) => sheet.name)).toEqual(['Common', 'Uncommon']);
  });

  it('keeps each sheet in collector-number order', () => {
    for (const sheet of SHEETS) {
      const numbers = sheet.cards.map((card) => card.set.collectorNumber);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    }
  });
});

describe('layouts', () => {
  it('turns a booster recipe into one layout whose slots sum to the pack size', () => {
    const layout = LAYOUTS[DEFAULT_LAYOUT_NAME];
    expect(layout).toBeDefined();
    const counts = Object.values(layout?.slots ?? {});
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(boosterSize(SLICE_BOOSTER));
    expect(layout?.slots).toEqual({ Common: 9, Uncommon: 3 });
    expect(layout?.weight).toBe(1);
  });

  it('sums repeated slots of one rarity into a single sheet count', () => {
    const doubled: BoosterRecipe = [
      { rarity: 'common', count: 5 },
      { rarity: 'rare', count: 1 },
      { rarity: 'common', count: 4 },
    ];
    expect(buildLayouts(doubled)[DEFAULT_LAYOUT_NAME]?.slots).toEqual({ Common: 9, Rare: 1 });
    expect(boosterSize(doubled)).toBe(10);
  });
});

describe('collation report', () => {
  it('names a sheet no layout draws from', () => {
    const report = collationReport(SHEETS, LAYOUTS);
    expect(report.unreachableSheets).toEqual(['Rare']);
    expect(formatCollationReport(report).join('\n')).toContain('Rare');
  });

  it('names a slot its sheet cannot fill, with both numbers', () => {
    const thin = buildSheets(EXAMPLE_SET.filter((card) => card.rarity !== 'uncommon'));
    const report = collationReport(thin, LAYOUTS);
    expect(report.shortSlots).toEqual([{ sheet: 'Uncommon', need: 3, have: 0 }]);
    expect(formatCollationReport(report).join('\n')).toContain('Uncommon');
  });

  it('judges a multi-layout file by its hungriest layout', () => {
    // `buildLayouts` emits one layout because a `BoosterRecipe` describes one
    // pack, but the format and this function both take a set of weighted
    // layouts and a hand-written one is legal. A sheet has to fill the deepest
    // slot that draws from it, so the report reads the maximum rather than the
    // last count it iterated over — which is why the deepest layout is declared
    // first here, where keeping the last one would report a set that drafts fine.
    const layouts = {
      Big: { weight: 1, slots: { Common: 200 } },
      Small: { weight: 3, slots: { Common: 1, Uncommon: 3 } },
    };
    expect(collationReport(SHEETS, layouts)).toEqual({
      unreachableSheets: ['Rare'],
      shortSlots: [{ sheet: 'Common', need: 200, have: 18 }],
    });
  });

  it('says nothing when every sheet is drawn from and every slot can be filled', () => {
    const recipe: BoosterRecipe = [...SLICE_BOOSTER, { rarity: 'rare', count: 1 }];
    const report = collationReport(SHEETS, buildLayouts(recipe));
    expect(report).toEqual({ unreachableSheets: [], shortSlots: [] });
    expect(formatCollationReport(report)).toEqual([]);
  });
});
