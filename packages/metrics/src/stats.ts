/**
 * Descriptive statistics.
 *
 * Nothing here knows about Magic. Every function is total: an empty sample
 * returns `null` rather than `NaN`, because a metric that quietly reports
 * `NaN` as "0.0%" in a CI gate is worse than one that refuses to answer.
 */

export interface Interval {
  readonly low: number;
  readonly high: number;
}

export interface Summary {
  readonly count: number;
  readonly mean: number;
  readonly median: number;
  readonly p10: number;
  readonly p25: number;
  readonly p75: number;
  readonly p90: number;
  /** p75 - p25. The spread the game-length window is judged on. */
  readonly iqr: number;
  readonly min: number;
  readonly max: number;
}

/** Ratio that treats an empty denominator as zero rather than `NaN`. */
export function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/**
 * Linear-interpolated quantile over an already-sorted ascending sample.
 * `q` is clamped to [0, 1]; the classic "type 7" definition, which is what R
 * and numpy default to, so hand-checked fixtures agree with the obvious tool.
 */
export function quantileSorted(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const clamped = Math.min(1, Math.max(0, q));
  const position = clamped * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower];
  const high = sorted[upper];
  if (low === undefined || high === undefined) return null;
  if (lower === upper) return low;
  return low + (high - low) * (position - lower);
}

export function summarize(values: readonly number[]): Summary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const average = mean(sorted);
  const median = quantileSorted(sorted, 0.5);
  const p10 = quantileSorted(sorted, 0.1);
  const p25 = quantileSorted(sorted, 0.25);
  const p75 = quantileSorted(sorted, 0.75);
  const p90 = quantileSorted(sorted, 0.9);
  if (
    first === undefined ||
    last === undefined ||
    average === null ||
    median === null ||
    p10 === null ||
    p25 === null ||
    p75 === null ||
    p90 === null
  ) {
    return null;
  }
  return {
    count: sorted.length,
    mean: average,
    median,
    p10,
    p25,
    p75,
    p90,
    iqr: p75 - p25,
    min: first,
    max: last,
  };
}

/**
 * Wilson score interval for a binomial proportion.
 *
 * Used instead of the normal approximation because balance runs routinely
 * produce win rates near 0 or 1 on unbalanced v0 content, where the normal
 * interval runs off the end of [0, 1] and stops being readable.
 */
export function wilsonInterval(successes: number, trials: number, z = 1.96): Interval {
  if (trials <= 0) return { low: 0, high: 1 };
  const proportion = successes / trials;
  const zz = z * z;
  const denominator = 1 + zz / trials;
  const center = (proportion + zz / (2 * trials)) / denominator;
  const spread =
    (z * Math.sqrt((proportion * (1 - proportion)) / trials + zz / (4 * trials * trials))) / denominator;
  return { low: Math.max(0, center - spread), high: Math.min(1, center + spread) };
}

/** Half-width of the Wilson interval; the "how tight is this number" summary. */
export function intervalHalfWidth(interval: Interval): number {
  return (interval.high - interval.low) / 2;
}

/** Counts occurrences into a dense histogram indexed by value; index 0 unused. */
export function histogram(values: readonly number[]): readonly number[] {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, value);
  const counts = new Array<number>(maximum + 1).fill(0);
  for (const value of values) {
    const current = counts[value];
    if (current !== undefined) counts[value] = current + 1;
  }
  return counts;
}

/** Cumulative share of the sample at or below each index of `counts`. */
export function cumulativeShare(counts: readonly number[], total: number): readonly number[] {
  const out: number[] = [];
  let running = 0;
  for (const count of counts) {
    running += count;
    out.push(share(running, total));
  }
  return out;
}
