import type { Card } from '@mtg/dsl';
import { cardManaValue } from '@mtg/dsl';

export type CutRarity = 'common' | 'uncommon';

export const CUT_RARITIES: readonly CutRarity[] = ['common', 'uncommon'];

export const CURVE_BANDS = 6;

export interface SheetShape {
  readonly size: number;
  readonly curve: readonly number[];
}

export interface PoolCutPlan {
  readonly protectedIds: ReadonlySet<string>;
  readonly sheets: Readonly<Record<CutRarity, SheetShape>>;
  readonly isAnswer: (card: Card) => boolean;
  readonly price: (card: Card) => number;
}

export type CutRole = 'answer' | 'creature' | 'spell';

export interface PoolCut {
  readonly kept: readonly Card[];
  readonly cut: readonly Card[];
}

export interface ReferencePrinting {
  readonly rarity: string;
  readonly manaValue?: number | undefined;
  readonly types: readonly string[];
}

export class PoolCutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolCutError';
  }
}

export const SINGLE_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
export const CELLS = [...SINGLE_COLORS, 'colorless', 'multicolor'] as const;

type Cell = (typeof CELLS)[number];

export function curveBand(manaValue: number): number {
  return Math.min(CURVE_BANDS, Math.max(1, Math.floor(manaValue))) - 1;
}

export function cellOf(card: Card): Cell {
  const [first, second] = card.colors;
  if (first === undefined) return 'colorless';
  return second === undefined ? first : 'multicolor';
}

export function roleOf(card: Card, isAnswer: PoolCutPlan['isAnswer']): CutRole {
  if (isAnswer(card)) return 'answer';
  return card.kind === 'creature' ? 'creature' : 'spell';
}

export function sheetShape(
  reference: readonly ReferencePrinting[],
  rarity: string,
  size: number,
): SheetShape {
  const printed = reference.filter((entry) => entry.rarity === rarity && !entry.types.includes('Land'));
  if (printed.length === 0) throw new PoolCutError(`the reference prints no ${rarity} to take a shape from`);
  const curve = Array.from(
    { length: CURVE_BANDS },
    (_, band) => printed.filter((entry) => curveBand(entry.manaValue ?? 0) === band).length,
  );
  return { size, curve };
}

export function cutPool(cards: readonly Card[], plan: PoolCutPlan): PoolCut {
  const held = new Set(
    cards
      .filter((card) => !isCutRarity(card.rarity) || plan.protectedIds.has(card.id))
      .map((card) => card.id),
  );
  const keptIds = CUT_RARITIES.reduce<ReadonlySet<string>>(
    (kept, rarity) => fillSheet(cards, kept, rarity, plan),
    held,
  );
  return {
    kept: cards.filter((card) => keptIds.has(card.id)),
    cut: cards.filter((card) => !keptIds.has(card.id)),
  };
}

function isCutRarity(rarity: string): rarity is CutRarity {
  return CUT_RARITIES.some((entry) => entry === rarity);
}

function fillSheet(
  cards: readonly Card[],
  kept: ReadonlySet<string>,
  rarity: CutRarity,
  plan: PoolCutPlan,
): ReadonlySet<string> {
  const shape = plan.sheets[rarity];
  const sheet = cards.filter((card) => card.rarity === rarity);
  const held = sheet.filter((card) => kept.has(card.id)).length;
  if (held > shape.size) {
    throw new PoolCutError(
      `${String(held)} protected ${rarity} cards do not fit a sheet of ${String(shape.size)}`,
    );
  }
  if (sheet.length < shape.size) {
    throw new PoolCutError(
      `the pool prints ${String(sheet.length)} ${rarity} cards, short of a sheet of ${String(shape.size)}`,
    );
  }
  const slots = Array.from({ length: shape.size - held });
  return slots.reduce<ReadonlySet<string>>(
    (filled) => new Set([...filled, nextCard(cards, sheet, filled, shape, plan).id]),
    kept,
  );
}

function nextCard(
  cards: readonly Card[],
  sheet: readonly Card[],
  kept: ReadonlySet<string>,
  shape: SheetShape,
  plan: PoolCutPlan,
): Card {
  const candidates = sheet.filter((card) => !kept.has(card.id));
  const cell = thinnestCell(cards, sheet, candidates, kept);
  const inCell = sheet.filter((card) => cellOf(card) === cell);
  const keptOnSheet = sheet.filter((card) => kept.has(card.id));
  const keptInCell = keptOnSheet.filter((card) => cellOf(card) === cell);
  const keptInColors = keptOnSheet.filter((card) => isSingleColor(cellOf(card)));
  const ranked = inCell
    .filter((card) => !kept.has(card.id))
    .map((card) => ({
      card,
      key: [
        priceShortfall(card, keptInCell, keptInColors, plan.price),
        keptShare(card, inCell, kept, plan.isAnswer),
        bandSurplus(card, keptOnSheet, shape),
        card.set.collectorNumber,
      ],
    }))
    .sort((left, right) => compareKeys(left.key, right.key));
  const [best] = ranked;
  if (best === undefined) throw new PoolCutError('no candidate is left to fill the sheet');
  return best.card;
}

function thinnestCell(
  cards: readonly Card[],
  sheet: readonly Card[],
  candidates: readonly Card[],
  kept: ReadonlySet<string>,
): Cell {
  const open = CELLS.filter((cell) => candidates.some((card) => cellOf(card) === cell));
  const colors = open.filter(isSingleColor);
  const held = (pool: readonly Card[], cell: Cell): number =>
    pool.filter((card) => kept.has(card.id) && cellOf(card) === cell).length;
  const ranked = (colors.length > 0 ? colors : open)
    .map((cell) => ({ cell, key: [held(sheet, cell), held(cards, cell), CELLS.indexOf(cell)] }))
    .sort((left, right) => compareKeys(left.key, right.key));
  const [best] = ranked;
  if (best === undefined) throw new PoolCutError('no candidate is left to fill the sheet');
  return best.cell;
}

function isSingleColor(cell: Cell): boolean {
  return SINGLE_COLORS.some((color) => color === cell);
}

function meanPrice(cards: readonly Card[], price: PoolCutPlan['price']): number {
  return cards.reduce((sum, card) => sum + price(card), 0) / cards.length;
}

function priceShortfall(
  card: Card,
  keptInCell: readonly Card[],
  keptInColors: readonly Card[],
  price: PoolCutPlan['price'],
): number {
  if (!isSingleColor(cellOf(card)) || keptInColors.length === 0) return 0;
  return Math.max(0, meanPrice(keptInColors, price) - meanPrice([...keptInCell, card], price));
}

function keptShare(
  card: Card,
  inCell: readonly Card[],
  kept: ReadonlySet<string>,
  isAnswer: PoolCutPlan['isAnswer'],
): number {
  const role = roleOf(card, isAnswer);
  const inRole = inCell.filter((entry) => roleOf(entry, isAnswer) === role);
  return inRole.filter((entry) => kept.has(entry.id)).length / inRole.length;
}

function bandSurplus(card: Card, keptOnSheet: readonly Card[], shape: SheetShape): number {
  const band = curveBand(cardManaValue(card));
  const curveTotal = shape.curve.reduce((sum, count) => sum + count, 0);
  const bandTarget = curveTotal === 0 ? 0 : ((shape.curve[band] ?? 0) / curveTotal) * shape.size;
  const bandHeld = keptOnSheet.filter((entry) => curveBand(cardManaValue(entry)) === band).length;
  return bandHeld - bandTarget;
}

function compareKeys(left: readonly number[], right: readonly number[]): number {
  const index = left.findIndex((value, at) => value !== right[at]);
  return index === -1 ? 0 : (left[index] ?? 0) - (right[index] ?? 0);
}
