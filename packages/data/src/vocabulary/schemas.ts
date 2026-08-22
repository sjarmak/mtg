/**
 * Boundary schemas for the three MTGJSON vocabulary files.
 *
 * MTGJSON is MIT-licensed and rebuilt daily; its value here is the clean
 * machine-readable enumerations (`prior-art-data-sources.md` §2): legal card
 * types/subtypes/supertypes, the keyword lists, and the per-field enum values.
 * Scryfall stays the source of truth for cards; this is vocabulary only.
 */
import { z } from 'zod';

export const VOCABULARY_KINDS = ['CardTypes', 'Keywords', 'EnumValues'] as const;
export type VocabularyKind = (typeof VOCABULARY_KINDS)[number];

const MetaSchema = z.looseObject({
  date: z.string().min(1),
  version: z.string().min(1),
});

const StringListSchema = z.array(z.string());

export const CardTypesEntrySchema = z.looseObject({
  subTypes: StringListSchema,
  superTypes: StringListSchema,
});

export const CardTypesFileSchema = z.looseObject({
  meta: MetaSchema,
  data: z.record(z.string(), CardTypesEntrySchema),
});
export type CardTypesFile = z.infer<typeof CardTypesFileSchema>;

export const KeywordsFileSchema = z.looseObject({
  meta: MetaSchema,
  data: z.looseObject({
    abilityWords: StringListSchema,
    keywordAbilities: StringListSchema,
    keywordActions: StringListSchema,
  }),
});
export type KeywordsFile = z.infer<typeof KeywordsFileSchema>;

export const EnumValuesFileSchema = z.looseObject({
  meta: MetaSchema,
  data: z.record(z.string(), z.record(z.string(), StringListSchema)),
});
export type EnumValuesFile = z.infer<typeof EnumValuesFileSchema>;

export const VOCABULARY_SCHEMAS = {
  CardTypes: CardTypesFileSchema,
  Keywords: KeywordsFileSchema,
  EnumValues: EnumValuesFileSchema,
} as const;
