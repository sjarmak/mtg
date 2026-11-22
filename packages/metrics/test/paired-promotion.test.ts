import { describe, expect, it } from 'vitest';
import { comparePairedPromotion, type PairedPromotionInput } from '../src/paired-promotion';

function input(): PairedPromotionInput {
  return {
    split: 'holdout',
    units: Array.from({ length: 200 }, (_, index) => ({
      unitId: `unit-${String(index)}`,
      difference: 1,
      segments: { format: 'test' },
    })),
    segmentDimensions: [{ id: 'format', values: ['test'] }],
    minimumIndependentUnits: 200,
    smallestUsefulEffect: 0.1,
    anticipatedStandardDeviation: 0.25,
    regressionMargin: 0,
    maximumFailureRate: 0,
    completion: { baseline: { rate: 1 }, candidate: { rate: 1 } },
  };
}

describe('paired promotion core validation', () => {
  it('refuses repeated independent units that would fabricate precision', () => {
    const valid = input();
    expect(comparePairedPromotion(valid).promotion.status).toBe('promote-candidate');
    expect(() => comparePairedPromotion({ ...valid, units: [...valid.units, valid.units[0]!] })).toThrow(
      /duplicate.*unit/i,
    );
  });

  it.each([
    ['smallestUsefulEffect', Number.NaN],
    ['smallestUsefulEffect', 0],
    ['smallestUsefulEffect', 2],
    ['anticipatedStandardDeviation', Number.NaN],
    ['anticipatedStandardDeviation', 0],
    ['anticipatedStandardDeviation', 2],
    ['regressionMargin', -1],
    ['regressionMargin', 2],
    ['maximumFailureRate', -1],
    ['maximumFailureRate', 2],
  ] as const)('refuses invalid %s', (field, value) => {
    expect(() => comparePairedPromotion({ ...input(), [field]: value })).toThrow();
  });

  it('refuses non-finite or out-of-range completion rates', () => {
    expect(() =>
      comparePairedPromotion({
        ...input(),
        completion: { baseline: { rate: Number.NaN }, candidate: { rate: 1 } },
      }),
    ).toThrow(/completion rate/i);
    expect(() =>
      comparePairedPromotion({
        ...input(),
        completion: { baseline: { rate: 1 }, candidate: { rate: 1.1 } },
      }),
    ).toThrow(/completion rate/i);
  });

  it('accepts a completion rate exactly at the allowed failure boundary', () => {
    const valid = input();
    const result = comparePairedPromotion({
      ...valid,
      maximumFailureRate: 0.02,
      completion: { baseline: { rate: 49 / 50 }, candidate: { rate: 49 / 50 } },
    });

    expect(result.promotion.reasons).not.toContain('baseline-failure-rate-exceeded');
    expect(result.promotion.reasons).not.toContain('candidate-failure-rate-exceeded');
  });
});

describe('paired promotion realized variance', () => {
  function spread(differences: readonly number[]): PairedPromotionInput {
    return {
      ...input(),
      units: differences.map((difference, index) => ({
        unitId: `unit-${String(index)}`,
        difference,
        segments: { format: 'test' },
      })),
      minimumIndependentUnits: differences.length,
    };
  }

  it('reports the realized spread and what the power plan would have required at it', () => {
    const result = comparePairedPromotion(
      spread(Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 1 : 0))),
    );

    expect(result.strength.power.anticipatedStandardDeviation).toBe(0.25);
    expect(result.strength.power.requiredIndependentUnits).toBe(50);
    expect(result.strength.power.realizedStandardDeviation).toBeCloseTo(0.505, 3);
    expect(result.strength.power.requiredIndependentUnitsAtRealizedVariance).toBe(201);
  });

  it('refuses to call a campaign powered when its own spread outran the anticipated one', () => {
    const result = comparePairedPromotion(
      spread(Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 1 : 0))),
    );

    expect(result.promotion.reasons).toContain('realized-variance-exceeds-power-plan');
    expect(result.promotion.status).toBe('retain-baseline');
  });

  it('stays silent when the realized spread came in inside the anticipated one', () => {
    const result = comparePairedPromotion(input());

    expect(result.strength.power.realizedStandardDeviation).toBe(0);
    expect(result.strength.power.requiredIndependentUnitsAtRealizedVariance).toBe(2);
    expect(result.promotion.reasons).not.toContain('realized-variance-exceeds-power-plan');
  });

  it('leaves the plan half unstated when the campaign declared no anticipated spread', () => {
    const { anticipatedStandardDeviation: _unused, ...withoutPlan } = spread(
      Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 1 : 0)),
    );
    const result = comparePairedPromotion(withoutPlan);

    expect(result.strength.power.anticipatedStandardDeviation).toBeNull();
    expect(result.strength.power.requiredIndependentUnits).toBeNull();
    expect(result.strength.power.requiredIndependentUnitsAtRealizedVariance).toBe(201);
    expect(result.promotion.reasons).toContain('realized-variance-exceeds-power-plan');
  });

  it('measures no spread from a single paired unit', () => {
    const result = comparePairedPromotion({
      ...spread([1, 1]),
      units: [
        { unitId: 'unit-0', difference: 1, segments: { format: 'test' } },
        { unitId: 'unit-1', difference: null, segments: { format: 'test' } },
      ],
      minimumIndependentUnits: 2,
    });

    expect(result.strength.power.realizedStandardDeviation).toBeNull();
    expect(result.strength.power.requiredIndependentUnitsAtRealizedVariance).toBeNull();
    expect(result.promotion.reasons).not.toContain('realized-variance-exceeds-power-plan');
  });
});

describe('paired promotion verdict interval', () => {
  function spread(differences: readonly number[]): PairedPromotionInput {
    return {
      ...input(),
      units: differences.map((difference, index) => ({
        unitId: `unit-${String(index)}`,
        difference,
        segments: { format: 'test' },
      })),
      minimumIndependentUnits: differences.length,
    };
  }

  it('decides on the paired normal interval at the realized spread and reports Hoeffding beside it', () => {
    // 66 units alternating 0.7 and -0.1 around a mean of 0.3, the shape of a real campaign.
    const result = comparePairedPromotion(
      spread(Array.from({ length: 66 }, (_, i) => (i % 2 === 0 ? 0.7 : -0.1))),
    );
    const z = 2.241_402_727_604_947; // Phi^-1(1 - 0.025 / 2): the headline and one format segment
    const sd = Math.sqrt((66 * 0.16) / 65);
    const halfWidth = (z * sd) / Math.sqrt(66);

    expect(result.strength.intervalMethod).toBe('simultaneous-two-sided-95%-paired-normal');
    expect(result.strength.secondaryIntervalMethod).toBe('simultaneous-two-sided-95%-hoeffding-bounds');
    expect(result.strength.interval95!.low).toBeCloseTo(0.3 - halfWidth, 9);
    expect(result.strength.interval95!.high).toBeCloseTo(0.3 + halfWidth, 9);
    expect(result.strength.hoeffdingInterval95!.low).toBeCloseTo(0.3 - Math.sqrt((2 * Math.log(80)) / 66), 9);
    expect(result.strength.bySegment[0]!.interval95).toEqual(result.strength.interval95);
    expect(result.strength.bySegment[0]!.hoeffdingInterval95).toEqual(result.strength.hoeffdingInterval95);
  });

  it('promotes on a normal interval that the Hoeffding bound alone could not', () => {
    // Mean 0.5 at spread 0.40: the plan's own arithmetic needs 40 units for an effect of 0.2.
    const result = comparePairedPromotion({
      ...spread(Array.from({ length: 66 }, (_, i) => (i % 2 === 0 ? 0.9 : 0.1))),
      smallestUsefulEffect: 0.2,
      anticipatedStandardDeviation: 0.45,
    });

    expect(result.strength.power.requiredIndependentUnits).toBe(40);
    expect(result.strength.interval95!.low).toBeGreaterThan(0.2);
    expect(result.strength.hoeffdingInterval95!.low).toBeLessThan(0.2);
    expect(result.promotion).toEqual({ status: 'promote-candidate', reasons: [] });
  });

  it('widens every interval in the family as the family grows', () => {
    const differences = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0.5 : 0));
    const one = comparePairedPromotion(spread(differences));
    const three = comparePairedPromotion({
      ...spread(differences),
      units: differences.map((difference, index) => ({
        unitId: `unit-${String(index)}`,
        difference,
        segments: { format: 'test', opponent: index % 2 === 0 ? 'a' : 'b' },
      })),
      segmentDimensions: [
        { id: 'format', values: ['test'] },
        { id: 'opponent', values: ['a', 'b'] },
      ],
    });

    expect(three.strength.interval95!.low).toBeLessThan(one.strength.interval95!.low);
    expect(three.strength.hoeffdingInterval95!.low).toBeLessThan(one.strength.hoeffdingInterval95!.low);
  });

  it('clamps both intervals to the score range', () => {
    const result = comparePairedPromotion(spread([1, 1, 1, -1]));

    expect(result.strength.interval95!.high).toBe(1);
    expect(result.strength.hoeffdingInterval95!.high).toBe(1);
    expect(comparePairedPromotion(spread([-1, -1, -1, 1])).strength.interval95!.low).toBe(-1);
  });
});
