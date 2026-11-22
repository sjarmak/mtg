import { expect, it } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef } from '@mtg/engine';
import { StageStrengthCampaignPlanSchema } from '@mtg/metrics';
import {
  buildIsdLimitedConstructionPlan,
  ISD_CONSTRUCTION_HOLDOUT_ID,
} from '../../tools/isd-limited-construction-plan';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const opponentA: DeckRef = { name: 'opponent-a', cards: [{ name: 'Plains', count: 40 }] };
const opponentB: DeckRef = { name: 'opponent-b', cards: [{ name: 'Island', count: 40 }] };

it('preregisters 50 independent ISD pools against two frozen opponents in both seats', () => {
  const plan = buildIsdLimitedConstructionPlan({
    subject: { id: 'isd', formatSha256: A, cardsSha256: B },
    builderRuntime: { kind: 'analysis', version: 'builder/v1', buildSha256: A },
    builderPolicies: {
      baseline: {
        policyId: 'structural/v1',
        configSha256: A,
        modelSha256: null,
        dataSha256: null,
      },
      candidate: {
        policyId: 'ranked/v1',
        configSha256: B,
        modelSha256: null,
        dataSha256: B,
      },
    },
    gameplayRuntime: { kind: 'forge', version: 'forge/v1', buildSha256: B },
    gameplayFeatures: { schemaId: 'game/v1', schemaSha256: A },
    gameplayPolicy: {
      policyId: 'strongest/v1',
      configSha256: A,
      modelSha256: null,
      dataSha256: null,
    },
    opponentPolicy: {
      policyId: 'forge-default/v1',
      configSha256: B,
      modelSha256: null,
      dataSha256: null,
    },
    opponents: new Map([
      ['opponent-a', opponentA],
      ['opponent-b', opponentB],
    ]),
  });

  expect(() => StageStrengthCampaignPlanSchema.parse(plan)).not.toThrow();
  expect(plan.id).toBe(ISD_CONSTRUCTION_HOLDOUT_ID);
  expect(plan.split).toBe('holdout');
  expect(plan.schedule).toHaveLength(50);
  expect(new Set(plan.schedule.map((row) => row.seed))).toHaveLength(50);
  expect(plan.schedule.flatMap((row) => row.outcomeSchedule)).toHaveLength(200);
  for (const row of plan.schedule) {
    expect(row.outcomeSchedule.map(({ opponentId, focalSeat }) => [opponentId, focalSeat])).toEqual([
      ['opponent-a', 0],
      ['opponent-a', 1],
      ['opponent-b', 0],
      ['opponent-b', 1],
    ]);
  }
  expect(plan.downstream.opponents).toEqual([
    { id: 'opponent-a', artifactSha256: botEvidenceSha256(opponentA) },
    { id: 'opponent-b', artifactSha256: botEvidenceSha256(opponentB) },
  ]);
  expect(plan.powerPlan).toMatchObject({
    anticipatedStandardDeviation: 0.25,
    requiredIndependentUnits: 50,
  });
});
