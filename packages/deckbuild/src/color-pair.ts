/**
 * Color-pair selection.
 *
 * Limited decks are two colors by default, so the builder evaluates all ten
 * pairs and keeps the whole ranking rather than just the winner: "why these
 * colors" is the first question asked of any deck-building heuristic, and the
 * ranking is the answer.
 *
 * A pair is scored by the summed score of the best `spellCount` cards playable
 * in it — depth beyond the deck's size is worth nothing, so a pair with two
 * bombs and no playables cannot beat a pair with a full curve.
 */
import type { Card, Color } from '@mtg/dsl';
import { COLORS, sortColors } from '@mtg/dsl';
import type { PoolCard } from './evaluate';
import { cardColors, comparePoolCards } from './evaluate';

/** A two-color pair in WUBRG order. */
export type ColorPair = readonly [Color, Color];

/** All ten two-color pairs, in WUBRG order within and between pairs. */
export const COLOR_PAIRS: readonly ColorPair[] = COLORS.flatMap((first, index) =>
  COLORS.slice(index + 1).map((second): ColorPair => [first, second]),
);

/** Canonical key for a pair, e.g. `WU`. */
export function colorPairKey(pair: ColorPair): string {
  return sortColors(pair).join('');
}

const PAIR_RANK: ReadonlyMap<string, number> = new Map(
  COLOR_PAIRS.map((pair, index) => [colorPairKey(pair), index]),
);

export interface ColorPairEvaluation {
  readonly pair: ColorPair;
  readonly key: string;
  /** Non-land cards in the pool castable in this pair (colorless counts for every pair). */
  readonly playableCount: number;
  /** Summed score of the best `spellCount` playables: the ranking key. */
  readonly topScore: number;
  /** `topScore` divided by the number of cards that contributed to it. */
  readonly averageTopScore: number;
  readonly creatureCount: number;
  /**
   * Playables in the pair that answer a creature.
   *
   * Reported, not ranked on, and the difference is deliberate. Every answer has
   * already moved `topScore` - `evaluateCard` pays `removalPremium` for exactly
   * the cards counted here - so a second term over the same fact would price
   * one card's removal twice and leave the weight that says how much a removal
   * spell is worth in two files. What is missing from `topScore` is not the
   * premium but its shape: the first answer in a Limited deck is worth more
   * than the sixth, and a concave premium belongs in `evaluateCard`, where the
   * card's own count is known, rather than in a pair sort that sees only sums.
   *
   * So this is the number the "why these colors" answer prints (`report.ts`),
   * and the sort key it is not. It was computed and read by nothing at all
   * until `mtg-qntb`, which is how a field states an intent nobody can check.
   */
  readonly removalCount: number;
}

/** True when every color of the card is inside the pair (colorless always passes). */
export function isPlayableIn(card: Card, pair: ColorPair): boolean {
  return cardColors(card).every((color) => pair.includes(color));
}

/** Non-land playables of a pair, best-first. */
export function playablesFor(evaluations: readonly PoolCard[], pair: ColorPair): PoolCard[] {
  return evaluations
    .filter((evaluation) => evaluation.card.kind !== 'land' && isPlayableIn(evaluation.card, pair))
    .sort(comparePoolCards);
}

function evaluatePair(
  evaluations: readonly PoolCard[],
  pair: ColorPair,
  spellCount: number,
): ColorPairEvaluation {
  const playable = playablesFor(evaluations, pair);
  const top = playable.slice(0, spellCount);
  const topScore = top.reduce((sum, evaluation) => sum + evaluation.score, 0);
  return {
    pair,
    key: colorPairKey(pair),
    playableCount: playable.length,
    topScore,
    averageTopScore: top.length === 0 ? 0 : topScore / top.length,
    creatureCount: playable.filter((evaluation) => evaluation.isCreature).length,
    removalCount: playable.filter((evaluation) => evaluation.isRemoval).length,
  };
}

/**
 * Ranks every pair best-first. Ties fall back to raw depth and then to the
 * canonical WUBRG pair order, so the winner is a pure function of the pool.
 */
export function rankColorPairs(
  evaluations: readonly PoolCard[],
  spellCount: number,
): readonly ColorPairEvaluation[] {
  return COLOR_PAIRS.map((pair) => evaluatePair(evaluations, pair, spellCount)).sort(
    (a, b) =>
      b.topScore - a.topScore ||
      b.playableCount - a.playableCount ||
      (PAIR_RANK.get(a.key) ?? 0) - (PAIR_RANK.get(b.key) ?? 0),
  );
}

/**
 * How many playables each color contributes, plus the colorless count.
 * Multicolor cards count once per color they contain.
 */
export interface PoolColorCounts {
  readonly byColor: Readonly<Record<Color, number>>;
  readonly colorless: number;
}

export function countPlayablesByColor(pool: readonly Card[]): PoolColorCounts {
  const byColor: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let colorless = 0;
  for (const card of pool) {
    if (card.kind === 'land') continue;
    const colors = cardColors(card);
    if (colors.length === 0) {
      colorless += 1;
      continue;
    }
    for (const color of colors) byColor[color] += 1;
  }
  return { byColor, colorless };
}
