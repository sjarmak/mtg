/** Authored judgments enter here; runtime evaluation is deterministic arithmetic. */
import { z } from 'zod';

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
export type Color = (typeof COLORS)[number];
export const BASIC_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
export type Basics = Readonly<Record<(typeof BASIC_NAMES)[number], number>>;
const ColorSchema = z.enum(COLORS);
const Strings = z.array(z.string().min(1)).refine((v) => new Set(v).size === v.length, 'duplicate tag');
export const CardProfileSchema = z.strictObject({
  quality: z.number().min(0).max(5),
  roles: z.array(z.enum(['interaction', 'draw', 'fixing'])),
  tags: Strings,
  planningCost: z.string().min(1).optional(),
  landSources: z.array(ColorSchema).optional(),
  landValue: z.number().min(0).max(1).optional(),
  payoffs: z.array(
    z.strictObject({
      tag: z.string().min(1),
      weight: z.number().min(0).max(2),
      target: z.number().int().min(1),
    }),
  ),
});
export type CardProfile = z.infer<typeof CardProfileSchema>;
export const EvaluationCardSchema = CardProfileSchema.extend({
  id: z.string().min(1),
  colors: z.array(ColorSchema),
  manaValue: z.number().int().min(0),
  type: z.enum(['creature', 'noncreature-spell', 'nonbasic-land']),
  pips: z.partialRecord(ColorSchema, z.number().int().min(0)),
  sources: z.array(ColorSchema),
});
export type EvaluationCard = z.infer<typeof EvaluationCardSchema>;

export function checkedPool(pool: readonly EvaluationCard[]): readonly EvaluationCard[] {
  const checked = z.array(EvaluationCardSchema).parse(pool);
  if (new Set(checked.map((c) => c.id)).size !== checked.length) throw new Error('duplicate physical copy');
  for (const card of checked) {
    if (
      new Set(card.colors).size !== card.colors.length ||
      new Set(card.sources).size !== card.sources.length ||
      COLORS.some((color) => (card.pips[color] ?? 0) > 0 && !card.colors.includes(color))
    )
      throw new Error('Inconsistent color requirements');
  }
  return checked;
}

/** Initial authored parameters, not fitted win-rate estimates. Version changes with policy/data. */
export const DECK_MODEL_VERSION = 'limited-deck-value/v1';
export const DECK_MODEL = {
  deckSize: 40,
  landCount: 17,
  creatureTarget: 14,
  interactionTarget: 4,
  creatureWeight: 0.2,
  interactionWeight: 0.4,
  earlyTarget: 8,
  earlyWeight: 0.15,
  // Uncastable spells must not beat a weaker card the selected mana can cast.
  unsupportedPenalty: 3,
  swapPasses: 2,
} as const;
