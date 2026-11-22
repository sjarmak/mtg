/** Presentation facts bind to existing printings, not draft or gameplay identity. */
import { z } from 'zod';
import type { PrintedCardCatalog } from './artifact';

export const PrintedRaritySchema = z.enum(['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus']);
export type PrintedRarity = z.infer<typeof PrintedRaritySchema>;
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const PrintedDisplayMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  catalogs: z
    .array(
      z.strictObject({
        catalogSha256: Hash,
        sourceSha256: Hash,
        rarities: z.record(z.string().min(1), PrintedRaritySchema),
      }),
    )
    .min(1),
});

export function validatePrintedDisplayMetadata(input: unknown, catalogs: readonly PrintedCardCatalog[]) {
  const metadata = PrintedDisplayMetadataSchema.parse(input);
  if (
    metadata.catalogs.length !== catalogs.length ||
    new Set(metadata.catalogs.map((row) => row.catalogSha256)).size !== catalogs.length
  ) {
    throw new Error('Display metadata catalog coverage mismatch');
  }
  for (const catalog of catalogs) {
    const row = metadata.catalogs.find((entry) => entry.catalogSha256 === catalog.contentSha256);
    if (row === undefined || row.sourceSha256 !== catalog.source.scryfallBulkSha256) {
      throw new Error(`Display metadata source mismatch: ${catalog.format}`);
    }
    if (
      Object.keys(row.rarities).length !== catalog.cards.length ||
      catalog.cards.some((card) => row.rarities[card.physicalId] === undefined)
    ) {
      throw new Error(`Display metadata printing coverage mismatch: ${catalog.format}`);
    }
  }
  return metadata;
}
