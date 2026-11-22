/** Stage-isolated Legacy Cube comparisons scored only by downstream Forge games. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { botEvidenceSha256, type BotEvidenceEpisode, type JsonValue } from '@mtg/bot-evidence';
import { evaluateDraft, LEGACY_CUBE_ADVISOR_MODEL, type ObservedDraft } from '@mtg/draft-export';
import { toDeckRef } from '@mtg/limited';
import {
  buildCalibrationDeck,
  executeStageStrengthCampaign,
  runStageStrengthCampaign,
  StageStrengthCampaignPlanSchema,
  stageStrengthEpisodeId,
  type StageStrengthCampaignPlan,
  type StageStrengthCampaignOptions,
  type StageStrengthCampaignRun,
  type StageStrengthExecutionContext,
  type StageStrengthOutcomeContext,
  type StageStrengthOutcomeResult,
  type StageStrengthTrialCheckpoint,
} from '@mtg/metrics';
import type { PrintedCardCatalog, PrintedCardCatalogEntry } from '@mtg/printed-card';
import { serializedPrintedCardCatalogContent } from '@mtg/printed-card';
import {
  buildLegacyCubePoolDeck,
  legacyCubeBotPickValue,
  runLegacyCubeDraft,
  LEGACY_CUBE_BOT_POLICY,
} from '../src/routes/legacy-cube/model';

const draftFeatureShape = {
  input: 'one-seat-visible-pack-and-ordered-picks',
  output: 'one-physical-card-from-complete-pack',
  otherSeats: 'production-structural-policy',
} as const;
export const LEGACY_CUBE_DRAFT_FEATURES = {
  schemaId: 'legacy-cube-production-draft/v1',
  schemaSha256: botEvidenceSha256(draftFeatureShape),
} as const;

const builderFeatureShape = {
  input: 'ordered-45-card-physical-pool',
  output: 'legal-40-card-deck',
} as const;
export const LEGACY_CUBE_BUILDER_FEATURES = {
  schemaId: 'legacy-cube-production-builder/v1',
  schemaSha256: botEvidenceSha256(builderFeatureShape),
} as const;

const productionDraftConfig = { version: 'legacy-cube-production-draft/v1', score: LEGACY_CUBE_BOT_POLICY };
const advisorInput = {
  archetypes: LEGACY_CUBE_ADVISOR_MODEL.archetypes,
  profiles: LEGACY_CUBE_ADVISOR_MODEL.profiles,
  packages: LEGACY_CUBE_ADVISOR_MODEL.packages,
};
const advisorDraftConfig = { version: 'legacy-cube-advisor-draft/v1', recommendation: 'current-or-flexible' };
const productionBuilderConfig = {
  version: 'legacy-cube-production-builder/v1',
  policy: 'deck-conditioned/v1',
};
const calibrationBuilderConfig = {
  version: 'legacy-cube-calibration-builder/v1',
  policy: 'two-color-package-preserving/v1',
};

export function legacyCubeSubjectIdentity(catalog: PrintedCardCatalog) {
  return {
    id: catalog.format,
    formatSha256: catalog.contentSha256,
    cardsSha256: botEvidenceSha256(catalog.cards),
  };
}

function draftCampaignOptions(options: CommonOptions): StageStrengthCampaignOptions {
  const captured = {
    ...options,
    plan: structuredClone(options.plan),
    catalog: structuredClone(options.catalog),
  };
  const plan = validateCommon(captured, 'draft');
  const decks = new Map<string, ReturnType<typeof toDeckRef>>();
  return {
    plan,
    executeStage: async (context) => {
      const started = (captured.now ?? Date.now)();
      const result = draftEpisode(plan.id, captured.catalog, context);
      decks.set(`${context.row.unitId}\u0000${context.arm}`, result.deck);
      return {
        episode: result.episode,
        cost: { elapsedMs: Math.max(0, (captured.now ?? Date.now)() - started), spentUsd: 0 },
      };
    },
    executeOutcome: async (context) => {
      const key = `${context.row.unitId}\u0000${context.arm}`;
      const deck = structuredClone(decks.get(key)!);
      decks.delete(key);
      return captured.executeOutcome(context, deck);
    },
    ...(captured.onTrial === undefined ? {} : { onTrial: captured.onTrial }),
  };
}

export function legacyCubeDraftPolicies(catalog: PrintedCardCatalog): StageStrengthCampaignPlan['policies'] {
  return {
    baseline: {
      policyId: LEGACY_CUBE_BOT_POLICY,
      configSha256: botEvidenceSha256(productionDraftConfig),
      modelSha256: null,
      dataSha256: null,
    },
    candidate: {
      policyId: 'legacy-cube-advisor-current/v1',
      configSha256: botEvidenceSha256(advisorDraftConfig),
      modelSha256: botEvidenceSha256(advisorInput),
      dataSha256: catalog.contentSha256,
    },
  };
}

export function legacyCubeBuilderPolicies(
  catalog: PrintedCardCatalog,
): StageStrengthCampaignPlan['policies'] {
  return {
    baseline: {
      policyId: 'deck-conditioned/v1',
      configSha256: botEvidenceSha256(productionBuilderConfig),
      modelSha256: null,
      dataSha256: null,
    },
    candidate: {
      policyId: 'two-color-package-preserving/v1',
      configSha256: botEvidenceSha256(calibrationBuilderConfig),
      modelSha256: botEvidenceSha256(advisorInput),
      dataSha256: catalog.contentSha256,
    },
  };
}

export type LegacyCubeDeckOutcomeExecution = (
  context: StageStrengthOutcomeContext,
  deck: ReturnType<typeof toDeckRef>,
) => Promise<StageStrengthOutcomeResult>;

interface CommonOptions {
  readonly plan: StageStrengthCampaignPlan;
  readonly catalog: PrintedCardCatalog;
  readonly executeOutcome: LegacyCubeDeckOutcomeExecution;
  readonly now?: () => number;
  readonly onTrial?: StageStrengthTrialCheckpoint;
}

export interface LegacyCubeBuilderStageCampaignOptions extends CommonOptions {
  readonly pools: ReadonlyMap<string, readonly string[]>;
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function verifyCatalog(catalog: PrintedCardCatalog): void {
  const actual = createHash('sha256').update(serializedPrintedCardCatalogContent(catalog)).digest('hex');
  if (actual !== catalog.contentSha256) throw new Error('Legacy Cube catalog checksum drift');
}

function validateCommon(options: CommonOptions, stage: 'draft' | 'limited-construction') {
  verifyCatalog(options.catalog);
  const plan = StageStrengthCampaignPlanSchema.parse(options.plan);
  const features = stage === 'draft' ? LEGACY_CUBE_DRAFT_FEATURES : LEGACY_CUBE_BUILDER_FEATURES;
  const policies =
    stage === 'draft' ? legacyCubeDraftPolicies(options.catalog) : legacyCubeBuilderPolicies(options.catalog);
  if (
    plan.stage !== stage ||
    plan.engine !== 'forge' ||
    plan.runtime.kind !== 'native' ||
    !isDeepStrictEqual(plan.features, { baseline: features, candidate: features }) ||
    !isDeepStrictEqual(plan.policies, policies) ||
    !isDeepStrictEqual(plan.subjects, [legacyCubeSubjectIdentity(options.catalog)])
  ) {
    throw new Error(`Legacy Cube ${stage} campaign differs from its production contract`);
  }
  return plan;
}

function policyConfig(context: StageStrengthExecutionContext): JsonValue {
  if (context.policy.policyId === LEGACY_CUBE_BOT_POLICY) return productionDraftConfig;
  if (context.policy.policyId === 'legacy-cube-advisor-current/v1') return advisorDraftConfig;
  if (context.policy.policyId === 'deck-conditioned/v1') return productionBuilderConfig;
  return calibrationBuilderConfig;
}

function episodeIdentity(
  planId: string,
  context: StageStrengthExecutionContext,
  stage: 'draft' | 'deckbuilding',
): BotEvidenceEpisode['episode'] {
  return {
    id: stageStrengthEpisodeId(planId, context.row.unitId, context.arm),
    stage,
    seed: context.row.evidenceSeed,
    runtime: context.runtime,
    subject: {
      formatId: context.subject.id,
      formatSha256: context.subject.formatSha256,
      cardsSha256: context.subject.cardsSha256,
    },
    features: context.features,
    behavior: { ...context.policy, config: policyConfig(context) },
    lineage: { setId: context.subject.id, poolId: context.row.seed, draftId: context.row.seed },
    splitGroup: { kind: stage === 'draft' ? 'draft' : 'pool', id: context.row.seed },
  };
}

function focalSeat(context: StageStrengthExecutionContext): string {
  const segment = context.row.segments['focal-seat'];
  if (segment !== undefined && /^seat-[1-8]$/u.test(segment)) return segment;
  const encoded = context.row.unitId.match(/-seat-([1-8])$/u)?.[1];
  if (encoded === undefined) throw new Error('Legacy Cube unit has no valid focal seat');
  return `seat-${encoded}`;
}

function draftEpisode(
  planId: string,
  catalog: PrintedCardCatalog,
  context: StageStrengthExecutionContext,
): { episode: BotEvidenceEpisode; deck: ReturnType<typeof toDeckRef> } {
  const seatId = focalSeat(context);
  const byId = new Map(catalog.cards.map((card) => [card.physicalId, card]));
  let picks: readonly string[] = [];
  let decisions: BotEvidenceEpisode['decisions'] = [];
  for (;;) {
    const progress = runLegacyCubeDraft(catalog, context.row.seed, picks, seatId);
    if (progress.result !== null) {
      const pool = picks.map((id) => ({ physicalId: id, payload: byId.get(id)! }));
      const built = buildLegacyCubePoolDeck(pool);
      return {
        deck: toDeckRef(built.deck, `Legacy Cube ${seatId}`),
        episode: {
          schemaVersion: 1,
          episode: episodeIdentity(planId, context, 'draft'),
          decisions,
          outcome: { status: 'completed', value: { seatId, poolPhysicalIds: picks } },
        },
      };
    }
    const owed = progress.owed[0];
    if (owed === undefined || owed.seatId !== seatId)
      throw new Error('Legacy Cube draft stopped without a focal pack');
    const pickedCards = picks.map((id) => byId.get(id)!);
    const observed: ObservedDraft = {
      seats: 8,
      rounds: 3,
      packSize: 15,
      picks,
      observations: progress.observations
        .filter((observation) => observation.seatId === seatId)
        .map((observation) => ({
          round: observation.round,
          pickNumber: observation.pickNumber,
          cards: observation.cards.map((card) => card.payload),
        })),
    };
    const advice = context.arm === 'candidate' ? evaluateDraft(observed, LEGACY_CUBE_ADVISOR_MODEL) : null;
    const chosen =
      advice === null
        ? owed.cards.toSorted(
            (left, right) =>
              legacyCubeBotPickValue(catalog, right.payload, pickedCards) -
                legacyCubeBotPickValue(catalog, left.payload, pickedCards) ||
              left.physicalId.localeCompare(right.physicalId),
          )[0]
        : (advice.recommendations.find((recommendation) => recommendation.mode === 'current')?.card ??
          advice.recommendations.find((recommendation) => recommendation.mode === 'flexible')?.card);
    if (chosen === undefined) throw new Error('Legacy Cube policy returned no legal pick');
    const observation = json({
      round: owed.round,
      pickNumber: owed.pickNumber,
      pickedPhysicalIds: picks,
      offered: owed.cards.map((card) => ({ physicalId: card.physicalId, name: card.payload.correctedName })),
    });
    decisions = [
      ...decisions,
      {
        sequence: decisions.length,
        observation: { sha256: botEvidenceSha256(observation), value: observation },
        candidates: {
          status: 'complete',
          values: owed.cards.map((card) => ({
            id: card.physicalId,
            value: { physicalId: card.physicalId, name: card.payload.correctedName },
          })),
        },
        choice: { status: 'chosen', candidateId: chosen.physicalId },
      },
    ];
    picks = [...picks, chosen.physicalId];
  }
}

/** Compare the exact production Cube drafter with the advisor while fixing construction and Forge play. */
export async function runLegacyCubeDraftStageCampaign(
  options: CommonOptions,
): Promise<StageStrengthCampaignRun> {
  return runStageStrengthCampaign(draftCampaignOptions(options));
}

/** Execute Cube draft trials while retaining only checkpointed evidence. */
export async function executeLegacyCubeDraftStageCampaign(options: CommonOptions): Promise<number> {
  return executeStageStrengthCampaign(draftCampaignOptions(options));
}

function fixedPool(catalog: PrintedCardCatalog, ids: readonly string[]): readonly PrintedCardCatalogEntry[] {
  if (ids.length !== 45 || new Set(ids).size !== 45)
    throw new Error('Legacy Cube builder pool must contain 45 unique cards');
  const byId = new Map(catalog.cards.map((card) => [card.physicalId, card]));
  return ids.map((id) => {
    const card = byId.get(id);
    if (card === undefined) throw new Error(`Legacy Cube builder pool contains unknown card ${id}`);
    return card;
  });
}

/** Compare Cube builders from identical pools while fixing all downstream Forge play. */
export async function runLegacyCubeBuilderStageCampaign(
  options: LegacyCubeBuilderStageCampaignOptions,
): Promise<StageStrengthCampaignRun> {
  return runStageStrengthCampaign(builderCampaignOptions(options));
}

function builderCampaignOptions(
  options: LegacyCubeBuilderStageCampaignOptions,
): StageStrengthCampaignOptions {
  const capturedPools = new Map([...options.pools].map(([seed, ids]) => [seed, [...ids]]));
  const captured = {
    ...options,
    plan: structuredClone(options.plan),
    catalog: structuredClone(options.catalog),
  };
  const plan = validateCommon(captured, 'limited-construction');
  const decks = new Map<string, ReturnType<typeof toDeckRef>>();
  for (const row of plan.schedule) fixedPool(captured.catalog, capturedPools.get(row.seed) ?? []);
  return {
    plan,
    executeStage: async (context) => {
      const started = (options.now ?? Date.now)();
      const pool = fixedPool(captured.catalog, capturedPools.get(context.row.seed)!);
      const observation = json({ poolPhysicalIds: pool.map((card) => card.physicalId) });
      const deck =
        context.arm === 'baseline'
          ? toDeckRef(
              buildLegacyCubePoolDeck(pool.map((payload) => ({ physicalId: payload.physicalId, payload })))
                .deck,
              'Legacy Cube production build',
            )
          : buildCalibrationDeck(pool, 'Legacy Cube candidate build').ref;
      decks.set(`${context.row.unitId}\u0000${context.arm}`, deck);
      const output = json(deck);
      const candidateId = botEvidenceSha256(output);
      return {
        episode: {
          schemaVersion: 1,
          episode: episodeIdentity(plan.id, context, 'deckbuilding'),
          decisions: [
            {
              sequence: 0,
              observation: { sha256: botEvidenceSha256(observation), value: observation },
              candidates: {
                status: 'incomplete',
                reason: 'deck search space is not enumerated',
                values: [{ id: candidateId, value: output }],
              },
              choice: { status: 'chosen', candidateId },
            },
          ],
          outcome: { status: 'completed', value: output },
        },
        cost: { elapsedMs: Math.max(0, (options.now ?? Date.now)() - started), spentUsd: 0 },
      };
    },
    executeOutcome: async (context) => {
      const key = `${context.row.unitId}\u0000${context.arm}`;
      const deck = structuredClone(decks.get(key)!);
      decks.delete(key);
      return captured.executeOutcome(context, deck);
    },
    ...(captured.onTrial === undefined ? {} : { onTrial: captured.onTrial }),
  };
}

/** Execute Cube builder trials while retaining only checkpointed evidence. */
export async function executeLegacyCubeBuilderStageCampaign(
  options: LegacyCubeBuilderStageCampaignOptions,
): Promise<number> {
  return executeStageStrengthCampaign(builderCampaignOptions(options));
}
