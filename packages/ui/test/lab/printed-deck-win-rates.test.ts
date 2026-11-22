import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import { PrintedFormatIndexSchema } from '../../src/lab/printed-format';

const WIN_RATES_URL = `formats/scd/deck-win-rates-${'c'.repeat(64)}.json`;
const availability = {
  browse: 'available' as const,
  draft: 'unavailable' as const,
  sealed: 'unavailable' as const,
  play: { status: 'unavailable' as const, reason: 'Commander play is not yet admitted.' },
};
const row = {
  id: 'scd',
  name: 'Starter Commander Decks 2022',
  kind: 'constructed' as const,
  variant: 'commander' as const,
  availability,
  formatUrl: 'formats/scd/scd-constructed-format-v1.json',
  deckWinRatesUrl: WIN_RATES_URL,
  catalogs: [{ code: 'SCD', url: 'formats/scd/scd-printed-catalog-v1.json' }],
};

function figure(deckId: string | undefined, winRatePercent: number) {
  return {
    name: `Deck ${deckId ?? 'nowhere'}`,
    product: 'Example Product',
    commander: `Commander of ${deckId ?? 'nowhere'}`,
    winRatePercent,
    games: 100,
    ...(deckId === undefined ? {} : { setCode: 'EXA', deckId }),
  };
}

function reading(decks: readonly unknown[]) {
  const table = {
    schemaVersion: 1,
    kind: 'commander-precon-win-rates',
    source: {
      name: 'Example Tracker',
      url: 'https://example.test/precons',
      retrieved: '2026-10-10',
      sourceUpdated: '2026-10-10T16:02:00Z',
      pageSha256: 'a'.repeat(64),
      measure: 'win rate of the stock list in tracked four-player games',
      minimumSample: 'at least 20 tracked stock games',
      lowSampleBelowGames: 40,
    },
    decks,
  };
  return async (url: string): Promise<unknown> =>
    url === WIN_RATES_URL
      ? table
      : (JSON.parse(readFileSync(`packages/data/data/scd/${url.split('/').at(-1)!}`, 'utf8')) as unknown);
}

describe('a constructed format loaded with deck win rates', () => {
  it('hands the page the figures its index row names', async () => {
    const loaded = await loadPrintedConstructedFormat(
      row,
      reading([figure('token-triumph', 27.76), figure('first-flight', 19.36)]),
    );
    expect(loaded.winRates?.decks.map((entry) => entry.deckId)).toEqual(['token-triumph', 'first-flight']);
  });

  it('loads without figures when the row names none', async () => {
    const { deckWinRatesUrl: _url, ...bare } = row;
    expect((await loadPrintedConstructedFormat(bare, reading([]))).winRates).toBeUndefined();
  });

  it('refuses figures for a deck the format does not carry, and a figure joined to no deck', async () => {
    await expect(
      loadPrintedConstructedFormat(row, reading([figure('token-triumph', 27.76), figure('elsewhere', 30)])),
    ).rejects.toThrow(/win rate for Deck elsewhere, a deck scd does not carry/);
    await expect(
      loadPrintedConstructedFormat(row, reading([figure('token-triumph', 27.76), figure(undefined, 24)])),
    ).rejects.toThrow(/win rate for Deck nowhere, a deck scd does not carry/);
  });

  it('refuses an index row that puts deck win rates on a format with packs', () => {
    expect(() =>
      PrintedFormatIndexSchema.parse({
        schemaVersion: 2,
        formats: [
          {
            id: 'akh-hou',
            name: 'Amonkhet and Hour of Devastation',
            kind: 'limited',
            availability: { ...availability, draft: 'available', sealed: 'available' },
            formatUrl: 'formats/akh-hou/akh-hou-limited-format-v1.json',
            deckWinRatesUrl: WIN_RATES_URL,
            catalogs: [{ code: 'AKH', url: 'formats/akh-hou/akh-printed-catalog-v1.json' }],
          },
        ],
      }),
    ).toThrow(/deck win rates belong to a constructed format/);
  });
});
