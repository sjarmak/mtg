/**
 * The three statistics the study reports, and nothing else: rank correlation,
 * a seeded percentile bootstrap, and the mean.
 *
 * Spearman rather than Pearson because neither side is on a scale worth
 * trusting linearly: Jev's numbers are two-decimal probabilities over packs of
 * different sizes, and the strength column is a smoothed association estimate.
 * Only the order is claimed. Ties take the average rank; a column with no
 * spread has no correlation, and that is `NaN` rather than zero, so a constant
 * input cannot pass for "uncorrelated".
 */
import { createRng, nextBelow } from '../../src/rng';

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 1-based ranks, tied values sharing the mean of the ranks they span. */
export function averageRanks(values: readonly number[]): readonly number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (
      end + 1 < order.length &&
      (order[end + 1] as { value: number }).value === (order[start] as { value: number }).value
    ) {
      end += 1;
    }
    const shared = (start + end) / 2 + 1;
    for (let at = start; at <= end; at += 1) ranks[(order[at] as { index: number }).index] = shared;
    start = end + 1;
  }
  return ranks;
}

export function pearson(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length) throw new Error('pearson needs two columns of the same length');
  if (xs.length < 2) return Number.NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = (xs[index] as number) - mx;
    const dy = (ys[index] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? Number.NaN : sxy / Math.sqrt(sxx * syy);
}

export function spearman(xs: readonly number[], ys: readonly number[]): number {
  return pearson(averageRanks(xs), averageRanks(ys));
}

export interface Interval {
  readonly low: number;
  readonly high: number;
}

/**
 * Percentile bootstrap of `statistic` over the rows `0..count-1`, resampled with
 * replacement from a stream named by `seed`. A resample whose statistic is
 * undefined (`NaN`) is dropped, and `null` is returned if too few survive to
 * name a 95% interval, so an unstable statistic reports no interval rather
 * than a narrow one.
 */
export function bootstrapInterval(
  count: number,
  statistic: (rows: readonly number[]) => number,
  seed: string,
  resamples = 2000,
): Interval | null {
  if (count < 2) return null;
  let rng = createRng(seed);
  const values: number[] = [];
  for (let round = 0; round < resamples; round += 1) {
    const rows: number[] = [];
    for (let draw = 0; draw < count; draw += 1) {
      const [row, next] = nextBelow(rng, count);
      rng = next;
      rows.push(row);
    }
    const value = statistic(rows);
    if (!Number.isNaN(value)) values.push(value);
  }
  if (values.length < resamples / 2) return null;
  values.sort((a, b) => a - b);
  const at = (quantile: number): number =>
    values[Math.min(values.length - 1, Math.floor(quantile * values.length))] as number;
  return { low: at(0.025), high: at(0.975) };
}
