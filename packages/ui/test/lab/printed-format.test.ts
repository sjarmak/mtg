import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PrintedFormatIndexSchema,
  PrintedFormatRowSchema,
  loadPrintedFormat,
} from '../../src/lab/printed-format';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(`packages/data/data/akh-hou/${name}`, 'utf8'));
const row = {
  id: 'akh-hou',
  name: 'Amonkhet / Hour of Devastation',
  availability: {
    browse: 'available',
    draft: 'available',
    sealed: 'available',
    play: { status: 'unavailable', reason: 'Full Forge admission is not complete.' },
  },
  formatUrl: 'formats/akh-hou/akh-hou-limited-format-v1.json',
  catalogs: ['AKH', 'HOU', 'MP2'].map((code) => ({
    code,
    url: `formats/akh-hou/${code.toLowerCase()}-printed-catalog-v1.json`,
  })),
};
const fetchJson = async (url: string): Promise<unknown> => read(url.split('/').at(-1)!);

describe('browser printed-format bundle boundary', () => {
  it('loads three exact catalogs and reuses the prepared mixed-format opener', async () => {
    const index = PrintedFormatIndexSchema.parse({ schemaVersion: 2, formats: [row] });
    const loaded = await loadPrintedFormat(index.formats[0]!, fetchJson);
    expect(loaded.catalogs.map((source) => [source.code, source.catalog.cards.length])).toEqual([
      ['AKH', 287],
      ['HOU', 209],
      ['MP2', 54],
    ]);
    expect(loaded.prepared.openSealedPool('browser').cards).toHaveLength(84);
    expect(loaded.prepared.openDraftPacks('browser')).toHaveLength(24);
  });

  it('rejects duplicate identities and non-local resource paths before fetching', async () => {
    expect(() => PrintedFormatIndexSchema.parse({ schemaVersion: 2, formats: [row, row] })).toThrow(
      /duplicate/,
    );
    expect(() =>
      PrintedFormatIndexSchema.parse({
        schemaVersion: 2,
        formats: [{ ...row, catalogs: [row.catalogs[0], row.catalogs[0]] }],
      }),
    ).toThrow(/duplicate/);
    for (const formatUrl of [
      'https://example.com/format.json',
      '//example.com/a.json',
      '../a.json',
      'formats/%2e%2e/a.json',
      'formats/a.json?x=1',
    ]) {
      await expect(
        loadPrintedFormat({ ...row, formatUrl }, () => {
          throw new Error('must not fetch');
        }),
      ).rejects.toThrow(/local|path/);
    }
  });

  it('keeps browsing, limited preparation, experimental play, and supported play distinct', () => {
    for (const status of ['unavailable', 'experimental', 'supported'] as const) {
      const parsed = PrintedFormatIndexSchema.parse({
        schemaVersion: 2,
        formats: [
          {
            ...row,
            availability: {
              ...row.availability,
              play: { status, reason: `${status} evidence` },
            },
          },
        ],
      });
      expect(parsed.formats[0]!.availability.play.status).toBe(status);
      expect(parsed.formats[0]!.availability.draft).toBe('available');
    }
    expect(() =>
      PrintedFormatIndexSchema.parse({
        schemaVersion: 2,
        formats: [{ ...row, availability: { ...row.availability, play: { status: 'ready' } } }],
      }),
    ).toThrow();
  });

  it('refuses stale, mislabeled, missing, or mismatched bundles', async () => {
    await expect(loadPrintedFormat({ ...row, id: 'wrong' }, fetchJson)).rejects.toThrow(/identity/);
    await expect(
      loadPrintedFormat({ ...row, catalogs: row.catalogs.slice(0, 2) }, fetchJson),
    ).rejects.toThrow(/source/);
    await expect(
      loadPrintedFormat(
        { ...row, catalogs: row.catalogs.map((source) => ({ ...source, code: `X${source.code}` })) },
        fetchJson,
      ),
    ).rejects.toThrow(/source/);
    await expect(
      loadPrintedFormat(row, async (url) => {
        const body = await fetchJson(url);
        return url.endsWith('hou-printed-catalog-v1.json')
          ? { ...(body as object), forgeVersion: 'stale' }
          : body;
      }),
    ).rejects.toThrow(/checksum/);
    await expect(
      loadPrintedFormat(row, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow(/offline/);
  });

  it('ties a constructed rules variant to a constructed row and refuses it on a limited one', () => {
    const constructedRow = {
      ...row,
      kind: 'constructed' as const,
      formatUrl: 'formats/akh-hou/akh-hou-constructed-format-v1.json',
    };
    expect(() => PrintedFormatRowSchema.parse(constructedRow)).toThrow(/requires its rules variant/);
    expect(PrintedFormatRowSchema.parse({ ...constructedRow, variant: 'momir' }).variant).toBe('momir');
    expect(() => PrintedFormatRowSchema.parse({ ...row, kind: 'limited', variant: 'momir' })).toThrow(
      /cannot carry a constructed rules variant/,
    );
  });
});
