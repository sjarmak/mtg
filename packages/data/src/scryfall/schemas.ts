/**
 * Boundary schemas for everything Scryfall sends us.
 *
 * Two rules, both deliberate:
 *  - *Required* fields are exactly the ones this package projects into typed
 *    columns. If one is missing the record is rejected and counted, never
 *    silently defaulted.
 *  - Everything else is optional and unknown keys pass through, because the
 *    raw JSON is stored verbatim and upstream adds fields without warning.
 *    Validation must not be the reason a new Scryfall field breaks ingest.
 */
import { z } from 'zod';
import { BULK_KINDS } from '../config';

/**
 * Permissive UUID shape. `z.uuid()` enforces RFC version/variant nibbles;
 * Scryfall ids are opaque identifiers and rejecting 33k cards over a nibble
 * would be a self-inflicted outage.
 */
const IdSchema = z.string().regex(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, 'not a UUID-shaped id');

const ColorLetterSchema = z.enum(['W', 'U', 'B', 'R', 'G']);
export type ColorLetter = z.infer<typeof ColorLetterSchema>;

const StringMapSchema = z.record(z.string(), z.string());

/** One entry of `GET /bulk-data`. */
export const BulkEntrySchema = z.looseObject({
  object: z.literal('bulk_data'),
  id: IdSchema,
  type: z.string().min(1),
  updated_at: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  jsonl_download_uri: z.url(),
  compressed_size: z.number().int().nonnegative().optional(),
});
export type BulkEntry = z.infer<typeof BulkEntrySchema>;

export const BulkCatalogSchema = z.looseObject({
  object: z.literal('list'),
  data: z.array(BulkEntrySchema).min(1),
});
export type BulkCatalog = z.infer<typeof BulkCatalogSchema>;

export const BulkKindSchema = z.enum(BULK_KINDS);

/**
 * A face of a multi-face card. Transform/modal cards carry mana cost, oracle
 * text and P/T here rather than at the top level, so the mappers read faces
 * when the top-level field is absent.
 */
export const CardFaceSchema = z.looseObject({
  name: z.string().min(1),
  mana_cost: z.string().optional(),
  type_line: z.string().optional(),
  oracle_text: z.string().optional(),
  power: z.string().optional(),
  toughness: z.string().optional(),
  loyalty: z.string().optional(),
  colors: z.array(ColorLetterSchema).optional(),
  artist: z.string().optional(),
  image_uris: StringMapSchema.optional(),
});
export type CardFace = z.infer<typeof CardFaceSchema>;

/**
 * A Scryfall card object as it appears in the `oracle_cards` / `default_cards`
 * bulk files. `oracle_id`, `cmc` and `type_line` are documented nullable for
 * `reversible_card` layouts — those rows are rejected on purpose: they are
 * cosmetic double-sided reprints whose real gameplay objects are separate
 * records, so admitting them would create oracle rows with no oracle identity.
 */
export const ScryfallCardSchema = z.looseObject({
  object: z.literal('card').optional(),
  id: IdSchema,
  oracle_id: IdSchema,
  name: z.string().min(1),
  lang: z.string().min(1),
  layout: z.string().min(1),
  cmc: z.number().nonnegative(),
  type_line: z.string().min(1),
  color_identity: z.array(ColorLetterSchema),
  colors: z.array(ColorLetterSchema).optional(),
  keywords: z.array(z.string()).default([]),
  mana_cost: z.string().optional(),
  oracle_text: z.string().optional(),
  power: z.string().optional(),
  toughness: z.string().optional(),
  loyalty: z.string().optional(),
  reserved: z.boolean().default(false),
  digital: z.boolean().default(false),
  legalities: StringMapSchema.optional(),
  card_faces: z.array(CardFaceSchema).min(1).optional(),
  set: z.string().min(1),
  set_name: z.string().optional(),
  set_type: z.string().optional(),
  collector_number: z.string().min(1),
  rarity: z.string().min(1),
  artist: z.string().optional(),
  released_at: z.string().optional(),
  border_color: z.string().optional(),
  frame: z.string().optional(),
  promo: z.boolean().default(false),
  reprint: z.boolean().default(false),
  booster: z.boolean().default(false),
  image_uris: StringMapSchema.optional(),
  image_status: z.string().optional(),
  scryfall_uri: z.string().optional(),
});
export type ScryfallCard = z.infer<typeof ScryfallCardSchema>;

/** A ruling object from the `rulings` bulk file (keyed by `oracle_id`). */
export const ScryfallRulingSchema = z.looseObject({
  object: z.literal('ruling').optional(),
  oracle_id: IdSchema,
  source: z.string().min(1),
  published_at: z.string().min(1),
  comment: z.string().min(1),
});
export type ScryfallRuling = z.infer<typeof ScryfallRulingSchema>;

/** Renders zod issues as one compact line for reject logs. */
export function issueSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<root>'}: ${issue.message}`)
    .join('; ');
}
