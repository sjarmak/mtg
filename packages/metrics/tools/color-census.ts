/**
 * Why a color goes unbuilt, in the scorer's own components.
 *
 * A build-rate table says which color the builder skips. It does not say why,
 * and the two answers it hides behind one number are different repairs: a color
 * can be skipped because its cards are weak, or because its cards are fine and
 * the pool prints too few of them. `mtg-4wpx` settled blue by hand-censusing 51
 * cards; `mtg-0g9g` asks the same question of black and says outright that
 * guessing at it will produce the wrong fix. This is that census, as an
 * instrument rather than a session.
 *
 *   npx tsx packages/metrics/tools/color-census.ts <set.json> [--pools 400] [--seed blue-audit/pool]
 *
 * The set is an argument with no default, for the reason every tool beside it
 * takes one: an instrument that names a particular committed fixture has an
 * opinion about which pool matters.
 *
 * It asserts nothing and exits 0. Every number it prints is `evaluateCard`'s or
 * `buildDeck`'s, never a second copy of their arithmetic, so a retune that
 * moves the scorer moves this reading with it. What it adds is the split: the
 * per-color score summary is a median, and a median cannot distinguish a color
 * whose spells cost too much from one whose spells do too little. The component
 * columns can, because `manaPenalty` and `effects` are the scorer's own two
 * halves of exactly that question.
 */
import { resolve } from 'node:path';
import { buildDeck, DEFAULT_SCORE_WEIGHTS, evaluateCard, openSealedPool } from '@mtg/deckbuild';
import type { Card, Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import { loadSet } from '../test/balance/set';

/** Boosters per sealed pool, matching what `mtg-0g9g` measured. */
const BOOSTERS = 6;
const DEFAULT_POOLS = 400;
const DEFAULT_SEED = 'blue-audit/pool';

export interface ColorRow {
  readonly color: Color;
  readonly cards: number;
  readonly creatures: number;
  readonly spells: number;
  /** `evaluateCard`'s score over the color's non-land cards. */
  readonly medianScore: number;
  /** Share of the color's non-land cards the builder prices under half a point. */
  readonly weakShare: number;
  /** Median `statSurplus` over the color's creatures: is the body paid for? */
  readonly medianStatSurplus: number;
  /** Median `manaPenalty` over the color's non-creature spells: what it costs. */
  readonly medianManaPenalty: number;
  /** Median `effects` over the same: what it does. */
  readonly medianEffects: number;
  /** Builds in which the color appeared, out of the pools opened. */
  readonly builds: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length / 2;
  if (sorted.length % 2 === 1) return sorted[(sorted.length - 1) / 2] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * A card's colors, reading a land by what it taps for.
 *
 * A land's `producesMana` includes colorless, which is not a color, so it is
 * dropped rather than widened: this census is about the five.
 */
export function cardColors(card: Card): readonly Color[] {
  if (card.kind !== 'land') return card.colors;
  return card.producesMana.filter((mana): mana is Color => COLORS.some((color) => color === mana));
}

function component(card: Card, name: string): number {
  const found = evaluateCard(card, DEFAULT_SCORE_WEIGHTS).components.find((part) => part.name === name);
  return found === undefined ? 0 : found.value;
}

/** How often each color was in the pair `buildDeck` chose. */
export function buildRates(
  set: readonly Card[],
  pools: number,
  seed: string,
): { readonly byColor: ReadonlyMap<Color, number>; readonly byPair: ReadonlyMap<string, number> } {
  const byColor = new Map<Color, number>(COLORS.map((color) => [color, 0]));
  const byPair = new Map<string, number>();
  for (let index = 0; index < pools; index += 1) {
    const built = buildDeck(
      openSealedPool(set, { boosters: BOOSTERS, seed: `${seed}/${String(index)}` }).cards,
    );
    const key = [...built.colorPair].join('');
    byPair.set(key, (byPair.get(key) ?? 0) + 1);
    for (const color of built.colorPair) byColor.set(color, (byColor.get(color) ?? 0) + 1);
  }
  return { byColor, byPair };
}

export function colorRows(set: readonly Card[], builds: ReadonlyMap<Color, number>): readonly ColorRow[] {
  return COLORS.map((color) => {
    const cards = set.filter((card) => card.kind !== 'land' && cardColors(card).includes(color));
    const creatures = cards.filter((card) => card.kind === 'creature');
    const spells = cards.filter((card) => card.kind !== 'creature');
    const scores = cards.map((card) => evaluateCard(card, DEFAULT_SCORE_WEIGHTS).score);
    return {
      color,
      cards: cards.length,
      creatures: creatures.length,
      spells: spells.length,
      medianScore: median(scores),
      weakShare:
        cards.length === 0 ? Number.NaN : scores.filter((score) => score < 0.5).length / cards.length,
      medianStatSurplus: median(creatures.map((card) => component(card, 'statSurplus'))),
      medianManaPenalty: median(spells.map((card) => component(card, 'manaPenalty'))),
      medianEffects: median(spells.map((card) => component(card, 'effects'))),
      builds: builds.get(color) ?? 0,
    };
  });
}

/** Which cards of one color the builder actually picks, and which it never does. */
export function picksForColor(
  set: readonly Card[],
  color: Color,
  pools: number,
  seed: string,
): { readonly picked: ReadonlyMap<string, number>; readonly never: readonly Card[] } {
  const picked = new Map<string, number>();
  for (let index = 0; index < pools; index += 1) {
    const built = buildDeck(
      openSealedPool(set, { boosters: BOOSTERS, seed: `${seed}/${String(index)}` }).cards,
    );
    if (!built.colorPair.includes(color)) continue;
    for (const card of built.spells) {
      if (cardColors(card).includes(color)) picked.set(card.name, (picked.get(card.name) ?? 0) + 1);
    }
  }
  const never = set.filter(
    (card) => card.kind !== 'land' && cardColors(card).includes(color) && !picked.has(card.name),
  );
  return { picked, never };
}

interface Args {
  readonly path: string;
  readonly pools: number;
  readonly seed: string;
  readonly color: Color | null;
}

export function parseCensusArgs(argv: readonly string[]): Args {
  let path: string | undefined;
  let pools = DEFAULT_POOLS;
  let seed = DEFAULT_SEED;
  let color: Color | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (!token.startsWith('--')) {
      path = token;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value`);
    index += 1;
    switch (token) {
      case '--pools': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--pools wants a positive integer');
        pools = parsed;
        break;
      }
      case '--seed':
        seed = value;
        break;
      case '--color': {
        const found = COLORS.find((candidate) => candidate === value.toUpperCase());
        if (found === undefined) throw new Error(`--color wants one of ${COLORS.join('')}`);
        color = found;
        break;
      }
      default:
        throw new Error(`unknown flag ${token}`);
    }
  }
  if (path === undefined) throw new Error('color-census: give it a path to a DSL set file');
  return { path, pools, seed, color };
}

function main(argv: readonly string[]): void {
  const args = parseCensusArgs(argv);
  const subject = loadSet(resolve(args.path));
  const rates = buildRates(subject.pool, args.pools, args.seed);

  console.log(
    `\n=== ${subject.label}: ${String(subject.pool.length)} cards, ${String(args.pools)} sealed pools at ${args.seed} ===\n`,
  );
  console.log('color  cards  crea  spell   median  weak%   statSurplus   manaPenalty   effects   builds');
  for (const row of colorRows(subject.pool, rates.byColor)) {
    console.log(
      `  ${row.color}    ${String(row.cards).padStart(4)}  ${String(row.creatures).padStart(4)}  ${String(row.spells).padStart(4)}` +
        `   ${row.medianScore.toFixed(3)}  ${(100 * row.weakShare).toFixed(0).padStart(4)}%` +
        `   ${row.medianStatSurplus.toFixed(2).padStart(10)}` +
        `   ${row.medianManaPenalty.toFixed(2).padStart(10)}` +
        `   ${row.medianEffects.toFixed(2).padStart(6)}` +
        `   ${String(row.builds).padStart(5)}`,
    );
  }
  console.log(
    '\npairs: ' +
      [...rates.byPair]
        .sort((left, right) => right[1] - left[1])
        .map(([pair, count]) => `${pair} ${String(count)}`)
        .join(', '),
  );

  if (args.color !== null) {
    const { picked, never } = picksForColor(subject.pool, args.color, args.pools, args.seed);
    const ranked = [...picked].sort((left, right) => right[1] - left[1]);
    console.log(
      `\n${args.color}: ${String(ranked.length)} cards picked at least once, ${String(never.length)} never picked`,
    );
    console.log(
      '  most picked: ' +
        ranked
          .slice(0, 15)
          .map(([name, count]) => `${name} ${String(count)}`)
          .join(' | '),
    );
    console.log(
      '  never picked: ' +
        never
          .map(
            (card) =>
              `${card.name} (${card.rarity}, ${evaluateCard(card, DEFAULT_SCORE_WEIGHTS).score.toFixed(2)})`,
          )
          .join(' | '),
    );
  }
}

if (process.argv[1]?.endsWith('color-census.ts') === true) {
  main(process.argv.slice(2));
}
