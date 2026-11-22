#!/usr/bin/env -S npx tsx
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadReferenceCorpus } from '@mtg/data';
import { DEFAULT_DECK_BUILD_CONFIG, evaluatePool, isRemovalCard } from '@mtg/deckbuild';
import { cardManaValue } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { parseSetFile } from '../src/index';
import {
  cellOf,
  CELLS,
  CURVE_BANDS,
  curveBand,
  cutPool,
  CUT_RARITIES,
  roleOf,
  sheetShape,
  SINGLE_COLORS,
} from '../src/pool-cut';
import type { CutRarity, CutRole, PoolCut, PoolCutPlan, SheetShape } from '../src/pool-cut';

const USAGE =
  'usage: tsx packages/setgen/tools/cut-pool.ts <set.json> --brief <brief.json> --decks <decks.json> ' +
  '[--decks <decks.json>] --reference <set code> --commons <n> --uncommons <n> [--keep <card id>] ' +
  '[--out <set.json>] [--record <cut.json>]';

interface Inputs {
  readonly setPath: string;
  readonly briefPath: string;
  readonly deckPaths: readonly string[];
  readonly reference: string;
  readonly sizes: Readonly<Record<CutRarity, number>>;
  readonly keep: readonly string[];
  readonly out: string | undefined;
  readonly record: string | undefined;
}

export interface PoolCutRecord {
  readonly formatVersion: 1;
  readonly source: { readonly sha256: string; readonly cards: number };
  readonly reference: string;
  readonly sheets: Readonly<Record<CutRarity, SheetShape>>;
  readonly protected: {
    readonly authored: number;
    readonly required: number;
    readonly stated: readonly string[];
    readonly deckPlayed: number;
    readonly distinct: number;
  };
  readonly cut: readonly string[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function stringsUnder(value: unknown, key: string, field: string): readonly string[] {
  if (typeof value !== 'object' || value === null) return [];
  const entries = (value as Record<string, unknown>)[key];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const found = (entry as Record<string, unknown>)[field];
    return typeof found === 'string' ? [found] : [];
  });
}

export function authoredIds(briefPath: string): readonly string[] {
  const ids = stringsUnder(readJson(briefPath), 'authoredCards', 'id');
  if (ids.length === 0) throw new Error(`${briefPath} lists no authoredCards`);
  return ids;
}

export function requiredIds(briefPath: string, cards: readonly Card[]): readonly string[] {
  const names = new Set(
    stringsUnder(readJson(briefPath), 'requiredCards', 'name').map((name) => name.trim().toLowerCase()),
  );
  if (names.size === 0) throw new Error(`${briefPath} lists no requiredCards`);
  return cards.filter((card) => names.has(card.name.trim().toLowerCase())).map((card) => card.id);
}

export function deckPlayedIds(deckPath: string): readonly string[] {
  const file = readJson(deckPath);
  const decks =
    typeof file === 'object' && file !== null ? (file as Record<string, unknown>)['decks'] : undefined;
  if (!Array.isArray(decks) || decks.length === 0) throw new Error(`${deckPath} lists no decks`);
  return decks.flatMap((deck: unknown) => stringsUnder(deck, 'spells', 'id'));
}

export function answersACreature(card: Card): boolean {
  return isRemovalCard(card, DEFAULT_DECK_BUILD_CONFIG.weights);
}

export function builderPrices(pool: readonly Card[]): (card: Card) => number {
  const prices = new Map(
    evaluatePool(pool, DEFAULT_DECK_BUILD_CONFIG.weights).map((priced) => [priced.card.id, priced.score]),
  );
  return (card) => {
    const price = prices.get(card.id);
    if (price === undefined) throw new Error(`${card.id} is not in the pool the builder priced`);
    return price;
  };
}

export function referenceShapes(
  code: string,
  sizes: Readonly<Record<CutRarity, number>>,
): PoolCutPlan['sheets'] {
  const found = loadReferenceCorpus().sets.find((set) => set.code === code);
  if (found === undefined) throw new Error(`the locked reference corpus holds no set coded ${code}`);
  const printed = found.cards.filter((card) => card.roles.includes('main-set'));
  return {
    common: sheetShape(printed, 'common', sizes.common),
    uncommon: sheetShape(printed, 'uncommon', sizes.uncommon),
  };
}

function wholeNumber(raw: string | undefined, flag: string): number {
  const parsed = Number(raw);
  if (raw === undefined || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a whole number, got ${String(raw)}\n${USAGE}`);
  }
  return parsed;
}

function required(raw: string | undefined, flag: string): string {
  if (raw === undefined) throw new Error(`${flag} is required\n${USAGE}`);
  return raw;
}

function parseInputs(argv: readonly string[]): Inputs {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      brief: { type: 'string' },
      decks: { type: 'string', multiple: true },
      reference: { type: 'string' },
      commons: { type: 'string' },
      uncommons: { type: 'string' },
      keep: { type: 'string', multiple: true },
      out: { type: 'string' },
      record: { type: 'string' },
    },
  });
  const deckPaths = values.decks ?? [];
  if (deckPaths.length === 0) throw new Error(`--decks is required\n${USAGE}`);
  return {
    setPath: required(positionals[0], 'the set path'),
    briefPath: required(values.brief, '--brief'),
    deckPaths,
    reference: required(values.reference, '--reference'),
    sizes: {
      common: wholeNumber(values.commons, '--commons'),
      uncommon: wholeNumber(values.uncommons, '--uncommons'),
    },
    keep: values.keep ?? [],
    out: values.out,
    record: values.record,
  };
}

function cellCounts(cards: readonly Card[], rarity: string): string {
  const sheet = cards.filter((card) => card.rarity === rarity);
  return CELLS.map((cell) => `${cell} ${String(sheet.filter((card) => cellOf(card) === cell).length)}`).join(
    ', ',
  );
}

function curveCounts(cards: readonly Card[], rarity: string): string {
  const sheet = cards.filter((card) => card.rarity === rarity);
  const bands = Array.from(
    { length: CURVE_BANDS },
    (_, band) => sheet.filter((card) => curveBand(cardManaValue(card)) === band).length,
  );
  return `[${bands.join(', ')}]`;
}

function priceMeans(cards: readonly Card[], rarity: string, price: (card: Card) => number): string {
  return SINGLE_COLORS.map((cell) => {
    const inCell = cards.filter((card) => card.rarity === rarity && cellOf(card) === cell);
    if (inCell.length === 0) return `${cell} none`;
    const total = inCell.reduce((sum, card) => sum + price(card), 0);
    return `${cell} ${(total / inCell.length).toFixed(2)}`;
  }).join(', ');
}

const ROLES: readonly CutRole[] = ['answer', 'creature', 'spell'];

function roleCounts(before: readonly Card[], after: readonly Card[], rarity: string): readonly string[] {
  const kept = new Set(after.map((card) => card.id));
  return SINGLE_COLORS.map((cell) => {
    const inCell = before.filter((card) => card.rarity === rarity && cellOf(card) === cell);
    const roles = ROLES.map((role) => {
      const inRole = inCell.filter((card) => roleOf(card, answersACreature) === role);
      return `${role} ${String(inRole.filter((card) => kept.has(card.id)).length)} of ${String(inRole.length)}`;
    });
    return `  ${cell}: ${roles.join(', ')}`;
  });
}

function describe(cards: readonly Card[], result: PoolCut, plan: PoolCutPlan): readonly string[] {
  const sheets = CUT_RARITIES.flatMap((rarity) => {
    const shape = plan.sheets[rarity];
    return [
      `${rarity}: ${String(cards.filter((card) => card.rarity === rarity).length)} -> ${String(shape.size)}`,
      `  reference curve [${shape.curve.join(', ')}]`,
      `  before: ${cellCounts(cards, rarity)}; curve ${curveCounts(cards, rarity)}`,
      `  after:  ${cellCounts(result.kept, rarity)}; curve ${curveCounts(result.kept, rarity)}`,
      `  mean builder price before: ${priceMeans(cards, rarity, plan.price)}`,
      `  mean builder price after:  ${priceMeans(result.kept, rarity, plan.price)}`,
      '  kept by role:',
      ...roleCounts(cards, result.kept, rarity).map((line) => `  ${line}`),
    ];
  });
  return [
    `pool: ${String(cards.length)} cards -> ${String(result.kept.length)} kept, ${String(result.cut.length)} cut`,
    ...sheets,
    'cut:',
    ...result.cut.map(
      (card) => `  ${card.id} (${card.rarity}, ${cellOf(card)}, mana value ${String(cardManaValue(card))})`,
    ),
  ];
}

export function main(argv: readonly string[]): number {
  const inputs = parseInputs(argv);
  const bytes = readFileSync(inputs.setPath);
  const raw = JSON.parse(bytes.toString('utf8')) as { readonly cards: readonly { readonly id: string }[] };
  const set = parseSetFile(raw);
  const authored = authoredIds(inputs.briefPath);
  const required = requiredIds(inputs.briefPath, set.cards);
  const deckPlayed = inputs.deckPaths.flatMap(deckPlayedIds);
  const unprinted = inputs.keep.filter((id) => !set.cards.some((card) => card.id === id));
  if (unprinted.length > 0)
    throw new Error(`--keep names cards the set does not print: ${unprinted.join(', ')}`);
  const protectedIds = new Set([...authored, ...required, ...inputs.keep, ...deckPlayed]);
  const plan: PoolCutPlan = {
    protectedIds,
    sheets: referenceShapes(inputs.reference, inputs.sizes),
    isAnswer: answersACreature,
    price: builderPrices(set.cards),
  };
  const result = cutPool(set.cards, plan);
  const keptIds = new Set(result.kept.map((card) => card.id));
  console.log(describe(set.cards, result, plan).join('\n'));
  if (inputs.out !== undefined) {
    const cut = { ...raw, cards: raw.cards.filter((card) => keptIds.has(card.id)) };
    writeFileSync(inputs.out, `${JSON.stringify(cut, null, 2)}\n`);
  }
  if (inputs.record !== undefined) {
    const record: PoolCutRecord = {
      formatVersion: 1,
      source: { sha256: createHash('sha256').update(bytes).digest('hex'), cards: set.cards.length },
      reference: inputs.reference,
      sheets: plan.sheets,
      protected: {
        authored: authored.length,
        required: required.length,
        stated: inputs.keep,
        deckPlayed: new Set(deckPlayed).size,
        distinct: protectedIds.size,
      },
      cut: result.cut.map((card) => card.id),
    };
    writeFileSync(inputs.record, `${JSON.stringify(record, null, 2)}\n`);
  }
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
