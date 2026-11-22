/** Frozen tuning-only designs for Legacy Cube drafting and deck construction. */
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef } from '@mtg/engine';
import { StageStrengthCampaignPlanSchema, type StageStrengthCampaignPlan } from '@mtg/metrics';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import {
  LEGACY_CUBE_BUILDER_FEATURES,
  LEGACY_CUBE_DRAFT_FEATURES,
  legacyCubeBuilderPolicies,
  legacyCubeDraftPolicies,
  legacyCubeSubjectIdentity,
} from './legacy-cube-stage-campaign';

const INDEPENDENT_UNITS = 11;
const POWER_PLAN_REQUIRED_UNITS = 8;
const ANTICIPATED_STANDARD_DEVIATION = 0.1;
const SMALLEST_USEFUL_EFFECT = 0.1;

export interface LegacyCubeTuningPlanInputs {
  readonly catalog: PrintedCardCatalog;
  readonly nativeRuntime: StageStrengthCampaignPlan['runtime'];
  readonly gameplayRuntime: StageStrengthCampaignPlan['downstream']['runtime'];
  readonly gameplayFeatures: StageStrengthCampaignPlan['downstream']['features'];
  readonly gameplayPolicy: StageStrengthCampaignPlan['downstream']['focalPolicy'];
  readonly opponentPolicy: StageStrengthCampaignPlan['downstream']['opponentPolicy'];
  readonly opponents: ReadonlyMap<string, DeckRef>;
}

function buildPlan(
  inputs: LegacyCubeTuningPlanInputs,
  stage: 'draft' | 'limited-construction',
): StageStrengthCampaignPlan {
  if (inputs.nativeRuntime.kind !== 'native') {
    throw new Error('Legacy Cube tuning requires a native draft and builder runtime');
  }
  const opponents = [...inputs.opponents].map(([id, deck]) => ({
    id,
    artifactSha256: botEvidenceSha256(deck),
  }));
  if (opponents.length !== 2 || new Set(opponents.map(({ artifactSha256 }) => artifactSha256)).size !== 2) {
    throw new Error('Legacy Cube tuning requires exactly two distinct frozen opponents');
  }
  const id = `legacy-cube-${stage === 'draft' ? 'draft' : 'builder'}-tuning-v2`;
  const feature = stage === 'draft' ? LEGACY_CUBE_DRAFT_FEATURES : LEGACY_CUBE_BUILDER_FEATURES;
  return StageStrengthCampaignPlanSchema.parse({
    version: 'stage-strength-campaign-plan/v1',
    id,
    split: 'tuning',
    stage,
    evidenceStage: stage === 'draft' ? 'draft' : 'deckbuilding',
    engine: 'forge',
    runtime: inputs.nativeRuntime,
    features: { baseline: feature, candidate: feature },
    subjects: [legacyCubeSubjectIdentity(inputs.catalog)],
    primaryOutcome: 'candidate-downstream-game-score-minus-baseline',
    downstream: {
      runtime: inputs.gameplayRuntime,
      features: inputs.gameplayFeatures,
      focalPolicy: inputs.gameplayPolicy,
      opponentPolicy: inputs.opponentPolicy,
      opponents,
    },
    smallestUsefulEffect: SMALLEST_USEFUL_EFFECT,
    regressionMargin: 0.05,
    maximumFailureRate: 0.05,
    minimumIndependentUnits: INDEPENDENT_UNITS,
    stoppingRule: { kind: 'fixed-independent-units', count: INDEPENDENT_UNITS },
    powerPlan: {
      method: 'paired-normal-approximation',
      alpha: 0.05,
      targetPower: 0.8,
      anticipatedStandardDeviation: ANTICIPATED_STANDARD_DEVIATION,
      requiredIndependentUnits: POWER_PLAN_REQUIRED_UNITS,
    },
    policies:
      stage === 'draft' ? legacyCubeDraftPolicies(inputs.catalog) : legacyCubeBuilderPolicies(inputs.catalog),
    segmentDimensions: [{ id: 'format', values: [inputs.catalog.format] }],
    schedule: Array.from({ length: INDEPENDENT_UNITS }, (_unused, index) => {
      const seat = (index % 8) + 1;
      const unit = `${stage === 'draft' ? `pod-${String(index).padStart(2, '0')}-seat-${String(seat)}` : `pool-${String(index).padStart(2, '0')}`}`;
      const seed = `${id}/${unit}/${stage === 'draft' ? 'draft' : 'pool'}`;
      return {
        unitId: unit,
        subjectId: inputs.catalog.format,
        seed,
        evidenceSeed: stage === 'draft' ? seed : null,
        outcomeSchedule: opponents.flatMap(({ id: opponentId }) =>
          ([0, 1] as const).map((focalSeat) => ({
            gameId: `${unit}/${opponentId}/seat-${String(focalSeat)}`,
            seed: `${id}/${unit}/${opponentId}/game`,
            focalSeat,
            opponentId,
          })),
        ),
        segments: { format: inputs.catalog.format },
      };
    }),
  });
}

export function buildLegacyCubeTuningPlans(inputs: LegacyCubeTuningPlanInputs): {
  readonly draft: StageStrengthCampaignPlan;
  readonly builder: StageStrengthCampaignPlan;
} {
  return { draft: buildPlan(inputs, 'draft'), builder: buildPlan(inputs, 'limited-construction') };
}
