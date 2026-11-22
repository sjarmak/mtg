import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { PrintedCardPresentation, PrintedPresentationCatalog } from '@mtg/printed-card';
import { FORGE_SCRIPT_ARCHIVE_PATH } from '../src/printed-card/forge-install';
import { buildMomirPresentationCatalog } from '../src/printed-card/momir-presentation';

type Row = Record<string, unknown>;

const UNKNOWN_TO_THE_STORE = [
  'A-Baba Lysaga, Night Witch',
  'A-Goldspan Dragon',
  'A-Hullbreaker Horror',
  'A-Luminarch Aspirant',
  'A-Omnath, Locus of Creation',
];

const OLDER_DIGITAL_ID = '00000000-0000-4000-8000-000000000001';

function frontFace(script: string): { readonly name: string; readonly types: readonly string[] } {
  const front = script.split(/^ALTERNATE$/m)[0] ?? '';
  const field = (label: string): string => new RegExp(`^${label}:(.*)$`, 'm').exec(front)?.[1]?.trim() ?? '';
  return { name: field('Name'), types: field('Types').split(' ') };
}

function rebalancedCreatureNames(): string[] {
  const root = mkdtempSync(join(tmpdir(), 'momir-rebalanced-'));
  try {
    execFileSync('unzip', ['-q', FORGE_SCRIPT_ARCHIVE_PATH, 'rebalanced/*', '-d', root], {
      timeout: 60_000,
    });
    const directory = join(root, 'rebalanced');
    return readdirSync(directory)
      .map((file) => frontFace(readFileSync(join(directory, file), 'utf8')))
      .filter((face) => face.types.includes('Creature'))
      .map((face) => face.name)
      .sort((left, right) => left.localeCompare(right, 'en'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('Momir presentation catalog', () => {
  let store: Database.Database;
  let catalog: PrintedPresentationCatalog;
  let byName: ReadonlyMap<string, PrintedCardPresentation>;

  const named = (name: string): PrintedCardPresentation => {
    const card = byName.get(name);
    if (card === undefined) throw new Error(`the catalog has no ${name}`);
    return card;
  };
  const isDigital = (card: PrintedCardPresentation): boolean =>
    store.prepare('SELECT digital FROM printing WHERE scryfall_id = ?').pluck().get(card.scryfallId) === 1;

  beforeAll(() => {
    store = new Database(join(process.cwd(), 'data/store/mtg.sqlite'), {
      readonly: true,
      fileMustExist: true,
    });
    catalog = buildMomirPresentationCatalog(store);
    byName = new Map(catalog.cards.flatMap((card) => card.observedNames.map((name) => [name, card])));
  }, 30_000);

  afterAll(() => {
    store.close();
  });

  it('selects one eligible printing for every creature Oracle identity', () => {
    const squirrel = named('Ravenous Squirrel');
    expect(catalog.cards.length).toBeGreaterThan(20_000);
    expect(squirrel).toMatchObject({ setCode: 'MH2', rarity: 'uncommon' });
    expect(squirrel.art.status).toBe('available');
    expect(new Set(catalog.cards.map((card) => card.oracleId)).size).toBe(catalog.cards.length);
  });

  it('admits the Momir Vig avatar by name despite its only printing being digital', () => {
    const avatar = named('Momir Vig, Simic Visionary Avatar');
    expect(avatar).toMatchObject({
      typeLine: 'Vanguard',
      setCode: 'PMOA',
      oracleText:
        "{X}, Discard a card: Create a token that's a copy of a creature card with mana value X chosen at random. Activate only as a sorcery and only once each turn.",
    });
    expect(avatar.art.status).toBe('available');
  });

  it('gives a creature with no paper printing the face of its digital one', () => {
    for (const name of ['A-Akki Ronin', 'A-Civil Servant']) {
      const card = named(name);
      expect(card.manaCost, name).toMatch(/^\{/);
      expect(card.power, name).toMatch(/^\d+$/);
      expect(card.toughness, name).toMatch(/^\d+$/);
      expect(card.oracleText, name).not.toBeNull();
      expect(card.art.status, name).toBe('available');
      expect(isDigital(card), name).toBe(true);
    }
    expect(named('Akki Ronin')).toMatchObject({ setCode: 'NEO' });
    expect(isDigital(named('Akki Ronin'))).toBe(false);
  });

  it('prefers a paper printing over a digital one, however old the digital one is', () => {
    const paper = store
      .prepare(
        `SELECT p.* FROM printing p JOIN oracle_card o ON o.oracle_id = p.oracle_id
         WHERE o.name = 'Akki Ronin' AND p.digital = 0`,
      )
      .get() as Row;
    const oracle = store
      .prepare('SELECT * FROM oracle_card WHERE oracle_id = ?')
      .get(paper['oracle_id']) as Row;
    const olderDigital: Row = {
      ...paper,
      scryfall_id: OLDER_DIGITAL_ID,
      set_code: 'xdig',
      digital: 1,
      released_at: '1990-01-01',
      raw_json: JSON.stringify({
        ...(JSON.parse(String(paper['raw_json'])) as Row),
        id: OLDER_DIGITAL_ID,
        digital: true,
      }),
    };
    const scratch = new Database(':memory:');
    try {
      const tables = store
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name IN ('oracle_card', 'printing')")
        .pluck()
        .all() as string[];
      for (const table of tables) scratch.exec(table);
      const insert = (table: string, row: Row): void => {
        const columns = Object.keys(row);
        scratch
          .prepare(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          )
          .run(...columns.map((column) => row[column]));
      };
      insert('oracle_card', oracle);
      insert('printing', olderDigital);
      expect(buildMomirPresentationCatalog(scratch).cards.map((card) => card.scryfallId)).toEqual([
        OLDER_DIGITAL_ID,
      ]);
      insert('printing', paper);
      expect(buildMomirPresentationCatalog(scratch).cards.map((card) => card.scryfallId)).toEqual([
        paper['scryfall_id'],
      ]);
    } finally {
      scratch.close();
    }
  });

  it('never draws a digital face for an Oracle identity the store holds a paper printing of', () => {
    const paperOracleIds = new Set(
      store
        .prepare(
          `SELECT DISTINCT oracle_id FROM printing
           WHERE source = 'scryfall' AND lang = 'en' AND digital = 0 AND instr(raw_json, '"image_uris"') > 0`,
        )
        .pluck()
        .all() as string[],
    );
    const digitalFaces = catalog.cards.filter((card) => isDigital(card));
    expect(digitalFaces.length).toBeGreaterThan(1_000);
    expect(digitalFaces.filter((card) => paperOracleIds.has(card.oracleId)).map((card) => card.name)).toEqual(
      [],
    );
  });

  it('has a face for every rebalanced creature the engine can create, bar the ones the store has never held', () => {
    const names = rebalancedCreatureNames();
    expect(names.length).toBeGreaterThan(140);
    const storeNames = new Set(
      (
        store.prepare("SELECT name FROM oracle_card WHERE source = 'scryfall'").pluck().all() as string[]
      ).flatMap((name) => name.split(' // ')),
    );
    expect(names.filter((name) => !storeNames.has(name))).toEqual(UNKNOWN_TO_THE_STORE);
    expect(names.filter((name) => storeNames.has(name) && !byName.has(name))).toEqual([]);
  }, 60_000);
});
