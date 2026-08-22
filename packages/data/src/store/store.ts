/**
 * Store lifecycle: open (creating and versioning the schema), close, and the
 * injectable clock every write uses for its `ingested_at` provenance.
 *
 * The clock is a constructor parameter rather than a call to `Date.now()`
 * inside the writers, so an ingest run replayed over identical input produces
 * byte-identical rows. That is what makes idempotency testable instead of
 * merely asserted.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SchemaVersionError } from '../errors';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';

export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

export interface DataStore {
  readonly db: Database.Database;
  readonly path: string;
  readonly now: Clock;
}

export interface OpenStoreOptions {
  readonly readonly?: boolean;
  readonly now?: Clock;
}

const MEMORY_PATHS = new Set([':memory:', '']);

export function openStore(path: string, options: OpenStoreOptions = {}): DataStore {
  if (!MEMORY_PATHS.has(path)) mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, options.readonly === true ? { readonly: true } : {});
  db.pragma('foreign_keys = OFF');
  if (options.readonly !== true) {
    if (!MEMORY_PATHS.has(path)) db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    applySchema(db);
  }
  assertSchemaVersion(db, path);

  return { db, path, now: options.now ?? systemClock };
}

export function closeStore(store: DataStore): void {
  store.db.close();
}

function applySchema(db: Database.Database): void {
  const migrate = db.transaction(() => {
    for (const statement of SCHEMA_STATEMENTS) db.prepare(statement).run();
    db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO NOTHING`).run(
      String(SCHEMA_VERSION),
    );
  });
  migrate();
}

function assertSchemaVersion(db: Database.Database, path: string): void {
  const row = db.prepare<[], { value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`).get();
  const found = row === undefined ? 0 : Number.parseInt(row.value, 10);
  if (found !== SCHEMA_VERSION) throw new SchemaVersionError(path, found, SCHEMA_VERSION);
}

/** Reads a `meta` value, or `null` when the key was never written. */
export function getMeta(store: DataStore, key: string): string | null {
  const row = store.db.prepare<[string], { value: string }>(`SELECT value FROM meta WHERE key = ?`).get(key);
  return row === undefined ? null : row.value;
}

/** Writes a `meta` value, replacing any previous one. */
export function setMeta(store: DataStore, key: string, value: string): void {
  store.db
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}
