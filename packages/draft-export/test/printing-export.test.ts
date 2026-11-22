/**
 * A file cut from the printing's sheets, not from DSL rarity.
 *
 * `mtg-rbw6`. The exporter partitioned every set by rarity, so a Draftmancer
 * file cut from a reduced M11 dealt nine commons and a rare while the lab beside
 * it dealt the printing's fifteen. The acceptance test is a round trip rather
 * than an inspection: the emitted file is read back into a collation and one
 * pack is opened from each at one seed, so the claim is that the file deals what
 * the lab deals rather than that it mentions the same words.
 *
 * The collation is written out rather than loaded, for `@mtg/deckbuild`'s
 * `collation.test.ts` reason: this package depends on `@mtg/dsl` and
 * `@mtg/deckbuild`, and a reduced printing is `@mtg/data`'s artifact.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openCollatedPool } from '@mtg/deckbuild';
import type { PackCollation } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DraftError, exportDraftmancerSet } from '@mtg/draft-export';

const SET_FIXTURE = fileURLToPath(
  new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();
const COMMONS = SET.filter((card) => card.rarity === 'common').slice(0, 10);
const RARES = SET.filter((card) => card.rarity === 'uncommon').slice(0, 5);

/**
 * Weights with no common factor, so the file's counts are the collation's
 * counts and one seed deals one pack on both sides. The reduction is exact
 * either way, and its own test is below.
 */
const PRINTING: PackCollation = {
  sheets: [
    { name: 'common', weights: Object.fromEntries(COMMONS.map((card) => [card.id, 1])) },
    {
      // Weighted, and dealt one card a pack, which is the shape a real rare
      // sheet has: M11 gives a rare twice a mythic's odds in a one-card slot.
      name: 'rare',
      weights: Object.fromEntries(RARES.map((card, index) => [card.id, index + 1])),
    },
  ],
  boosters: [
    { contents: { common: 4, rare: 1 }, weight: 3 },
    { contents: { common: 5 }, weight: 1 },
  ],
};

/** Reads the emitted file back into the collation it describes. */
function readBack(text: string): PackCollation {
  const byName = new Map(SET.map((card) => [card.name, card.id] as const));
  const sheets: { name: string; weights: Record<string, number> }[] = [];
  let settings: unknown = null;
  let current: { name: string; weights: Record<string, number> } | null = null;
  let section = '';
  const lines = text.split('\n');
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? '';
    const header = /^\[(.+)\]$/.exec(line);
    if (header !== null) {
      section = header[1] ?? '';
      if (section === 'CustomCards' || section === 'Settings') {
        current = null;
        continue;
      }
      current = { name: section, weights: {} };
      sheets.push(current);
      continue;
    }
    if (section === 'Settings' && line === '{') {
      const rest = lines.slice(at).join('\n');
      const end = rest.indexOf('\n}');
      settings = JSON.parse(rest.slice(0, end + 2));
      continue;
    }
    if (current === null || line.length === 0) continue;
    const counted = /^(\d+) (.+)$/.exec(line);
    const name = counted === null ? line : (counted[2] ?? '');
    const id = byName.get(name);
    if (id === undefined) throw new Error(`the file names ${name}, which the set does not print`);
    current.weights[id] = counted === null ? 1 : Number(counted[1]);
  }
  const layouts = (settings as { layouts: Record<string, { weight: number; slots: Record<string, number> }> })
    .layouts;
  return {
    sheets,
    boosters: Object.values(layouts).map((layout) => ({
      contents: layout.slots,
      weight: layout.weight,
    })),
  };
}

describe('a file cut from a printing', () => {
  const cut = exportDraftmancerSet(SET, { collation: PRINTING });

  it('deals the pack the lab deals, read back out of the file itself', () => {
    const fromFile = readBack(cut.text);

    for (const seed of ['printing/1', 'printing/2', 'printing/3']) {
      const lab = openCollatedPool(SET, PRINTING, { seed, boosters: 4 });
      const file = openCollatedPool(SET, fromFile, { seed, boosters: 4 });
      expect(file.boosters.map((pack) => pack.map((card) => card.id))).toEqual(
        lab.boosters.map((pack) => pack.map((card) => card.id)),
      );
    }
  });

  it('names one layout per booster configuration, at the printing weights', () => {
    expect(Object.values(cut.layouts)).toEqual([
      { weight: 3, slots: { common: 4, rare: 1 } },
      { weight: 1, slots: { common: 5 } },
    ]);
  });

  it('carries no rarity sheet, because rarity is not what cut it', () => {
    expect(cut.sheets).toEqual([]);
    expect(cut.printing?.map((sheet) => sheet.name)).toEqual(['common', 'rare']);
  });

  it('emits a custom card for every card its sheets name and no other', () => {
    expect(new Set(cut.customCards.map((card) => card.name))).toEqual(
      new Set([...COMMONS, ...RARES].map((card) => card.name)),
    );
  });

  it('says nothing about a sheet it deals faithfully', () => {
    expect(cut.notes).toEqual([]);
  });
});

describe('what the printing arm refuses or qualifies', () => {
  it('divides a sheet by its common factor, which is exact', () => {
    const first = COMMONS[0];
    const second = COMMONS[1];
    if (first === undefined || second === undefined) throw new Error('the fixture is too small');
    const scaled: PackCollation = {
      sheets: [{ name: 'common', weights: { [first.id]: 60, [second.id]: 40 } }],
      boosters: [{ contents: { common: 1 }, weight: 1 }],
    };

    expect(
      exportDraftmancerSet(SET, { collation: scaled }).printing?.[0]?.entries.map(([, count]) => count),
    ).toEqual([3, 2]);
  });

  it('collapses a card the printing prints twice into one weighted line', () => {
    const plains = COMMONS[0];
    if (plains === undefined) throw new Error('the fixture is too small');
    // The same card at two ids, which is what four Plains at four collector
    // numbers are: Draftmancer keys by name, so the sheet gets one line at the
    // weight of both.
    const twin: Card = { ...plains, id: `${plains.id}-b`, set: { ...plains.set, collectorNumber: 999 } };
    const printing: PackCollation = {
      sheets: [{ name: 'basic', weights: { [plains.id]: 1, [twin.id]: 1 } }],
      boosters: [{ contents: { basic: 1 }, weight: 1 }],
    };
    const cut = exportDraftmancerSet([...SET, twin], { collation: printing });

    expect(cut.printing?.[0]?.entries).toHaveLength(1);
    expect(cut.customCards.filter((card) => card.name === plains.name)).toHaveLength(1);
  });

  it('refuses two different cards under one name rather than keeping one', () => {
    const first = COMMONS[0];
    const second = COMMONS[1];
    if (first === undefined || second === undefined) throw new Error('the fixture is too small');
    const impostor: Card = { ...second, name: first.name };
    const printing: PackCollation = {
      sheets: [{ name: 'common', weights: { [first.id]: 1, [impostor.id]: 1 } }],
      boosters: [{ contents: { common: 1 }, weight: 1 }],
    };

    expect(() => exportDraftmancerSet([...SET, impostor], { collation: printing })).toThrowError(DraftError);
  });

  it('says which weighted sheet fills more than one slot, because that is the unsettled case', () => {
    const weighted: PackCollation = {
      sheets: [{ name: 'common', weights: Object.fromEntries(COMMONS.map((card, at) => [card.id, at + 1])) }],
      boosters: [{ contents: { common: 5 }, weight: 1 }],
    };
    const cut = exportDraftmancerSet(SET, { collation: weighted });

    expect(cut.notes).toHaveLength(1);
    expect(cut.notes[0]).toContain('sheet common is weighted and deals 5 cards a pack');
  });

  it('refuses a recipe and a collation together rather than choosing one', () => {
    expect(() =>
      exportDraftmancerSet(SET, { collation: PRINTING, recipe: [{ rarity: 'common', count: 1 }] }),
    ).toThrowError(/not both/);
  });
});
