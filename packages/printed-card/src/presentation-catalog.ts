import { z } from 'zod';
import { PrintedCardArtSchema, PrintedCardFaceSchema, PrintedColorListSchema } from './artifact';
import { PrintedRaritySchema } from './display-metadata';

const OpaqueId = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const Mana = z.enum(['W', 'U', 'B', 'R', 'G', 'C']);

export const PrintedCardPresentationSchema = z.strictObject({
  physicalId: z.string().min(1),
  position: z.number().int().positive(),
  name: z.string().min(1),
  oracleId: OpaqueId,
  scryfallId: OpaqueId,
  manaCost: z.string().nullable(),
  manaValue: z.number().nonnegative(),
  typeLine: z.string().min(1),
  oracleText: z.string().nullable(),
  power: z.string().nullable(),
  toughness: z.string().nullable(),
  loyalty: z.string().nullable(),
  colors: PrintedColorListSchema,
  colorIdentity: PrintedColorListSchema,
  faces: z.array(PrintedCardFaceSchema).min(1),
  art: PrintedCardArtSchema,
  observedNames: z.array(z.string().min(1)).min(1),
  producedMana: z.array(Mana).nullable().optional(),
  setCode: z.string().min(1),
  rarity: PrintedRaritySchema,
});

export const PrintedPresentationCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-presentation-catalog'),
  selection: z.literal(
    'oldest-english-image-printing-per-oracle-creature-paper-before-digital-plus-named-avatar',
  ),
  cards: z.array(PrintedCardPresentationSchema).min(1),
});

export type PrintedCardPresentation = z.infer<typeof PrintedCardPresentationSchema>;
export type PrintedPresentationCatalog = z.infer<typeof PrintedPresentationCatalogSchema>;

export function parsePrintedPresentationCatalog(input: unknown): PrintedPresentationCatalog {
  return PrintedPresentationCatalogSchema.parse(input);
}
