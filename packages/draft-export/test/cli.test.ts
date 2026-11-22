/**
 * The CLI's exit codes, which are the only part of this package a person or a
 * script reads.
 *
 * The one that matters is the short pack: the file is written and looks
 * entirely right, so a run that exited 0 would hand Draftmancer a set it cannot
 * build a booster from and let the human discover it. The file is still written
 * on that path — deleting it would hide the evidence — so the exit code is the
 * whole of the signal and it is asserted alongside the file.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASIC_LANDS, EXAMPLE_SET, isBasicLand } from '@mtg/dsl';
import { main } from '../src/cli';

describe('draft-export cli', () => {
  let directory: string;
  let out: string[];
  let errors: string[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mtg-draft-export-cli-'));
    out = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => out.push(parts.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => errors.push(parts.join(' ')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('refuses to run without an output path, rather than picking one', () => {
    expect(main([])).toBe(2);
    expect(errors.join('\n')).toContain('usage');
  });

  it('writes the fixture set to the named file and exits 0', () => {
    const outFile = join(directory, 'nested', 'set.txt');
    expect(main([outFile])).toBe(0);
    const text = readFileSync(outFile, 'utf8');
    expect(text).toContain('[CustomCards]');
    expect(text).toContain('[Settings]');
    // The path, then which of the two arms cut it: a file that says nothing
    // about that is a file whose reader has to open it to find out (`mtg-rbw6`).
    expect(out).toEqual([outFile, 'cut from the set rarities, which is what a generated set offers']);
  });

  it('strands no sheet: the pack it writes is the set it was handed', () => {
    // This used to expect `sheet Rare is in no pack slot`, because the pack was
    // a constant with no rare slot and the fixture set prints rares. The
    // command takes no recipe flag, so the derived pack is the only pack it can
    // write, and a warning here would name a tier it had just made undraftable.
    const outFile = join(directory, 'set.txt');
    expect(main([outFile])).toBe(0);
    expect(errors.join('\n')).not.toContain('in no pack slot');
    expect(readFileSync(outFile, 'utf8')).toContain('"Rare": 1');
  });

  it('exits non-zero when a slot asks for more cards than its sheet holds', () => {
    const cardsFile = join(directory, 'cards.json');
    writeFileSync(
      cardsFile,
      JSON.stringify(EXAMPLE_SET.filter((card) => card.rarity !== 'uncommon')),
      'utf8',
    );
    const outFile = join(directory, 'short.txt');

    expect(main([outFile, cardsFile])).toBe(1);
    expect(errors.join('\n')).toContain('slot Uncommon needs 3 cards per pack but its sheet holds 0');
    // Written anyway: the file is not the problem, the collation is, and a
    // missing file would leave nothing to look at.
    expect(readFileSync(outFile, 'utf8')).toContain('[CustomCards]');
  });

  it('says on stdout that the basic lands came out of the printing it cut', () => {
    // A document whose booster spends one pick on a basic sheet, which is
    // M11's shape and every reduced reference printing's (`mtg-5of3`). The file
    // is the pack Draftmancer deals, so a run that dropped the slot silently
    // would leave the document saying five and the pack holding four.
    const commons = EXAMPLE_SET.filter((card) => card.rarity === 'common' && !isBasicLand(card));
    const weights = (cards: readonly { readonly id: string }[]): Record<string, number> =>
      Object.fromEntries(cards.map((card) => [card.id, 1]));
    const cardsFile = join(directory, 'printing.json');
    writeFileSync(
      cardsFile,
      JSON.stringify({
        cards: EXAMPLE_SET,
        reduction: {
          collation: {
            sheets: [
              { name: 'basic', weights: weights(BASIC_LANDS) },
              { name: 'common', weights: weights(commons) },
            ],
            boosters: [{ contents: { basic: 1, common: 4 }, weight: 1, packSize: 5 }],
          },
        },
      }),
      'utf8',
    );
    const outFile = join(directory, 'printing.txt');

    expect(main([outFile, cardsFile])).toBe(0);
    expect(out.join('\n')).toContain("cut from the printing's own collation");
    expect(out.join('\n')).toContain('basic lands are not dealt: dropped basic');
    expect(out.join('\n')).toContain('a pack is 4 cards where the printing collates 5');
  });

  it('throws on a document with no "cards" field, and writes no file at all', () => {
    const cardsFile = join(directory, 'nonsense.json');
    writeFileSync(cardsFile, '{"notCards": []}', 'utf8');
    const outFile = join(directory, 'never.txt');
    expect(() => main([outFile, cardsFile])).toThrow(/array of cards/);
    expect(existsSync(outFile)).toBe(false);
  });

  it('throws on an empty set document, and writes no file at all', () => {
    // An empty "cards" array is a validly *shaped* set document, so this is a
    // domain error from exportDraftmancerSet rather than a shape error from
    // the loader — but it must still fail loudly and write nothing.
    const cardsFile = join(directory, 'empty.json');
    writeFileSync(cardsFile, '{"cards": []}', 'utf8');
    const outFile = join(directory, 'never.txt');
    expect(() => main([outFile, cardsFile])).toThrow(/empty set/);
    expect(existsSync(outFile)).toBe(false);
  });

  it('accepts a set document in the shape @mtg/setgen writes, same as every other set reader', () => {
    // set.json on disk is never a bare array — it is
    // { formatVersion, set: {...}, cards: [...] }. This is the shape the card
    // renderer, the art verifier and the `npm run play` launcher all already
    // read; this command used to be the odd one out.
    const cardsFile = join(directory, 'set.json');
    writeFileSync(
      cardsFile,
      JSON.stringify({
        formatVersion: 1,
        set: { code: 'XMP', name: 'Fixture', theme: 'fixture', seed: 'fixture-seed', profile: 'fixture v1' },
        cards: EXAMPLE_SET,
      }),
      'utf8',
    );
    const outFile = join(directory, 'from-document.txt');

    expect(main([outFile, cardsFile])).toBe(0);
    const text = readFileSync(outFile, 'utf8');
    expect(text).toContain('[CustomCards]');
    expect(text).toContain('[Settings]');
  });
});
