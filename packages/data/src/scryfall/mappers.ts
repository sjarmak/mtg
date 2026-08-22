/**
 * Mechanical projection of validated Scryfall objects into store rows.
 *
 * Pure functions, no IO. Multi-face handling is the only non-obvious part:
 * transform/split/modal cards leave `mana_cost`, `oracle_text` and P/T off the
 * top level and put them on `card_faces`, so those columns are reconstructed
 * from the faces rather than stored as NULL.
 */
import { createHash } from 'node:crypto';
import type { Source } from '../config';
import type { ColorLetter, ScryfallCard, ScryfallRuling } from './schemas';

/** WUBRG print order; the canonical order for every color string we store. */
const COLOR_ORDER: Readonly<Record<ColorLetter, number>> = { W: 0, U: 1, B: 2, R: 3, G: 4 };

export interface OracleCardRowInput {
  readonly oracle_id: string;
  readonly source: Source;
  readonly name: string;
  readonly mana_cost: string | null;
  readonly mana_value: number;
  readonly type_line: string;
  readonly oracle_text: string | null;
  readonly power: string | null;
  readonly toughness: string | null;
  readonly loyalty: string | null;
  readonly colors: string;
  readonly color_identity: string;
  readonly layout: string;
  readonly keywords: string;
  readonly legalities: string | null;
  readonly reserved: number;
  readonly raw_json: string;
  readonly bulk_updated_at: string | null;
  readonly ingested_at: string;
}

export interface PrintingRowInput {
  readonly scryfall_id: string;
  readonly oracle_id: string;
  readonly source: Source;
  readonly set_code: string;
  readonly set_name: string | null;
  readonly collector_number: string;
  readonly rarity: string;
  readonly artist: string | null;
  readonly released_at: string | null;
  readonly lang: string;
  readonly digital: number;
  readonly border_color: string | null;
  readonly frame: string | null;
  readonly image_uris: string | null;
  readonly raw_json: string;
  readonly bulk_updated_at: string | null;
  readonly ingested_at: string;
}

export interface RulingRowInput {
  readonly ruling_id: string;
  readonly oracle_id: string;
  readonly source: Source;
  readonly ruling_source: string;
  readonly published_at: string;
  readonly comment: string;
  readonly raw_json: string;
  readonly bulk_updated_at: string | null;
  readonly ingested_at: string;
}

/** `['U','W']` → `'WU'`; colorless → `''`. Deduped and WUBRG-sorted. */
export function canonicalColors(colors: readonly ColorLetter[] | undefined): string {
  if (colors === undefined || colors.length === 0) return '';
  const unique = [...new Set(colors)];
  unique.sort((a, b) => COLOR_ORDER[a] - COLOR_ORDER[b]);
  return unique.join('');
}

function faceJoin(values: readonly (string | undefined)[], separator: string): string | null {
  const present = values.filter((value): value is string => value !== undefined && value.length > 0);
  return present.length === 0 ? null : present.join(separator);
}

function firstDefined(values: readonly (string | undefined)[]): string | null {
  return values.find((value): value is string => value !== undefined) ?? null;
}

/**
 * Stable identity for a ruling. Scryfall's ruling objects carry no id of their
 * own, so re-ingesting the same file must not duplicate rows: the digest of the
 * four content fields is the primary key.
 */
export function rulingId(ruling: ScryfallRuling): string {
  return createHash('sha256')
    .update([ruling.oracle_id, ruling.published_at, ruling.source, ruling.comment].join('\u0000'))
    .digest('hex');
}

export interface MapContext {
  readonly source: Source;
  readonly bulkUpdatedAt: string | null;
  readonly ingestedAt: string;
  /** Raw line text, stored verbatim so upstream additions survive ingest. */
  readonly rawJson: string;
}

export function toOracleCardRow(card: ScryfallCard, context: MapContext): OracleCardRowInput {
  const faces = card.card_faces ?? [];
  const manaCost =
    card.mana_cost ??
    faceJoin(
      faces.map((face) => face.mana_cost),
      ' // ',
    );
  const oracleText =
    card.oracle_text ??
    faceJoin(
      faces.map((face) => face.oracle_text),
      '\n//\n',
    );
  const faceColors = faces.flatMap((face) => face.colors ?? []);
  const colors = card.colors ?? (faceColors.length > 0 ? faceColors : undefined);

  return {
    oracle_id: card.oracle_id,
    source: context.source,
    name: card.name,
    mana_cost: manaCost,
    mana_value: card.cmc,
    type_line: card.type_line,
    oracle_text: oracleText,
    power: card.power ?? firstDefined(faces.map((face) => face.power)),
    toughness: card.toughness ?? firstDefined(faces.map((face) => face.toughness)),
    loyalty: card.loyalty ?? firstDefined(faces.map((face) => face.loyalty)),
    colors: canonicalColors(colors),
    color_identity: canonicalColors(card.color_identity),
    layout: card.layout,
    keywords: JSON.stringify([...card.keywords].sort()),
    legalities: card.legalities === undefined ? null : JSON.stringify(card.legalities),
    reserved: card.reserved ? 1 : 0,
    raw_json: context.rawJson,
    bulk_updated_at: context.bulkUpdatedAt,
    ingested_at: context.ingestedAt,
  };
}

export function toPrintingRow(card: ScryfallCard, context: MapContext): PrintingRowInput {
  const faceImages = card.card_faces?.[0]?.image_uris;
  const images = card.image_uris ?? faceImages;
  return {
    scryfall_id: card.id,
    oracle_id: card.oracle_id,
    source: context.source,
    set_code: card.set.toUpperCase(),
    set_name: card.set_name ?? null,
    collector_number: card.collector_number,
    rarity: card.rarity,
    artist: card.artist ?? card.card_faces?.[0]?.artist ?? null,
    released_at: card.released_at ?? null,
    lang: card.lang,
    digital: card.digital ? 1 : 0,
    border_color: card.border_color ?? null,
    frame: card.frame ?? null,
    image_uris: images === undefined ? null : JSON.stringify(images),
    raw_json: context.rawJson,
    bulk_updated_at: context.bulkUpdatedAt,
    ingested_at: context.ingestedAt,
  };
}

export function toRulingRow(ruling: ScryfallRuling, context: MapContext): RulingRowInput {
  return {
    ruling_id: rulingId(ruling),
    oracle_id: ruling.oracle_id,
    source: context.source,
    ruling_source: ruling.source,
    published_at: ruling.published_at,
    comment: ruling.comment,
    raw_json: context.rawJson,
    bulk_updated_at: context.bulkUpdatedAt,
    ingested_at: context.ingestedAt,
  };
}
