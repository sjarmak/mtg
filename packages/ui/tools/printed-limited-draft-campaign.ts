/** Full-pod printed Limited draft comparison with fixed construction and Forge play. */
import { isDeepStrictEqual } from 'node:util';
import { botEvidenceSha256, type JsonValue } from '@mtg/bot-evidence';
import {
  runPrintedLimitedDraft,
  type PreparedPrintedLimitedFormat,
  type PrintedBoosterPayload,
} from '@mtg/draft-export';
import type { DeckRef, ObservedBackend } from '@mtg/engine';
import { prepareLimitedDeck, toDeckRef } from '@mtg/limited';
import {
  executeStageStrengthCampaign,
  runStageStrengthCampaign,
  StageStrengthCampaignPlanSchema,
  stageStrengthEpisodeId,
  type StageStrengthArm,
  type StageStrengthCampaignOptions,
  type StageStrengthCampaignPlan,
  type StageStrengthCampaignRun,
  type StageStrengthExecutionContext,
  type StageStrengthTrialCheckpoint,
} from '@mtg/metrics';
import { z } from 'zod';
import { suggestPrintedDeck } from '../src/routes/printed/deck-evaluation';
import { createPrintedReplayBot, PRINTED_GENERAL_BOT } from '../src/routes/printed/draft-bot';
import { printedLimitedFacts } from '../src/routes/printed/limited-facts';
import { printedDraftRatingsPolicy, validatePrintedDraftRatings } from '../src/lab/printed-draft-ratings';
import {
  bindPrintedConstructionBackend,
  evaluatePrintedLimitedDeckOutcome,
  forgeGameplayFeatureIdentity,
  forgeGameplayPolicyIdentity,
  printedConstructionForgeRuntime,
  printedLimitedSubjectIdentity,
  type PrintedConstructionGameRunner,
  type PrintedConstructionSubject,
  type PrintedLimitedConstructionCampaignOptions,
} from './printed-limited-construction-campaign';
import type { ForgeObservedDecisionPolicy } from '@mtg/forge-export';

const DRAFT_FEATURE_SHAPE = {
  input: 'acting-seat-visible-physical-pack-and-ordered-pool',
  output: 'one-physical-card-from-complete-offered-pack',
  scope: 'all-automated-seats-in-full-pod',
} as const;
export const PRINTED_LIMITED_DRAFT_FEATURES = {
  schemaId: 'printed-limited-full-pod-draft/v1',
  schemaSha256: botEvidenceSha256(DRAFT_FEATURE_SHAPE),
} as const;

const baselineConfig = { version: 'printed-limited-full-pod-draft/v1', evaluation: 'structural' } as const;
function candidateConfig(ratings: PrintedConstructionSubject['ratings']) {
  return {
    version: 'printed-limited-full-pod-draft/v1',
    evaluation: 'forge-ranked',
    ratingsFingerprint: ratings.source.fingerprint,
  } as const;
}

export function printedLimitedDraftPolicies(
  ratings: PrintedConstructionSubject['ratings'],
): StageStrengthCampaignPlan['policies'] {
  const candidate = candidateConfig(ratings);
  return {
    baseline: {
      policyId: PRINTED_GENERAL_BOT.botPolicy,
      configSha256: botEvidenceSha256(baselineConfig),
      modelSha256: null,
      dataSha256: null,
    },
    candidate: {
      policyId: printedDraftRatingsPolicy(ratings),
      configSha256: botEvidenceSha256(candidate),
      modelSha256: null,
      dataSha256: ratings.source.fingerprint,
    },
  };
}

export interface PrintedLimitedDraftCampaignOptions {
  readonly plan: StageStrengthCampaignPlan;
  readonly draftRuntime: StageStrengthCampaignPlan['runtime'];
  readonly gameplayPolicy: ForgeObservedDecisionPolicy;
  readonly subjects: ReadonlyMap<string, PrintedConstructionSubject>;
  readonly opponents: ReadonlyMap<string, DeckRef>;
  readonly maximumTurns: number;
  readonly maximumDecisions: number;
  readonly now?: () => number;
  readonly onTrial?: StageStrengthTrialCheckpoint;
}

function snapshotPreparedFormat(prepared: PreparedPrintedLimitedFormat): PreparedPrintedLimitedFormat {
  const openDraftPacks = prepared.openDraftPacks.bind(prepared);
  const openSealedPool = prepared.openSealedPool.bind(prepared);
  return {
    format: structuredClone(prepared.format),
    fingerprint: prepared.fingerprint,
    basicLandRemoval: structuredClone(prepared.basicLandRemoval),
    openDraftPacks: (seed) => structuredClone(openDraftPacks(seed)),
    openSealedPool: (seed) => structuredClone(openSealedPool(seed)),
  };
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

function snapshotOptions(options: PrintedLimitedDraftCampaignOptions): PrintedLimitedDraftCampaignOptions {
  const choose = options.gameplayPolicy.choose;
  return {
    plan: structuredClone(options.plan),
    draftRuntime: structuredClone(options.draftRuntime),
    gameplayPolicy: {
      identity: structuredClone(options.gameplayPolicy.identity),
      choose: (position) => choose(position),
    },
    subjects: new Map(
      [...options.subjects].map(([id, subject]) => [
        id,
        {
          ...subject,
          prepared: snapshotPreparedFormat(subject.prepared),
          catalogs: structuredClone(subject.catalogs),
          ratings: structuredClone(subject.ratings),
          backend: bindPrintedConstructionBackend(
            {
              admitted: true,
              subject: structuredClone(subject.backend.admission.subject),
              backend: snapshotBackend(subject.backend.admission.backend),
            },
            structuredClone(subject.backend.opponentPolicy),
          ),
        },
      ]),
    ),
    opponents: new Map([...options.opponents].map(([id, deck]) => [id, structuredClone(deck)])),
    maximumTurns: options.maximumTurns,
    maximumDecisions: options.maximumDecisions,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.onTrial === undefined ? {} : { onTrial: options.onTrial }),
  };
}

function policyConfig(arm: StageStrengthArm, subject: PrintedConstructionSubject): JsonValue {
  return structuredClone(arm === 'baseline' ? baselineConfig : candidateConfig(subject.ratings));
}

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`);
}

async function validateOptions(options: PrintedLimitedDraftCampaignOptions) {
  const plan = StageStrengthCampaignPlanSchema.parse(options.plan);
  if (plan.stage !== 'draft' || plan.engine !== 'forge' || plan.runtime.kind !== 'native') {
    throw new Error('Printed Limited draft requires a native draft plan with Forge outcomes');
  }
  if (!isDeepStrictEqual(plan.runtime, options.draftRuntime))
    throw new Error('Draft runtime differs from plan');
  if (
    !isDeepStrictEqual(plan.features, {
      baseline: PRINTED_LIMITED_DRAFT_FEATURES,
      candidate: PRINTED_LIMITED_DRAFT_FEATURES,
    })
  ) {
    throw new Error('Draft feature schema differs from plan');
  }
  if (!isDeepStrictEqual(plan.downstream.focalPolicy, forgeGameplayPolicyIdentity(options.gameplayPolicy))) {
    throw new Error('Fixed gameplay policy differs from plan');
  }
  if (!isDeepStrictEqual(plan.downstream.features, forgeGameplayFeatureIdentity(options.gameplayPolicy))) {
    throw new Error('Gameplay feature schema differs from plan');
  }
  positiveSafeInteger(options.maximumTurns, 'maximum turns');
  positiveSafeInteger(options.maximumDecisions, 'maximum decisions');
  for (const identity of plan.subjects) {
    const subject = options.subjects.get(identity.id);
    if (subject === undefined) throw new Error(`campaign has no subject ${identity.id}`);
    const ratings = await validatePrintedDraftRatings(subject.ratings, subject.prepared, subject.catalogs);
    if (!isDeepStrictEqual(printedLimitedSubjectIdentity(subject.prepared), identity)) {
      throw new Error(`printed subject ${identity.id} differs from plan`);
    }
    if (!isDeepStrictEqual(printedLimitedDraftPolicies(ratings), plan.policies)) {
      throw new Error(`printed draft policies for ${identity.id} differ from plan`);
    }
    const admission = subject.backend.admission.subject;
    if (
      admission.formatId !== identity.id ||
      admission.formatSha256 !== identity.formatSha256 ||
      !isDeepStrictEqual(
        admission.catalogs,
        Object.fromEntries(
          subject.prepared.format.sources.map((source) => [source.code, source.catalogSha256]),
        ),
      ) ||
      !isDeepStrictEqual(printedConstructionForgeRuntime(admission), plan.downstream.runtime) ||
      !isDeepStrictEqual(subject.backend.opponentPolicy, plan.downstream.opponentPolicy)
    )
      throw new Error(`Forge admission for ${identity.id} differs from plan`);
  }
  for (const opponent of plan.downstream.opponents) {
    const deck = options.opponents.get(opponent.id);
    if (deck === undefined || botEvidenceSha256(deck) !== opponent.artifactSha256) {
      throw new Error(`frozen opponent ${opponent.id} differs from plan`);
    }
  }
  return plan;
}

function focalSeatId(context: StageStrengthExecutionContext): string {
  const seat = context.row.segments['focal-seat'];
  if (seat === undefined || !/^seat-[1-9][0-9]*$/u.test(seat)) {
    throw new Error(`draft unit ${context.row.unitId} has no valid focal seat`);
  }
  return seat;
}

function runDraft(context: StageStrengthExecutionContext, subject: PrintedConstructionSubject) {
  const bot = createPrintedReplayBot(
    context.policy.policyId,
    context.arm === 'candidate' ? subject.ratings : undefined,
  );
  const progress = runPrintedLimitedDraft(subject.prepared, {
    seed: context.row.seed,
    ...bot,
    evidence: {
      id: `${context.row.unitId}/${context.arm}`,
      runtime: { version: context.runtime.version, buildSha256: context.runtime.buildSha256 },
      subject: {
        formatId: context.subject.id,
        formatSha256: context.subject.formatSha256,
        cardsSha256: context.subject.cardsSha256,
      },
      features: context.features,
      behavior: { ...context.policy, config: policyConfig(context.arm, subject) },
      lineage: { setId: context.subject.id, draftId: context.row.seed },
      splitGroup: { kind: 'draft', id: context.row.seed },
    },
  });
  if (progress.result === null || progress.evidence === undefined)
    throw new Error('Full-pod draft did not complete');
  return progress;
}

function stageExecutor(
  options: PrintedLimitedDraftCampaignOptions,
): StageStrengthCampaignOptions['executeStage'] {
  return async (context) => {
    const startedAt = (options.now ?? Date.now)();
    const progress = runDraft(context, options.subjects.get(context.subject.id)!);
    return {
      episode: {
        ...progress.evidence!,
        episode: {
          ...progress.evidence!.episode,
          id: stageStrengthEpisodeId(options.plan.id, context.row.unitId, context.arm),
        },
      },
      cost: { elapsedMs: Math.max(0, (options.now ?? Date.now)() - startedAt), spentUsd: 0 },
    };
  };
}

const DraftOutcomeSchema = z
  .object({
    seats: z.array(
      z
        .object({
          seatId: z.string(),
          picks: z.array(z.object({ physicalId: z.string() }).passthrough()),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function builtFocalDeck(
  context: StageStrengthExecutionContext,
  subject: PrintedConstructionSubject,
  outcome: unknown,
): DeckRef {
  const seatId = focalSeatId(context);
  const result = DraftOutcomeSchema.parse(outcome);
  const seat = result.seats.find((candidate) => candidate.seatId === seatId);
  if (seat === undefined) throw new Error(`draft result has no focal seat ${seatId}`);
  const cards = new Map(
    subject.prepared
      .openDraftPacks(context.row.seed)
      .flatMap((pack) => pack.cards.map((card) => [card.physicalId, card] as const)),
  );
  const pool = seat.picks.map(({ physicalId }) => {
    const card = cards.get(physicalId);
    if (card === undefined) throw new Error(`draft outcome references unknown physical card ${physicalId}`);
    return card as typeof card & { payload: PrintedBoosterPayload };
  });
  const initial = prepareLimitedDeck(pool, (card) => printedLimitedFacts(card.payload.printing));
  return toDeckRef(suggestPrintedDeck(initial, subject.ratings), `Drafted ${seatId}`);
}

/** Compare structural and ranked full-pod drafting while holding construction and gameplay fixed. */
export async function runPrintedLimitedDraftCampaign(
  options: PrintedLimitedDraftCampaignOptions,
  runGame?: PrintedConstructionGameRunner,
): Promise<StageStrengthCampaignRun> {
  const captured = snapshotOptions(options);
  const plan = await validateOptions(captured);
  const constructionOptions: PrintedLimitedConstructionCampaignOptions = {
    plan,
    builderRuntime: captured.draftRuntime,
    gameplayPolicy: captured.gameplayPolicy,
    subjects: captured.subjects,
    opponents: captured.opponents,
    maximumTurns: captured.maximumTurns,
    maximumDecisions: captured.maximumDecisions,
    ...(captured.now === undefined ? {} : { now: captured.now }),
  };
  return runStageStrengthCampaign({
    plan,
    executeStage: stageExecutor(captured),
    executeOutcome: async (context) => {
      if (context.episode.outcome.status !== 'completed') throw new Error('Draft stage did not complete');
      return evaluatePrintedLimitedDeckOutcome(
        plan,
        constructionOptions,
        context,
        builtFocalDeck(context, captured.subjects.get(context.subject.id)!, context.episode.outcome.value),
        runGame,
      );
    },
    ...(captured.onTrial === undefined ? {} : { onTrial: captured.onTrial }),
  });
}

/** Execute the draft holdout while retaining only checkpointed evidence. */
export async function executePrintedLimitedDraftCampaign(
  options: PrintedLimitedDraftCampaignOptions,
  runGame?: PrintedConstructionGameRunner,
): Promise<number> {
  const captured = snapshotOptions(options);
  const plan = await validateOptions(captured);
  const constructionOptions: PrintedLimitedConstructionCampaignOptions = {
    plan,
    builderRuntime: captured.draftRuntime,
    gameplayPolicy: captured.gameplayPolicy,
    subjects: captured.subjects,
    opponents: captured.opponents,
    maximumTurns: captured.maximumTurns,
    maximumDecisions: captured.maximumDecisions,
    ...(captured.now === undefined ? {} : { now: captured.now }),
  };
  return executeStageStrengthCampaign({
    plan,
    executeStage: stageExecutor(captured),
    executeOutcome: async (context) => {
      if (context.episode.outcome.status !== 'completed') throw new Error('Draft stage did not complete');
      return evaluatePrintedLimitedDeckOutcome(
        plan,
        constructionOptions,
        context,
        builtFocalDeck(context, captured.subjects.get(context.subject.id)!, context.episode.outcome.value),
        runGame,
      );
    },
    ...(captured.onTrial === undefined ? {} : { onTrial: captured.onTrial }),
  });
}
