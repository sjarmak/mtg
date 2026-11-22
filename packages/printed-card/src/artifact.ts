/** Browser-safe schema for portable printed-card catalogs. */
import { z } from 'zod';

const NonemptyString = z.string().min(1);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const OpaqueId = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const Color = z.enum(['W', 'U', 'B', 'R', 'G']);
const COLOR_ORDER = new Map(Color.options.map((color, index) => [color, index]));
const Mana = z.enum(['W', 'U', 'B', 'R', 'G', 'C']);
const MANA_ORDER = new Map(Mana.options.map((color, index) => [color, index]));

export const PrintedColorListSchema = z
  .array(Color)
  .max(5)
  .superRefine((colors, context) => {
    const canonical = [...new Set(colors)].sort(
      (left, right) => (COLOR_ORDER.get(left) ?? 0) - (COLOR_ORDER.get(right) ?? 0),
    );
    if (canonical.join('') !== colors.join('')) {
      context.addIssue({ code: 'custom', message: 'colors must be unique and in WUBRG order' });
    }
  });

export const PrintedManaListSchema = z
  .array(Mana)
  .max(6)
  .superRefine((colors, context) => {
    const canonical = [...new Set(colors)].sort(
      (left, right) => (MANA_ORDER.get(left) ?? 0) - (MANA_ORDER.get(right) ?? 0),
    );
    if (canonical.join('') !== colors.join('')) {
      context.addIssue({
        code: 'custom',
        message: 'mana outputs must be unique and in WUBRGC order',
      });
    }
  });

const NullableText = z.string().nullable();

export const PrintedCardFaceSchema = z.strictObject({
  name: NonemptyString,
  manaCost: NullableText,
  typeLine: NonemptyString,
  oracleText: NullableText,
  power: NullableText,
  toughness: NullableText,
  loyalty: NullableText,
  colors: PrintedColorListSchema.nullable(),
});

const ImageUris = z
  .record(NonemptyString, z.url())
  .refine((uris) => Object.keys(uris).length > 0, 'an available image record must not be empty');

export const PrintedCardArtSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('available'),
    source: z.literal('scryfall'),
    scryfallId: OpaqueId,
    images: z
      .array(
        z.strictObject({
          face: z.number().int().nonnegative().nullable(),
          uris: ImageUris,
        }),
      )
      .min(1),
  }),
  z.strictObject({
    status: z.literal('missing'),
    source: z.literal('scryfall'),
    scryfallId: OpaqueId,
    reason: NonemptyString,
  }),
]);

export const PrintedCardCatalogEntrySchema = z
  .strictObject({
    physicalId: NonemptyString,
    position: z.number().int().positive(),
    sourceName: NonemptyString,
    correctedName: NonemptyString,
    name: NonemptyString,
    oracleId: OpaqueId,
    scryfallId: OpaqueId,
    forgeScript: NonemptyString,
    forgeScriptSha256: Sha256,
    layout: NonemptyString,
    manaCost: NullableText,
    manaValue: z.number().nonnegative(),
    typeLine: NonemptyString,
    oracleText: NullableText,
    power: NullableText,
    toughness: NullableText,
    loyalty: NullableText,
    colors: PrintedColorListSchema,
    colorIdentity: PrintedColorListSchema,
    producedMana: PrintedManaListSchema.nullable().optional(),
    faces: z.array(PrintedCardFaceSchema).min(1),
    art: PrintedCardArtSchema,
  })
  .superRefine((card, context) => {
    if (card.art.scryfallId !== card.scryfallId) {
      context.addIssue({ code: 'custom', path: ['art', 'scryfallId'], message: 'art identity drift' });
    }
    if (card.art.status !== 'available') return;
    const seen = new Set<string>();
    for (const [index, image] of card.art.images.entries()) {
      if (image.face !== null && image.face >= card.faces.length) {
        context.addIssue({
          code: 'custom',
          path: ['art', 'images', index, 'face'],
          message: 'art face is outside the face list',
        });
      }
      const key = image.face === null ? 'whole' : String(image.face);
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['art', 'images', index, 'face'],
          message: 'art face appears more than once',
        });
      }
      seen.add(key);
    }
  });

export const PrintedCardCatalogSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('printed-card-catalog'),
    format: NonemptyString,
    source: z.strictObject({
      provenanceArtifact: NonemptyString,
      provenanceSha256: Sha256,
      scryfallProvider: NonemptyString,
      scryfallBulkFile: NonemptyString,
      scryfallBulkSha256: Sha256,
      scryfallBulkUpdatedAt: NonemptyString,
    }),
    forgeVersion: NonemptyString,
    cards: z.array(PrintedCardCatalogEntrySchema).min(1),
    contentSha256: Sha256,
  })
  .superRefine((catalog, context) => {
    const physicalIds = new Set<string>();
    for (const [index, card] of catalog.cards.entries()) {
      if (card.position !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['cards', index, 'position'],
          message: 'catalog positions must be contiguous and in source order',
        });
      }
      const expectedPhysicalId = `${catalog.format}:${String(card.position).padStart(4, '0')}:${card.scryfallId}`;
      if (card.physicalId !== expectedPhysicalId) {
        context.addIssue({
          code: 'custom',
          path: ['cards', index, 'physicalId'],
          message: 'physical id must bind format, source position, and Scryfall identity',
        });
      }
      if (physicalIds.has(card.physicalId)) {
        context.addIssue({
          code: 'custom',
          path: ['cards', index, 'physicalId'],
          message: 'duplicate physical id',
        });
      }
      physicalIds.add(card.physicalId);
    }
  });

export type PrintedCardFace = z.infer<typeof PrintedCardFaceSchema>;
export type PrintedCardCatalogEntry = z.infer<typeof PrintedCardCatalogEntrySchema>;
export type PrintedCardCatalog = z.infer<typeof PrintedCardCatalogSchema>;

export function parsePrintedCardCatalog(input: unknown): PrintedCardCatalog {
  return PrintedCardCatalogSchema.parse(input);
}

/** Canonical checksum subject; hashing stays with a Node producer or Web Crypto caller. */
export function printedCardCatalogContent(catalog: PrintedCardCatalog): unknown {
  return {
    format: catalog.format,
    source: catalog.source,
    forgeVersion: catalog.forgeVersion,
    cards: catalog.cards,
  };
}

export function serializedPrintedCardCatalogContent(catalog: PrintedCardCatalog): string {
  return `${JSON.stringify(printedCardCatalogContent(catalog))}\n`;
}
