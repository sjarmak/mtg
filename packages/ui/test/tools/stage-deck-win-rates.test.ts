import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCommanderHeadToHeadResults, parsePrintedDeckWinRates } from '@mtg/printed-card';
import { loadPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import { PrintedFormatIndexSchema } from '../../src/lab/printed-format';
import { releaseDateLookup } from '../../tools/printed-release-dates';
import {
  DECK_WIN_RATES_FILENAME,
  HEAD_TO_HEAD_FILENAME,
  deckWinRatesPath,
  describeDeckWinRates,
  describeHeadToHead,
  headToHeadPath,
  readDeckWinRates,
  readHeadToHead,
} from '../../tools/stage-deck-win-rates';
import { stagePrintedFormats } from '../../tools/stage-printed-formats';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-win-rates-staging-'));
  roots.push(root);
  return root;
};

const limitedSource = {
  id: 'akh-hou',
  directory: resolve('packages/data/data/akh-hou'),
  formatFile: 'akh-hou-limited-format-v1.json',
  availability: {
    browse: 'available' as const,
    draft: 'available' as const,
    sealed: 'available' as const,
    play: { status: 'unavailable' as const, reason: 'Full Forge admission is not complete.' },
  },
  catalogs: ['AKH', 'HOU', 'MP2'].map((code) => ({
    code,
    file: `${code.toLowerCase()}-printed-catalog-v1.json`,
  })),
};
const commanderSource = {
  id: 'scd',
  directory: resolve('packages/data/data/scd'),
  formatFile: 'scd-constructed-format-v1.json',
  availability: {
    browse: 'available' as const,
    draft: 'unavailable' as const,
    sealed: 'unavailable' as const,
    play: { status: 'unavailable' as const, reason: 'Commander play is not yet admitted.' },
  },
  catalogs: [{ code: 'SCD', file: 'scd-printed-catalog-v1.json' }],
};
const staging = {
  releaseDateOf: releaseDateLookup({ AKH: '2017-04-28', HOU: '2017-07-14', MP2: null }),
};

function row(deckId: string, winRatePercent: number, games: number) {
  return {
    name: `Deck ${deckId}`,
    product: 'Example Product',
    commander: `Commander of ${deckId}`,
    winRatePercent,
    games,
    setCode: 'EXA',
    deckId,
  };
}

function tableOf(decks: readonly unknown[]) {
  return {
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
}

const unlisted = {
  name: 'Deck nowhere',
  product: 'Example Product',
  commander: 'Commander of nowhere',
  winRatePercent: 24,
  games: 60,
};

function headToHeadPairing(a: string, b: string, aWins: number, bWins: number) {
  return {
    a,
    b,
    games: aWins + bWins,
    aWins,
    bWins,
    rulesDraws: 0,
    clockDraws: 0,
    aShare: { point: aWins / (aWins + bWins), low: 0, high: 1 },
  };
}

function headToHeadTableOf(pairings: readonly ReturnType<typeof headToHeadPairing>[]) {
  return parseCommanderHeadToHeadResults({ schemaVersion: 2, pairings });
}

describe('staging deck win rates beside a Commander format', () => {
  it('publishes the figures for the decks that format carries, and only those', async () => {
    const root = temporary();
    const deckWinRates = parsePrintedDeckWinRates(
      tableOf([
        row('token-triumph', 27.76, 163),
        row('elsewhere', 30, 80),
        unlisted,
        row('grave-danger', 21.19, 177),
      ]),
    );
    const index = await stagePrintedFormats([limitedSource, commanderSource], root, {
      ...staging,
      deckWinRates,
    });
    const [limited, commander] = index.formats;
    expect(limited?.deckWinRatesUrl).toBeUndefined();
    expect(commander?.deckWinRatesUrl).toMatch(/^formats\/scd\/deck-win-rates-[a-f0-9]{64}\.json$/);
    const read = async (url: string): Promise<unknown> => JSON.parse(readFileSync(join(root, url), 'utf8'));
    const loaded = await loadPrintedConstructedFormat(commander, read);
    expect(loaded.winRates?.decks.map((entry) => [entry.deckId, entry.winRatePercent])).toEqual([
      ['token-triumph', 27.76],
      ['grave-danger', 21.19],
    ]);
    expect(loaded.winRates?.source.name).toBe('Example Tracker');
    expect(
      await stagePrintedFormats([limitedSource, commanderSource], root, { ...staging, deckWinRates }),
    ).toEqual(index);
  });

  it('publishes nothing for a format none of whose decks were measured, or when no table was read', async () => {
    const read =
      (root: string) =>
      async (url: string): Promise<unknown> =>
        JSON.parse(readFileSync(join(root, url), 'utf8'));
    const unmeasuredRoot = temporary();
    const unmeasured = await stagePrintedFormats([commanderSource], unmeasuredRoot, {
      ...staging,
      deckWinRates: parsePrintedDeckWinRates(tableOf([row('elsewhere', 30, 80), unlisted])),
    });
    expect(unmeasured.formats[0]?.deckWinRatesUrl).toBeUndefined();
    expect(
      (await loadPrintedConstructedFormat(unmeasured.formats[0], read(unmeasuredRoot))).winRates,
    ).toBeUndefined();
    const bareRoot = temporary();
    const bare = await stagePrintedFormats([commanderSource], bareRoot, staging);
    expect(bare.formats[0]?.deckWinRatesUrl).toBeUndefined();
    expect((await loadPrintedConstructedFormat(bare.formats[0], read(bareRoot))).winRates).toBeUndefined();
  });
});

describe('staging lab head-to-head results beside a Commander format', () => {
  it('publishes the pairings between the decks that format carries, and only those', async () => {
    const root = temporary();
    const headToHead = headToHeadTableOf([
      headToHeadPairing('token-triumph', 'grave-danger', 25, 15),
      headToHeadPairing('token-triumph', 'elsewhere', 20, 20),
    ]);
    const index = await stagePrintedFormats([limitedSource, commanderSource], root, {
      ...staging,
      headToHead,
    });
    const [limited, commander] = index.formats;
    expect(limited?.headToHeadUrl).toBeUndefined();
    expect(commander?.headToHeadUrl).toMatch(/^formats\/scd\/head-to-head-[a-f0-9]{64}\.json$/);
    const read = async (url: string): Promise<unknown> => JSON.parse(readFileSync(join(root, url), 'utf8'));
    const loaded = await loadPrintedConstructedFormat(commander, read);
    expect(loaded.headToHead?.pairings.map((entry) => [entry.a, entry.b])).toEqual([
      ['token-triumph', 'grave-danger'],
    ]);
  });

  it('publishes nothing for a format none of whose decks share a measured pairing, or when no table was read', async () => {
    const read =
      (root: string) =>
      async (url: string): Promise<unknown> =>
        JSON.parse(readFileSync(join(root, url), 'utf8'));
    const unmeasuredRoot = temporary();
    const unmeasured = await stagePrintedFormats([commanderSource], unmeasuredRoot, {
      ...staging,
      headToHead: headToHeadTableOf([headToHeadPairing('elsewhere', 'nowhere', 10, 10)]),
    });
    expect(unmeasured.formats[0]?.headToHeadUrl).toBeUndefined();
    expect(
      (await loadPrintedConstructedFormat(unmeasured.formats[0], read(unmeasuredRoot))).headToHead,
    ).toBeUndefined();
    const bareRoot = temporary();
    const bare = await stagePrintedFormats([commanderSource], bareRoot, staging);
    expect(bare.formats[0]?.headToHeadUrl).toBeUndefined();
    expect((await loadPrintedConstructedFormat(bare.formats[0], read(bareRoot))).headToHead).toBeUndefined();
  });
});

describe('the launcher reading the head-to-head table', () => {
  it('looks for one named file under the repository it was started from', () => {
    const path = headToHeadPath('/checkout');
    expect(path.startsWith('/checkout/packages/data/data/')).toBe(true);
    expect(path.endsWith(`/${HEAD_TO_HEAD_FILENAME}`)).toBe(true);
  });

  it('reads a table that is there, and treats a missing one as a checkout without figures', () => {
    const root = temporary();
    const path = join(root, HEAD_TO_HEAD_FILENAME);
    expect(readHeadToHead(path)).toBeUndefined();
    writeFileSync(
      path,
      JSON.stringify(headToHeadTableOf([headToHeadPairing('token-triumph', 'grave-danger', 25, 15)])),
    );
    expect(readHeadToHead(path)?.pairings).toHaveLength(1);
  });

  it('refuses a table that is there and is not one, rather than staging without it', () => {
    const root = temporary();
    const path = join(root, HEAD_TO_HEAD_FILENAME);
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, pairings: [] }));
    expect(() => readHeadToHead(path)).toThrow();
  });

  it('says which formats got figures, and says so when none did', () => {
    const headToHead = headToHeadTableOf([headToHeadPairing('token-triumph', 'grave-danger', 25, 15)]);
    const withFigures = PrintedFormatIndexSchema.parse({
      schemaVersion: 2,
      formats: [
        {
          id: 'scd',
          name: 'Starter Commander Decks 2022',
          kind: 'constructed',
          variant: 'commander',
          availability: commanderSource.availability,
          formatUrl: 'formats/scd/scd-constructed-format-v1.json',
          headToHeadUrl: `formats/scd/head-to-head-${'b'.repeat(64)}.json`,
          catalogs: [{ code: 'SCD', url: 'formats/scd/scd-printed-catalog-v1.json' }],
        },
      ],
    });
    const without = PrintedFormatIndexSchema.parse({ schemaVersion: 2, formats: [] });
    expect(describeHeadToHead(headToHead, withFigures)).toBe(
      'Head-to-head results: staged for Starter Commander Decks 2022.',
    );
    expect(describeHeadToHead(headToHead, without)).toBe(
      'Head-to-head results: the table was read, and no staged format carries a deck it measures.',
    );
    expect(describeHeadToHead(undefined, withFigures)).toBe(
      'Head-to-head results: no table in this checkout, so the Commander deck picker shows no lab measurement.',
    );
  });
});

describe('the launcher reading the win-rate table', () => {
  it('looks for one named file under the repository it was started from', () => {
    const path = deckWinRatesPath('/checkout');
    expect(path.startsWith('/checkout/packages/data/data/')).toBe(true);
    expect(path.endsWith(`/${DECK_WIN_RATES_FILENAME}`)).toBe(true);
  });

  it('reads a table that is there, and treats a missing one as a checkout without figures', () => {
    const root = temporary();
    const path = join(root, DECK_WIN_RATES_FILENAME);
    expect(readDeckWinRates(path)).toBeUndefined();
    writeFileSync(path, JSON.stringify(tableOf([row('token-triumph', 27.76, 163)])));
    expect(readDeckWinRates(path)?.decks).toHaveLength(1);
  });

  it('refuses a table that is there and is not one, rather than staging without it', () => {
    const root = temporary();
    const path = join(root, DECK_WIN_RATES_FILENAME);
    writeFileSync(
      path,
      JSON.stringify({ ...tableOf([row('token-triumph', 27.76, 163)]), kind: 'something-else' }),
    );
    expect(() => readDeckWinRates(path)).toThrow();
  });

  it('says which formats got figures, and says so when none did', () => {
    const table = parsePrintedDeckWinRates(tableOf([row('token-triumph', 27.76, 163)]));
    const withFigures = PrintedFormatIndexSchema.parse({
      schemaVersion: 2,
      formats: [
        {
          id: 'scd',
          name: 'Starter Commander Decks 2022',
          kind: 'constructed',
          variant: 'commander',
          availability: commanderSource.availability,
          formatUrl: 'formats/scd/scd-constructed-format-v1.json',
          deckWinRatesUrl: `formats/scd/deck-win-rates-${'b'.repeat(64)}.json`,
          catalogs: [{ code: 'SCD', url: 'formats/scd/scd-printed-catalog-v1.json' }],
        },
      ],
    });
    const without = PrintedFormatIndexSchema.parse({ schemaVersion: 2, formats: [] });
    expect(describeDeckWinRates(table, withFigures)).toBe(
      'Deck win rates: Example Tracker figures staged for Starter Commander Decks 2022.',
    );
    expect(describeDeckWinRates(table, without)).toBe(
      'Deck win rates: Example Tracker figures were read, and no staged format carries a deck they measure.',
    );
    expect(describeDeckWinRates(undefined, withFigures)).toBe(
      'Deck win rates: no table in this checkout, so the Commander deck picker shows no pairing figures.',
    );
  });
});
