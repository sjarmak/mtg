/**
 * Fixture decks for benchmarks and tests.
 *
 * These are NOT the deck builder — `@mtg/deckbuild` owns real pool→deck
 * construction. These are fixed, synthetic, deterministically-built two-color
 * decks over the DSL's example card set, so the throughput benchmark and this
 * package's own tests have something to play without depending on a package
 * that is still moving.
 *
 * Shape follows the limited default the metrics lane cites (Karsten via
 * `docs/research/prior-art-playability-metrics.md` §4.4): 40 cards, 17 lands,
 * 23 spells.
 */
import type { BasicLandType, Card, Color } from '@mtg/dsl';
import { BASIC_LAND_COLOR, BASIC_LAND_TYPES, basicLand, COLORS, EXAMPLE_CARDS } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';

export const DEFAULT_DECK_SIZE = 40;
export const DEFAULT_LAND_COUNT = 17;
const FIXTURE_SET_CODE = 'SLC';

function basicFor(color: Color): BasicLandType {
  const found = BASIC_LAND_TYPES.find((type) => BASIC_LAND_COLOR[type] === color);
  if (found === undefined) throw new Error(`no basic land type produces ${color}`);
  return found;
}

/** Example cards castable in a deck of these colors, colorless included. */
function spellPool(colors: readonly Color[]): readonly Card[] {
  return EXAMPLE_CARDS.filter(
    (card) => card.kind !== 'land' && card.colors.every((color) => colors.includes(color)),
  ).toSorted((a, b) => a.id.localeCompare(b.id));
}

/** Colored pips required by a spell list, per color. */
function pipDemand(spells: readonly Card[]): Readonly<Record<Color, number>> {
  const demand: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of spells) {
    if (card.kind === 'land') continue;
    for (const color of COLORS) demand[color] += card.manaCost[color];
  }
  return demand;
}

/**
 * Splits the land slots across the deck's colors in proportion to pip demand,
 * with at least one source per color, largest-remainder rounding so the counts
 * always add up exactly.
 */
function landSplit(colors: readonly Color[], spells: readonly Card[], lands: number): readonly Card[] {
  const demand = pipDemand(spells);
  const total = colors.reduce((sum, color) => sum + demand[color], 0);
  const exact = colors.map((color) =>
    total === 0 ? lands / colors.length : (demand[color] * lands) / total,
  );
  const counts = exact.map((value) => Math.max(1, Math.floor(value)));
  let assigned = counts.reduce((sum, value) => sum + value, 0);
  // Largest-remainder top-up / trim so the land count is exact.
  while (assigned !== lands) {
    const step = assigned < lands ? 1 : -1;
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < counts.length; index += 1) {
      const count = counts[index] ?? 0;
      if (step < 0 && count <= 1) continue;
      const remainder = (exact[index] ?? 0) - count;
      const score = step > 0 ? remainder : -remainder;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    counts[bestIndex] = (counts[bestIndex] ?? 0) + step;
    assigned += step;
  }

  const cards: Card[] = [];
  for (const [index, color] of colors.entries()) {
    const type = basicFor(color);
    const count = counts[index] ?? 0;
    for (let copy = 0; copy < count; copy += 1) {
      cards.push(basicLand(type, FIXTURE_SET_CODE, 900 + COLORS.indexOf(color)));
    }
  }
  return cards;
}

export interface FixtureDeckOptions {
  readonly size?: number;
  readonly lands?: number;
}

/** Builds a deterministic 17-land / 23-spell deck in the given colors. */
export function fixtureDeck(
  name: string,
  colors: readonly Color[],
  options: FixtureDeckOptions = {},
): DeckList {
  if (colors.length === 0) throw new Error('a fixture deck needs at least one color');
  const size = options.size ?? DEFAULT_DECK_SIZE;
  const landCount = options.lands ?? DEFAULT_LAND_COUNT;
  if (landCount >= size) throw new Error('a fixture deck needs room for spells');

  const pool = spellPool(colors);
  if (pool.length === 0) throw new Error(`no example cards fit colors ${colors.join('')}`);
  const spells: Card[] = [];
  for (let slot = 0; slot < size - landCount; slot += 1) {
    const card = pool[slot % pool.length];
    if (card === undefined) break;
    spells.push(card);
  }
  return { name, cards: [...spells, ...landSplit(colors, spells, landCount)] };
}

/** Two archetype-flavored fixture decks that make for a lively matchup. */
export const FIXTURE_DECK_RW: DeckList = fixtureDeck('RW Aggro', ['R', 'W']);
export const FIXTURE_DECK_UB: DeckList = fixtureDeck('UB Control', ['U', 'B']);
export const FIXTURE_DECK_GW: DeckList = fixtureDeck('GW Midrange', ['G', 'W']);
