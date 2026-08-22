/**
 * Row shapes the query API hands back, and the SQL-row → domain-row mapping.
 *
 * `rawJson` is carried as a string rather than parsed eagerly: callers that
 * only need the projected columns should not pay to deserialize 33k Scryfall
 * objects. `parseRaw` is there for the ones that do.
 */
import type { Source } from '../config';

export interface CardRow {
  readonly oracleId: string;
  readonly source: Source;
  readonly name: string;
  readonly manaCost: string | null;
  readonly manaValue: number;
  readonly typeLine: string;
  readonly oracleText: string | null;
  readonly power: string | null;
  readonly toughness: string | null;
  readonly loyalty: string | null;
  /** WUBRG-ordered letters, `''` for colorless. */
  readonly colors: string;
  readonly colorIdentity: string;
  readonly layout: string;
  readonly keywords: readonly string[];
  readonly legalities: Readonly<Record<string, string>> | null;
  readonly reserved: boolean;
  readonly rawJson: string;
  readonly bulkUpdatedAt: string | null;
  readonly ingestedAt: string;
}

export interface PrintingRow {
  readonly scryfallId: string;
  readonly oracleId: string;
  readonly source: Source;
  readonly setCode: string;
  readonly setName: string | null;
  readonly collectorNumber: string;
  readonly rarity: string;
  readonly artist: string | null;
  readonly releasedAt: string | null;
  readonly lang: string;
  readonly digital: boolean;
  readonly imageUris: Readonly<Record<string, string>> | null;
  readonly rawJson: string;
  readonly bulkUpdatedAt: string | null;
  readonly ingestedAt: string;
}

export interface RulingRow {
  readonly rulingId: string;
  readonly oracleId: string;
  readonly source: Source;
  readonly rulingSource: string;
  readonly publishedAt: string;
  readonly comment: string;
  readonly bulkUpdatedAt: string | null;
  readonly ingestedAt: string;
}

export interface RawCardRow {
  oracle_id: string;
  source: string;
  name: string;
  mana_cost: string | null;
  mana_value: number;
  type_line: string;
  oracle_text: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  colors: string;
  color_identity: string;
  layout: string;
  keywords: string;
  legalities: string | null;
  reserved: number;
  raw_json: string;
  bulk_updated_at: string | null;
  ingested_at: string;
}

export interface RawPrintingRow {
  scryfall_id: string;
  oracle_id: string;
  source: string;
  set_code: string;
  set_name: string | null;
  collector_number: string;
  rarity: string;
  artist: string | null;
  released_at: string | null;
  lang: string;
  digital: number;
  border_color: string | null;
  frame: string | null;
  image_uris: string | null;
  raw_json: string;
  bulk_updated_at: string | null;
  ingested_at: string;
}

export interface RawRulingRow {
  ruling_id: string;
  oracle_id: string;
  source: string;
  ruling_source: string;
  published_at: string;
  comment: string;
  raw_json: string;
  bulk_updated_at: string | null;
  ingested_at: string;
}

function asSource(value: string): Source {
  return value === 'lab' ? 'lab' : 'scryfall';
}

function parseJsonObject(value: string | null): Readonly<Record<string, string>> | null {
  if (value === null) return null;
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, string>;
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === 'string');
}

export function toCardRow(row: RawCardRow): CardRow {
  return {
    oracleId: row.oracle_id,
    source: asSource(row.source),
    name: row.name,
    manaCost: row.mana_cost,
    manaValue: row.mana_value,
    typeLine: row.type_line,
    oracleText: row.oracle_text,
    power: row.power,
    toughness: row.toughness,
    loyalty: row.loyalty,
    colors: row.colors,
    colorIdentity: row.color_identity,
    layout: row.layout,
    keywords: parseStringArray(row.keywords),
    legalities: parseJsonObject(row.legalities),
    reserved: row.reserved !== 0,
    rawJson: row.raw_json,
    bulkUpdatedAt: row.bulk_updated_at,
    ingestedAt: row.ingested_at,
  };
}

export function toPrintingRow(row: RawPrintingRow): PrintingRow {
  return {
    scryfallId: row.scryfall_id,
    oracleId: row.oracle_id,
    source: asSource(row.source),
    setCode: row.set_code,
    setName: row.set_name,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    artist: row.artist,
    releasedAt: row.released_at,
    lang: row.lang,
    digital: row.digital !== 0,
    imageUris: parseJsonObject(row.image_uris),
    rawJson: row.raw_json,
    bulkUpdatedAt: row.bulk_updated_at,
    ingestedAt: row.ingested_at,
  };
}

export function toRulingRow(row: RawRulingRow): RulingRow {
  return {
    rulingId: row.ruling_id,
    oracleId: row.oracle_id,
    source: asSource(row.source),
    rulingSource: row.ruling_source,
    publishedAt: row.published_at,
    comment: row.comment,
    bulkUpdatedAt: row.bulk_updated_at,
    ingestedAt: row.ingested_at,
  };
}

/** Deserializes the preserved upstream JSON for a row that needs it. */
export function parseRaw(row: { readonly rawJson: string }): unknown {
  return JSON.parse(row.rawJson) as unknown;
}
