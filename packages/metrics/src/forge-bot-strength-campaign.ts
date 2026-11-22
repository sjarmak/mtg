/** Forge-specific execution adapter for a canonical bot-strength campaign. */
import { isDeepStrictEqual } from 'node:util';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef, ObservedBackend, SeatId, SessionSpec } from '@mtg/engine';
import {
  runForgeObservedPolicyGame,
  type ForgeObservedDecisionPolicy,
  type ForgeObservedPolicyGameOptions,
} from '@mtg/forge-export';
import {
  executeBotStrengthCampaign,
  runBotStrengthCampaign,
  type BotStrengthCampaignRun,
  type BotStrengthTrialCheckpoint,
} from './bot-strength-campaign-runner';
import {
  BotStrengthCampaignPlanSchema,
  botStrengthEpisodeId,
  type BotStrengthArm,
  type BotStrengthCampaignPlan,
  type BotStrengthOpponent,
} from './bot-strength-comparison';

type ForgeOpponentPolicyIdentity = Pick<
  BotStrengthOpponent,
  'policyId' | 'configSha256' | 'modelSha256' | 'dataSha256'
>;

export interface ForgeBotStrengthBackend {
  readonly backend: ObservedBackend;
  /** Policy identity derived from the pinned Forge runtime and selected AI configuration. */
  readonly opponentPolicy: ForgeOpponentPolicyIdentity;
}

export interface ForgeBotStrengthCampaignOptions {
  readonly plan: BotStrengthCampaignPlan;
  readonly policies: Readonly<Record<BotStrengthArm, ForgeObservedDecisionPolicy>>;
  /** Exact deck-file SHA-256 to its parsed main deck. */
  readonly decks: ReadonlyMap<string, DeckRef>;
  /** Each backend must isolate mutable Forge state between opened sessions. */
  readonly backends: ReadonlyMap<string, ForgeBotStrengthBackend>;
  readonly maximumTurns: number;
  readonly maximumDecisions: number;
  readonly onTrial?: BotStrengthTrialCheckpoint;
}

export type ForgeObservedGameRunner = (
  options: ForgeObservedPolicyGameOptions,
) => ReturnType<typeof runForgeObservedPolicyGame>;

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
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
  const adapter = {
    observationAdapterId: policy.identity.observationAdapterId,
    actionAdapterId: policy.identity.actionAdapterId,
  };
  return {
    schemaId: `${adapter.observationAdapterId}+${adapter.actionAdapterId}`,
    schemaSha256: botEvidenceSha256(adapter),
  };
}

function validateInputs(
  options: ForgeBotStrengthCampaignOptions,
): ReturnType<typeof BotStrengthCampaignPlanSchema.parse> {
  const plan = BotStrengthCampaignPlanSchema.parse(options.plan);
  if (plan.engine !== 'forge') throw new Error('Forge gameplay requires a Forge campaign plan');
  positiveSafeInteger(options.maximumTurns, 'maximum turns');
  positiveSafeInteger(options.maximumDecisions, 'maximum decisions');
  for (const arm of ['baseline', 'candidate'] as const) {
    if (!isDeepStrictEqual(policyIdentity(options.policies[arm]), plan.policies[arm])) {
      throw new Error(`${arm} policy identity differs from the campaign plan`);
    }
    if (!isDeepStrictEqual(featureIdentity(options.policies[arm]), plan.features[arm])) {
      throw new Error(`${arm} feature identity differs from the campaign plan`);
    }
  }
  for (const row of plan.schedule) {
    const attestedBackend = options.backends.get(row.formatId);
    if (attestedBackend === undefined) {
      throw new Error(`campaign has no Forge backend for format ${row.formatId}`);
    }
    if (!options.decks.has(row.focalDeckSha256)) {
      throw new Error(`campaign has no focal deck ${row.focalDeckSha256}`);
    }
    const opponent = plan.opponents.find((entry) => entry.id === row.opponentId)!;
    const opponentPolicy: ForgeOpponentPolicyIdentity = {
      policyId: opponent.policyId,
      configSha256: opponent.configSha256,
      modelSha256: opponent.modelSha256,
      dataSha256: opponent.dataSha256,
    };
    if (!isDeepStrictEqual(attestedBackend.opponentPolicy, opponentPolicy)) {
      throw new Error(`campaign opponent policy ${opponent.id} differs from the Forge backend attestation`);
    }
    if (!options.decks.has(opponent.deckSha256)) {
      throw new Error(`campaign has no opponent deck ${opponent.deckSha256}`);
    }
  }
  return plan;
}

function tableFor(
  formatId: string,
  seed: string,
  focalSeat: SeatId,
  arm: BotStrengthArm,
  focalDeck: DeckRef,
  opponentDeck: DeckRef,
  maximumTurns: number,
): SessionSpec {
  const local = {
    name: arm === 'baseline' ? 'Baseline' : 'Candidate',
    controller: 'local' as const,
    deck: focalDeck,
  };
  const opponent = { name: 'Forge Default', controller: 'engine' as const, deck: opponentDeck };
  return {
    content: { kind: 'printed', format: formatId },
    seats: focalSeat === 0 ? [local, opponent] : [opponent, local],
    seed,
    maximumTurns,
  };
}

function forgeTrialExecution(
  plan: ReturnType<typeof BotStrengthCampaignPlanSchema.parse>,
  options: ForgeBotStrengthCampaignOptions,
  runGame: ForgeObservedGameRunner,
): Parameters<typeof runBotStrengthCampaign>[1] {
  return async (context) => {
    const focalDeck = options.decks.get(context.row.focalDeckSha256)!;
    const opponentDeck = options.decks.get(context.opponent.deckSha256)!;
    const gameId = botStrengthEpisodeId(plan.id, context.row.unitId, context.row.focalSeat, context.arm);
    const report = await runGame({
      backend: options.backends.get(context.row.formatId)!.backend,
      table: tableFor(
        context.row.formatId,
        context.row.seed,
        context.row.focalSeat,
        context.arm,
        focalDeck,
        opponentDeck,
        options.maximumTurns,
      ),
      candidateSeat: context.row.focalSeat,
      policy: options.policies[context.arm],
      evidence: {
        id: gameId,
        runtime: plan.runtime,
        subject: {
          formatId: context.format.id,
          formatSha256: context.format.formatSha256,
          cardsSha256: context.format.cardsSha256,
        },
        modelSha256: context.policy.modelSha256,
        dataSha256: context.policy.dataSha256,
        lineage: { gameId },
        splitGroup: { kind: 'game', id: gameId },
      },
      maximumDecisions: options.maximumDecisions,
    });
    return {
      episode: report.evidence,
      cost: {
        elapsedMs: report.measurement.elapsedMs,
        decisions: report.measurement.decisions,
        downstreamDecisions: 0,
        spentUsd: 0,
      },
    };
  };
}

/** Run actual local-policy-vs-Forge-Default games for every prevalidated row. */
export async function runForgeBotStrengthCampaign(
  options: ForgeBotStrengthCampaignOptions,
  runGame: ForgeObservedGameRunner = runForgeObservedPolicyGame,
): Promise<BotStrengthCampaignRun> {
  const plan = validateInputs(options);
  return runBotStrengthCampaign(plan, forgeTrialExecution(plan, options, runGame), options.onTrial);
}

/** Execute Forge gameplay trials while retaining only checkpointed evidence. */
export async function executeForgeBotStrengthCampaign(
  options: ForgeBotStrengthCampaignOptions,
  runGame: ForgeObservedGameRunner = runForgeObservedPolicyGame,
): Promise<number> {
  const plan = validateInputs(options);
  return executeBotStrengthCampaign(plan, forgeTrialExecution(plan, options, runGame), options.onTrial);
}
