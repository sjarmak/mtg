import { COLORS, DECK_MODEL, checkedPool } from './model';
import type { Basics, Color, EvaluationCard } from './model';
import { allocateMana } from './mana';
import { deckValue } from './value';

export interface LimitedPoolPlan {
  readonly selectedIds: readonly string[];
  readonly basics: Basics;
  readonly value: number;
  readonly colors: readonly Color[];
}
const COLOR_PLANS: readonly (readonly Color[])[] = COLORS.flatMap((color, i) => [
  [color],
  ...COLORS.slice(i + 1).map((other) => [color, other]),
]);

function scorePlan(
  spells: readonly EvaluationCard[],
  lands: readonly EvaluationCard[],
  colors: readonly Color[],
  landCount: number,
): LimitedPoolPlan {
  const basics = allocateMana(spells, lands, landCount - lands.length);
  return {
    selectedIds: [...spells, ...lands].map((c) => c.id),
    basics,
    colors,
    value: deckValue(spells, lands, basics),
  };
}

function candidate(
  pool: readonly EvaluationCard[],
  colors: readonly Color[],
  complete: boolean,
  landCount: number,
  refine = false,
): LimitedPoolPlan {
  const spells = pool.filter((c) => c.type !== 'nonbasic-land');
  const ranked = spells
    .map((c, index) => ({
      c,
      index,
      score:
        c.quality -
        c.colors.filter((color) => !colors.includes(color)).length * DECK_MODEL.unsupportedPenalty,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const compatible = ranked.filter(({ c }) => c.colors.every((color) => colors.includes(color)));
  let selected = (complete ? ranked : compatible).slice(0, DECK_MODEL.deckSize - landCount).map(({ c }) => c);
  const availableLands = pool
    .filter(
      (c) =>
        c.type === 'nonbasic-land' &&
        (c.sources.length === 0 || c.sources.some((color) => colors.includes(color))),
    )
    .sort((a, b) => b.quality - a.quality);
  let lands: readonly EvaluationCard[] = [];
  let best = scorePlan(selected, lands, colors, landCount);
  // A drafted land replaces a basic, never a spell. Keep it only if the common objective improves.
  for (const land of availableLands.slice(0, landCount - colors.length)) {
    const next = scorePlan(selected, [...lands, land], colors, landCount);
    if (next.value > best.value) {
      lands = [...lands, land];
      best = next;
    }
  }
  if (!refine) return best;
  // Bounded swaps let interaction and available packages displace standalone quality.
  for (let pass = 0; pass < DECK_MODEL.swapPasses; pass++) {
    let replacement = selected;
    for (const incoming of spells.filter((c) => !selected.some((s) => s.id === c.id))) {
      for (let i = 0; i < selected.length; i++) {
        const nextCards = selected.map((c, index) => (index === i ? incoming : c));
        const next = scorePlan(nextCards, lands, colors, landCount);
        if (next.value > best.value) {
          best = next;
          replacement = nextCards;
        }
      }
    }
    if (replacement === selected) break;
    selected = replacement;
  }
  return best;
}

/** Complete construction keeps physical IDs. Land target and all weights belong to this version. */
export function planLimitedPool(
  input: readonly EvaluationCard[],
  options: { readonly landCounts?: readonly number[] } = {},
): LimitedPoolPlan {
  const pool = checkedPool(input);
  const landCounts = options.landCounts ?? [16, 17, 18];
  if (
    landCounts.length === 0 ||
    landCounts.some((n) => !Number.isInteger(n) || n < 1 || n >= DECK_MODEL.deckSize)
  )
    throw new Error('Invalid land-count candidates');
  const spells = pool.filter((c) => c.type !== 'nonbasic-land').length;
  const plans = landCounts
    .filter((n) => spells >= DECK_MODEL.deckSize - n)
    .flatMap((landCount) =>
      COLOR_PLANS.map((colors) => ({ landCount, colors, plan: candidate(pool, colors, true, landCount) })),
    )
    .sort((a, b) => b.plan.value - a.plan.value);
  if (plans.length === 0) throw new Error('Limited pool has too few spells');
  return plans
    .slice(0, 3)
    .map(({ colors, landCount }) => candidate(pool, colors, true, landCount, true))
    .sort((a, b) => b.value - a.value)[0]!;
}

/** Partial-deck projection uses only observed picks; no assumed future pack contents. */
export function projectedPoolValue(input: readonly EvaluationCard[]): number {
  const pool = checkedPool(input);
  return projectedPoolValueOfChecked(pool);
}

/** Internal fast path for cards already produced by a checked typed adapter. */
export function projectedPoolValueOfChecked(pool: readonly EvaluationCard[]): number {
  if (pool.length === 0) return 0;
  return Math.max(...COLOR_PLANS.map((colors) => candidate(pool, colors, false, DECK_MODEL.landCount).value));
}
