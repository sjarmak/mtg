import { BASIC_NAMES, COLORS, DECK_MODEL } from './model';
import type { Basics, Color, EvaluationCard } from './model';

/** Parse only the printed mana-cost grammar, never card meaning or Oracle text. */
export function colorPips(cost: string | null): Partial<Record<Color, number>> {
  const pips: Partial<Record<Color, number>> = {};
  if (cost === null || cost === '') return pips;
  const tokens = cost.match(/\{[^{}]+\}/gu) ?? [];
  if (tokens.join('') !== cost) throw new Error(`Unsupported mana cost: ${cost}`);
  for (const token of tokens) {
    const symbol = token.slice(1, -1);
    if (COLORS.includes(symbol as Color)) {
      const color = symbol as Color;
      pips[color] = (pips[color] ?? 0) + 1;
    } else if (!/^(?:[0-9]+|X)$/u.test(symbol)) throw new Error(`Unsupported mana symbol: ${symbol}`);
  }
  return pips;
}

export function allocateMana(
  spells: readonly EvaluationCard[],
  lands: readonly EvaluationCard[],
  total: number,
): Basics {
  if (!Number.isInteger(total) || total < 0) throw new Error('Invalid basic-land target');
  const weights = COLORS.map((color) =>
    spells.reduce(
      (sum, c) => sum + (c.pips[color] ?? 0) * Math.max(1, 6 - c.manaValue) * Math.max(1, c.quality),
      0,
    ),
  );
  const counts = COLORS.map(() => 0);
  const existing = COLORS.map((color) => lands.filter((c) => c.sources.includes(color)).length);
  for (let i = 0; i < total; i++) {
    const order = COLORS.map((_, index) => ({
      index,
      value: (weights[index] ?? 0) / (counts[index]! + existing[index]! + 1) ** 2,
    })).sort((a, b) => b.value - a.value || a.index - b.index);
    const index = order[0]!.index;
    counts[index] = counts[index]! + 1;
  }
  return Object.fromEntries(BASIC_NAMES.map((name, i) => [name, counts[i]!])) as unknown as Basics;
}

// Fixed deck-size binomial coefficients avoid repeated factorial work in draft replay.
const combinations: readonly (readonly number[])[] = Array.from({ length: DECK_MODEL.deckSize + 1 }, (_, n) =>
  Array.from({ length: n + 1 }, (_, k) => {
    let value = 1;
    for (let i = 1; i <= Math.min(k, n - k); i++) value = (value * (n - i + 1)) / i;
    return value;
  }),
);
const choose = (n: number, k: number): number => combinations[n]?.[k] ?? 0;

// Numerical memoization has a finite domain and carries no game/session data.
const drawProbabilities = new Map<number, number>();

/** Exact single-resource draw probability; combining colors below is an approximation. */
export function drawAtLeast(population: number, sources: number, draws: number, need: number): number {
  if (
    ![population, sources, draws, need].every(Number.isInteger) ||
    population < 0 ||
    population > DECK_MODEL.deckSize ||
    sources < 0 ||
    sources > population ||
    draws < 0 ||
    draws > population ||
    need < 0
  )
    throw new Error('Invalid Limited draw-probability inputs');
  if (need === 0) return 1;
  if (need > sources || need > draws) return 0;
  const radix = DECK_MODEL.deckSize + 1;
  const key = (sources * radix + draws) * radix + need;
  const cached = population === DECK_MODEL.deckSize ? drawProbabilities.get(key) : undefined;
  if (cached !== undefined) return cached;
  let probability = 0;
  for (let hits = need; hits <= Math.min(sources, draws); hits++)
    probability +=
      (choose(sources, hits) * choose(population - sources, draws - hits)) / choose(population, draws);
  const result = Math.min(1, probability);
  if (population === DECK_MODEL.deckSize) drawProbabilities.set(key, result);
  return result;
}

/** Land-drop and colored-source marginals, not a claim of joint cast-on-curve probability. */
export function manaSupport(card: EvaluationCard, lands: readonly EvaluationCard[], basics: Basics): number {
  const count = Object.values(basics).reduce((a, b) => a + b, 0) + lands.length;
  const draws = Math.min(DECK_MODEL.deckSize, 7 + Math.max(1, card.manaValue) - 1);
  const landSupport = drawAtLeast(DECK_MODEL.deckSize, count, draws, card.manaValue);
  return COLORS.reduce(
    (value, color, i) =>
      value *
      drawAtLeast(
        DECK_MODEL.deckSize,
        basics[BASIC_NAMES[i]!] + lands.filter((c) => c.sources.includes(color)).length,
        draws,
        card.pips[color] ?? 0,
      ),
    landSupport,
  );
}
