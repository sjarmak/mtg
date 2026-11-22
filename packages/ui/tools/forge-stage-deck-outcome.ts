/** Generic downstream Forge scoring for an already-built deck. */
import { isDeepStrictEqual } from 'node:util';
import {
  BotEvidenceEpisodeSchema,
  botEvidenceSha256,
  type BotEvidenceEpisode,
  type JsonValue,
} from '@mtg/bot-evidence';
import type { DeckRef, ObservedBackend, SeatId, SessionSpec } from '@mtg/engine';
import {
  runForgeObservedPolicyGame,
  type ForgeObservedDecisionPolicy,
  type ForgeObservedGameReport,
  type ForgeObservedPolicyGameOptions,
} from '@mtg/forge-export';
import {
  StageStrengthCampaignPlanSchema,
  stageStrengthGameEpisodeId,
  type StageStrengthCampaignPlan,
  type StageStrengthOutcomeContext,
  type StageStrengthOutcomeResult,
} from '@mtg/metrics';

export interface ForgeStageDeckOutcomeOptions {
  readonly plan: StageStrengthCampaignPlan;
  readonly gameplayPolicy: ForgeObservedDecisionPolicy;
  readonly backends: ReadonlyMap<string, ObservedBackend>;
  readonly opponents: ReadonlyMap<string, DeckRef>;
  readonly maximumTurns: number;
  readonly maximumDecisions: number;
  readonly now?: () => number;
}

export type ForgeStageGameRunner = (
  options: ForgeObservedPolicyGameOptions,
) => ReturnType<typeof runForgeObservedPolicyGame>;

export function forgeGameplayPolicyIdentity(policy: ForgeObservedDecisionPolicy) {
  return {
    policyId: `${policy.identity.policyId}@${String(policy.identity.policyVersion)}`,
    configSha256: policy.identity.configSha256,
    modelSha256: null,
    dataSha256: null,
  };
}

export function forgeGameplayFeatureIdentity(policy: ForgeObservedDecisionPolicy) {
  const adapters = {
    observationAdapterId: policy.identity.observationAdapterId,
    actionAdapterId: policy.identity.actionAdapterId,
  };
  return {
    schemaId: `${adapters.observationAdapterId}+${adapters.actionAdapterId}`,
    schemaSha256: botEvidenceSha256(adapters),
  };
}

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`);
}

function snapshotBackend(backend: ObservedBackend): ObservedBackend {
  const supports = backend.supports.bind(backend);
  const open = backend.open.bind(backend);
  const shutdown = backend.shutdown?.bind(backend);
  return {
    id: backend.id,
    determinism: backend.determinism,
    capabilities: structuredClone(backend.capabilities),
    supports: (table) => supports(table),
    open: (table) => open(table),
    ...(shutdown === undefined ? {} : { shutdown: () => shutdown() }),
  };
}

function snapshotPolicy(policy: ForgeObservedDecisionPolicy): ForgeObservedDecisionPolicy {
  const choose = policy.choose;
  return { identity: structuredClone(policy.identity), choose: (position) => choose(position) };
}

function tableFor(
  formatId: string,
  gameSeed: string,
  focalSeat: SeatId,
  focalDeck: DeckRef,
  opponentDeck: DeckRef,
  maximumTurns: number,
): SessionSpec {
  const focal = { name: 'Measured deck', controller: 'local' as const, deck: structuredClone(focalDeck) };
  const opponent = {
    name: 'Frozen opponent',
    controller: 'engine' as const,
    deck: structuredClone(opponentDeck),
  };
  return {
    content: { kind: 'printed', format: formatId },
    seats: focalSeat === 0 ? [focal, opponent] : [opponent, focal],
    seed: gameSeed,
    maximumTurns,
  };
}

/** Validate all frozen downstream identities and probe each subject backend before a campaign starts. */
export async function validateForgeStageDeckOutcomeOptions(
  options: ForgeStageDeckOutcomeOptions,
): Promise<void> {
  const plan = StageStrengthCampaignPlanSchema.parse(options.plan);
  if (!isDeepStrictEqual(plan.downstream.focalPolicy, forgeGameplayPolicyIdentity(options.gameplayPolicy))) {
    throw new Error('Fixed gameplay policy differs from the campaign plan');
  }
  if (!isDeepStrictEqual(plan.downstream.features, forgeGameplayFeatureIdentity(options.gameplayPolicy))) {
    throw new Error('Gameplay feature schema differs from the campaign plan');
  }
  positiveSafeInteger(options.maximumTurns, 'maximum turns');
  positiveSafeInteger(options.maximumDecisions, 'maximum decisions');
  for (const registered of plan.downstream.opponents) {
    const opponent = options.opponents.get(registered.id);
    if (opponent === undefined || botEvidenceSha256(opponent) !== registered.artifactSha256) {
      throw new Error(`frozen opponent ${registered.id} differs from the campaign plan`);
    }
  }
  const probeOpponent = options.opponents.get(plan.downstream.opponents[0]!.id)!;
  for (const subject of plan.subjects) {
    const backend = options.backends.get(subject.id);
    if (backend === undefined) throw new Error(`campaign has no Forge backend for ${subject.id}`);
    if (backend.determinism !== 'observed')
      throw new Error(`Forge backend for ${subject.id} is not observed`);
    const reasons = await backend.supports(
      tableFor(
        subject.id,
        'campaign-runtime-validation',
        0,
        probeOpponent,
        probeOpponent,
        options.maximumTurns,
      ),
    );
    if (reasons.length > 0) {
      throw new Error(`Forge backend for ${subject.id} refused the campaign runtime: ${reasons.join('; ')}`);
    }
  }
}

function gameOptions(
  plan: ReturnType<typeof StageStrengthCampaignPlanSchema.parse>,
  options: ForgeStageDeckOutcomeOptions,
  context: StageStrengthOutcomeContext,
  deck: DeckRef,
  opponentDeck: DeckRef,
  scheduled: StageStrengthOutcomeContext['row']['outcomeSchedule'][number],
): ForgeObservedPolicyGameOptions {
  return {
    backend: snapshotBackend(options.backends.get(context.subject.id)!),
    table: tableFor(
      context.subject.id,
      scheduled.seed,
      scheduled.focalSeat,
      deck,
      opponentDeck,
      options.maximumTurns,
    ),
    candidateSeat: scheduled.focalSeat,
    policy: snapshotPolicy(options.gameplayPolicy),
    evidence: {
      id: stageStrengthGameEpisodeId(plan.id, context.row.unitId, context.arm, scheduled.gameId),
      runtime: plan.downstream.runtime,
      subject: {
        formatId: context.subject.id,
        formatSha256: context.subject.formatSha256,
        cardsSha256: context.subject.cardsSha256,
      },
      modelSha256: plan.downstream.focalPolicy.modelSha256,
      dataSha256: plan.downstream.focalPolicy.dataSha256,
      lineage: { setId: context.subject.id, poolId: context.row.seed, gameId: scheduled.gameId },
      splitGroup: { kind: 'game', id: scheduled.gameId },
    },
    maximumDecisions: options.maximumDecisions,
  };
}

function expectedIdentity(options: ForgeObservedPolicyGameOptions): BotEvidenceEpisode['episode'] {
  return {
    id: options.evidence.id,
    stage: 'gameplay',
    seed: options.table.seed,
    runtime: { ...options.evidence.runtime, kind: 'forge' },
    subject: options.evidence.subject,
    features: forgeGameplayFeatureIdentity(options.policy),
    behavior: {
      ...forgeGameplayPolicyIdentity(options.policy),
      config: options.policy.identity.configuration,
    },
    lineage: options.evidence.lineage,
    splitGroup: options.evidence.splitGroup,
  };
}

function validateReport(
  options: ForgeObservedPolicyGameOptions,
  input: ForgeObservedGameReport,
): ForgeObservedGameReport {
  const evidence = BotEvidenceEpisodeSchema.parse(input.evidence);
  if (!isDeepStrictEqual(evidence.episode, expectedIdentity(options))) {
    throw new Error(`Forge game ${options.evidence.id} evidence identity drift`);
  }
  const measurement = input.measurement;
  if (
    measurement.candidateSeat !== options.candidateSeat ||
    measurement.completion !== evidence.outcome.status ||
    measurement.decisions !== evidence.decisions.length ||
    !Number.isFinite(measurement.elapsedMs) ||
    measurement.elapsedMs < 0
  ) {
    throw new Error(`Forge game ${options.evidence.id} measurement drift`);
  }
  return { evidence, measurement: structuredClone(measurement) };
}

function thrownReport(
  options: ForgeObservedPolicyGameOptions,
  cause: unknown,
  elapsedMs: number,
): ForgeObservedGameReport {
  const message = cause instanceof Error ? cause.message : String(cause);
  return {
    evidence: {
      schemaVersion: 1,
      episode: expectedIdentity(options),
      decisions: [],
      outcome: {
        status: 'engine-failure',
        error: message.trim() === '' ? 'unknown Forge game runner failure' : message,
      },
    },
    measurement: {
      candidateSeat: options.candidateSeat,
      completion: 'engine-failure',
      elapsedMs,
      decisions: 0,
      callbackCounts: {},
    },
  };
}

function resultOf(report: ForgeObservedGameReport, focalSeat: SeatId): 'win' | 'loss' | 'draw' | null {
  if (report.evidence.outcome.status !== 'completed') return null;
  const value = report.evidence.outcome.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Completed Forge game has no structured winner');
  }
  const winner = (value as Readonly<Record<string, JsonValue>>)['winner'];
  if (winner === null) return 'draw';
  if (winner !== 0 && winner !== 1) throw new Error('Completed Forge game has an invalid winner');
  return winner === focalSeat ? 'win' : 'loss';
}

/** Score an already-built deck under one campaign row's frozen Forge schedule. */
export async function evaluateForgeStageDeckOutcome(
  options: ForgeStageDeckOutcomeOptions,
  context: StageStrengthOutcomeContext,
  deck: DeckRef,
  runGame: ForgeStageGameRunner = runForgeObservedPolicyGame,
): Promise<StageStrengthOutcomeResult> {
  const plan = StageStrengthCampaignPlanSchema.parse(options.plan);
  const games: StageStrengthOutcomeResult['outcomeEvidence']['games'][number][] = [];
  let elapsedMs = 0;
  let decisions = 0;
  for (const scheduled of context.row.outcomeSchedule) {
    const registered = plan.downstream.opponents.find(({ id }) => id === scheduled.opponentId)!;
    const opponent = options.opponents.get(scheduled.opponentId);
    if (opponent === undefined || botEvidenceSha256(opponent) !== registered.artifactSha256) {
      throw new Error(`frozen opponent ${scheduled.opponentId} differs from the campaign plan`);
    }
    const frozenOpponent = structuredClone(opponent);
    if (botEvidenceSha256(frozenOpponent) !== registered.artifactSha256) {
      throw new Error(`frozen opponent ${scheduled.opponentId} differs from the campaign plan`);
    }
    const configured = gameOptions(plan, options, context, deck, frozenOpponent, scheduled);
    const startedAt = (options.now ?? Date.now)();
    let raw: ForgeObservedGameReport;
    try {
      raw = await runGame(gameOptions(plan, options, context, deck, frozenOpponent, scheduled));
    } catch (cause: unknown) {
      raw = thrownReport(configured, cause, Math.max(0, (options.now ?? Date.now)() - startedAt));
    }
    const report = validateReport(configured, raw);
    elapsedMs += report.measurement.elapsedMs;
    decisions += report.measurement.decisions;
    const result = resultOf(report, scheduled.focalSeat);
    games.push({
      ...scheduled,
      opponent: { artifactSha256: registered.artifactSha256, policy: plan.downstream.opponentPolicy },
      result,
      evidence: report.evidence,
      measurement: { elapsedMs: report.measurement.elapsedMs, decisions: report.measurement.decisions },
    });
    if (result === null) {
      const failed = report.evidence.outcome;
      if (failed.status === 'completed') throw new Error('Completed Forge game has no result');
      return {
        outcomeEvidence: {
          version: 'stage-strength-game-outcome/v1',
          unitId: context.row.unitId,
          arm: context.arm,
          status: failed.status,
          sourceEpisodeSha256: botEvidenceSha256(context.episode),
          error: failed.error,
          games,
        },
        cost: { elapsedMs, decisions, spentUsd: 0 },
      };
    }
  }
  return {
    outcomeEvidence: {
      version: 'stage-strength-game-outcome/v1',
      unitId: context.row.unitId,
      arm: context.arm,
      status: 'completed',
      sourceEpisodeSha256: botEvidenceSha256(context.episode),
      games,
    },
    cost: { elapsedMs, decisions, spentUsd: 0 },
  };
}
