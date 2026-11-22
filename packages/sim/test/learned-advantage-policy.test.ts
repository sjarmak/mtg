import { describe, expect, it } from 'vitest';
import { calibrateAdvantageMargin } from '../src/learned-advantage-policy';

describe('learned advantage policy', () => {
  it('chooses the held-out margin with the greatest counterfactual utility gain', () => {
    const calibration = calibrateAdvantageMargin([
      { predictedDifference: 0.1, utilityDifference: -0.8 },
      { predictedDifference: 0.4, utilityDifference: 0.3 },
      { predictedDifference: 0.8, utilityDifference: 0.7 },
    ]);
    expect(calibration).toMatchObject({
      minimumScoreAdvantage: 0.1,
      changed: 2,
      utilityGain: 1,
      meanUtilityGain: 0.5,
    });
    expect(calibration.supportedUtilityGain).toBeCloseTo(0.3);
  });

  it('abstains when held-out branches support no learned departure', () => {
    expect(
      calibrateAdvantageMargin([
        { predictedDifference: 0.2, utilityDifference: -0.1 },
        { predictedDifference: 0.7, utilityDifference: -0.4 },
      ]),
    ).toEqual({
      minimumScoreAdvantage: 0.7,
      changed: 0,
      utilityGain: 0,
      meanUtilityGain: 0,
      supportedUtilityGain: 0,
    });
  });
});
