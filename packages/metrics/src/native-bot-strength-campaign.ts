/** Native-kernel execution adapter for a canonical bot-strength campaign. */
import { isDeepStrictEqual } from 'node:util';
import { botEvidenceSha256, type BotEvidenceEpisode, type JsonValue } from '@mtg/bot-evidence';
import { canonicalJson } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import {
  NativeGameplayEvidenceError,
  completedNativeGameplayEvidence,
  createBot,
  nativeGameplayEvidenceIdentity,
  playSimGame,
  type BotSpec,
  type EnumerationCaps,
  type GameBudget,
  type GameOutcome,
  type ObservationRetention,
  type PlayGameOptions,
} from '@mtg/sim';
import {
  executeBotStrengthCampaign,
  runBotStrengthCampaign,
  type BotStrengthCampaignRun,
  type BotStrengthTrialCheckpoint,
  type BotStrengthTrialExecution,
} from './bot-strength-campaign-runner';
import {
  BotStrengthCampaignPlanSchema,
  botStrengthEpisodeId,
  type BotStrengthArm,
  type BotStrengthCampaignPlan,
  type BotStrengthOpponent,
} from './bot-strength-comparison';

const NATIVE_GAMEPLAY_FEATURE_SCHEMA = Object.freeze({
  observation: 'player-safe-kernel-agent-state/canonical-json/v1',
  candidates: 'kernel-canonical-action-set/v1',
});

type NativePolicyIdentity = Pick<
  BotStrengthOpponent,
  'policyId' | 'configSha256' | 'modelSha256' | 'dataSha256'
>;

export interface NativeBotStrengthOpponent {
  readonly spec: BotSpec;
  readonly deck: DeckList;
}

export interface NativeBotStrengthCampaignOptions {
  readonly plan: BotStrengthCampaignPlan;
  readonly policies: Readonly<Record<BotStrengthArm, BotSpec>>;
  /** Exact canonical deck SHA-256 to the executable native deck. */
  readonly decks: ReadonlyMap<string, DeckList>;
  readonly opponents: ReadonlyMap<string, NativeBotStrengthOpponent>;
  readonly maximumTurns: number;
  readonly budget: GameBudget;
  readonly caps?: EnumerationCaps;
  readonly onTrial?: BotStrengthTrialCheckpoint;
  /**
   * What each trial keeps of the observations its decisions were made on.
   * Defaults to `digest`: promotion reads outcomes and choices, and the
   * retained values were 2.0 GB for 264 games. Ask for `retained` only to
   * train from campaign play.
   */
  readonly observations?: ObservationRetention;
}

export type NativeGameRunner = (options: PlayGameOptions) => GameOutcome;

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

/** Identity of the exact serializable policy input consumed by `createBot`. */
export function nativeBotPolicyIdentity(spec: BotSpec): NativePolicyIdentity {
  return {
    policyId: `native-${spec.kind}/v1`,
    configSha256: botEvidenceSha256(spec),
    modelSha256: spec.kind === 'learned' ? spec.model.sha256 : null,
    dataSha256: spec.kind === 'learned' ? spec.dataSha256 : null,
  };
}

/** Versioned shape of safe observations and legal candidate actions retained by native games. */
export function nativeGameplayFeatureIdentity() {
  return {
    schemaId: `${NATIVE_GAMEPLAY_FEATURE_SCHEMA.observation}+${NATIVE_GAMEPLAY_FEATURE_SCHEMA.candidates}`,
    schemaSha256: botEvidenceSha256(NATIVE_GAMEPLAY_FEATURE_SCHEMA),
  };
}

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function exactDeck(digest: string, deck: DeckList | undefined, label: string): DeckList {
  if (deck === undefined) throw new Error(`campaign has no ${label} ${digest}`);
  if (botEvidenceSha256(deck) !== digest) {
    throw new Error(`${label} ${digest} differs from its executable deck`);
  }
  return deck;
}

function validateInputs(
  options: NativeBotStrengthCampaignOptions,
): ReturnType<typeof BotStrengthCampaignPlanSchema.parse> {
  const plan = BotStrengthCampaignPlanSchema.parse(options.plan);
  if (plan.engine !== 'native') throw new Error('native gameplay requires a native campaign plan');
  positiveSafeInteger(options.maximumTurns, 'maximum turns');
  positiveSafeInteger(options.budget.maxDecisions, 'maximum decisions');
  positiveSafeInteger(options.budget.maxMillis, 'maximum milliseconds');
  if (options.caps?.priority !== undefined) {
    positiveSafeInteger(options.caps.priority, 'priority cap');
  }
  if (options.caps?.declaration !== undefined) {
    positiveSafeInteger(options.caps.declaration, 'declaration cap');
  }
  const features = nativeGameplayFeatureIdentity();
  for (const arm of ['baseline', 'candidate'] as const) {
    const spec = options.policies[arm];
    if (!isDeepStrictEqual(nativeBotPolicyIdentity(spec), plan.policies[arm])) {
      throw new Error(`${arm} policy identity differs from the campaign plan`);
    }
    if (!isDeepStrictEqual(features, plan.features[arm])) {
      throw new Error(`${arm} feature identity differs from the campaign plan`);
    }
    createBot(spec, 'native-campaign/preflight', 0);
  }
  for (const row of plan.schedule) {
    exactDeck(row.focalDeckSha256, options.decks.get(row.focalDeckSha256), 'focal deck');
    const attested = plan.opponents.find((entry) => entry.id === row.opponentId)!;
    const executable = options.opponents.get(row.opponentId);
    if (executable === undefined) throw new Error(`campaign has no opponent ${row.opponentId}`);
    if (!isDeepStrictEqual(nativeBotPolicyIdentity(executable.spec), policyIdentity(attested))) {
      throw new Error(`campaign opponent policy ${row.opponentId} differs from its executable bot`);
    }
    exactDeck(attested.deckSha256, executable.deck, 'opponent deck');
    createBot(executable.spec, 'native-campaign/preflight', 0);
  }
  return plan;
}

function policyIdentity(opponent: BotStrengthOpponent): NativePolicyIdentity {
  return {
    policyId: opponent.policyId,
    configSha256: opponent.configSha256,
    modelSha256: opponent.modelSha256,
    dataSha256: opponent.dataSha256,
  };
}

function gameIndex(
  plan: ReturnType<typeof BotStrengthCampaignPlanSchema.parse>,
  unitId: string,
  seat: 0 | 1,
) {
  const index = plan.schedule.findIndex((row) => row.unitId === unitId && row.focalSeat === seat);
  if (index < 0) throw new Error(`campaign schedule lost ${unitId} seat ${String(seat)}`);
  return index;
}

function agents(
  rowSeed: string,
  focalSeat: 0 | 1,
  focal: BotSpec,
  opponent: BotSpec,
): PlayGameOptions['agents'] {
  const specs: readonly [BotSpec, BotSpec] = focalSeat === 0 ? [focal, opponent] : [opponent, focal];
  return [createBot(specs[0], `${rowSeed}/agent/0`, 0), createBot(specs[1], `${rowSeed}/agent/1`, 1)];
}

function validateDecisionSequence(evidence: BotEvidenceEpisode): void {
  for (const [index, decision] of evidence.decisions.entries()) {
    if (decision.sequence !== index) {
      throw new Error(
        `native decision sequence must be contiguous: expected ${String(index)}, received ${String(decision.sequence)}`,
      );
    }
  }
}

function validateCompletedGame(options: PlayGameOptions, outcome: GameOutcome): BotEvidenceEpisode {
  if (outcome.index !== options.index || outcome.seed !== options.seed) {
    throw new Error('native game outcome identity differs from its scheduled game');
  }
  if (outcome.evidence === undefined || options.evidence === undefined || options.evidence === null) {
    throw new Error(`native game ${options.seed} returned no requested evidence`);
  }
  validateDecisionSequence(outcome.evidence);
  const expected = completedNativeGameplayEvidence(
    nativeGameplayEvidenceIdentity(options.evidence, options.seed),
    outcome.evidence.decisions,
    outcome,
  );
  if (!isDeepStrictEqual(outcome.evidence, expected)) {
    throw new Error(`native game ${options.seed} evidence differs from its runtime outcome`);
  }
  return expected;
}

function nativeTrialExecution(
  plan: BotStrengthCampaignPlan,
  options: NativeBotStrengthCampaignOptions,
  runGame: NativeGameRunner,
): BotStrengthTrialExecution {
  return async (context) => {
    const focalDeck = options.decks.get(context.row.focalDeckSha256)!;
    const opponent = options.opponents.get(context.row.opponentId)!;
    const focalSpec = options.policies[context.arm];
    const behaviorConfig = jsonValue(focalSpec);
    const focalSeat = context.row.focalSeat;
    const gameId = botStrengthEpisodeId(plan.id, context.row.unitId, focalSeat, context.arm);
    const decks: readonly [DeckList, DeckList] =
      focalSeat === 0 ? [focalDeck, opponent.deck] : [opponent.deck, focalDeck];
    const gameOptions: PlayGameOptions = {
      index: gameIndex(plan, context.row.unitId, focalSeat),
      seed: context.row.seed,
      decks,
      agents: agents(context.row.seed, focalSeat, focalSpec, opponent.spec),
      startingPlayer: 0,
      maximumTurns: options.maximumTurns,
      budget: options.budget,
      ...(options.caps === undefined ? {} : { caps: options.caps }),
      observations: options.observations ?? 'digest',
      log: null,
      evidence: {
        id: gameId,
        runtime: context.runtime,
        subject: {
          formatId: context.format.id,
          formatSha256: context.format.formatSha256,
          cardsSha256: context.format.cardsSha256,
        },
        features: context.features,
        behavior: { ...context.policy, config: behaviorConfig },
        lineage: { gameId },
        splitGroup: { kind: 'game', id: gameId },
      },
    };
    const started = Date.now();
    try {
      const outcome = runGame(gameOptions);
      const evidence = validateCompletedGame(gameOptions, outcome);
      return {
        episode: evidence,
        cost: { elapsedMs: Date.now() - started, decisions: outcome.decisions },
      };
    } catch (error) {
      if (!(error instanceof NativeGameplayEvidenceError)) throw error;
      if (error.evidence.outcome.status === 'completed') {
        throw new Error(`native game ${context.row.unitId} threw completed evidence`);
      }
      validateDecisionSequence(error.evidence);
      return {
        episode: error.evidence,
        cost: { elapsedMs: Date.now() - started, decisions: error.evidence.decisions.length },
      };
    }
  };
}

/** Execute every preregistered row and release each validated trial after checkpointing. */
export async function executeNativeBotStrengthCampaign(
  options: NativeBotStrengthCampaignOptions,
  runGame: NativeGameRunner = playSimGame,
): Promise<number> {
  const plan = validateInputs(options);
  return executeBotStrengthCampaign(plan, nativeTrialExecution(plan, options, runGame), options.onTrial);
}

/** Execute and retain a native campaign for in-memory analysis and tests. */
export async function runNativeBotStrengthCampaign(
  options: NativeBotStrengthCampaignOptions,
  runGame: NativeGameRunner = playSimGame,
): Promise<BotStrengthCampaignRun> {
  const plan = validateInputs(options);
  return runBotStrengthCampaign(plan, nativeTrialExecution(plan, options, runGame), options.onTrial);
}
