/**
 * The emitted file, read back the way Draftmancer would read it.
 *
 * The section splitter lives here rather than in `src/`: this package writes
 * the format and never reads it, and a parser in the source would be a second
 * unverified guess about Draftmancer dressed up as a check on the first. The
 * golden fixture is the byte-stability gate — a set that has not changed must
 * compile to the same file forever, or a draft in progress is not reproducible.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { boosterRecipeFor, boosterSize, SLICE_BOOSTER } from '@mtg/deckbuild';
import { EXAMPLE_SET, exampleCard } from '@mtg/dsl';
import { DraftExportError, exportDraftmancerSet } from '@mtg/draft-export';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'example-set.draftmancer.txt');

const EXPORT = exportDraftmancerSet(EXAMPLE_SET);

const MYTHIC_EXPORT = exportDraftmancerSet([
  ...EXAMPLE_SET,
  { ...exampleCard('slc-skywatch-sentinel'), id: 'emit-mythic', name: 'Emit Mythic', rarity: 'mythic' },
]);

/** Section header -> the lines under it, in file order. */
function sections(text: string): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of text.split('\n')) {
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header !== null && header[1] !== undefined) {
      current = [];
      found.set(header[1], current);
      continue;
    }
    if (current !== undefined && line.length > 0) current.push(line);
  }
  return found;
}

function customCardsJson(text: string): readonly { readonly name: string }[] {
  const block = sections(text).get('CustomCards');
  if (block === undefined) throw new Error('no [CustomCards] section');
  return JSON.parse(block.join('\n')) as readonly { readonly name: string }[];
}

describe('file structure', () => {
  it('writes the custom cards, the settings, then one section per sheet', () => {
    expect([...sections(EXPORT.text).keys()]).toEqual([
      'CustomCards',
      'Settings',
      'Common',
      'Uncommon',
      'Rare',
    ]);
  });

  it('ends with a newline, as a text file does', () => {
    expect(EXPORT.text.endsWith('\n')).toBe(true);
    expect(EXPORT.text.endsWith('\n\n')).toBe(false);
  });

  it('lists every card exactly once in [CustomCards]', () => {
    const names = customCardsJson(EXPORT.text).map((entry) => entry.name);
    expect(names).toHaveLength(EXAMPLE_SET.length);
    expect(new Set(names).size).toBe(EXAMPLE_SET.length);
    expect([...names].sort()).toEqual([...EXAMPLE_SET.map((card) => card.name)].sort());
  });

  it('lists every card exactly once across the sheet sections', () => {
    const listed = ['Common', 'Uncommon', 'Rare'].flatMap((name) => sections(EXPORT.text).get(name) ?? []);
    expect([...listed].sort()).toEqual([...EXAMPLE_SET.map((card) => card.name)].sort());
  });

  it('writes settings whose slots sum to the pack size', () => {
    const settings = JSON.parse((sections(EXPORT.text).get('Settings') ?? []).join('\n')) as {
      layouts: Record<string, { weight: number; slots: Record<string, number> }>;
    };
    const slots = Object.values(settings.layouts).flatMap((layout) => Object.values(layout.slots));
    expect(slots.reduce((sum, count) => sum + count, 0)).toBe(boosterSize(boosterRecipeFor(EXAMPLE_SET)));
  });

  it('draws from every sheet the set prints, the rare one included', () => {
    // This inverts what the file used to assert. The fixture set prints rares
    // and the pack had no rare slot, so the export compiled a Rare sheet no
    // layout drew from and the test pinned that as correct. It was the drafting
    // half of the same bug `openSealedPool` carried: a rarity generated,
    // rendered and exported, and never picked.
    expect(EXAMPLE_SET.some((card) => card.rarity === 'rare')).toBe(true);
    expect(EXPORT.report.unreachableSheets).toEqual([]);
    expect(EXPORT.report.shortSlots).toEqual([]);
  });

  it('emits reachable rare and mythic weighted layouts by default', () => {
    expect(MYTHIC_EXPORT.report).toEqual({ unreachableSheets: [], shortSlots: [] });
    expect(MYTHIC_EXPORT.layouts).toEqual({
      Rare: { weight: 2, slots: { Common: 9, Uncommon: 3, Rare: 1 } },
      Mythic: { weight: 1, slots: { Common: 9, Uncommon: 3, Mythic: 1 } },
    });
  });

  it('still reports an unreachable sheet when the caller states a recipe without it', () => {
    // The warning path is the caller's to reach now, not the default's.
    const stranded = exportDraftmancerSet(EXAMPLE_SET, { recipe: SLICE_BOOSTER });
    expect(stranded.report.unreachableSheets).toEqual(['Rare']);
    expect(stranded.report.shortSlots).toEqual([]);
  });
});

describe('byte stability', () => {
  it('compiles the fixture set to the committed golden file', () => {
    expect(EXPORT.text).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('compiles the same set to the same bytes twice', () => {
    expect(exportDraftmancerSet(EXAMPLE_SET).text).toBe(EXPORT.text);
  });

  it('does not depend on the order the cards arrive in', () => {
    const shuffled = [...EXAMPLE_SET].reverse();
    expect(exportDraftmancerSet(shuffled).text).toBe(EXPORT.text);
  });
});

describe('rejections', () => {
  it('refuses a set with two cards of one name, which the file cannot tell apart', () => {
    const sentinel = exampleCard('slc-skywatch-sentinel');
    const twin = {
      ...sentinel,
      id: 'slc-skywatch-sentinel-2',
      set: { ...sentinel.set, collectorNumber: 99 },
    };
    expect(() => exportDraftmancerSet([...EXAMPLE_SET, twin])).toThrow(DraftExportError);
    expect(() => exportDraftmancerSet([...EXAMPLE_SET, twin])).toThrow('Skywatch Sentinel');
  });

  it('refuses an empty set', () => {
    expect(() => exportDraftmancerSet([])).toThrow(DraftExportError);
  });
});
