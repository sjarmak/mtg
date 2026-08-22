/**
 * Prepared-statement writers for the three content tables plus the reject log.
 *
 * Every write is an upsert keyed on the natural primary key, so re-ingesting a
 * file — whole or from a resume checkpoint — converges to the same rows. The
 * statements are prepared once per store and reused across the whole run;
 * re-preparing per row is the difference between minutes and hours on a 100k
 * line file.
 */
import type { Database, Statement } from 'better-sqlite3';
import type { OracleCardRowInput, PrintingRowInput, RulingRowInput } from '../scryfall/mappers';
import type { DataStore } from './store';

export interface RejectRowInput {
  readonly bulk_kind: string;
  readonly line_number: number;
  readonly reason: string;
  readonly excerpt: string;
  readonly rejected_at: string;
}

export interface Writers {
  readonly oracleCard: Statement<[OracleCardRowInput]>;
  readonly printing: Statement<[PrintingRowInput]>;
  readonly ruling: Statement<[RulingRowInput]>;
  readonly reject: Statement<[RejectRowInput]>;
}

const ORACLE_CARD_SQL = `
  INSERT INTO oracle_card (
    oracle_id, source, name, mana_cost, mana_value, type_line, oracle_text,
    power, toughness, loyalty, colors, color_identity, layout, keywords,
    legalities, reserved, raw_json, bulk_updated_at, ingested_at
  ) VALUES (
    @oracle_id, @source, @name, @mana_cost, @mana_value, @type_line, @oracle_text,
    @power, @toughness, @loyalty, @colors, @color_identity, @layout, @keywords,
    @legalities, @reserved, @raw_json, @bulk_updated_at, @ingested_at
  )
  ON CONFLICT(oracle_id) DO UPDATE SET
    source = excluded.source,
    name = excluded.name,
    mana_cost = excluded.mana_cost,
    mana_value = excluded.mana_value,
    type_line = excluded.type_line,
    oracle_text = excluded.oracle_text,
    power = excluded.power,
    toughness = excluded.toughness,
    loyalty = excluded.loyalty,
    colors = excluded.colors,
    color_identity = excluded.color_identity,
    layout = excluded.layout,
    keywords = excluded.keywords,
    legalities = excluded.legalities,
    reserved = excluded.reserved,
    raw_json = excluded.raw_json,
    bulk_updated_at = excluded.bulk_updated_at,
    ingested_at = excluded.ingested_at
`;

const PRINTING_SQL = `
  INSERT INTO printing (
    scryfall_id, oracle_id, source, set_code, set_name, collector_number, rarity,
    artist, released_at, lang, digital, border_color, frame, image_uris,
    raw_json, bulk_updated_at, ingested_at
  ) VALUES (
    @scryfall_id, @oracle_id, @source, @set_code, @set_name, @collector_number, @rarity,
    @artist, @released_at, @lang, @digital, @border_color, @frame, @image_uris,
    @raw_json, @bulk_updated_at, @ingested_at
  )
  ON CONFLICT(scryfall_id) DO UPDATE SET
    oracle_id = excluded.oracle_id,
    source = excluded.source,
    set_code = excluded.set_code,
    set_name = excluded.set_name,
    collector_number = excluded.collector_number,
    rarity = excluded.rarity,
    artist = excluded.artist,
    released_at = excluded.released_at,
    lang = excluded.lang,
    digital = excluded.digital,
    border_color = excluded.border_color,
    frame = excluded.frame,
    image_uris = excluded.image_uris,
    raw_json = excluded.raw_json,
    bulk_updated_at = excluded.bulk_updated_at,
    ingested_at = excluded.ingested_at
`;

const RULING_SQL = `
  INSERT INTO ruling (
    ruling_id, oracle_id, source, ruling_source, published_at, comment,
    raw_json, bulk_updated_at, ingested_at
  ) VALUES (
    @ruling_id, @oracle_id, @source, @ruling_source, @published_at, @comment,
    @raw_json, @bulk_updated_at, @ingested_at
  )
  ON CONFLICT(ruling_id) DO UPDATE SET
    oracle_id = excluded.oracle_id,
    source = excluded.source,
    ruling_source = excluded.ruling_source,
    published_at = excluded.published_at,
    comment = excluded.comment,
    raw_json = excluded.raw_json,
    bulk_updated_at = excluded.bulk_updated_at,
    ingested_at = excluded.ingested_at
`;

const REJECT_SQL = `
  INSERT INTO ingest_reject (bulk_kind, line_number, reason, excerpt, rejected_at)
  VALUES (@bulk_kind, @line_number, @reason, @excerpt, @rejected_at)
  ON CONFLICT(bulk_kind, line_number) DO UPDATE SET
    reason = excluded.reason,
    excerpt = excluded.excerpt,
    rejected_at = excluded.rejected_at
`;

export function createWriters(store: DataStore): Writers {
  const db: Database = store.db;
  return {
    oracleCard: db.prepare<[OracleCardRowInput]>(ORACLE_CARD_SQL),
    printing: db.prepare<[PrintingRowInput]>(PRINTING_SQL),
    ruling: db.prepare<[RulingRowInput]>(RULING_SQL),
    reject: db.prepare<[RejectRowInput]>(REJECT_SQL),
  };
}
