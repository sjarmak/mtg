/**
 * Staging the official set icons: which sets are asked for, and what a miss does.
 *
 * `../../tools/stage-set-icons.ts` says why the roster is decided from the
 * launcher's own staging evidence and why one set's failure does not empty the
 * rest. These tests inject the cache and the copy so nothing here reaches the
 * network or the disk.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrintedCardPresentation, PrintedPresentationCatalog } from '@mtg/printed-card';
import {
  describeSetIcons,
  libraryIconRoster,
  parentIconCode,
  printedCatalogIconRoster,
  setIconRoster,
  setIconsEnv,
  stagedPresentationSetCodes,
  stageSetIcons,
} from '../../tools/stage-set-icons';

function presentationCard(setCode: string, index: number): PrintedCardPresentation {
  const uuid = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return {
    physicalId: `${setCode}:${String(index)}`,
    position: index + 1,
    name: `Test Card ${String(index)}`,
    oracleId: uuid,
    scryfallId: uuid,
    manaCost: null,
    manaValue: 0,
    typeLine: 'Creature',
    oracleText: null,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [],
    colorIdentity: [],
    faces: [
      {
        name: `Test Card ${String(index)}`,
        manaCost: null,
        typeLine: 'Creature',
        oracleText: null,
        power: null,
        toughness: null,
        loyalty: null,
        colors: null,
      },
    ],
    art: { status: 'missing', source: 'scryfall', scryfallId: uuid, reason: 'test fixture' },
    observedNames: [`Test Card ${String(index)}`],
    setCode,
    rarity: 'common',
  };
}

function presentationCatalog(setCodes: readonly string[]): PrintedPresentationCatalog {
  return {
    schemaVersion: 1,
    kind: 'printed-presentation-catalog',
    selection: 'oldest-english-image-printing-per-oracle-creature-paper-before-digital-plus-named-avatar',
    cards: setCodes.map((code, index) => presentationCard(code, index)),
  };
}

describe('which sets are asked for', () => {
  it('takes the official sets and every printed catalog, never a custom set', () => {
    const roster = setIconRoster(
      [
        { code: 'XMP', origin: 'custom' },
        { code: 'M11', origin: 'official' },
        { code: null, origin: 'official' },
        { code: 'm13', origin: 'official' },
      ],
      [{ code: 'AKH' }, { code: 'hou' }, { code: 'M11' }],
    );
    expect(roster).toEqual(['M11', 'M13', 'AKH', 'HOU']);
  });

  it('is empty for a lab of custom sets', () => {
    expect(setIconRoster([{ code: 'XMP', origin: 'custom' }], [])).toEqual([]);
  });
});

describe('the roster a build reads off disk', () => {
  it('reads code and origin from each candidate it can read', () => {
    const roster = libraryIconRoster(
      [
        { path: '/out/reference/m11/set.json', what: 'the reduced reference build' },
        { path: '/out/XMP/set.json', what: 'the flagship' },
      ],
      (path) =>
        path === '/out/reference/m11/set.json'
          ? JSON.stringify({ set: { code: 'M11', origin: 'official' } })
          : JSON.stringify({ set: { code: 'XMP' } }),
    );
    expect(roster).toEqual([
      { code: 'M11', name: null, reduced: false, origin: 'official' },
      { code: 'XMP', name: null, reduced: false, origin: 'custom' },
    ]);
  });

  it('skips a candidate that is not on this checkout', () => {
    const roster = libraryIconRoster([{ path: '/out/XMP/set.json', what: 'the flagship' }], () => {
      throw new Error('ENOENT');
    });
    expect(roster).toEqual([]);
  });
});

describe('staging the roster', () => {
  it('serves every icon it could fetch and names the one it could not', async () => {
    const published: string[] = [];
    const staged = await stageSetIcons({
      codes: ['M11', 'XYZ', 'ISD'],
      cacheDir: '/cache',
      publicDir: '/public/set-icons',
      cache: (url) => {
        if (url.endsWith('/xyz.svg')) return Promise.reject(new Error('HTTP 404'));
        return Promise.resolve({
          name: url,
          path: `/cache/${url.endsWith('/m11.svg') ? 'a' : 'b'}.svg`,
          fetched: url.endsWith('/isd.svg'),
        });
      },
      publish: (from, to) => {
        published.push(`${from} -> ${to}`);
      },
    });
    expect(staged.staged).toEqual(['M11', 'ISD']);
    expect(staged.fetched).toBe(1);
    expect(staged.reused).toBe(1);
    expect(staged.failures).toEqual(['XYZ: HTTP 404']);
    expect(published).toEqual([
      '/cache/a.svg -> /public/set-icons/M11.svg',
      '/cache/b.svg -> /public/set-icons/ISD.svg',
    ]);
    expect(setIconsEnv(staged)).toBe('M11,ISD');
  });

  it("falls back to a token or Alchemy set's parent icon when its own code 404s", async () => {
    const published: string[] = [];
    const requested: string[] = [];
    const staged = await stageSetIcons({
      codes: ['TACR', 'YMID', 'UNK'],
      cacheDir: '/cache',
      publicDir: '/public/set-icons',
      cache: (url) => {
        requested.push(url);
        if (url.endsWith('/tacr.svg') || url.endsWith('/ymid.svg') || url.endsWith('/unk.svg')) {
          return Promise.reject(new Error('HTTP 404'));
        }
        return Promise.resolve({ name: url, path: `/cache/${url}.svg`, fetched: true });
      },
      publish: (from, to) => {
        published.push(`${from} -> ${to}`);
      },
    });
    expect(requested).toEqual([
      'https://svgs.scryfall.io/sets/tacr.svg',
      'https://svgs.scryfall.io/sets/acr.svg',
      'https://svgs.scryfall.io/sets/ymid.svg',
      'https://svgs.scryfall.io/sets/mid.svg',
      'https://svgs.scryfall.io/sets/unk.svg',
    ]);
    expect(staged.staged).toEqual(['TACR', 'YMID']);
    expect(staged.failures).toEqual(['UNK: HTTP 404']);
    expect(published).toEqual([
      '/cache/https://svgs.scryfall.io/sets/acr.svg.svg -> /public/set-icons/TACR.svg',
      '/cache/https://svgs.scryfall.io/sets/mid.svg.svg -> /public/set-icons/YMID.svg',
    ]);
  });

  it('reports the code’s own failure, not the alias attempt, when both 404', async () => {
    const staged = await stageSetIcons({
      codes: ['TSB'],
      cacheDir: '/cache',
      publicDir: '/public/set-icons',
      cache: (url) => Promise.reject(new Error(`HTTP 404 for ${url}`)),
      publish: () => {
        throw new Error('should never publish an icon neither fetch produced');
      },
    });
    expect(staged.staged).toEqual([]);
    expect(staged.failures).toEqual(['TSB: HTTP 404 for https://svgs.scryfall.io/sets/tsb.svg']);
  });
});

describe('the token/Alchemy alias a code names', () => {
  it('strips the family letter for a 4-letter token or Alchemy code', () => {
    expect(parentIconCode('TACR')).toBe('ACR');
    expect(parentIconCode('ymid')).toBe('MID');
    expect(parentIconCode('T40K')).toBe('40K');
  });

  it('names no parent for a code outside the T/Y families, or a bare letter', () => {
    expect(parentIconCode('M11')).toBeNull();
    expect(parentIconCode('UNK')).toBeNull();
    expect(parentIconCode('T')).toBeNull();
  });
});

describe('what the launcher says', () => {
  it('says so in one line when nothing official was staged', () => {
    expect(describeSetIcons({ staged: [], fetched: 0, reused: 0, failures: [] })).toBe(
      'No official sets staged, so every seal draws its set code.',
    );
  });

  it('names the sets served and the one that fell back to its code', () => {
    const lines = describeSetIcons({
      staged: ['M11', 'ISD'],
      fetched: 1,
      reused: 1,
      failures: ['XYZ: HTTP 404'],
    });
    expect(lines).toContain('Fetched 1 set icons');
    expect(lines).toContain('M11, ISD');
    expect(lines).toContain('Could not stage 1 of 3 set icons (XYZ: HTTP 404)');
    expect(lines).toContain('draw their code in the seal');
  });

  it('reports a warm cache without claiming a fetch', () => {
    expect(describeSetIcons({ staged: ['M11'], fetched: 0, reused: 1, failures: [] })).toMatch(
      /^1 set icons \(M11\) already in /,
    );
  });
});

describe('a presentation catalog spanning many real sets', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const stagePresentationFile = (publicDir: string, formatId: string, setCodes: readonly string[]): void => {
    const dir = join(publicDir, 'formats', formatId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'presentation-deadbeef.json'), JSON.stringify(presentationCatalog(setCodes)));
  };

  it('reads every distinct setCode a staged presentation catalog names', () => {
    const publicDir = mkdtempSync(join(tmpdir(), 'set-icons-presentation-'));
    roots.push(publicDir);
    stagePresentationFile(publicDir, 'momir-basic', ['M11', 'MH2', 'm11', 'ISD']);
    expect(stagedPresentationSetCodes(publicDir, 'momir-basic')).toEqual(['M11', 'MH2', 'ISD']);
  });

  it('is undefined when nothing has staged that format yet', () => {
    const publicDir = mkdtempSync(join(tmpdir(), 'set-icons-presentation-'));
    roots.push(publicDir);
    expect(stagedPresentationSetCodes(publicDir, 'momir-basic')).toBeUndefined();
  });

  it("puts Momir Basic's whole setCode roster onto its nominal catalog, leaving an ordinary format untouched", () => {
    const publicDir = mkdtempSync(join(tmpdir(), 'set-icons-presentation-'));
    roots.push(publicDir);
    stagePresentationFile(publicDir, 'momir-basic', ['M11', 'MH2', 'ISD', 'DOM']);
    const roster = printedCatalogIconRoster(
      [
        { id: 'momir-basic', presentationCatalog: 'momir-oldest-creatures', catalogs: [{ code: 'M11' }] },
        { id: 'akh-hou', catalogs: [{ code: 'AKH' }, { code: 'HOU' }] },
      ],
      publicDir,
    );
    expect(roster).toEqual([
      { code: 'M11', setCodes: ['M11', 'MH2', 'ISD', 'DOM'] },
      { code: 'AKH' },
      { code: 'HOU' },
    ]);
    expect(setIconRoster([], roster)).toEqual(['M11', 'MH2', 'ISD', 'DOM', 'AKH', 'HOU']);
  });
});
