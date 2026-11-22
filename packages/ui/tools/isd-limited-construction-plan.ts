/** Frozen holdout design for the first ISD Limited construction promotion decision. */
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef } from '@mtg/engine';
import type { StageStrengthCampaignPlan } from '@mtg/metrics';
import { PRINTED_LIMITED_CONSTRUCTION_FEATURES } from './printed-limited-construction-campaign';

export const ISD_CONSTRUCTION_HOLDOUT_ID = 'isd-limited-construction-holdout-v11';
const INDEPENDENT_POOLS = 50;

type Runtime = StageStrengthCampaignPlan['runtime'];
type Policy = StageStrengthCampaignPlan['policies']['baseline'];
type Features = StageStrengthCampaignPlan['features']['baseline'];

export interface IsdLimitedConstructionPlanInputs {
  readonly subject: StageStrengthCampaignPlan['subjects'][number];
  readonly builderRuntime: Runtime;
  readonly builderPolicies: StageStrengthCampaignPlan['policies'];
  readonly gameplayRuntime: StageStrengthCampaignPlan['downstream']['runtime'];
  readonly gameplayFeatures: Features;
  readonly gameplayPolicy: Policy;
  readonly opponentPolicy: Policy;
  readonly opponents: ReadonlyMap<string, DeckRef>;
}

export function buildIsdLimitedConstructionPlan(
  inputs: IsdLimitedConstructionPlanInputs,
): StageStrengthCampaignPlan {
  const opponents = [...inputs.opponents].map(([id, deck]) => ({
    id,
    artifactSha256: botEvidenceSha256(deck),
  }));
  if (inputs.subject.id !== 'isd') throw new Error('ISD holdout requires the isd printed subject');
  if (opponents.length !== 2) throw new Error('ISD holdout requires exactly two frozen opponents');
  return {
    version: 'stage-strength-campaign-plan/v1',
    id: ISD_CONSTRUCTION_HOLDOUT_ID,
    split: 'holdout',
    stage: 'limited-construction',
    evidenceStage: 'deckbuilding',
    engine: 'forge',
    runtime: inputs.builderRuntime,
    features: {
      baseline: PRINTED_LIMITED_CONSTRUCTION_FEATURES,
      candidate: PRINTED_LIMITED_CONSTRUCTION_FEATURES,
    },
    subjects: [inputs.subject],
    primaryOutcome: 'candidate-downstream-game-score-minus-baseline',
    downstream: {
      runtime: inputs.gameplayRuntime,
      features: inputs.gameplayFeatures,
      focalPolicy: inputs.gameplayPolicy,
      opponentPolicy: inputs.opponentPolicy,
      opponents,
    },
    smallestUsefulEffect: 0.1,
    regressionMargin: 0.05,
    maximumFailureRate: 0.02,
    minimumIndependentUnits: INDEPENDENT_POOLS,
    stoppingRule: { kind: 'fixed-independent-units', count: INDEPENDENT_POOLS },
    powerPlan: {
      method: 'paired-normal-approximation',
      alpha: 0.05,
      targetPower: 0.8,
      anticipatedStandardDeviation: 0.25,
      requiredIndependentUnits: INDEPENDENT_POOLS,
    },
    policies: inputs.builderPolicies,
    segmentDimensions: [{ id: 'format', values: ['isd'] }],
    schedule: Array.from({ length: INDEPENDENT_POOLS }, (_unused, index) => {
      const unit = `pool-${String(index).padStart(2, '0')}`;
      return {
        unitId: unit,
        subjectId: 'isd',
        seed: `${ISD_CONSTRUCTION_HOLDOUT_ID}/${unit}/sealed`,
        evidenceSeed: null,
        outcomeSchedule: opponents.flatMap(({ id }) =>
          ([0, 1] as const).map((focalSeat) => ({
            gameId: `${unit}/${id}/seat-${String(focalSeat)}`,
            seed: `${ISD_CONSTRUCTION_HOLDOUT_ID}/${unit}/${id}/game`,
            focalSeat,
            opponentId: id,
          })),
        ),
        segments: { format: 'isd' },
      };
    }),
  };
}
