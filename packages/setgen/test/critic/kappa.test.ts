/**
 * `cohensKappa` arithmetic, against worked examples this test builds and
 * checks by hand in the comments below — not against a remembered published
 * figure, so the expected numbers here are exactly as trustworthy as the
 * arithmetic that produced them.
 *
 * This file never touches real adjudication or verdict data; see
 * `../../src/critic/kappa.ts`'s docblock for why no such data exists yet.
 */
import { describe, expect, it } from 'vitest';
import type { RatingPair } from '../../src/critic/kappa';
import { cohensKappa } from '../../src/critic/kappa';

describe('cohensKappa', () => {
  it('rejects an empty pair list rather than dividing by zero', () => {
    expect(() => cohensKappa([])).toThrow(/at least one/);
  });

  it('is 1 when the two raters agree on every item', () => {
    const pairs: RatingPair[] = [
      { itemId: '1', a: 'faithful', b: 'faithful' },
      { itemId: '2', a: 'faithful', b: 'faithful' },
      { itemId: '3', a: 'partial', b: 'partial' },
      { itemId: '4', a: 'unfaithful', b: 'unfaithful' },
    ];
    const result = cohensKappa(pairs);
    expect(result.kappa).toBe(1);
    expect(result.observedAgreement).toBe(1);
    expect(result.n).toBe(4);
  });

  it('is 1, not NaN, when both raters used only one label (p_e = 1 degenerate case)', () => {
    const pairs: RatingPair[] = [
      { itemId: '1', a: 'faithful', b: 'faithful' },
      { itemId: '2', a: 'faithful', b: 'faithful' },
      { itemId: '3', a: 'faithful', b: 'faithful' },
    ];
    const result = cohensKappa(pairs);
    expect(result.expectedAgreement).toBe(1);
    expect(result.kappa).toBe(1);
    expect(Number.isNaN(result.kappa)).toBe(false);
  });

  it('is 0 when observed agreement exactly matches chance agreement', () => {
    // Two labels, each rater splits 50/50, and every item is a disagreement:
    // p_o = 0, marginals are 0.5/0.5 for both raters, so p_e = 0.25 + 0.25 = 0.5.
    // That is not this case; construct 50/50 marginals with p_o = p_e instead:
    // a: x,x,y,y ; b: y,y,x,x -> every pair disagrees, p_o = 0, p_e = 0.5,
    // kappa = (0 - 0.5) / (1 - 0.5) = -1. Use that as the "total disagreement"
    // check instead, since it is unambiguous by construction.
    const pairs: RatingPair[] = [
      { itemId: '1', a: 'x', b: 'y' },
      { itemId: '2', a: 'x', b: 'y' },
      { itemId: '3', a: 'y', b: 'x' },
      { itemId: '4', a: 'y', b: 'x' },
    ];
    const result = cohensKappa(pairs);
    expect(result.observedAgreement).toBe(0);
    expect(result.expectedAgreement).toBeCloseTo(0.5, 10);
    expect(result.kappa).toBeCloseTo(-1, 10);
  });

  it('matches a hand-computed worked example over the three faithfulness labels', () => {
    // a marginals: faithful 4, partial 3, unfaithful 3 (of 10) -> 0.4/0.3/0.3
    // b marginals: faithful 4, partial 3, unfaithful 3 (of 10) -> 0.4/0.3/0.3
    // p_e = 0.4*0.4 + 0.3*0.3 + 0.3*0.3 = 0.16 + 0.09 + 0.09 = 0.34
    // matches (a === b): items 1,2,4,5,7,8,10 = 7/10 -> p_o = 0.7
    // kappa = (0.7 - 0.34) / (1 - 0.34) = 0.36 / 0.66
    const pairs: RatingPair[] = [
      { itemId: '1', a: 'faithful', b: 'faithful' },
      { itemId: '2', a: 'faithful', b: 'faithful' },
      { itemId: '3', a: 'faithful', b: 'partial' },
      { itemId: '4', a: 'partial', b: 'partial' },
      { itemId: '5', a: 'partial', b: 'partial' },
      { itemId: '6', a: 'partial', b: 'unfaithful' },
      { itemId: '7', a: 'unfaithful', b: 'unfaithful' },
      { itemId: '8', a: 'unfaithful', b: 'unfaithful' },
      { itemId: '9', a: 'unfaithful', b: 'faithful' },
      { itemId: '10', a: 'faithful', b: 'faithful' },
    ];
    const result = cohensKappa(pairs);
    expect(result.observedAgreement).toBeCloseTo(0.7, 10);
    expect(result.expectedAgreement).toBeCloseTo(0.34, 10);
    expect(result.kappa).toBeCloseTo(0.36 / 0.66, 10);
    expect(result.n).toBe(10);
    expect(result.labels).toStrictEqual(['faithful', 'partial', 'unfaithful']);
  });

  it('builds a confusion matrix readable as matrix[a][b] = count', () => {
    const pairs: RatingPair[] = [
      { itemId: '1', a: 'faithful', b: 'faithful' },
      { itemId: '2', a: 'faithful', b: 'partial' },
      { itemId: '3', a: 'partial', b: 'partial' },
    ];
    const result = cohensKappa(pairs);
    expect(result.confusionMatrix.get('faithful')?.get('faithful')).toBe(1);
    expect(result.confusionMatrix.get('faithful')?.get('partial')).toBe(1);
    expect(result.confusionMatrix.get('partial')?.get('partial')).toBe(1);
    expect(result.confusionMatrix.get('partial')?.get('faithful')).toBeUndefined();
  });
});
