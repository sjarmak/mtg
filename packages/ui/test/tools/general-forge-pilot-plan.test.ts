import { expect, it } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import {
  forgeObservedCoveragePolicyV8,
  forgeObservedLegalBaselinePolicy,
  strongestForgeObservedPolicy,
} from '@mtg/forge-export';
import { buildGeneralForgePilotPlan } from '../../tools/general-forge-pilot-plan';

const SHA = 'a'.repeat(64);

it('pre-registers a seat-balanced cross-format pilot with fixed stopping', () => {
  const plan = buildGeneralForgePilotPlan({
    runtime: { version: 'forge-2.0.14/campaign-v1', buildSha256: SHA },
    policies: {
      baseline: forgeObservedCoveragePolicyV8,
      candidate: strongestForgeObservedPolicy,
    },
    formats: {
      cube: { id: 'legacy-cube-2021-08', formatSha256: '1'.repeat(64), cardsSha256: '2'.repeat(64) },
      printed: { id: 'akh-hou', formatSha256: '3'.repeat(64), cardsSha256: '4'.repeat(64) },
    },
    decks: {
      cubeFocal: '5'.repeat(64),
      cubeOpponents: ['6'.repeat(64), '7'.repeat(64)],
      draftFocal: '8'.repeat(64),
      draftOpponent: '9'.repeat(64),
      sealedFocal: 'b'.repeat(64),
      sealedOpponent: 'c'.repeat(64),
    },
    opponentPolicy: {
      policyId: 'forge-default@2.0.14',
      configSha256: botEvidenceSha256({ aiMode: 'Default' }),
      modelSha256: null,
      dataSha256: null,
    },
  });

  expect(plan.id).toBe('general-forge-tuning-pilot-v3');
  expect(plan.split).toBe('tuning');
  expect(plan.policies.candidate.policyId).toBe('forge-observed-strongest-play@49');
  expect(plan.features.candidate.schemaId).toBe('forge-player-observation/v1+forge-reviewed-actions/v41');
  expect(plan.stoppingRule.count).toBe(8);
  expect(plan.powerPlan.requiredIndependentUnits).toBe(8);
  expect(plan.schedule).toHaveLength(16);
  expect(new Set(plan.schedule.map((row) => row.unitId)).size).toBe(8);
  for (const unitId of new Set(plan.schedule.map((row) => row.unitId))) {
    expect(plan.schedule.filter((row) => row.unitId === unitId).map((row) => row.focalSeat)).toEqual([0, 1]);
  }
  expect(plan.opponents).toHaveLength(4);
  expect(plan.formats.map((format) => format.id)).toEqual(['legacy-cube-2021-08', 'akh-hou']);
});

it('reserves a distinct holdout identity and seed namespace without changing the schedule shape', () => {
  const plan = buildGeneralForgePilotPlan({
    campaign: {
      id: 'general-forge-holdout-v1',
      split: 'holdout',
      seedPrefix: 'general-forge-holdout-v1',
    },
    runtime: { version: 'forge-2.0.14/campaign-v1', buildSha256: SHA },
    policies: {
      baseline: forgeObservedLegalBaselinePolicy,
      candidate: strongestForgeObservedPolicy,
    },
    formats: {
      cube: { id: 'legacy-cube-2021-08', formatSha256: '1'.repeat(64), cardsSha256: '2'.repeat(64) },
      printed: { id: 'akh-hou', formatSha256: '3'.repeat(64), cardsSha256: '4'.repeat(64) },
    },
    decks: {
      cubeFocal: '5'.repeat(64),
      cubeOpponents: ['6'.repeat(64), '7'.repeat(64)],
      draftFocal: '8'.repeat(64),
      draftOpponent: '9'.repeat(64),
      sealedFocal: 'b'.repeat(64),
      sealedOpponent: 'c'.repeat(64),
    },
    opponentPolicy: {
      policyId: 'forge-default@2.0.14',
      configSha256: botEvidenceSha256({ aiMode: 'Default' }),
      modelSha256: null,
      dataSha256: null,
    },
  });

  expect(plan.id).toBe('general-forge-holdout-v1');
  expect(plan.split).toBe('holdout');
  expect(plan.policies.baseline.policyId).toBe('forge-observed-legal-baseline@31');
  expect(plan.schedule).toHaveLength(16);
  expect(plan.schedule.every((row) => row.seed.startsWith('general-forge-holdout-v1/'))).toBe(true);
  expect(plan.schedule.some((row) => row.seed.startsWith('general-forge-pilot/'))).toBe(false);
});
