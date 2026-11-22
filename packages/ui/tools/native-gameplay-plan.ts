/** Frozen schedule builder for a cross-format native gameplay comparison. */
import {
  BotStrengthCampaignPlanSchema,
  requiredIndependentUnitsFor,
  type BotStrengthCampaignPlan,
} from '@mtg/metrics';

const SMALLEST_USEFUL_EFFECT = 0.1;
const REGRESSION_MARGIN = 0.05;
const MAXIMUM_FAILURE_RATE = 0.02;
const ANTICIPATED_STANDARD_DEVIATION = 0.25;
const REQUIRED_INDEPENDENT_UNITS = requiredIndependentUnitsFor(
  ANTICIPATED_STANDARD_DEVIATION,
  SMALLEST_USEFUL_EFFECT,
);

type ArmValue<T> = Readonly<{ baseline: T; candidate: T }>;
type FormatIdentity = BotStrengthCampaignPlan['formats'][number];
type OpponentIdentity = BotStrengthCampaignPlan['opponents'][number];
type PolicyIdentity = BotStrengthCampaignPlan['policies']['baseline'];
type FeatureIdentity = BotStrengthCampaignPlan['features']['baseline'];

export interface NativeGameplayMatchup {
  readonly formatId: string;
  readonly focalDeckSha256: string;
  readonly opponentId: string;
}

export interface NativeGameplayPlanInputs {
  readonly id: string;
  readonly split: 'tuning' | 'holdout';
  readonly runtime: BotStrengthCampaignPlan['runtime'];
  readonly features: ArmValue<FeatureIdentity>;
  readonly policies: ArmValue<PolicyIdentity>;
  readonly formats: readonly FormatIdentity[];
  readonly opponents: readonly OpponentIdentity[];
  readonly matchups: readonly NativeGameplayMatchup[];
  readonly replicasPerMatchup: number;
}

function requireCompletePopulation(inputs: NativeGameplayPlanInputs, independentUnits: number): void {
  if (!Number.isSafeInteger(inputs.replicasPerMatchup) || inputs.replicasPerMatchup < 1) {
    throw new Error('Native gameplay replicas per matchup must be a positive safe integer.');
  }
  const scheduledFormats = new Set(inputs.matchups.map(({ formatId }) => formatId));
  if (inputs.formats.some(({ id }) => !scheduledFormats.has(id))) {
    throw new Error('Native gameplay must schedule every declared format.');
  }
  if (independentUnits < REQUIRED_INDEPENDENT_UNITS) {
    throw new Error(
      `Native gameplay population is below the power plan: ${String(independentUnits)} < ${String(REQUIRED_INDEPENDENT_UNITS)}.`,
    );
  }
}

/** Build and fully validate the plan before any policy sees a holdout game. */
export function buildNativeGameplayPlan(inputs: NativeGameplayPlanInputs): BotStrengthCampaignPlan {
  const independentUnits = inputs.matchups.length * inputs.replicasPerMatchup;
  requireCompletePopulation(inputs, independentUnits);
  const schedule = inputs.matchups.flatMap((matchup, matchupIndex) =>
    Array.from({ length: inputs.replicasPerMatchup }, (_unused, replica) => {
      const unitId = `matchup-${String(matchupIndex).padStart(2, '0')}/rep-${String(replica).padStart(2, '0')}`;
      return ([0, 1] as const).map((focalSeat) => ({
        ...matchup,
        unitId,
        seed: `${inputs.id}/${inputs.split}/${unitId}`,
        focalSeat,
      }));
    }).flat(),
  );
  return BotStrengthCampaignPlanSchema.parse({
    version: 'bot-strength-campaign-plan/v1',
    id: inputs.id,
    split: inputs.split,
    stage: 'gameplay',
    engine: 'native',
    runtime: inputs.runtime,
    features: inputs.features,
    formats: inputs.formats,
    primaryOutcome: 'candidate-game-score-minus-baseline',
    smallestUsefulEffect: SMALLEST_USEFUL_EFFECT,
    regressionMargin: REGRESSION_MARGIN,
    maximumFailureRate: MAXIMUM_FAILURE_RATE,
    minimumIndependentUnits: independentUnits,
    stoppingRule: { kind: 'fixed-independent-units', count: independentUnits },
    powerPlan: {
      method: 'paired-normal-approximation',
      alpha: 0.05,
      targetPower: 0.8,
      anticipatedStandardDeviation: ANTICIPATED_STANDARD_DEVIATION,
      requiredIndependentUnits: REQUIRED_INDEPENDENT_UNITS,
    },
    policies: inputs.policies,
    opponents: inputs.opponents,
    schedule,
  });
}
