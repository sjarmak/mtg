import { expect, it } from 'vitest';
import { assessQualitySummary } from '../src/legacy-cube-calibration/quality-gate';
import type { summarizeQualityCampaign } from '../src/legacy-cube-calibration/quality-summary';

type Summary = ReturnType<typeof summarizeQualityCampaign>;
const criteria = [
  'coherence',
  'castability',
  'pool-alternatives',
  'explanation-accuracy',
  'exploration-usefulness',
];

/** Arithmetic fixtures only. These are not canonical reviews or strategic evidence. */
function summary(count: number, difference = 1): Summary {
  return {
    version: 'legacy-cube-quality-summary/v1',
    campaign: 'a'.repeat(64),
    split: 'holdout',
    origin: 'model',
    independentHumanEvidence: false,
    adoptionEligible: false,
    independentSessions: count,
    policyUnits: count,
    comparisons: [],
    limitations: [],
    sha256: 'b'.repeat(64),
    criteria: criteria.map((criterion) => ({
      criterion,
      observations: count,
      unresolvedSessions: 0,
      meanPairedDifference: difference,
      sessions: Array.from({ length: count }, (_, i) => ({
        session: `seed-${i}`,
        pairedDifference: difference,
        policies: [
          {
            policy: 'current',
            observations: 1,
            pairedDifference: difference,
            uncertain: 0,
            reviewerInconsistencies: 0,
            candidate: { pass: 1, fail: 0, uncertain: 0 },
          },
        ],
      })),
    })),
  };
}

it('supports a sufficiently large paired gain but never claims final adoption or human validation', () => {
  const result = assessQualitySummary(summary(100));
  expect(result.status).toBe('quality-supported');
  expect(result.adoptionEligible).toBe(false);
  expect(result.independentHumanEvidence).toBe(false);
  expect(result.criteria.every((c) => c.lowerBound! > 0)).toBe(true);
  expect(result.criteria[0]!.lowerBound).toBeCloseTo(1 - Math.sqrt((2 * Math.log(100)) / 100));
  expect(result.pending).toContain('transfer-context-review');
});

it('retains baseline for a tiny sample, ties, or tuning results', () => {
  for (const input of [summary(1), summary(100, 0), { ...summary(100), split: 'tuning' as const }])
    expect(assessQualitySummary(input).status).toBe('retain-baseline');
  expect(assessQualitySummary(summary(1)).reasons).toContain('insufficient-independent-seeds');
  expect(assessQualitySummary(summary(100, 0)).reasons).toContain('improvement-not-established');
  expect(assessQualitySummary({ ...summary(100), split: 'tuning' }).reasons).toContain('not-held-out');
});

it('does not let correlated policies and stages increase the effective sample size', () => {
  const input = summary(2);
  const inflated = {
    ...input,
    policyUnits: 40,
    criteria: input.criteria.map((c) => ({
      ...c,
      observations: 240,
      sessions: c.sessions.map((s) => ({
        ...s,
        policies: Array.from({ length: 20 }, (_, i) => ({
          ...s.policies[0]!,
          policy: `policy-${i}`,
          observations: 6,
          candidate: { pass: 6, fail: 0, uncertain: 0 },
        })),
      })),
    })),
  };
  expect(assessQualitySummary(inflated).criteria.map((c) => c.lowerBound)).toEqual(
    assessQualitySummary(input).criteria.map((c) => c.lowerBound),
  );
  expect(assessQualitySummary(inflated).status).toBe('retain-baseline');
});

it('keeps uncertain and inconsistent judgments unresolved even when other criteria improve', () => {
  const input = summary(100);
  const unresolved = {
    ...input,
    criteria: input.criteria.map((c, index) =>
      index
        ? c
        : {
            ...c,
            unresolvedSessions: 1,
            meanPairedDifference: null,
            sessions: c.sessions.map((s, i) =>
              i
                ? s
                : {
                    ...s,
                    pairedDifference: null,
                    policies: [
                      { ...s.policies[0]!, uncertain: 1, reviewerInconsistencies: 1, pairedDifference: null },
                    ],
                  },
            ),
          },
    ),
  };
  const result = assessQualitySummary(unresolved);
  expect(result.status).toBe('retain-baseline');
  expect(result.criteria[0]!.lowerBound).toBeNull();
  expect(result.reasons).toContain('unresolved-quality-judgments');
});

it('refuses any candidate failure or uncertainty, including outside the improving criterion', () => {
  for (const verdict of ['fail', 'uncertain'] as const) {
    const input = summary(100);
    const failed = {
      ...input,
      criteria: input.criteria.map((c, index) =>
        index
          ? c
          : {
              ...c,
              sessions: c.sessions.map((s, i) =>
                i
                  ? s
                  : {
                      ...s,
                      policies: [
                        { ...s.policies[0]!, candidate: { pass: 0, fail: 0, uncertain: 0, [verdict]: 1 } },
                      ],
                    },
              ),
            },
      ),
    };
    expect(assessQualitySummary(failed).status).toBe('retain-baseline');
    expect(assessQualitySummary(failed).reasons).toContain('candidate-quality-not-all-pass');
  }
});

it('rejects missing or duplicate criteria and inconsistent independent seed counts', () => {
  const input = summary(10);
  for (const criteria of [input.criteria.slice(1), input.criteria.map(() => input.criteria[0]!)])
    expect(() => assessQualitySummary({ ...input, criteria })).toThrow(/five distinct criteria/);
  for (const independentSessions of [0, 2.5, 9])
    expect(() => assessQualitySummary({ ...input, independentSessions })).toThrow(/draft seeds/);
  expect(() =>
    assessQualitySummary({
      ...input,
      criteria: input.criteria.map((c) => ({
        ...c,
        sessions: c.sessions.map(() => c.sessions[0]!),
      })),
    }),
  ).toThrow(/draft seeds/);
});
