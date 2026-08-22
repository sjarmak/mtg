import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import {
  REFERENCE_SET_CODES,
  REFERENCE_SET_SOURCES,
  ReferenceCorpusSchema,
  buildReferenceCorpus,
  createHttpClient,
  createLimiter,
  fetchReferenceSetSources,
  loadReferenceCorpus,
  parseReferenceSetSource,
  writeReferenceCorpus,
  type ReferenceSetSource,
} from '@mtg/data';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function card(
  uuid: string,
  number: string,
  name: string,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    uuid,
    name,
    number,
    rarity: 'common',
    availability: ['paper'],
    borderColor: 'black',
    colorIdentity: [],
    colors: [],
    finishes: ['nonfoil'],
    foreignData: [],
    frameVersion: '2015',
    hasFoil: false,
    hasNonFoil: true,
    identifiers: {},
    keywords: [],
    language: 'English',
    layout: 'normal',
    legalities: {},
    manaValue: 1,
    purchaseUrls: {},
    rulings: [],
    setCode: 'TST',
    subtypes: [],
    supertypes: [],
    text: '',
    type: 'Creature',
    types: ['Creature'],
    ...extra,
  };
}

function rawSet(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const cards = [
    card('00000000-0000-5000-8000-000000000001', '1', 'Alpha'),
    card('00000000-0000-5000-8000-000000000002', '2', 'Day // Night', {
      side: 'a',
      otherFaceIds: ['00000000-0000-5000-8000-000000000003'],
    }),
    card('00000000-0000-5000-8000-000000000003', '2', 'Day // Night', {
      side: 'b',
      otherFaceIds: ['00000000-0000-5000-8000-000000000002'],
    }),
    card('00000000-0000-5000-8000-000000000004', '3', 'Starter Card', {
      boosterTypes: ['deck'],
      promoTypes: ['starterdeck'],
    }),
    card('00000000-0000-5000-8000-000000000005', '4', 'Showcase Alpha', {
      isAlternative: true,
      promoTypes: ['boosterfun'],
    }),
    card('00000000-0000-5000-8000-000000000006', '5', 'Release Promo', {
      isPromo: true,
      promoTypes: ['prerelease'],
    }),
  ];
  return {
    meta: { date: '2026-08-14', version: '5.3.0+20260814' },
    data: {
      baseSetSize: 2,
      booster: {
        draft: {
          boosters: [{ contents: { main: 2, showcase: 1 }, weight: 1 }],
          boostersTotalWeight: 1,
          name: 'Test Draft Booster',
          sheets: {
            main: {
              cards: {
                '00000000-0000-5000-8000-000000000001': 1,
                '00000000-0000-5000-8000-000000000002': 1,
              },
              foil: false,
              totalWeight: 2,
            },
            showcase: {
              cards: { '00000000-0000-5000-8000-000000000005': 1 },
              foil: false,
              totalWeight: 1,
            },
          },
          sourceSetCodes: ['TST'],
        },
      },
      cards,
      code: 'TST',
      isFoilOnly: false,
      isOnlineOnly: false,
      keyruneCode: 'TST',
      name: 'Test Set',
      releaseDate: '2020-01-01',
      tokens: [
        {
          ...card('00000000-0000-5000-8000-000000000007', 'T1', 'Test Token'),
          setCode: 'TTST',
        },
      ],
      totalSetSize: 5,
      translations: {},
      type: 'core',
      ...overrides,
    },
  };
}

function fixture(): { readonly bytes: Uint8Array; readonly source: ReferenceSetSource } {
  const bytes = new TextEncoder().encode(JSON.stringify(rawSet()));
  return {
    bytes,
    source: {
      code: 'TST',
      name: 'Test Set',
      url: 'https://mtgjson.com/api/v5/TST.json',
      sha256: sha256(bytes),
      version: '5.3.0+20260814',
      builtDate: '2026-08-14',
      baseSetSize: 2,
      cardRecords: 6,
      tokenRecords: 1,
    },
  };
}

describe('printing-level reference sets', () => {
  const temporaryDirs: string[] = [];

  afterEach(() => {
    for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('pins exactly the twelve requested sources to one MTGJSON build', () => {
    expect(REFERENCE_SET_CODES).toEqual([
      'M11',
      'M13',
      'M15',
      'M20',
      'ORI',
      'ISD',
      'RTR',
      'RAV',
      'ROE',
      'SOM',
      'KTK',
      'MH2',
    ]);
    expect(new Set(REFERENCE_SET_SOURCES.map((source) => source.version))).toEqual(
      new Set(['5.3.0+20260814']),
    );
    expect(REFERENCE_SET_SOURCES.every((source) => /^[0-9a-f]{64}$/.test(source.sha256))).toBe(true);
  });

  it('retains every printing face and distinguishes population roles', () => {
    const { bytes, source } = fixture();
    const set = parseReferenceSetSource(bytes, source);

    expect(set.mainSetSize).toBe(2);
    expect(set.sourceUrl).toBe(source.url);
    expect(set.cards).toHaveLength(6);
    expect(set.tokens).toHaveLength(1);
    expect(set.cards.filter((entry) => entry.roles.includes('main-set'))).toHaveLength(3);
    expect(set.cards.find((entry) => entry.name === 'Starter Card')?.roles).toEqual(['ancillary']);
    expect(set.cards.find((entry) => entry.name === 'Showcase Alpha')?.roles).toEqual([
      'ancillary',
      'alternate-treatment',
    ]);
    expect(set.cards.find((entry) => entry.name === 'Release Promo')?.roles).toEqual(['ancillary', 'promo']);
    expect(set.tokens[0]?.roles).toEqual(['token']);
    expect(set.cards.filter((entry) => entry.number === '2').map((entry) => entry.side)).toEqual(['a', 'b']);
  });

  it('preserves weighted draft collation and validates every sheet reference', () => {
    const { bytes, source } = fixture();
    const set = parseReferenceSetSource(bytes, source);

    expect(set.draftBooster.boosters[0]?.contents).toEqual({ main: 2, showcase: 1 });
    expect(set.draftBooster.sheets['showcase']?.cards).toEqual({
      '00000000-0000-5000-8000-000000000005': 1,
    });

    const value = rawSet();
    const data = value['data'] as Record<string, unknown>;
    const booster = data['booster'] as Record<string, unknown>;
    const draft = booster['draft'] as Record<string, unknown>;
    const sheets = draft['sheets'] as Record<string, unknown>;
    const main = sheets['main'] as Record<string, unknown>;
    main['cards'] = { '00000000-0000-5000-8000-000000000099': 1 };
    main['totalWeight'] = 1;
    const broken = new TextEncoder().encode(JSON.stringify(value));
    expect(() => parseReferenceSetSource(broken, { ...source, sha256: sha256(broken) })).toThrow(
      /unknown card uuid.*00000000-0000-5000-8000-000000000099/i,
    );
  });

  it('rejects checksum, set identity, build, and record-count mismatches', () => {
    const { bytes, source } = fixture();
    expect(() => parseReferenceSetSource(bytes, { ...source, sha256: '0'.repeat(64) })).toThrow(
      /checksum mismatch/i,
    );
    expect(() => parseReferenceSetSource(bytes, { ...source, code: 'BAD' })).toThrow(
      /expected set BAD.*got TST/i,
    );
    expect(() => parseReferenceSetSource(bytes, { ...source, version: '5.2.0' })).toThrow(
      /expected MTGJSON build 5.2.0.*got 5.3.0\+20260814/i,
    );
    expect(() => parseReferenceSetSource(bytes, { ...source, cardRecords: 7 })).toThrow(
      /expected 7 card records.*got 6/i,
    );
  });

  it('rejects a partial main set even when the document still claims the full size', () => {
    const value = rawSet();
    const data = value['data'] as Record<string, unknown>;
    data['cards'] = (data['cards'] as Record<string, unknown>[]).filter((entry) => entry['number'] !== '2');
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const source = { ...fixture().source, sha256: sha256(bytes), cardRecords: 4 };

    expect(() => parseReferenceSetSource(bytes, source)).toThrow(/main-set collector positions.*missing 2/i);
  });

  it('builds a deterministic, schema-checked corpus in source-list order', () => {
    const { bytes, source } = fixture();
    const corpus = buildReferenceCorpus([{ source, bytes }]);

    expect(ReferenceCorpusSchema.parse(corpus)).toEqual(corpus);
    expect(corpus.source).toEqual({
      provider: 'MTGJSON',
      license: 'MIT',
      licenseUrl: 'https://mtgjson.com/license/',
      version: '5.3.0+20260814',
      builtDate: '2026-08-14',
    });
    expect(corpus.sets.map((set) => set.code)).toEqual(['TST']);
    expect(buildReferenceCorpus([{ source, bytes }])).toEqual(corpus);
  });

  it('downloads each pinned set as one document, reuses its verified cache, and writes the corpus', async () => {
    const { bytes, source } = fixture();
    const cacheDir = mkdtempSync(join(tmpdir(), 'mtg-reference-cache-'));
    const outputDir = mkdtempSync(join(tmpdir(), 'mtg-reference-output-'));
    temporaryDirs.push(cacheDir, outputDir);
    const calls: string[] = [];
    const client = createHttpClient({
      limiter: createLimiter(() => Promise.resolve()),
      sleep: () => Promise.resolve(),
      fetchImpl: ((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response(bytes, { status: 200 }));
      }) as unknown as typeof fetch,
    });

    const first = await fetchReferenceSetSources([source], { cacheDir, client });
    const second = await fetchReferenceSetSources([source], { cacheDir, client });
    expect(calls).toEqual([source.url]);
    expect(first[0] === undefined ? null : sha256(first[0].bytes)).toBe(source.sha256);
    expect(second[0] === undefined ? null : sha256(second[0].bytes)).toBe(source.sha256);

    const output = join(outputDir, 'reference.json');
    await writeReferenceCorpus(output, buildReferenceCorpus(first));
    expect(existsSync(output)).toBe(true);
    expect(ReferenceCorpusSchema.parse(JSON.parse(readFileSync(output, 'utf8')))).toEqual(
      buildReferenceCorpus(first),
    );
  });

  it('rejects a corrupted cached source instead of silently using or replacing it', async () => {
    const { source } = fixture();
    const cacheDir = mkdtempSync(join(tmpdir(), 'mtg-reference-corrupt-'));
    temporaryDirs.push(cacheDir);
    writeFileSync(join(cacheDir, `${source.code}-${source.sha256}.json`), '{}');
    const client = createHttpClient({
      fetchImpl: (() => {
        throw new Error('network should not be reached');
      }) as unknown as typeof fetch,
    });

    await expect(fetchReferenceSetSources([source], { cacheDir, client })).rejects.toThrow(
      /checksum mismatch/i,
    );
  });

  it('loads the committed corpus with complete set, face, token, and draft-sheet populations', () => {
    const corpus = loadReferenceCorpus();
    expect(corpus.sets.map((set) => set.code)).toEqual(REFERENCE_SET_CODES);
    expect(
      corpus.sets.map((set) => ({
        code: set.code,
        main: set.mainSetSize,
        cards: set.cards.length,
        tokens: set.tokens.length,
        draftCards: new Set(
          Object.values(set.draftBooster.sheets).flatMap((sheet) => Object.keys(sheet.cards)),
        ).size,
      })),
    ).toEqual([
      { code: 'M11', main: 249, cards: 249, tokens: 6, draftCards: 249 },
      { code: 'M13', main: 249, cards: 249, tokens: 11, draftCards: 249 },
      { code: 'M15', main: 269, cards: 284, tokens: 14, draftCards: 269 },
      { code: 'M20', main: 280, cards: 346, tokens: 12, draftCards: 280 },
      { code: 'ORI', main: 272, cards: 293, tokens: 15, draftCards: 272 },
      { code: 'ISD', main: 264, cards: 284, tokens: 13, draftCards: 264 },
      { code: 'RTR', main: 274, cards: 274, tokens: 12, draftCards: 274 },
      { code: 'RAV', main: 306, cards: 306, tokens: 0, draftCards: 306 },
      { code: 'ROE', main: 248, cards: 248, tokens: 7, draftCards: 248 },
      { code: 'SOM', main: 249, cards: 249, tokens: 10, draftCards: 249 },
      { code: 'KTK', main: 269, cards: 293, tokens: 13, draftCards: 269 },
      { code: 'MH2', main: 303, cards: 498, tokens: 21, draftCards: 441 },
    ]);
  });
});
