/**
 * Printed-characteristic filters for cards outside the battlefield.
 *
 * This shape lives below both effects and activation costs. Keeping it out of
 * `effects.ts` preserves the package's one-way schema graph: an effect may own
 * an activated ability through a token, while an activation cost may now own a
 * filter, so either high-level module owning the shared schema would close a
 * cycle. The leaf imports only vocabulary and is safe for both callers.
 */
import { z } from 'zod';
import { CardKindSchema, ColorSchema, GrantableKeywordSchema, SupertypeSchema } from './vocabulary';

/** Largest literal mana-value ceiling admitted by printed-card and target filters. */
export const MAX_FILTER_MANA_VALUE = 16;

const CARD_FILTER_FIELDS = {
  cardTypes: z.array(CardKindSchema).min(1).optional(),
  excludeCardTypes: z.array(CardKindSchema).min(1).optional(),
  subtypes: z.array(z.string().min(1)).min(1).optional(),
  supertypes: z.array(SupertypeSchema).min(1).optional(),
  colors: z.array(ColorSchema).min(1).optional(),
  /** Matches a card printing any listed parameterless keyword. */
  keywords: z.array(GrantableKeywordSchema).min(1).optional(),
  names: z.array(z.string().min(1)).min(1).optional(),
  /** Matches CR 202.3's exact mana value. */
  manaValue: z.number().int().min(0).max(MAX_FILTER_MANA_VALUE).optional(),
  maxManaValue: z.number().int().min(0).max(MAX_FILTER_MANA_VALUE).optional(),
} as const;

/** One nonempty printed quality inside a whole-filter OR. */
export const CardFilterAlternativeSchema = z
  .strictObject(CARD_FILTER_FIELDS)
  .refine((filter) => Object.values(filter).some((value) => value !== undefined), {
    message: 'a card-filter alternative must state a printed quality',
  })
  .refine((filter) => filter.manaValue === undefined || filter.maxManaValue === undefined, {
    message: 'a card-filter alternative states either an exact mana value or a maximum, not both',
  });

/** A predicate over the characteristics printed on a card in a hidden zone. */
export const CardFilterSchema = z
  .strictObject({
    ...CARD_FILTER_FIELDS,
    /** Matches any one of these complete printed-quality predicates. */
    anyOf: z.array(CardFilterAlternativeSchema).min(2).optional(),
  })
  .refine(
    (filter) =>
      filter.anyOf === undefined ||
      Object.entries(filter).every(([field, value]) => field === 'anyOf' || value === undefined),
    { message: 'a card-filter anyOf is the whole predicate and cannot carry sibling constraints' },
  )
  .refine((filter) => filter.manaValue === undefined || filter.maxManaValue === undefined, {
    message: 'a card filter states either an exact mana value or a maximum, not both',
  });

export type CardFilter = z.infer<typeof CardFilterSchema>;
export type CardFilterAlternative = z.infer<typeof CardFilterAlternativeSchema>;
