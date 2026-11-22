/** Fixed tuning pilot spanning Legacy Cube and qualified AKH/HOU Limited. */
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { ForgeObservedDecisionPolicy } from '@mtg/forge-export';
import {
  BotStrengthCampaignPlanSchema,
  type BotStrengthCampaignPlan,
  type BotStrengthOpponent,
} from '@mtg/metrics';

type FormatIdentity = BotStrengthCampaignPlan['formats'][number];
type OpponentPolicy = Pick<BotStrengthOpponent, 'policyId' | 'configSha256' | 'modelSha256' | 'dataSha256'>;

export interface GeneralForgePilotInputs {
  readonly campaign?: Readonly<{
    id: string;
    split: BotStrengthCampaignPlan['split'];
    seedPrefix: string;
  }>;
  readonly runtime: BotStrengthCampaignPlan['runtime'];
  readonly policies: Readonly<{
    baseline: ForgeObservedDecisionPolicy;
    candidate: ForgeObservedDecisionPolicy;
  }>;
  readonly formats: Readonly<{ cube: FormatIdentity; printed: FormatIdentity }>;
  readonly decks: Readonly<{
    cubeFocal: string;
    cubeOpponents: readonly [string, string];
    draftFocal: string;
    draftOpponent: string;
    sealedFocal: string;
    sealedOpponent: string;
  }>;
  readonly opponentPolicy: OpponentPolicy;
}

function policyIdentity(policy: ForgeObservedDecisionPolicy) {
  return {
    policyId: `${policy.identity.policyId}@${String(policy.identity.policyVersion)}`,
    configSha256: policy.identity.configSha256,
    modelSha256: null,
    dataSha256: null,
  };
}

function featureIdentity(policy: ForgeObservedDecisionPolicy) {
  const identity = {
    observationAdapterId: policy.identity.observationAdapterId,
    actionAdapterId: policy.identity.actionAdapterId,
  };
  return {
    schemaId: `${identity.observationAdapterId}+${identity.actionAdapterId}`,
    schemaSha256: botEvidenceSha256(identity),
  };
}

/** Known decks make this an operational tuning pilot; it cannot authorize promotion. */
export function buildGeneralForgePilotPlan(inputs: GeneralForgePilotInputs): BotStrengthCampaignPlan {
  const campaign = inputs.campaign ?? {
    id: 'general-forge-tuning-pilot-v3',
    split: 'tuning',
    seedPrefix: 'general-forge-pilot',
  };
  const opponent = (id: string, deckSha256: string): BotStrengthOpponent => ({
    id,
    ...inputs.opponentPolicy,
    deckSha256,
  });
  const opponents = [
    opponent('cube-opponent-a', inputs.decks.cubeOpponents[0]),
    opponent('cube-opponent-b', inputs.decks.cubeOpponents[1]),
    opponent('akh-hou-draft-opponent', inputs.decks.draftOpponent),
    opponent('akh-hou-sealed-opponent', inputs.decks.sealedOpponent),
  ];
  const units = [
    ...inputs.decks.cubeOpponents.flatMap((_, opponentIndex) =>
      [0, 1].map((seedIndex) => ({
        unitId: `cube-${String(opponentIndex + 1)}-seed-${String(seedIndex + 1)}`,
        formatId: inputs.formats.cube.id,
        opponentId: `cube-opponent-${opponentIndex === 0 ? 'a' : 'b'}`,
        seed: `${campaign.seedPrefix}/cube/${String(opponentIndex + 1)}/${String(seedIndex + 1)}`,
        focalDeckSha256: inputs.decks.cubeFocal,
      })),
    ),
    ...(['draft', 'sealed'] as const).flatMap((kind) =>
      [0, 1].map((seedIndex) => ({
        unitId: `${kind}-seed-${String(seedIndex + 1)}`,
        formatId: inputs.formats.printed.id,
        opponentId: `akh-hou-${kind}-opponent`,
        seed: `${campaign.seedPrefix}/akh-hou/${kind}/${String(seedIndex + 1)}`,
        focalDeckSha256: kind === 'draft' ? inputs.decks.draftFocal : inputs.decks.sealedFocal,
      })),
    ),
  ];
  return BotStrengthCampaignPlanSchema.parse({
    version: 'bot-strength-campaign-plan/v1',
    id: campaign.id,
    split: campaign.split,
    stage: 'gameplay',
    engine: 'forge',
    runtime: inputs.runtime,
    features: {
      baseline: featureIdentity(inputs.policies.baseline),
      candidate: featureIdentity(inputs.policies.candidate),
    },
    formats: [inputs.formats.cube, inputs.formats.printed],
    primaryOutcome: 'candidate-game-score-minus-baseline',
    smallestUsefulEffect: 0.1,
    regressionMargin: 0.1,
    maximumFailureRate: 0.05,
    minimumIndependentUnits: 8,
    stoppingRule: { kind: 'fixed-independent-units', count: 8 },
    powerPlan: {
      method: 'paired-normal-approximation',
      alpha: 0.05,
      targetPower: 0.8,
      anticipatedStandardDeviation: 0.1,
      requiredIndependentUnits: 8,
    },
    policies: {
      baseline: policyIdentity(inputs.policies.baseline),
      candidate: policyIdentity(inputs.policies.candidate),
    },
    opponents,
    schedule: units.flatMap((unit) => ([0, 1] as const).map((focalSeat) => ({ ...unit, focalSeat }))),
  });
}
