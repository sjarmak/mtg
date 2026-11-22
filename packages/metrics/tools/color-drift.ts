/**
 * What an authoring wave did to each color, measured against the pool it deals.
 *
 * `color-census.ts` reads one set and says which color the builder skips.
 * That is the right instrument when a color has always been last. It is the
 * wrong one when a color *fell*: `mtg-14ep` is white going from joint-first to
 * fourth across ninety-one added cards, and a single-set census answers "white
 * is fourth" without saying whether white got worse or the set got better
 * around it. Those are different repairs, and the census cannot separate them
 * because it has no yesterday.
 *
 *   npx tsx packages/metrics/tools/color-drift.ts <before.json> <after.json> [--pools 400] [--seed blue-audit/pool]
 *
 * It prints three tables, each answering one question the two-set comparison
 * makes askable and a one-set census does not:
 *
 *   • kept vs added. A color's cards that survived the wave, scored at BOTH
 *     revisions, beside the cards the wave added. A color whose kept mean is
 *     flat was touched without being strengthened, and that is invisible in a
 *     set-level median, which mixes the two populations.
 *   • per-pool supply. Cards of the color in a six-booster pool. At this pool
 *     size a color's whole presence is about fourteen cards, so what a builder
 *     sees is close to count times mean rather than a top-N cut.
 *   • per-pool mass, split creature from spell. A median score cannot tell a
 *     color that lost bodies from one that lost answers; two sums can.
 *
 * Every number is `evaluateCard`'s or `openSealedPool`'s. It asserts nothing
 * and exits 0.
 *
 * **It re-renders `oracleText` on load, and says how many it moved.** A set
 * committed weeks ago was authored against an older renderer, and `parseCard`
 * refuses an oracle string that today's renderer would write differently
 * (`ORACLE_TEXT_MISMATCH`), so the historical half of the comparison cannot be
 * read at all without this. Rendering from the structured card is what the DSL
 * says that field is, and nothing here scores it: dropping the refusal costs
 * nothing and keeping it would cost the whole tool.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard, openSealedPool } from '@mtg/deckbuild';
import type { Card, Color } from '@mtg/dsl';
import { COLORS, parseCard, renderOracleText } from '@mtg/dsl';
import { cardColors, median } from './color-census';

/** Boosters per sealed pool, matching what `mtg-0g9g` and `mtg-14ep` measured. */
const BOOSTERS = 6;
const DEFAULT_POOLS = 400;
const DEFAULT_SEED = 'blue-audit/pool';

export interface LoadedSet {
  readonly label: string;
  readonly pool: readonly Card[];
  /** How many cards' `oracleText` today's renderer writes differently. */
  readonly rerendered: number;
}

/** Reads a set document, re-rendering oracle text so a historical file parses. */
export function loadDriftSet(path: string, text: string): LoadedSet {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || !('cards' in raw)) {
    throw new Error(`${path} has no "cards" array`);
  }
  const { cards, set } = raw as { cards: unknown; set?: { code?: unknown; name?: unknown } };
  if (!Array.isArray(cards) || cards.length === 0) throw new Error(`${path} has an empty "cards" array`);
  let rerendered = 0;
  const pool = cards.map((card, index): Card => {
    try {
      // Rendered before parsing, not after: `parseCard` is the check that
      // refuses a stale string, so a historical file has to arrive holding
      // what today's renderer would write. The renderer reads the structured
      // fields, which are the ones `parseCard` is about to validate anyway.
      const oracleText = renderOracleText(card as Card);
      if (oracleText !== (card as { oracleText?: unknown }).oracleText) rerendered += 1;
      return parseCard({ ...(card as object), oracleText });
    } catch (error: unknown) {
      throw new Error(
        `${path}: card ${String(index)} is not a DSL card: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  const code = typeof set?.code === 'string' ? set.code : 'unknown set';
  const name = typeof set?.name === 'string' ? ` ${set.name}` : '';
  return { label: `${code}${name} (${String(pool.length)} cards)`, pool, rerendered };
}

const score = (card: Card): number => evaluateCard(card, DEFAULT_SCORE_WEIGHTS).score;

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((left, right) => left + right, 0) / values.length;
}

export interface DriftRow {
  readonly color: Color;
  /** Cards of the color the wave kept, and their mean score at each revision. */
  readonly kept: number;
  readonly keptMeanBefore: number;
  readonly keptMeanAfter: number;
  /** Cards of the color the wave added, and their mean score. */
  readonly added: number;
  readonly addedMean: number;
  /** Cards of the color the wave removed. */
  readonly removed: number;
}

/** Kept against added, per color, scoring the kept cards at both revisions. */
export function driftRows(before: readonly Card[], after: readonly Card[]): readonly DriftRow[] {
  const wasNamed = new Map(before.map((card) => [card.name, card]));
  const isNamed = new Set(after.map((card) => card.name));
  return COLORS.map((color): DriftRow => {
    const own = (cards: readonly Card[]): readonly Card[] =>
      cards.filter((card) => card.kind !== 'land' && cardColors(card).includes(color));
    const kept = own(after).filter((card) => wasNamed.has(card.name));
    const added = own(after).filter((card) => !wasNamed.has(card.name));
    return {
      color,
      kept: kept.length,
      keptMeanBefore: mean(kept.map((card) => score(wasNamed.get(card.name) as Card))),
      keptMeanAfter: mean(kept.map(score)),
      added: added.length,
      addedMean: mean(added.map(score)),
      removed: own(before).filter((card) => !isNamed.has(card.name)).length,
    };
  });
}

export interface PoolRow {
  readonly color: Color;
  /** Median cards of the color in one sealed pool. */
  readonly cards: number;
  /** Median summed score of the color's creatures in one pool. */
  readonly creatureMass: number;
  /** Median summed score of the color's non-creature cards in one pool. */
  readonly spellMass: number;
}

/** What one sealed pool holds of each color, over `pools` seeded openings. */
export function poolRows(set: readonly Card[], pools: number, seed: string): readonly PoolRow[] {
  const counts = new Map<Color, number[]>(COLORS.map((color) => [color, []]));
  const creatures = new Map<Color, number[]>(COLORS.map((color) => [color, []]));
  const spells = new Map<Color, number[]>(COLORS.map((color) => [color, []]));
  for (let index = 0; index < pools; index += 1) {
    const opened = openSealedPool(set, { boosters: BOOSTERS, seed: `${seed}/${String(index)}` }).cards;
    for (const color of COLORS) {
      const own = opened.filter((card) => card.kind !== 'land' && cardColors(card).includes(color));
      const sum = (cards: readonly Card[]): number => cards.reduce((total, card) => total + score(card), 0);
      (counts.get(color) as number[]).push(own.length);
      (creatures.get(color) as number[]).push(sum(own.filter((card) => card.kind === 'creature')));
      (spells.get(color) as number[]).push(sum(own.filter((card) => card.kind !== 'creature')));
    }
  }
  return COLORS.map((color) => ({
    color,
    cards: median(counts.get(color) as number[]),
    creatureMass: median(creatures.get(color) as number[]),
    spellMass: median(spells.get(color) as number[]),
  }));
}

interface Args {
  readonly before: string;
  readonly after: string;
  readonly pools: number;
  readonly seed: string;
}

export function parseDriftArgs(argv: readonly string[]): Args {
  const paths: string[] = [];
  let pools = DEFAULT_POOLS;
  let seed = DEFAULT_SEED;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (!token.startsWith('--')) {
      paths.push(token);
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
      default:
        throw new Error(`unknown flag ${token}`);
    }
  }
  if (paths.length !== 2) throw new Error('color-drift: give it two set paths, the earlier one first');
  return { before: paths[0] as string, after: paths[1] as string, pools, seed };
}

function read(path: string): LoadedSet {
  const full = resolve(path);
  return loadDriftSet(full, readFileSync(full, 'utf8'));
}

function main(argv: readonly string[]): void {
  const args = parseDriftArgs(argv);
  const before = read(args.before);
  const after = read(args.after);

  console.log(`\n=== ${before.label}  ->  ${after.label} ===`);
  console.log(
    `re-rendered oracle text: ${String(before.rerendered)} before, ${String(after.rerendered)} after\n`,
  );

  console.log('color   kept   mean then   mean now    added   added mean   removed');
  for (const row of driftRows(before.pool, after.pool)) {
    console.log(
      `  ${row.color}   ${String(row.kept).padStart(4)}   ${row.keptMeanBefore.toFixed(3).padStart(9)}` +
        `   ${row.keptMeanAfter.toFixed(3).padStart(8)}   ${String(row.added).padStart(6)}` +
        `   ${row.addedMean.toFixed(3).padStart(10)}   ${String(row.removed).padStart(7)}`,
    );
  }

  for (const [label, set] of [
    [before.label, before.pool],
    [after.label, after.pool],
  ] as const) {
    console.log(`\n${label}, ${String(args.pools)} sealed pools at ${args.seed}`);
    console.log('color   cards in pool   creature mass   spell mass');
    for (const row of poolRows(set, args.pools, args.seed)) {
      console.log(
        `  ${row.color}   ${row.cards.toFixed(1).padStart(13)}   ${row.creatureMass.toFixed(2).padStart(13)}` +
          `   ${row.spellMass.toFixed(2).padStart(10)}`,
      );
    }
  }
}

if (process.argv[1]?.endsWith('color-drift.ts') === true) {
  main(process.argv.slice(2));
}
