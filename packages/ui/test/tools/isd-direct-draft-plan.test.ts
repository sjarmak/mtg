import { expect, it } from 'vitest';
import { buildIsdDirectDraftPlan, ISD_DIRECT_DRAFT_PODS } from '../../tools/isd-direct-draft-plan';

const SHA = 'a'.repeat(64);

it('freezes 50 independent held-out pods without claiming gameplay evidence', () => {
  const plan = buildIsdDirectDraftPlan({
    runtime: { kind: 'native', version: 'test', buildSha256: SHA },
    subject: { id: 'isd', formatSha256: SHA, cardsSha256: SHA },
    policies: {
      baseline: { policyId: 'baseline', configSha256: SHA, modelSha256: null, dataSha256: null },
      candidate: { policyId: 'candidate', configSha256: SHA, modelSha256: null, dataSha256: SHA },
    },
  });

  expect(plan.schedule).toHaveLength(ISD_DIRECT_DRAFT_PODS);
  expect(new Set(plan.schedule.map((row) => row.seed))).toHaveLength(ISD_DIRECT_DRAFT_PODS);
  expect(plan.split).toBe('holdout');
  expect(plan.claim).toBe('draft-pick-quality');
  expect(plan.gameplayEvidence).toBe(false);
  expect(plan.schedule.every((row) => !('focalSeat' in row))).toBe(true);
});
