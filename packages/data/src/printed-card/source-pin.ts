/** Offline verification of scoped source snapshots; no database or network access. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MtgjsonSetFileSchema } from '../reference/schemas';
import { ScryfallCardSchema } from '../scryfall/schemas';

// Auxiliary sets such as MP2 have cards, but no standalone booster or tokens.
export const PrintedSourceSetSchema = MtgjsonSetFileSchema.extend({
  data: MtgjsonSetFileSchema.shape.data.extend({
    booster: MtgjsonSetFileSchema.shape.data.shape.booster.default({}),
    tokens: MtgjsonSetFileSchema.shape.data.shape.tokens.default([]),
  }),
});
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Snapshot = z.object({
  file: z.string().regex(/^[A-Z0-9]+-[a-f0-9]{64}\.(mtgjson|scryfall)\.json$/),
  url: z.url(),
  sha256: Hash,
});
export const PrintedSourceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    fetchedAt: z.iso.datetime(),
    sources: z
      .array(
        z.object({
          code: z.string().regex(/^[A-Z0-9]{2,8}$/),
          mtgjson: Snapshot.extend({ meta: MtgjsonSetFileSchema.shape.meta }),
          scryfall: Snapshot.extend({ cards: z.number().int().positive() }),
        }),
      )
      .min(1),
  })
  .superRefine((manifest, context) => {
    if (new Set(manifest.sources.map((source) => source.code)).size !== manifest.sources.length) {
      context.addIssue({ code: 'custom', message: 'duplicate source code' });
    }
  });
const hash = (body: string) => createHash('sha256').update(body).digest('hex');

export function parsePrintedSourcePin(body: string, readSnapshot: (file: string) => string) {
  const manifest = PrintedSourceManifestSchema.parse(JSON.parse(body));
  const read = (source: z.infer<typeof Snapshot>): string => {
    const content = readSnapshot(source.file);
    if (hash(content) !== source.sha256) throw new Error(`source checksum mismatch: ${source.file}`);
    return content;
  };
  const sources = manifest.sources.map((descriptor) => {
    const document = PrintedSourceSetSchema.parse(JSON.parse(read(descriptor.mtgjson)));
    const cards = z.array(ScryfallCardSchema).parse(JSON.parse(read(descriptor.scryfall)));
    if (
      document.data.code !== descriptor.code ||
      document.meta.version !== descriptor.mtgjson.meta.version ||
      document.meta.date !== descriptor.mtgjson.meta.date
    )
      throw new Error(`MTGJSON identity drift: ${descriptor.code}`);
    if (
      cards.length !== descriptor.scryfall.cards ||
      new Set(cards.map((card) => card.id)).size !== cards.length
    ) {
      throw new Error(`Scryfall count or duplicate printing drift: ${descriptor.code}`);
    }
    if (cards.some((card) => card.set !== descriptor.code.toLowerCase() || card.lang !== 'en')) {
      throw new Error(`Scryfall source drift: ${descriptor.code}`);
    }
    return { descriptor, document, cards };
  });
  return { manifest, sha256: hash(body), sources };
}
export type PrintedSourcePin = ReturnType<typeof parsePrintedSourcePin>;
export type PrintedSetSource = PrintedSourcePin['sources'][number];
