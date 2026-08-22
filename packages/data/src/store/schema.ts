/**
 * The local store's DDL.
 *
 * Shape follows `docs/research/prior-art-data-sources.md` §8: mirror Scryfall's
 * own oracle/printing split, keep the raw JSON per row so an upstream schema
 * change never loses data, project typed columns for what the lab queries, and
 * record provenance (`source`, `bulk_updated_at`, `ingested_at`) on every row.
 *
 * Generated lab cards live in `oracle_card`/`printing` with `source = 'lab'`,
 * which is what lets the deck lab, sim and renderer stay indifferent to card
 * origin.
 *
 * No foreign-key constraints: the three bulk files ingest independently and in
 * any order (rulings routinely land before the cards they reference), so
 * referential integrity is a query-time join concern, not a write-time one.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS oracle_card (
     oracle_id       TEXT PRIMARY KEY,
     source          TEXT NOT NULL,
     name            TEXT NOT NULL,
     mana_cost       TEXT,
     mana_value      REAL NOT NULL,
     type_line       TEXT NOT NULL,
     oracle_text     TEXT,
     power           TEXT,
     toughness       TEXT,
     loyalty         TEXT,
     colors          TEXT NOT NULL,
     color_identity  TEXT NOT NULL,
     layout          TEXT NOT NULL,
     keywords        TEXT NOT NULL,
     legalities      TEXT,
     reserved        INTEGER NOT NULL DEFAULT 0,
     raw_json        TEXT NOT NULL,
     bulk_updated_at TEXT,
     ingested_at     TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS oracle_card_name_idx ON oracle_card (name COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS oracle_card_color_identity_idx ON oracle_card (color_identity)`,
  `CREATE INDEX IF NOT EXISTS oracle_card_source_idx ON oracle_card (source)`,

  `CREATE TABLE IF NOT EXISTS printing (
     scryfall_id      TEXT PRIMARY KEY,
     oracle_id        TEXT NOT NULL,
     source           TEXT NOT NULL,
     set_code         TEXT NOT NULL,
     set_name         TEXT,
     collector_number TEXT NOT NULL,
     rarity           TEXT NOT NULL,
     artist           TEXT,
     released_at      TEXT,
     lang             TEXT NOT NULL,
     digital          INTEGER NOT NULL DEFAULT 0,
     border_color     TEXT,
     frame            TEXT,
     image_uris       TEXT,
     raw_json         TEXT NOT NULL,
     bulk_updated_at  TEXT,
     ingested_at      TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS printing_oracle_idx ON printing (oracle_id)`,
  `CREATE INDEX IF NOT EXISTS printing_set_idx ON printing (set_code)`,

  `CREATE TABLE IF NOT EXISTS ruling (
     ruling_id       TEXT PRIMARY KEY,
     oracle_id       TEXT NOT NULL,
     source          TEXT NOT NULL,
     ruling_source   TEXT NOT NULL,
     published_at    TEXT NOT NULL,
     comment         TEXT NOT NULL,
     raw_json        TEXT NOT NULL,
     bulk_updated_at TEXT,
     ingested_at     TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ruling_oracle_idx ON ruling (oracle_id)`,

  `CREATE TABLE IF NOT EXISTS ingest_run (
     bulk_kind       TEXT PRIMARY KEY,
     bulk_updated_at TEXT NOT NULL,
     download_uri    TEXT NOT NULL,
     content_path    TEXT,
     lines_done      INTEGER NOT NULL DEFAULT 0,
     rows_written    INTEGER NOT NULL DEFAULT 0,
     rows_rejected   INTEGER NOT NULL DEFAULT 0,
     status          TEXT NOT NULL,
     started_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     finished_at     TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS ingest_reject (
     bulk_kind   TEXT NOT NULL,
     line_number INTEGER NOT NULL,
     reason      TEXT NOT NULL,
     excerpt     TEXT NOT NULL,
     rejected_at TEXT NOT NULL,
     PRIMARY KEY (bulk_kind, line_number)
   )`,

  `CREATE TABLE IF NOT EXISTS vocabulary (
     kind        TEXT PRIMARY KEY,
     version     TEXT NOT NULL,
     built_date  TEXT NOT NULL,
     raw_json    TEXT NOT NULL,
     ingested_at TEXT NOT NULL
   )`,
];
