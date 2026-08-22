/**
 * Structured mana costs. A cost is never a string in the DSL — it is a
 * generic amount plus one pip counter per color, so mana value, color
 * identity and Forge-script emission are all mechanical derivations.
 */
import { z } from 'zod';
import type { Color } from './vocabulary';
import { COLORS, sortColors } from './vocabulary';

export const ManaCostSchema = z.strictObject({
  generic: z.int().default(0),
  W: z.int().default(0),
  U: z.int().default(0),
  B: z.int().default(0),
  R: z.int().default(0),
  G: z.int().default(0),
  /**
   * CR 107.3f / 601.2b: this cost has an `{X}` component whose value the
   * caster announces when casting. `false` on every cost DSL v0 could print
   * before this field existed, which is what keeps a state written before X
   * existed byte-identical after it.
   *
   * X never contributes to `generic` here — CR 707.3 sets it to 0 for any
   * object not on the stack, and a cost with `hasX: true` and no chosen value
   * is exactly that object. `resolveX` is the one place a chosen value is
   * folded in, and only for the cast in progress.
   */
  hasX: z.boolean().default(false),
});

export type ManaCost = z.infer<typeof ManaCostSchema>;
export type ManaCostInput = z.input<typeof ManaCostSchema>;

export const ZERO_MANA_COST: ManaCost = { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, hasX: false };

/**
 * `ManaCostSchema` minus `hasX`: the mana cost shape offered to a model, for
 * every prompt that puts a cost in front of one, whether it is pricing a
 * spell (`packages/setgen/src/filled.ts`) or an activation
 * (`ModelActivationCostSchema` below). Reusing the full schema in either place
 * would rename every recorded fixture that shows it a field the prompt never
 * teaches the model to use — the model would be guessing, and a guess that
 * happened to say `true` would print an `{X}` no design note asked for.
 *
 * One definition rather than two: `filled.ts` used to derive this locally,
 * but `ModelActivationCostSchema` needed the identical omission on its nested
 * `mana` field, and a second derivation is a second chance for the two to
 * drift apart the next time `ManaCostSchema` grows a field neither prompt is
 * ready to offer.
 */
export const ModelManaCostSchema = ManaCostSchema.omit({ hasX: true });
export type ModelManaCost = z.infer<typeof ModelManaCostSchema>;

/** Hostile-input ceiling for a value chosen while casting an X spell. */
export const MAX_CHOSEN_X = 20;

/** Builds a complete cost from a partial one; every unset counter is 0. */
export function mana(parts: ManaCostInput = {}): ManaCost {
  return {
    generic: parts.generic ?? 0,
    W: parts.W ?? 0,
    U: parts.U ?? 0,
    B: parts.B ?? 0,
    R: parts.R ?? 0,
    G: parts.G ?? 0,
    hasX: parts.hasX ?? false,
  };
}

/**
 * Folds the caster's announced X into `generic` (CR 601.2b announces X before
 * anything else is paid; CR 107.3f: X is the value chosen, never negative).
 *
 * Pure and total: a cost with no X returns unchanged, so every caller can run
 * this over every cost rather than branching on `hasX` itself.
 */
export function resolveX(cost: ManaCost, chosen: number): ManaCost {
  if (!cost.hasX) return cost;
  return { ...cost, generic: cost.generic + Math.max(0, chosen), hasX: false };
}

/** Total converted cost: generic plus every colored pip. */
export function manaValue(cost: ManaCost): number {
  return cost.generic + COLORS.reduce((sum, color) => sum + cost[color], 0);
}

/** Number of colored pips per color, in WUBRG order. */
export function colorPips(cost: ManaCost): ReadonlyArray<readonly [Color, number]> {
  return COLORS.map((color) => [color, cost[color]] as const);
}

/** Color identity implied by the cost, WUBRG-sorted. Empty for colorless costs. */
export function colorsFromCost(cost: ManaCost): Color[] {
  return sortColors(COLORS.filter((color) => cost[color] > 0));
}

/**
 * Canonical printed cost, e.g. `{1}{R}` or `{0}` for a free colorless cost.
 * `{X}` prints first (CR 202.3), ahead of generic, exactly as Magic templates
 * it — "{X}{R}", never "{R}{X}".
 */
export function formatManaCost(cost: ManaCost): string {
  const pips = COLORS.flatMap((color) =>
    Array.from({ length: Math.max(0, cost[color]) }, () => `{${color}}`),
  );
  const x = cost.hasX ? ['{X}'] : [];
  const generic = cost.generic > 0 || (pips.length === 0 && x.length === 0) ? [`{${cost.generic}}`] : [];
  return [...x, ...generic, ...pips].join('');
}

/** True when the cost has no colored pips at all. */
export function isColorless(cost: ManaCost): boolean {
  return COLORS.every((color) => cost[color] === 0);
}
