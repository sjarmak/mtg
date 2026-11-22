import { nextInt, type Rng } from './rng';
import { SealedPoolError } from './sealed';

/** Draws `count` distinct cards off one sheet, weighted, without replacement. */
export function drawWeightedEntries<CardType>(
  entries: readonly (readonly [CardType, number])[],
  count: number,
  rng: Rng,
): readonly [readonly CardType[], Rng] {
  const remaining = [...entries];
  const drawn: CardType[] = [];
  let current = rng;
  for (let taken = 0; taken < count; taken += 1) {
    const total = remaining.reduce((sum, [, weight]) => sum + weight, 0);
    if (!Number.isSafeInteger(total) || total <= 0) {
      throw new SealedPoolError('sheet weights exceed the supported range');
    }
    const [roll, advanced] = nextInt(current, total);
    current = advanced;
    let cursor = roll;
    let index = 0;
    for (; index < remaining.length - 1; index += 1) {
      const entry = remaining[index];
      if (entry === undefined) continue;
      cursor -= entry[1];
      if (cursor < 0) break;
    }
    const [entry] = remaining.splice(index, 1);
    if (entry !== undefined) drawn.push(entry[0]);
  }
  return [drawn, current];
}
