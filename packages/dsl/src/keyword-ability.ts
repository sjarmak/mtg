/** Parameterized and engine-only keyword-ability records shared below Card. */
import { z } from 'zod';
import { BasicLandTypeSchema, ColorSchema, GrantableKeywordSchema } from './vocabulary';

/** The bounded qualities Protection may name in the M11/M13 execution slice. */
export const ProtectionQualitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('color'), color: ColorSchema }),
  z.strictObject({ kind: z.literal('subtype'), subtype: z.string() }),
]);

/**
 * Keyword abilities whose rules consequences are wider than layer-6's flat
 * evergreen vocabulary. They are engine-only card data: the set generator's
 * keyword and model answer schemas remain unchanged.
 */
export const KeywordAbilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('defender') }),
  z.strictObject({ kind: z.literal('landwalk'), landType: BasicLandTypeSchema }),
  z.strictObject({ kind: z.literal('hexproof') }),
  z.strictObject({ kind: z.literal('indestructible') }),
  z.strictObject({ kind: z.literal('protection'), quality: ProtectionQualitySchema }),
  z.strictObject({ kind: z.literal('doubleStrike') }),
  z.strictObject({ kind: z.literal('shroud') }),
  z.strictObject({ kind: z.literal('flash') }),
  z.strictObject({ kind: z.literal('intimidate') }),
  z.strictObject({ kind: z.literal('unleash') }),
]);

/** One ordered member of a bundled static keyword-ability grant. */
export const GrantedKeywordAbilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('keyword'), keyword: GrantableKeywordSchema }),
  z.strictObject({ kind: z.literal('protection'), quality: ProtectionQualitySchema }),
  z.strictObject({ kind: z.literal('landwalk'), landType: BasicLandTypeSchema }),
]);

export type ProtectionQuality = z.infer<typeof ProtectionQualitySchema>;
export type KeywordAbility = z.infer<typeof KeywordAbilitySchema>;
