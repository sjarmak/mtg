#!/usr/bin/env -S npx tsx
/**
 * `tsx packages/setgen/tools/pool-census.ts <set.json>` — what verbs a finished
 * pool prints, per verb, counting each card once.
 *
 * This tool exists because the number it prints was quoted four times and
 * computed by nothing. A share of a pool is not a fact somebody remembers, it is
 * a reading of a file taken with a stated instrument, and the reading that was
 * being quoted had gone stale three separate ways at once: it summed per-verb
 * card counts into a numerator and divided by cards, so a card printing two of
 * the four verbs was counted twice above and once below; one of its four rows
 * could not be reproduced by any walk over the committed bytes; and its
 * denominator was three cards behind the pool by the time it was last repeated.
 * None of those is a mistake somebody made carelessly. They are what happens to
 * a number that no committed code recomputes.
 *
 * So this file prints the instrument beside the reading. Four things decide the
 * numbers and all four are on stdout above them: which pool, how many cards are
 * in it, whether the walk descends into the abilities of tokens the cards
 * create, and which printed clauses count as a verb.
 *
 * **It reads and never writes.** No set file, no fixture, no report; the pool
 * arrives as an argument and stdout is the whole output. The pool is an argument
 * rather than a default for a second reason as well: a census with a path baked
 * into it is a census that keeps answering about whichever set was interesting
 * the day it was written.
 *
 *   tsx packages/setgen/tools/pool-census.ts out/set.json
 *   tsx packages/setgen/tools/pool-census.ts out/set.json --no-token-descent
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_EFFECT_KINDS } from '@mtg/dsl';
import type { AnyEffectKind, Card } from '@mtg/dsl';
import { parseSetFile } from '../src/index';
import {
  printedEffectKinds,
  printedEffectKindsOnCard,
  printedModificationKinds,
  printedModificationKindsOnCard,
} from '../src/validate/mechanics';
import type { PrintedModificationKind } from '../src/validate/mechanics';

/**
 * The four verbs the complaint this census answers actually names: "lots of
 * on-death and on-attack triggers, few interactive effects, and a lack of spells
 * that aren't destroy / +N+N / bounce / tap".
 *
 * Fixed rather than an argument, unlike the pool. A family is a *question* —
 * these four are one thing a card can be doing instead of interacting — and a
 * tool whose family is a flag prints a number that means whatever its last
 * caller typed, which is the property the figure this replaces already had.
 * Three of them are effect kinds and the fourth is a modification kind, which is
 * exactly why the census reads both vocabularies; `printedModificationKinds`
 * argues that at length.
 */
const FAMILY: readonly PrintedVerb[] = ['putCounters', 'createToken', 'pumpUntilEndOfTurn', 'statBonus'];

/** A verb a card can print, over both vocabularies a card prints verbs in. */
export type PrintedVerb = AnyEffectKind | PrintedModificationKind;

export interface VerbCount {
  readonly verb: PrintedVerb;
  /** Cards printing this verb at least once. Never card-uses. */
  readonly cards: number;
}

export interface PoolCensus {
  /** Every card in the pool, and the denominator of every share below. */
  readonly cards: number;
  /** True when a card is credited with what its tokens print on their own lines. */
  readonly tokenDescent: boolean;
  /** Effect kinds printed by at least one card, most cards first. */
  readonly effectKinds: readonly VerbCount[];
  /** Modification kinds printed by at least one card, most cards first. */
  readonly modificationKinds: readonly VerbCount[];
  /** Effect kinds the engine can run that this pool prints on no card. */
  readonly unprintedEffectKinds: readonly AnyEffectKind[];
  /** The four verbs, and the cards printing them. */
  readonly family: readonly VerbCount[];
  /** Cards printing at least one of the four. The share worth quoting. */
  readonly familyCards: number;
  /** The sum of the four rows: card-verb pairs, and a share of nothing. */
  readonly familyPairs: number;
}

/** Every verb one card prints, deduplicated, so a card counts once per verb. */
function verbsOf(card: Card, tokenDescent: boolean): ReadonlySet<PrintedVerb> {
  const effects = tokenDescent ? printedEffectKinds(card) : printedEffectKindsOnCard(card);
  const modifications = tokenDescent ? printedModificationKinds(card) : printedModificationKindsOnCard(card);
  return new Set<PrintedVerb>([...effects, ...modifications]);
}

function tally(cards: readonly Card[], tokenDescent: boolean): ReadonlyMap<PrintedVerb, number> {
  const counts = new Map<PrintedVerb, number>();
  for (const card of cards) {
    for (const verb of verbsOf(card, tokenDescent)) {
      counts.set(verb, (counts.get(verb) ?? 0) + 1);
    }
  }
  return counts;
}

/** Counts for the verbs a predicate admits, most cards first and ties by name. */
function rank(
  counts: ReadonlyMap<PrintedVerb, number>,
  admits: (verb: PrintedVerb) => boolean,
): readonly VerbCount[] {
  return [...counts]
    .filter(([verb]) => admits(verb))
    .map(([verb, cards]) => ({ verb, cards }))
    .sort((left, right) => right.cards - left.cards || left.verb.localeCompare(right.verb));
}

export function poolCensus(cards: readonly Card[], tokenDescent: boolean): PoolCensus {
  const counts = tally(cards, tokenDescent);
  const isEffectKind = (verb: PrintedVerb): verb is AnyEffectKind =>
    (ALL_EFFECT_KINDS as readonly string[]).includes(verb);
  const family = FAMILY.map((verb) => ({ verb, cards: counts.get(verb) ?? 0 }));
  return {
    cards: cards.length,
    tokenDescent,
    effectKinds: rank(counts, isEffectKind),
    modificationKinds: rank(counts, (verb) => !isEffectKind(verb)),
    unprintedEffectKinds: ALL_EFFECT_KINDS.filter((kind) => !counts.has(kind)),
    family,
    familyCards: cards.filter((card) => {
      const verbs = verbsOf(card, tokenDescent);
      return FAMILY.some((verb) => verbs.has(verb));
    }).length,
    familyPairs: family.reduce((total, entry) => total + entry.cards, 0),
  };
}

function share(count: number, of: number): string {
  return of === 0 ? '  n/a' : `${((count / of) * 100).toFixed(1)}%`.padStart(6);
}

function row(entry: VerbCount, of: number): string {
  return `  ${entry.verb.padEnd(30)}${String(entry.cards).padStart(4)}${share(entry.cards, of)}`;
}

export function formatPoolCensus(census: PoolCensus, subject: string): string {
  const lines = [
    `subject: ${subject}`,
    `denominator: ${String(census.cards)} cards, each counted once per verb`,
    `token descent: ${
      census.tokenDescent
        ? 'on, so a card is credited with what the tokens it creates print on their own lines'
        : 'off, so a card is credited only with what is printed on the card'
    }`,
    'modal cards: every mode is read, not the one a game would choose',
    'continuous clauses read: static abilities, equip clauses, Aura clauses',
    '',
    'effect kinds, by cards printing them',
    ...census.effectKinds.map((entry) => row(entry, census.cards)),
    `  ${String(census.unprintedEffectKinds.length)} of ${String(ALL_EFFECT_KINDS.length)} effect kinds printed on no card: ${census.unprintedEffectKinds.join(', ')}`,
    '',
    'modification kinds, by cards printing them',
    ...census.modificationKinds.map((entry) => row(entry, census.cards)),
    '',
    `family: ${FAMILY.join(', ')}`,
    ...census.family.map((entry) => row(entry, census.cards)),
    `  ${'cards printing at least one'.padEnd(30)}${String(census.familyCards).padStart(4)}${share(census.familyCards, census.cards)}`,
    `  ${'card-verb pairs'.padEnd(30)}${String(census.familyPairs).padStart(4)}        the sum of the rows above, and a share of nothing: ${String(census.familyPairs - census.familyCards)} cards print more than one`,
  ];
  return lines.join('\n');
}

interface Args {
  readonly path: string;
  readonly tokenDescent: boolean;
}

export function parsePoolCensusArgs(argv: readonly string[]): Args {
  const paths = argv.filter((arg) => !arg.startsWith('--'));
  const flags = argv.filter((arg) => arg.startsWith('--'));
  const unknown = flags.filter((flag) => flag !== '--no-token-descent');
  const path = paths[0];
  if (path === undefined || paths.length > 1 || unknown.length > 0) {
    throw new Error('usage: pool-census.ts <set.json> [--no-token-descent]');
  }
  return { path: resolve(process.cwd(), path), tokenDescent: !flags.includes('--no-token-descent') };
}

export function main(argv: readonly string[]): number {
  const { path, tokenDescent } = parsePoolCensusArgs(argv);
  const set = parseSetFile(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  console.log(formatPoolCensus(poolCensus(set.cards, tokenDescent), path));
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
