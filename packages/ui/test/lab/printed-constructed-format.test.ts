import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import {
  checkPrintedConstructedBundle,
  loadPrintedConstructedFormat,
} from '../../src/lab/printed-constructed-format';
import { PrintedFormatIndexSchema, loadPrintedFormat } from '../../src/lab/printed-format';

const read = (name: string): unknown => JSON.parse(readFileSync(`packages/data/data/scd/${name}`, 'utf8'));
const row = {
  id: 'scd',
  name: 'Starter Commander Decks 2022',
  kind: 'constructed' as const,
  variant: 'commander' as const,
  availability: {
    browse: 'available' as const,
    draft: 'unavailable' as const,
    sealed: 'unavailable' as const,
    play: { status: 'unavailable' as const, reason: 'Commander play is not yet admitted.' },
  },
  formatUrl: 'formats/scd/scd-constructed-format-v1.json',
  displayMetadataUrl: 'formats/scd/scd-display-metadata-v1.json',
  catalogs: [{ code: 'SCD', url: 'formats/scd/scd-printed-catalog-v1.json' }],
};
const fetchJson = async (url: string): Promise<unknown> => read(url.split('/').at(-1)!);
const digest = async (text: string) => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
};
const withChecksum = async (format: Record<string, unknown>) => {
  const { contentSha256: _checksum, ...content } = format;
  return { ...content, contentSha256: await digest(`${JSON.stringify(content)}\n`) };
};

describe('browser printed constructed-format bundle boundary', () => {
  it('loads the checked catalog and resolves every deck slot to a printing it carries', async () => {
    const index = PrintedFormatIndexSchema.parse({ schemaVersion: 2, formats: [row] });
    const loaded = await loadPrintedConstructedFormat(index.formats[0]!, fetchJson);
    expect(loaded.format.rules).toEqual({ variant: 'commander', startingLife: 40 });
    expect(loaded.catalogs.map((source) => [source.code, source.catalog.cards.length])).toEqual([
      ['SCD', 352],
    ]);
    expect(loaded.format.decks.map((deck) => deck.id)).toEqual([
      'chaos-incarnate',
      'draconic-destruction',
      'first-flight',
      'grave-danger',
      'token-triumph',
    ]);
    for (const deck of loaded.format.decks) {
      expect(deck.commanders).toHaveLength(1);
      expect(deck.cards.reduce((sum, slot) => sum + slot.count, 0)).toBe(99);
      for (const slot of [...deck.commanders, ...deck.cards]) {
        expect(loaded.printings.get(slot.physicalId)?.correctedName).toBe(slot.name);
      }
    }
    expect(Object.keys(loaded.rarities)).toHaveLength(352);
    const withoutDisplay = await loadPrintedConstructedFormat(
      { ...row, displayMetadataUrl: undefined },
      fetchJson,
    );
    expect(withoutDisplay.rarities).toEqual({});
    expect(withoutDisplay.format).toEqual(loaded.format);
  });

  it('is the only loader a constructed row goes through', async () => {
    await expect(loadPrintedFormat(row, fetchJson)).rejects.toThrow(/constructed format/);
    await expect(
      loadPrintedConstructedFormat({ ...row, kind: undefined, variant: undefined }, fetchJson),
    ).rejects.toThrow(/no constructed decks/);
    await expect(
      loadPrintedConstructedFormat({ ...row, kind: 'limited', variant: undefined }, fetchJson),
    ).rejects.toThrow(/no constructed decks/);
  });

  it('refuses a catalog that is not the one the format binds, and a slot no catalog carries', async () => {
    const format = read('scd-constructed-format-v1.json') as {
      decks: { id: string; commanders: { physicalId: string; name: string }[]; cards: unknown[] }[];
    };
    const catalog = parsePrintedCardCatalog(read('scd-printed-catalog-v1.json'));
    await expect(checkPrintedConstructedBundle(format, [], digest)).rejects.toThrow(
      /missing source catalog SCD/,
    );
    await expect(
      checkPrintedConstructedBundle(format, [{ ...catalog, contentSha256: '0'.repeat(64) }], digest),
    ).rejects.toThrow(/checksum mismatch/);
    const foreign = {
      ...format,
      decks: format.decks.map((deck, index) =>
        index === 0
          ? { ...deck, commanders: [{ ...deck.commanders[0]!, physicalId: 'scd-printed-v1:9999:missing' }] }
          : deck,
      ),
    };
    await expect(
      checkPrintedConstructedBundle(await withChecksum(foreign), [catalog], digest),
    ).rejects.toThrow(/chaos-incarnate names a printing no catalog carries/);
    const misnamed = {
      ...format,
      decks: format.decks.map((deck, index) =>
        index === 0 ? { ...deck, commanders: [{ ...deck.commanders[0]!, name: 'Not Kardur' }] } : deck,
      ),
    };
    await expect(
      checkPrintedConstructedBundle(await withChecksum(misnamed), [catalog], digest),
    ).rejects.toThrow(/names Not Kardur for a printing of/);
  });

  it('refuses constructed format bytes that do not match their declared checksum', async () => {
    const format = read('scd-constructed-format-v1.json') as { name: string };
    const catalog = parsePrintedCardCatalog(read('scd-printed-catalog-v1.json'));
    await expect(
      checkPrintedConstructedBundle({ ...format, name: 'Changed after hashing' }, [catalog], digest),
    ).rejects.toThrow(/constructed format scd checksum mismatch/);
  });

  it('refuses Standard rules on a standalone constructed row routed to Commander', async () => {
    const format = read('scd-constructed-format-v1.json') as Record<string, unknown> & {
      rules: { variant: string; startingLife: number };
      decks: { commanders: unknown[]; cards: unknown[] }[];
    };
    format.rules.variant = 'standard';
    for (const deck of format.decks) {
      deck.cards = [...deck.commanders, ...deck.cards];
      deck.commanders = [];
    }
    const changed = await withChecksum(format);
    await expect(
      loadPrintedConstructedFormat(row, async (url) => (url === row.formatUrl ? changed : fetchJson(url))),
    ).rejects.toThrow(/standalone constructed format scd requires Commander or Momir rules/);
  });
});
