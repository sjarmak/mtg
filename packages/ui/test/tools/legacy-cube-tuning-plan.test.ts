import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef } from '@mtg/engine';
import { comparePairedPromotion, StageStrengthCampaignPlanSchema } from '@mtg/metrics';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import {
  LEGACY_CUBE_BUILDER_FEATURES,
  LEGACY_CUBE_DRAFT_FEATURES,
  legacyCubeBuilderPolicies,
  legacyCubeDraftPolicies,
  legacyCubeSubjectIdentity,
} from '../../tools/legacy-cube-stage-campaign';
import { buildLegacyCubeTuningPlans } from '../../tools/legacy-cube-tuning-plan';

const catalog = parsePrintedCardCatalog(
  JSON.parse(readFileSync('packages/data/data/legacy-cube-2021-card-catalog-v1.json', 'utf8')),
);
const opponents = new Map<string, DeckRef>([
  ['power', { name: 'Power', cards: [{ name: 'Mountain', count: 40 }] }],
  ['aggro', { name: 'Aggro', cards: [{ name: 'Forest', count: 40 }] }],
]);
const nativeRuntime = {
  kind: 'native' as const,
  version: 'legacy-cube-stage/v1',
  buildSha256: 'a'.repeat(64),
};
const gameplayRuntime = {
  kind: 'forge' as const,
  version: 'forge-test/stage-v1',
  buildSha256: 'b'.repeat(64),
};
const gameplayFeatures = { schemaId: 'observation+action', schemaSha256: 'c'.repeat(64) };
const gameplayPolicy = {
  policyId: 'strongest@1',
  configSha256: 'd'.repeat(64),
  modelSha256: null,
  dataSha256: null,
};
const opponentPolicy = {
  policyId: 'forge-default@test',
  configSha256: 'e'.repeat(64),
  modelSha256: null,
  dataSha256: null,
};

describe('Legacy Cube tuning plans', () => {
  it('freezes powered, tuning-only draft and builder schedules over distinct opponents and seats', () => {
    const plans = buildLegacyCubeTuningPlans({
      catalog,
      nativeRuntime,
      gameplayRuntime,
      gameplayFeatures,
      gameplayPolicy,
      opponentPolicy,
      opponents,
    });
    expect(() => StageStrengthCampaignPlanSchema.parse(plans.draft)).not.toThrow();
    expect(() => StageStrengthCampaignPlanSchema.parse(plans.builder)).not.toThrow();
    for (const plan of [plans.draft, plans.builder]) {
      expect(plan.split).toBe('tuning');
      expect(plan.schedule).toHaveLength(11);
      expect(plan.powerPlan).toMatchObject({
        anticipatedStandardDeviation: 0.1,
        requiredIndependentUnits: 8,
      });
      expect(plan.schedule.every((row) => row.outcomeSchedule.length === 4)).toBe(true);
      expect(
        new Set(plan.schedule.flatMap((row) => row.outcomeSchedule.map((game) => game.opponentId))),
      ).toEqual(new Set(['power', 'aggro']));
      expect(JSON.stringify(plan)).not.toContain('holdout');
    }
    expect(plans.draft.features.baseline).toEqual(LEGACY_CUBE_DRAFT_FEATURES);
    expect(plans.builder.features.baseline).toEqual(LEGACY_CUBE_BUILDER_FEATURES);
    expect(plans.draft.policies).toEqual(legacyCubeDraftPolicies(catalog));
    expect(plans.builder.policies).toEqual(legacyCubeBuilderPolicies(catalog));
    expect(plans.draft.subjects).toEqual([legacyCubeSubjectIdentity(catalog)]);
    expect(plans.draft.segmentDimensions).toEqual([{ id: 'format', values: [catalog.format] }]);
    expect(plans.draft.schedule.map((row) => row.unitId.match(/-seat-([1-8])$/u)?.[1])).toEqual(
      Array.from({ length: 11 }, (_unused, index) => String((index % 8) + 1)),
    );
    for (const plan of [plans.draft, plans.builder]) {
      const comparison = comparePairedPromotion({
        split: plan.split,
        units: plan.schedule.map((row) => ({
          unitId: row.unitId,
          segments: row.segments,
          difference: 1,
        })),
        segmentDimensions: plan.segmentDimensions,
        minimumIndependentUnits: plan.minimumIndependentUnits,
        smallestUsefulEffect: plan.smallestUsefulEffect,
        regressionMargin: plan.regressionMargin,
        maximumFailureRate: plan.maximumFailureRate,
        completion: {
          baseline: { rate: 1 },
          candidate: { rate: 1 },
        },
      });
      expect(comparison.promotion.reasons).toEqual(['not-held-out']);
    }
    expect(plans.draft.downstream.opponents).toEqual(
      [...opponents].map(([id, deck]) => ({ id, artifactSha256: botEvidenceSha256(deck) })),
    );
  });

  it('rejects duplicate opponent artifacts', () => {
    const duplicate = opponents.get('power')!;
    expect(() =>
      buildLegacyCubeTuningPlans({
        catalog,
        nativeRuntime,
        gameplayRuntime,
        gameplayFeatures,
        gameplayPolicy,
        opponentPolicy,
        opponents: new Map([
          ['one', duplicate],
          ['two', duplicate],
        ]),
      }),
    ).toThrow(/distinct/);
  });
});
