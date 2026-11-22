/** Frozen holdout design for the first ISD full-pod draft promotion decision. */
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef } from '@mtg/engine';
import type { StageStrengthCampaignPlan } from '@mtg/metrics';
import { PRINTED_LIMITED_DRAFT_FEATURES } from './printed-limited-draft-campaign';

export const ISD_DRAFT_HOLDOUT_ID = 'isd-limited-draft-holdout-v11';
const INDEPENDENT_PODS = 88;
const POWER_PLAN_REQUIRED_PODS = 50;

export interface IsdLimitedDraftPlanInputs {
  readonly subject: StageStrengthCampaignPlan['subjects'][number];
  readonly draftRuntime: StageStrengthCampaignPlan['runtime'];
  readonly draftPolicies: StageStrengthCampaignPlan['policies'];
  readonly gameplayRuntime: StageStrengthCampaignPlan['downstream']['runtime'];
  readonly gameplayFeatures: StageStrengthCampaignPlan['features']['baseline'];
  readonly gameplayPolicy: StageStrengthCampaignPlan['policies']['baseline'];
  readonly opponentPolicy: StageStrengthCampaignPlan['policies']['baseline'];
  readonly opponents: ReadonlyMap<string, DeckRef>;
}

export function buildIsdLimitedDraftPlan(inputs: IsdLimitedDraftPlanInputs): StageStrengthCampaignPlan {
  const opponents = [...inputs.opponents].map(([id, deck]) => ({
    id,
    artifactSha256: botEvidenceSha256(deck),
  }));
  if (inputs.subject.id !== 'isd') throw new Error('ISD holdout requires the isd printed subject');
  if (inputs.draftRuntime.kind !== 'native')
    throw new Error('ISD draft holdout requires a native draft runtime');
  if (opponents.length !== 2) throw new Error('ISD holdout requires exactly two frozen opponents');
  const focalSeats = Array.from({ length: 8 }, (_unused, index) => `seat-${String(index + 1)}`);
  return {
    version: 'stage-strength-campaign-plan/v1',
    id: ISD_DRAFT_HOLDOUT_ID,
    split: 'holdout',
    stage: 'draft',
    evidenceStage: 'draft',
    engine: 'forge',
    runtime: inputs.draftRuntime,
    features: { baseline: PRINTED_LIMITED_DRAFT_FEATURES, candidate: PRINTED_LIMITED_DRAFT_FEATURES },
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
    minimumIndependentUnits: INDEPENDENT_PODS,
    stoppingRule: { kind: 'fixed-independent-units', count: INDEPENDENT_PODS },
    powerPlan: {
      method: 'paired-normal-approximation',
      alpha: 0.05,
      targetPower: 0.8,
      anticipatedStandardDeviation: 0.25,
      requiredIndependentUnits: POWER_PLAN_REQUIRED_PODS,
    },
    policies: inputs.draftPolicies,
    segmentDimensions: [
      { id: 'format', values: ['isd'] },
      { id: 'focal-seat', values: focalSeats },
    ],
    schedule: Array.from({ length: INDEPENDENT_PODS }, (_unused, index) => {
      const unit = `pod-${String(index).padStart(2, '0')}`;
      const seed = `${ISD_DRAFT_HOLDOUT_ID}/${unit}/draft`;
      return {
        unitId: unit,
        subjectId: 'isd',
        seed,
        evidenceSeed: seed,
        outcomeSchedule: opponents.flatMap(({ id }) =>
          ([0, 1] as const).map((focalSeat) => ({
            gameId: `${unit}/${id}/seat-${String(focalSeat)}`,
            seed: `${ISD_DRAFT_HOLDOUT_ID}/${unit}/${id}/game`,
            focalSeat,
            opponentId: id,
          })),
        ),
        segments: { format: 'isd', 'focal-seat': focalSeats[index % focalSeats.length]! },
      };
    }),
  };
}
