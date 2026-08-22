/**
 * Shared test scaffolding.
 *
 * Every test is hermetic: in-memory SQLite, committed JSONL fixtures, and a
 * frozen clock so provenance columns are deterministic. Nothing here touches
 * the network — the fixtures are real Scryfall and MTGJSON records captured
 * once, not live downloads.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, type BulkDescriptor, type BulkKind, type DataStore } from '@mtg/data';

const HERE = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_DIR = join(HERE, 'fixtures');

export const FIXTURES = {
  oracleCards: join(FIXTURE_DIR, 'oracle-cards.jsonl'),
  oracleCardsMalformed: join(FIXTURE_DIR, 'oracle-cards-malformed.jsonl'),
  rulings: join(FIXTURE_DIR, 'rulings.jsonl'),
  bulkCatalog: join(FIXTURE_DIR, 'bulk-catalog.json'),
  cardTypes: join(FIXTURE_DIR, 'mtgjson-cardtypes.json'),
  keywords: join(FIXTURE_DIR, 'mtgjson-keywords.json'),
  enumValues: join(FIXTURE_DIR, 'mtgjson-enumvalues.json'),
} as const;

export const FROZEN_NOW = '2026-08-09T12:00:00.000Z';

export function memoryStore(now: string = FROZEN_NOW): DataStore {
  return openStore(':memory:', { now: () => now });
}

export const ORACLE_UPDATED_AT = '2026-08-09T09:02:38.172+00:00';
export const RULINGS_UPDATED_AT = '2026-08-09T09:00:35.567+00:00';

export function descriptorFor(kind: BulkKind, updatedAt: string): BulkDescriptor {
  return {
    kind,
    updatedAt,
    downloadUri: `https://data.scryfall.io/${kind}/${kind}-test.jsonl.gz`,
    compressedSize: null,
    description: `test descriptor for ${kind}`,
  };
}

export function readFixtureJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** Oracle ids of the fixture cards, so assertions do not repeat UUID literals. */
export const ORACLE_IDS = {
  lightningBolt: '4457ed35-7c10-48c8-9776-456485fdf070',
  grizzlyBears: '14c8f55d-d177-4c25-a931-ebeb9e6062a0',
  fireIce: 'ae92942b-919c-4ea9-b693-85fcef765d5a',
  delver: 'edd531b9-f615-4399-8c8c-1c5e18c4acbf',
  forest: 'b34bb2dc-c1af-4d77-b0b3-a0fb342a5fc6',
  wrathOfGod: '34515b16-c9a4-4f98-8c77-416a7a523407',
  /** Rulings-only: exercises a ruling whose card was never ingested. */
  tarmogoyf: '45900b2f-f6a9-4c42-9642-008f3c1cf6dd',
} as const;

/** Valid card records in `oracle-cards.jsonl` (the reversible one is rejected). */
export const VALID_FIXTURE_CARDS = 6;
export const FIXTURE_CARD_LINES = 7;
