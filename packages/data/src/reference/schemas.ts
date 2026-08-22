/** Boundary schemas for pinned MTGJSON set files and the normalized corpus. */
import { z } from 'zod';

const NonemptyString = z.string().min(1);
const PositiveWeight = z.number().int().positive();
const UuidSchema = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const StringList = z.array(z.string());

export const MtgjsonMetaSchema = z.looseObject({
  date: NonemptyString,
  version: NonemptyString,
});

export const MtgjsonCardSchema = z.looseObject({
  uuid: UuidSchema,
  name: NonemptyString,
  number: NonemptyString,
  rarity: NonemptyString,
  setCode: NonemptyString,
  identifiers: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  availability: StringList.default([]),
  boosterTypes: StringList.optional(),
  promoTypes: StringList.optional(),
  isAlternative: z.boolean().optional(),
  isPromo: z.boolean().optional(),
  side: z.string().optional(),
  otherFaceIds: z.array(UuidSchema).optional(),
  layout: z.string().optional(),
  manaCost: z.string().optional(),
  manaValue: z.number().nonnegative().optional(),
  text: z.string().optional(),
  originalText: z.string().optional(),
  type: z.string().optional(),
  originalType: z.string().optional(),
  types: StringList.optional(),
  supertypes: StringList.optional(),
  subtypes: StringList.optional(),
  colors: StringList.optional(),
  colorIdentity: StringList.optional(),
  keywords: StringList.optional(),
  power: z.string().optional(),
  toughness: z.string().optional(),
  loyalty: z.string().optional(),
});

export const MtgjsonTokenSchema = MtgjsonCardSchema.omit({ rarity: true }).extend({
  layout: z.string().optional(),
});

export const BoosterSheetSchema = z.looseObject({
  balanceColors: z.boolean().optional(),
  cards: z.record(UuidSchema, PositiveWeight),
  foil: z.boolean(),
  totalWeight: PositiveWeight,
});

export const DraftBoosterSchema = z.looseObject({
  boosters: z
    .array(
      z.looseObject({
        contents: z.record(z.string(), z.number().int().positive()),
        weight: PositiveWeight,
      }),
    )
    .min(1),
  boostersTotalWeight: PositiveWeight,
  languages: StringList.optional(),
  name: z.string().optional(),
  sheets: z.record(z.string(), BoosterSheetSchema),
  sourceSetCodes: z.array(NonemptyString).min(1),
});

export const MtgjsonSetFileSchema = z.looseObject({
  meta: MtgjsonMetaSchema,
  data: z.looseObject({
    baseSetSize: z.number().int().positive(),
    booster: z.record(z.string(), DraftBoosterSchema),
    cards: z.array(MtgjsonCardSchema).min(1),
    code: NonemptyString,
    name: NonemptyString,
    releaseDate: NonemptyString,
    tokens: z.array(MtgjsonTokenSchema),
    totalSetSize: z.number().int().positive(),
    type: NonemptyString,
  }),
});
export type MtgjsonSetFile = z.infer<typeof MtgjsonSetFileSchema>;

export const ReferenceCardRoleSchema = z.enum(['main-set', 'ancillary', 'promo', 'alternate-treatment']);
export type ReferenceCardRole = z.infer<typeof ReferenceCardRoleSchema>;

export const ReferenceCardSchema = z.object({
  uuid: UuidSchema,
  name: NonemptyString,
  number: NonemptyString,
  rarity: NonemptyString,
  setCode: NonemptyString,
  roles: z.array(ReferenceCardRoleSchema).min(1),
  identifiers: z.record(z.string(), z.union([z.string(), z.number()])),
  availability: StringList,
  boosterTypes: StringList,
  promoTypes: StringList,
  side: z.string().optional(),
  otherFaceIds: z.array(UuidSchema),
  layout: z.string().optional(),
  manaCost: z.string().optional(),
  manaValue: z.number().nonnegative().optional(),
  text: z.string().optional(),
  originalText: z.string().optional(),
  type: z.string().optional(),
  originalType: z.string().optional(),
  types: StringList,
  supertypes: StringList,
  subtypes: StringList,
  colors: StringList,
  colorIdentity: StringList,
  keywords: StringList,
  power: z.string().optional(),
  toughness: z.string().optional(),
  loyalty: z.string().optional(),
});
export type ReferenceCard = z.infer<typeof ReferenceCardSchema>;

export const ReferenceTokenSchema = ReferenceCardSchema.omit({ rarity: true, roles: true }).extend({
  roles: z.tuple([z.literal('token')]),
});
export type ReferenceToken = z.infer<typeof ReferenceTokenSchema>;

export const ReferenceSetSchema = z.object({
  code: NonemptyString,
  name: NonemptyString,
  sourceUrl: z.url(),
  releaseDate: NonemptyString,
  setType: NonemptyString,
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  mainSetSize: z.number().int().positive(),
  totalSetSize: z.number().int().positive(),
  cards: z.array(ReferenceCardSchema).min(1),
  tokens: z.array(ReferenceTokenSchema),
  draftBooster: DraftBoosterSchema,
});
export type ReferenceSet = z.infer<typeof ReferenceSetSchema>;

export const ReferenceCorpusSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    provider: z.literal('MTGJSON'),
    license: z.literal('MIT'),
    licenseUrl: z.url(),
    version: NonemptyString,
    builtDate: NonemptyString,
  }),
  sets: z.array(ReferenceSetSchema).min(1),
});
export type ReferenceCorpus = z.infer<typeof ReferenceCorpusSchema>;
