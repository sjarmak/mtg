import { describe, expect, it } from 'vitest';
import { legacyCubeTuningDecision } from '../../tools/legacy-cube-tuning-campaign';

function comparison(reasons: readonly string[]) {
  return {
    promotion: {
      status: 'retain-baseline' as const,
      reasons,
    },
    strength: {
      independentUnits: 8,
      meanPairedDifference: 0.1,
      interval95: { lower: 0.01, upper: 0.19 },
      byOpponent: [],
    },
    completion: {},
    cost: {},
  };
}

describe('legacyCubeTuningDecision', () => {
  it('advances a candidate when only the expected tuning split reason remains', () => {
    expect(legacyCubeTuningDecision(comparison(['not-held-out']))).toMatchObject({
      decision: 'advance-candidate-to-holdout',
      rationale: ['The tuning comparison met every preregistered strength, regression, and failure gate.'],
    });
  });

  it('retains production for every substantive promotion failure', () => {
    expect(
      legacyCubeTuningDecision(comparison(['not-held-out', 'insufficient-independent-units'])),
    ).toMatchObject({
      decision: 'retain-production-baseline',
      rationale: ['insufficient-independent-units'],
    });
  });
});
