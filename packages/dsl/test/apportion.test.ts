/**
 * One largest-remainder implementation, held to both contracts it inherited.
 *
 * `@mtg/deckbuild` and `@mtg/design-data` each declared this function and each
 * tested it; mtg-bc2.134 merged them here, so their cases merge here too rather
 * than staying behind in the two suites that no longer own the code.
 *
 * The one place the copies disagreed is the last describe. `@mtg/deckbuild`'s
 * handed back zeros for an empty or all-zero weight vector; `@mtg/design-data`'s
 * refused it. The refusal survived the merge because the tolerant answer breaks
 * the postcondition every other case here asserts — that the parts sum to the
 * total — on exactly the inputs it accepts silently.
 */
import { describe, expect, it } from 'vitest';
import { apportion } from '../src/apportion';

describe('apportion', () => {
  it('hands out exactly the requested total', () => {
    expect(apportion(17, [18, 7]).reduce((sum, count) => sum + count, 0)).toBe(17);
    expect(apportion(17, [1, 1, 1])).toEqual([6, 6, 5]);
    expect(apportion(10, [1, 3, 3, 2, 1, 1])).toEqual([1, 3, 2, 2, 1, 1]);
    expect(apportion(90, [9, 3])).toEqual([68, 22]);
    expect(apportion(0, [3, 1])).toEqual([0, 0]);
  });

  it('breaks remainder ties by ascending index so the result is stable', () => {
    expect(apportion(3, [1, 1])).toEqual([2, 1]);
    expect(apportion(3, [1, 1])).toEqual(apportion(3, [1, 1]));
    expect(apportion(1, [1, 1])).toEqual([1, 0]);
    expect(apportion(3, [1, 1, 1, 1])).toEqual([1, 1, 1, 0]);
  });

  it('hands out the whole total, in integers, over a sweep of weight vectors', () => {
    // The probe mtg-bc2.66 reports and did not keep: every total against every
    // shape of weight vector. Enumerated rather than drawn, so a failure names
    // itself instead of needing a seed to reproduce. The all-zero shapes the
    // sweep generates are the refusal below, not a distribution.
    for (let total = 0; total <= 40; total += 1) {
      for (let shape = 0; shape < 50; shape += 1) {
        const weights = Array.from(
          { length: 1 + (shape % 5) },
          (_unused, index) => ((shape * 7 + index * 13) % 17) / 3,
        );
        const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
        if (weightSum === 0) {
          expect(() => apportion(total, weights)).toThrow(RangeError);
          continue;
        }
        const counts = apportion(total, weights);
        expect(counts).toHaveLength(weights.length);
        for (const count of counts) {
          expect(Number.isInteger(count)).toBe(true);
          expect(count).toBeGreaterThanOrEqual(0);
        }
        expect(counts.reduce((sum, count) => sum + count, 0)).toBe(total);
      }
    }
  });

  it('sums to the total for fractional weights at every total in the band', () => {
    for (let total = 0; total <= 40; total += 1) {
      const parts = apportion(total, [3, 1.5, 1.25, 0.2, 7]);
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
      expect(parts.every((part) => Number.isInteger(part) && part >= 0)).toBe(true);
    }
  });

  it('rejects a total that is not a whole count of slots', () => {
    expect(() => apportion(-1, [1])).toThrow(/non-negative integer/);
    expect(() => apportion(1.5, [1])).toThrow(RangeError);
  });

  it('rejects a weight vector it cannot divide by, rather than answering zeros', () => {
    expect(() => apportion(3, [1, -2])).toThrow(/non-negative/);
    expect(() => apportion(5, [1, Number.POSITIVE_INFINITY])).toThrow(/finite/);
    expect(() => apportion(5, [])).toThrow(/at least one weight/);
    expect(() => apportion(5, [0, 0])).toThrow(/must not all be zero/);
  });
});
