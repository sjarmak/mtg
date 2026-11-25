import { expect, it } from 'vitest';
import type { DeckRef } from '@mtg/engine';
import { comparePairedPromotion, StageStrengthCampaignPlanSchema } from '@mtg/metrics';
import { buildIsdLimitedDraftPlan, ISD_DRAFT_HOLDOUT_ID } from '../../tools/isd-limited-draft-plan';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const opponents = new Map<string, DeckRef>([
  ['a', { name: 'a', cards: [{ name: 'Plains', count: 40 }] }],
  ['b', { name: 'b', cards: [{ name: 'Island', count: 40 }] }],
]);

it('preregisters enough rotated full pods for every focal-seat segment to clear the promotion bound', () => {
  const policy = { policyId: 'policy', configSha256: A, modelSha256: null, dataSha256: null };
  const plan = buildIsdLimitedDraftPlan({
    subject: { id: 'isd', formatSha256: A, cardsSha256: B },
    draftRuntime: { kind: 'native', version: 'draft/v1', buildSha256: A },
    draftPolicies: { baseline: policy, candidate: { ...policy, policyId: 'ranked', configSha256: B } },
    gameplayRuntime: { kind: 'forge', version: 'forge/v1', buildSha256: B },
    gameplayFeatures: { schemaId: 'game', schemaSha256: A },
    gameplayPolicy: policy,
    opponentPolicy: policy,
    opponents,
  });
  expect(() => StageStrengthCampaignPlanSchema.parse(plan)).not.toThrow();
  expect(plan.id).toBe(ISD_DRAFT_HOLDOUT_ID);
  expect(plan.schedule).toHaveLength(88);
  expect(new Set(plan.schedule.map((row) => row.seed))).toHaveLength(88);
  expect(new Set(plan.schedule.slice(0, 8).map((row) => row.segments['focal-seat']))).toHaveLength(8);
  expect(plan.schedule.flatMap((row) => row.outcomeSchedule)).toHaveLength(352);
  const perfect = comparePairedPromotion({
    split: plan.split,
    units: plan.schedule.map((row) => ({ unitId: row.unitId, difference: 1, segments: row.segments })),
    segmentDimensions: plan.segmentDimensions,
    minimumIndependentUnits: plan.minimumIndependentUnits,
    smallestUsefulEffect: plan.smallestUsefulEffect,
    regressionMargin: plan.regressionMargin,
    maximumFailureRate: plan.maximumFailureRate,
    completion: { baseline: { rate: 1 }, candidate: { rate: 1 } },
  });
  expect(perfect.promotion.reasons).not.toContain('segment-regression-not-excluded');
});

it('gives each roles comparison its own held-out pods, apart from the spent ranked holdout', () => {
  const policy = { policyId: 'policy', configSha256: A, modelSha256: null, dataSha256: null };
  const seeds = (['structural-vs-ranked', 'structural-vs-roles', 'ranked-vs-roles'] as const).map(
    (comparison) =>
      buildIsdLimitedDraftPlan({
        subject: { id: 'isd', formatSha256: A, cardsSha256: B },
        draftRuntime: { kind: 'native', version: 'draft/v1', buildSha256: A },
        draftPolicies: { baseline: policy, candidate: { ...policy, policyId: 'roles', configSha256: B } },
        gameplayRuntime: { kind: 'forge', version: 'forge/v1', buildSha256: B },
        gameplayFeatures: { schemaId: 'game', schemaSha256: A },
        gameplayPolicy: policy,
        opponentPolicy: policy,
        opponents,
        comparison,
      }).schedule.flatMap((row) => [row.seed, ...row.outcomeSchedule.map((game) => game.seed)]),
  );
  expect(seeds[0]![0]).toBe(`${ISD_DRAFT_HOLDOUT_ID}/pod-00/draft`);
  for (const [index, mine] of seeds.entries())
    for (const other of seeds.slice(index + 1))
      expect(mine.filter((seed) => other.includes(seed))).toEqual([]);
});
