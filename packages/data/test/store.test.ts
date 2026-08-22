import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  SchemaVersionError,
  closeStore,
  getMeta,
  openStore,
  setMeta,
  storeStats,
} from '@mtg/data';
import { memoryStore } from './helpers';

describe('store schema', () => {
  const temporaryDirs: string[] = [];

  afterEach(() => {
    for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates every table on a fresh database', () => {
    const store = memoryStore();
    const tables = store.db
      .prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row) => row.name);

    expect(tables).toEqual([
      'ingest_reject',
      'ingest_run',
      'meta',
      'oracle_card',
      'printing',
      'ruling',
      'vocabulary',
    ]);
    expect(getMeta(store, 'schema_version')).toBe(String(SCHEMA_VERSION));
    closeStore(store);
  });

  it('creates the indexes the query API relies on', () => {
    const store = memoryStore();
    const indexes = store.db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all()
      .map((row) => row.name);

    expect(indexes).toEqual([
      'oracle_card_color_identity_idx',
      'oracle_card_name_idx',
      'oracle_card_source_idx',
      'printing_oracle_idx',
      'printing_set_idx',
      'ruling_oracle_idx',
    ]);
    closeStore(store);
  });

  it('reports empty statistics before any ingest', () => {
    const store = memoryStore();
    expect(storeStats(store)).toEqual({
      oracleCards: 0,
      labCards: 0,
      printings: 0,
      rulings: 0,
      sets: 0,
      rejects: 0,
    });
    closeStore(store);
  });

  it('re-opening a file store is a no-op, not a re-migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtg-data-store-'));
    temporaryDirs.push(dir);
    const path = join(dir, 'nested', 'mtg.sqlite');

    const first = openStore(path);
    setMeta(first, 'marker', 'first-open');
    closeStore(first);

    const second = openStore(path);
    expect(getMeta(second, 'marker')).toBe('first-open');
    expect(getMeta(second, 'schema_version')).toBe(String(SCHEMA_VERSION));
    closeStore(second);
  });

  it('refuses a database written by an incompatible schema version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtg-data-version-'));
    temporaryDirs.push(dir);
    const path = join(dir, 'mtg.sqlite');

    const store = openStore(path);
    setMeta(store, 'schema_version', String(SCHEMA_VERSION + 7));
    closeStore(store);

    expect(() => openStore(path)).toThrow(SchemaVersionError);
  });
});
