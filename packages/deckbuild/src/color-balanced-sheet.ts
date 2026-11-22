/**
 * Seeded color-balance model: reserve one mono card per color, then compensate
 * the other-card quota for those five reserved slots. This is not a factory
 * sheet-order reconstruction. MTGJSON supplies a balance flag, not sheet order.
 * Related approach: Draftmancer src/PaperBoosterFactory.ts (MIT), inspected as
 * prior art. Stochastic rounding retains the expected other-card count without
 * retry loops or an exhausted category falling back to a biased draw.
 */
import { nextInt, type Rng } from './rng';
import { SealedPoolError } from './sealed';
import { drawWeightedEntries } from './weighted-sheet';

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
type Entries<T> = readonly (readonly [T, number])[];
export type CollationColors<T> = (card: T) => readonly string[];

function groupsOf<T>(entries: Entries<T>, colorsOf: CollationColors<T>) {
  const labeled = entries.map((entry) => ({ entry, colors: colorsOf(entry[0]) }));
  if (labeled.some(({ colors }) => colors.some((color) => !COLORS.some((known) => known === color)))) {
    throw new SealedPoolError('color-balanced sheet contains an unknown color');
  }
  return {
    colors: COLORS.map((color) =>
      labeled.filter((row) => row.colors.length === 1 && row.colors[0] === color).map((row) => row.entry),
    ),
    mono: labeled.filter((row) => row.colors.length === 1).map((row) => row.entry),
    others: labeled.filter((row) => row.colors.length !== 1).map((row) => row.entry),
  };
}

function balancePlan<T>(entries: Entries<T>, count: number, colorsOf: CollationColors<T>) {
  if (count < COLORS.length) throw new SealedPoolError('color-balanced sheet needs at least five slots');
  const groups = groupsOf(entries, colorsOf);
  if (groups.colors.some((group) => group.length === 0))
    throw new SealedPoolError('color-balanced sheet is missing a mono color');
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const otherNumerator = count * groups.others.reduce((sum, [, weight]) => sum + weight, 0);
  if (!Number.isSafeInteger(otherNumerator))
    throw new SealedPoolError('color-balance quota exceeds the supported range');
  const minimumOthers = Math.floor(otherNumerator / total);
  const maximumOthers = Math.ceil(otherNumerator / total);
  if (
    maximumOthers > count - COLORS.length ||
    maximumOthers > groups.others.length ||
    count - minimumOthers > groups.mono.length
  ) {
    throw new SealedPoolError('color-balance quotas cannot fill this sheet without bias or duplicates');
  }
  return { ...groups, total, minimumOthers, remainder: otherNumerator % total };
}

export function assertColorBalancedSheet<T>(
  entries: Entries<T>,
  count: number,
  colorsOf: CollationColors<T> | undefined,
): void {
  if (colorsOf === undefined) throw new SealedPoolError('color-balanced sheet requires a color resolver');
  balancePlan(entries, count, colorsOf);
}

export function drawColorBalancedSheet<T>(
  entries: Entries<T>,
  count: number,
  rng: Rng,
  colorsOf: CollationColors<T>,
): readonly [readonly T[], Rng] {
  const plan = balancePlan(entries, count, colorsOf);
  let current = rng;
  const [quotaRoll, afterQuota] = nextInt(current, plan.total);
  current = afterQuota;
  const otherCount = plan.minimumOthers + (quotaRoll < plan.remainder ? 1 : 0);
  const drawn: T[] = [];
  for (const group of plan.colors) {
    const [cards, advanced] = drawWeightedEntries(group, 1, current);
    drawn.push(...cards);
    current = advanced;
  }
  const selected = new Set(drawn);
  const [otherCards, afterOthers] = drawWeightedEntries(plan.others, otherCount, current);
  const [monoCards, afterMono] = drawWeightedEntries(
    plan.mono.filter(([card]) => !selected.has(card)),
    count - COLORS.length - otherCount,
    afterOthers,
  );
  drawn.push(...otherCards, ...monoCards);
  current = afterMono;
  for (let index = drawn.length - 1; index > 0; index -= 1) {
    const [swap, advanced] = nextInt(current, index + 1);
    [drawn[index], drawn[swap]] = [drawn[swap]!, drawn[index]!];
    current = advanced;
  }
  return [drawn, current];
}
