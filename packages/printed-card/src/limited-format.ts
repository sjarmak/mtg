/** Portable printed products and recipes, separate from card presentation and play admission. */
import { z } from 'zod';

const Name = z.string().trim().min(1);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const Positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Weights = z.record(Name, Positive).refine((weights) => Object.keys(weights).length > 0);

const Product = z.strictObject({
  id: Name,
  setCode: Name,
  sourceSetCodes: z.array(Name).min(1),
  // Same structural contract as @mtg/deckbuild's PackCollation. Semantic
  // validation stays with that sampler, against the resolved printing IDs.
  collation: z.strictObject({
    sheets: z
      .array(
        z.strictObject({
          name: Name,
          weights: Weights,
          foil: z.boolean(),
          balanceColors: z.boolean().optional(),
        }),
      )
      .min(1),
    boosters: z.array(z.strictObject({ contents: Weights, weight: Positive })).min(1),
  }),
});

export const PrintedLimitedFormatSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('printed-limited-format'),
    id: Name,
    name: Name,
    sources: z
      .array(
        z.strictObject({
          code: Name,
          catalogFormat: Name,
          catalogSha256: Sha256,
          mtgjson: z.strictObject({ url: z.url(), sha256: Sha256, version: Name }),
        }),
      )
      .min(1),
    products: z.array(Product).min(1),
    draft: z.strictObject({
      seats: z.number().int().min(2).max(8),
      rounds: z.array(Name).min(1),
      botPolicy: Name,
    }),
    sealed: z.strictObject({ boosters: z.array(Name).min(1) }),
    basicLandPolicy: z.enum(['remove', 'keep']),
    contentSha256: Sha256,
  })
  .superRefine((format, context) => {
    const issue = (message: string): void => context.addIssue({ code: 'custom', message });
    const sources = new Set(format.sources.map((source) => source.code));
    if (sources.size !== format.sources.length) issue('duplicate source set code');
    if (new Set(format.sources.map((source) => source.catalogFormat)).size !== format.sources.length) {
      issue('duplicate source catalog identity');
    }
    const products = new Set(format.products.map((product) => product.id));
    if (products.size !== format.products.length) issue('duplicate product id');
    for (const product of format.products) {
      if (!product.sourceSetCodes.includes(product.setCode))
        issue(`product ${product.id} omits its primary source`);
      if (new Set(product.sourceSetCodes).size !== product.sourceSetCodes.length)
        issue(`product ${product.id} repeats a source`);
      for (const source of product.sourceSetCodes) {
        if (!sources.has(source)) issue(`product ${product.id} names unknown source ${source}`);
      }
    }
    for (const product of [...format.draft.rounds, ...format.sealed.boosters]) {
      if (!products.has(product)) issue(`recipe names unknown product ${product}`);
    }
  });

export type PrintedLimitedFormat = z.infer<typeof PrintedLimitedFormatSchema>;
export type PrintedBoosterProduct = PrintedLimitedFormat['products'][number];

export const PrintedDraftTranscriptSchema = z.strictObject({
  version: z.literal(1),
  formatId: Name,
  fingerprint: Sha256,
  seed: Name,
  /** Absent in legacy saves: use the recipe's original policy. */
  botPolicy: Name.optional(),
  humanSeatIds: z.array(Name).min(1),
  picks: z.record(Name, z.array(Name)),
});
export type PrintedDraftTranscript = z.infer<typeof PrintedDraftTranscriptSchema>;

export function parsePrintedLimitedFormat(value: unknown): PrintedLimitedFormat {
  return PrintedLimitedFormatSchema.parse(value);
}

/** Node and browser callers hash this same subject, including collation and replay policy. */
export function serializedPrintedLimitedFormatContent(format: PrintedLimitedFormat): string {
  const { contentSha256: _checksum, ...content } = format;
  return `${JSON.stringify(content)}\n`;
}
