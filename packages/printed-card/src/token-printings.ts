/**
 * Official token printings a format's cards create, for presentation only.
 *
 * A catalog holds admitted card printings and nothing else: no token is
 * admitted, scripted or dealt, so a token printing is not a catalog entry and
 * a file of them binds to no admission. What it does bind to is the engine's
 * own name for the object. A foreign engine names its tokens as it likes
 * (Forge says "Pegasus Token" for what Scryfall prints as "Pegasus"), and an
 * observed object is matched to a printing by that exact name, so every entry
 * carries the names the producer *witnessed* in the engine's token scripts,
 * never one derived from the printed name. An entry with no witnessed name
 * could never be looked up and is refused at the schema.
 */
import { z } from 'zod';
import { PrintedCardArtSchema, PrintedCardFaceSchema, PrintedColorListSchema } from './artifact';

const NonemptyString = z.string().min(1);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const OpaqueId = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);

export const PrintedTokenPrintingSchema = z
  .strictObject({
    physicalId: NonemptyString,
    position: z.number().int().positive(),
    /** The token set the printing is from (`TSCD`), which is not a catalog code. */
    setCode: z.string().regex(/^T[A-Z0-9]+$/),
    name: NonemptyString,
    /** Exact engine names for this printing, read from the engine's own token scripts. */
    observedNames: z.array(NonemptyString).min(1),
    oracleId: OpaqueId,
    scryfallId: OpaqueId,
    typeLine: NonemptyString,
    power: z.string().nullable(),
    toughness: z.string().nullable(),
    loyalty: z.string().nullable(),
    colors: PrintedColorListSchema,
    faces: z.array(PrintedCardFaceSchema).min(1),
    art: PrintedCardArtSchema,
  })
  .superRefine((token, context) => {
    if (token.art.scryfallId !== token.scryfallId) {
      context.addIssue({ code: 'custom', path: ['art', 'scryfallId'], message: 'art identity drift' });
    }
    if (!/^Token\b/u.test(token.typeLine)) {
      context.addIssue({ code: 'custom', path: ['typeLine'], message: 'a token printing is typed Token' });
    }
  });

export const PrintedTokenPrintingsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sets: z
      .array(
        z.strictObject({
          code: z.string().regex(/^T[A-Z0-9]+$/),
          sourceUrl: z.url(),
          sourceSha256: Sha256,
          fetchedAt: z.iso.datetime(),
        }),
      )
      .min(1),
    /** The engine whose token scripts witnessed every `observedNames` entry. */
    engine: z.strictObject({ name: z.literal('forge'), version: NonemptyString }),
    tokens: z.array(PrintedTokenPrintingSchema),
  })
  .superRefine((file, context) => {
    const codes = new Set(file.sets.map((set) => set.code));
    if (codes.size !== file.sets.length) {
      context.addIssue({ code: 'custom', path: ['sets'], message: 'duplicate token set' });
    }
    const ids = new Set<string>();
    file.tokens.forEach((token, index) => {
      if (ids.has(token.physicalId)) {
        context.addIssue({ code: 'custom', path: ['tokens', index], message: 'duplicate token printing' });
      }
      ids.add(token.physicalId);
      if (!codes.has(token.setCode)) {
        context.addIssue({
          code: 'custom',
          path: ['tokens', index, 'setCode'],
          message: 'token set not listed',
        });
      }
    });
  });

export type PrintedTokenPrinting = z.infer<typeof PrintedTokenPrintingSchema>;
export type PrintedTokenPrintings = z.infer<typeof PrintedTokenPrintingsSchema>;

export function parsePrintedTokenPrintings(input: unknown): PrintedTokenPrintings {
  return PrintedTokenPrintingsSchema.parse(input);
}
