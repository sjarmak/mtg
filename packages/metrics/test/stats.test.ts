import { describe, expect, it } from 'vitest';
import {
  cumulativeShare,
  histogram,
  intervalHalfWidth,
  mean,
  quantileSorted,
  share,
  summarize,
  wilsonInterval,
} from '@mtg/metrics';

describe('share', () => {
  it('treats an empty denominator as zero rather than NaN', () => {
    expect(share(0, 0)).toBe(0);
    expect(share(3, 4)).toBe(0.75);
  });
});

describe('mean', () => {
  it('refuses an empty sample', () => {
    expect(mean([])).toBeNull();
  });

  it('averages', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('quantileSorted', () => {
  it('interpolates linearly between order statistics', () => {
    // Type-7 quantile: position = q * (n - 1) = 0.5 * 3 = 1.5, so halfway
    // between the second and third values.
    expect(quantileSorted([1, 2, 4, 8], 0.5)).toBe(3);
    expect(quantileSorted([1, 2, 4, 8], 0)).toBe(1);
    expect(quantileSorted([1, 2, 4, 8], 1)).toBe(8);
  });

  it('clamps out-of-range quantiles instead of returning undefined', () => {
    expect(quantileSorted([1, 2, 3], -1)).toBe(1);
    expect(quantileSorted([1, 2, 3], 5)).toBe(3);
  });

  it('refuses an empty sample', () => {
    expect(quantileSorted([], 0.5)).toBeNull();
  });
});

describe('summarize', () => {
  it('reports the full five-number summary plus the IQR', () => {
    const summary = summarize([9, 1, 5, 3, 7]);
    expect(summary).not.toBeNull();
    if (summary === null) return;
    expect(summary.count).toBe(5);
    expect(summary.min).toBe(1);
    expect(summary.max).toBe(9);
    expect(summary.median).toBe(5);
    expect(summary.p25).toBe(3);
    expect(summary.p75).toBe(7);
    expect(summary.iqr).toBe(4);
    expect(summary.mean).toBe(5);
  });

  it('does not mutate the caller sample', () => {
    const values = [3, 1, 2];
    summarize(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it('refuses an empty sample', () => {
    expect(summarize([])).toBeNull();
  });
});

describe('wilsonInterval', () => {
  it('stays inside [0, 1] at the extremes where the normal interval does not', () => {
    const interval = wilsonInterval(0, 40);
    expect(interval.low).toBe(0);
    expect(interval.high).toBeGreaterThan(0);
    expect(interval.high).toBeLessThan(0.15);
  });

  it('brackets the point estimate', () => {
    const interval = wilsonInterval(50, 100);
    expect(interval.low).toBeLessThan(0.5);
    expect(interval.high).toBeGreaterThan(0.5);
  });

  it('tightens as the sample grows', () => {
    expect(intervalHalfWidth(wilsonInterval(100, 200))).toBeGreaterThan(
      intervalHalfWidth(wilsonInterval(1000, 2000)),
    );
  });

  it('is maximally wide with no trials', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it('reproduces the sample-floor arithmetic the config cites', () => {
    // 200 games at p = 0.5 gives about +/-6.9 points, which is why
    // DEFAULT_SAMPLE_FLOORS.colorPair is 200 for a 30-point-wide band.
    expect(intervalHalfWidth(wilsonInterval(100, 200))).toBeCloseTo(0.068, 2);
  });
});

describe('histogram / cumulativeShare', () => {
  it('indexes counts by value with index 0 unused for turn data', () => {
    expect(histogram([1, 2, 2, 4])).toEqual([0, 1, 2, 0, 1]);
  });

  it('accumulates to the full share', () => {
    const counts = histogram([1, 2, 2, 4]);
    const cumulative = cumulativeShare(counts, 4);
    expect(cumulative[1]).toBe(0.25);
    expect(cumulative[2]).toBe(0.75);
    expect(cumulative[4]).toBe(1);
  });
});
