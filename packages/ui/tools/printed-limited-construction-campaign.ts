/** ISD-capable printed Limited construction evaluation over frozen pools and Forge games. */
import { isDeepStrictEqual } from 'node:util';
import { botEvidenceSha256, type BotEvidenceEpisode, type JsonValue } from '@mtg/bot-evidence';
import type { PreparedPrintedLimitedFormat, PrintedBoosterPayload } from '@mtg/draft-export';
import type { DeckRef, ObservedBackend } from '@mtg/engine';
import {
  runForgeObservedPolicyGame,
  type ForgeObservedDecisionPolicy,
  type ForgeObservedPolicyGameOptions,
} from '@mtg/forge-export';
import { prepareLimitedDeck, toDeckRef, type LimitedDeck } from '@mtg/limited';
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
  type StageStrengthOutcomeContext,
  type StageStrengthOutcomeResult,
  type StageStrengthTrialCheckpoint,
} from '@mtg/metrics';
import {
  PrintedPlaySubjectSchema,
  type PrintedCardCatalog,
  type PrintedPlaySubject,
} from '@mtg/printed-card';
import { z } from 'zod';
import { validatePrintedDraftRatings, type PrintedDraftRatings } from '../src/lab/printed-draft-ratings';
import { suggestPrintedDeck } from '../src/routes/printed/deck-evaluation';
import { printedLimitedFacts } from '../src/routes/printed/limited-facts';
import type { AdmittedPrintedBackend } from './admitted-printed-backend';
import {
  evaluateForgeStageDeckOutcome,
  forgeGameplayFeatureIdentity,
  forgeGameplayPolicyIdentity,
  validateForgeStageDeckOutcomeOptions,
} from './forge-stage-deck-outcome';

export { forgeGameplayFeatureIdentity, forgeGameplayPolicyIdentity } from './forge-stage-deck-outcome';

const CONSTRUCTION_FEATURE_SHAPE = {
  input: 'ordered-physical-pool-with-pinned-printed-facts',
  output: 'selected-physical-ids-and-canonical-basic-counts',
  candidateSet: 'single-returned-deck-search-space-not-enumerated',
} as const;
export const PRINTED_LIMITED_CONSTRUCTION_FEATURES = {
  schemaId: 'printed-limited-construction/v1',
  schemaSha256: botEvidenceSha256(CONSTRUCTION_FEATURE_SHAPE),
} as const;

const BaselineConfig = { version: 'printed-limited-construction/v1', evaluation: 'structural' } as const;
const DeckOutputSchema = z.strictObject({
  selectedPhysicalIds: z.array(z.string().min(1)),
  basics: z.strictObject({
    Plains: z.number().int().nonnegative(),
    Island: z.number().int().nonnegative(),
    Swamp: z.number().int().nonnegative(),
    Mountain: z.number().int().nonnegative(),
    Forest: z.number().int().nonnegative(),
  }),
});
type PrintedDeck = LimitedDeck<PrintedBoosterPayload>;
type RuntimeIdentity = StageStrengthCampaignPlan['runtime'];
type ParsedPlan = ReturnType<typeof StageStrengthCampaignPlanSchema.parse>;

function candidateConfig(ratings: PrintedDraftRatings) {
  return {
    version: 'printed-limited-construction/v1',
    evaluation: 'forge-ranked',
    ratingsFingerprint: ratings.source.fingerprint,
  } as const;
}

export function printedLimitedConstructionPolicies(
  ratings: PrintedDraftRatings,
): StageStrengthCampaignPlan['policies'] {
  const candidate = candidateConfig(ratings);
  return {
    baseline: {
      policyId: 'printed-limited-structural/v1',
      configSha256: botEvidenceSha256(BaselineConfig),
      modelSha256: null,
      dataSha256: null,
    },
    candidate: {
      policyId: 'printed-limited-forge-ranked/v1',
      configSha256: botEvidenceSha256(candidate),
      modelSha256: null,
      dataSha256: ratings.source.fingerprint,
    },
  };
}

export function printedLimitedSubjectIdentity(prepared: PreparedPrintedLimitedFormat) {
  return {
    id: prepared.format.id,
    formatSha256: prepared.format.contentSha256,
    cardsSha256: botEvidenceSha256({
      catalogs: prepared.format.sources.map(({ code, catalogSha256 }) => ({ code, catalogSha256 })),
    }),
  };
}

declare const printedConstructionBackend: unique symbol;

export interface PrintedConstructionBackend {
  readonly [printedConstructionBackend]: true;
  /** One admission result owns both the measured subject and the backend built from that snapshot. */
  readonly admission: AdmittedPrintedBackend;
  readonly opponentPolicy: StageStrengthCampaignPlan['downstream']['opponentPolicy'];
}

/** Bind the admitted runtime pair to the fixed opponent identity used by the campaign. */
export function bindPrintedConstructionBackend(
  admission: AdmittedPrintedBackend,
  opponentPolicy: StageStrengthCampaignPlan['downstream']['opponentPolicy'],
): PrintedConstructionBackend {
  return { admission, opponentPolicy } as PrintedConstructionBackend;
}

export interface PrintedConstructionSubject {
  readonly prepared: PreparedPrintedLimitedFormat;
  readonly catalogs: readonly { readonly code: string; readonly catalog: PrintedCardCatalog }[];
  readonly ratings: PrintedDraftRatings;
  readonly backend: PrintedConstructionBackend;
}

export interface PrintedLimitedConstructionCampaignOptions {
  readonly plan: StageStrengthCampaignPlan;
  readonly builderRuntime: RuntimeIdentity;
  readonly gameplayPolicy: ForgeObservedDecisionPolicy;
  readonly subjects: ReadonlyMap<string, PrintedConstructionSubject>;
  readonly opponents: ReadonlyMap<string, DeckRef>;
  readonly maximumTurns: number;
  readonly maximumDecisions: number;
  readonly now?: () => number;
  readonly onTrial?: StageStrengthTrialCheckpoint;
}

export type PrintedConstructionGameRunner = (
  options: ForgeObservedPolicyGameOptions,
) => ReturnType<typeof runForgeObservedPolicyGame>;

function snapshotGameplayPolicy(policy: ForgeObservedDecisionPolicy): ForgeObservedDecisionPolicy {
  const choose = policy.choose;
  return {
    identity: structuredClone(policy.identity),
    choose: (position) => choose(position),
  };
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

function snapshotOptions(
  options: PrintedLimitedConstructionCampaignOptions,
): PrintedLimitedConstructionCampaignOptions {
  return {
    plan: structuredClone(options.plan),
    builderRuntime: structuredClone(options.builderRuntime),
    gameplayPolicy: snapshotGameplayPolicy(options.gameplayPolicy),
    subjects: new Map(
      [...options.subjects].map(([id, subject]) => [
        id,
        {
          ...subject,
          prepared: snapshotPreparedFormat(subject.prepared),
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

async function validateSubject(
  identity: ParsedPlan['subjects'][number],
  subject: PrintedConstructionSubject,
  plan: ParsedPlan,
): Promise<void> {
  const admission = subject.backend.admission.subject;
  const authenticated = await validatePrintedDraftRatings(
    subject.ratings,
    subject.prepared,
    subject.catalogs,
  );
  if (!isDeepStrictEqual(printedLimitedSubjectIdentity(subject.prepared), identity)) {
    throw new Error(`printed subject ${identity.id} differs from the campaign plan`);
  }
  if (!isDeepStrictEqual(printedLimitedConstructionPolicies(authenticated), plan.policies)) {
    throw new Error(`printed policies for ${identity.id} differ from the campaign plan`);
  }
  if (!isDeepStrictEqual(printedConstructionForgeRuntime(admission), plan.downstream.runtime)) {
    throw new Error(`Forge runtime for ${identity.id} differs from the campaign plan`);
  }
  if (
    admission.formatId !== identity.id ||
    admission.formatSha256 !== identity.formatSha256 ||
    !isDeepStrictEqual(
      admission.catalogs,
      Object.fromEntries(
        subject.prepared.format.sources.map((source) => [source.code, source.catalogSha256]),
      ),
    )
  ) {
    throw new Error(`Forge admission for ${identity.id} differs from the printed subject`);
  }
  if (!isDeepStrictEqual(subject.backend.opponentPolicy, plan.downstream.opponentPolicy)) {
    throw new Error(`Forge opponent policy for ${identity.id} differs from the campaign plan`);
  }
}

export function printedConstructionForgeRuntime(
  input: PrintedPlaySubject,
): StageStrengthCampaignPlan['downstream']['runtime'] {
  const admission = PrintedPlaySubjectSchema.parse(input);
  const {
    formatId: _formatId,
    formatSha256: _formatSha256,
    catalogs: _catalogs,
    ...forgeRuntime
  } = admission;
  return {
    kind: 'forge',
    version: `forge-${admission.forgeVersion}/printed-limited-construction-v1`,
    buildSha256: botEvidenceSha256({
      version: 'printed-limited-construction-forge-runtime/v1',
      forgeRuntime,
    }),
  };
}

async function validateInputs(options: PrintedLimitedConstructionCampaignOptions): Promise<ParsedPlan> {
  const plan = StageStrengthCampaignPlanSchema.parse(options.plan);
  if (plan.stage !== 'limited-construction' || plan.engine !== 'forge') {
    throw new Error('Printed Limited construction requires a Forge limited-construction plan');
  }
  if (!isDeepStrictEqual(plan.runtime, options.builderRuntime)) {
    throw new Error('Printed Limited builder runtime differs from the campaign plan');
  }
  if (!isDeepStrictEqual(plan.downstream.focalPolicy, forgeGameplayPolicyIdentity(options.gameplayPolicy))) {
    throw new Error('Fixed gameplay policy differs from the campaign plan');
  }
  if (!isDeepStrictEqual(plan.downstream.features, forgeGameplayFeatureIdentity(options.gameplayPolicy))) {
    throw new Error('Gameplay feature schema differs from the campaign plan');
  }
  for (const subjectIdentity of plan.subjects) {
    const subject = options.subjects.get(subjectIdentity.id);
    if (subject === undefined) throw new Error(`campaign has no subject ${subjectIdentity.id}`);
    await validateSubject(subjectIdentity, subject, plan);
  }
  await validateForgeStageDeckOutcomeOptions(forgeOutcomeOptions(plan, options));
  return plan;
}

function forgeOutcomeOptions(
  plan: StageStrengthCampaignPlan,
  options: PrintedLimitedConstructionCampaignOptions,
) {
  return {
    plan,
    gameplayPolicy: options.gameplayPolicy,
    backends: new Map(
      [...options.subjects].map(([id, subject]) => [id, subject.backend.admission.backend] as const),
    ),
    opponents: options.opponents,
    maximumTurns: options.maximumTurns,
    maximumDecisions: options.maximumDecisions,
    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function initialDeck(subject: PrintedConstructionSubject, seed: string): PrintedDeck {
  return prepareLimitedDeck(subject.prepared.openSealedPool(seed).cards, (card) =>
    printedLimitedFacts(card.payload.printing),
  );
}

function deckOutput(deck: PrintedDeck): z.infer<typeof DeckOutputSchema> {
  return DeckOutputSchema.parse({
    selectedPhysicalIds: deck.selectedPhysicalIds,
    basics: deck.basics,
  });
}

function policyConfig(arm: StageStrengthArm, ratings: PrintedDraftRatings): JsonValue {
  return json(arm === 'baseline' ? BaselineConfig : candidateConfig(ratings));
}

function constructionEpisode(
  planId: string,
  context: StageStrengthExecutionContext,
  subject: PrintedConstructionSubject,
  output: z.infer<typeof DeckOutputSchema>,
  observation: JsonValue,
): BotEvidenceEpisode {
  const candidateId = botEvidenceSha256(output);
  return {
    schemaVersion: 1,
    episode: {
      id: stageStrengthEpisodeId(planId, context.row.unitId, context.arm),
      stage: 'deckbuilding',
      seed: context.row.evidenceSeed,
      runtime: context.runtime,
      subject: {
        formatId: context.subject.id,
        formatSha256: context.subject.formatSha256,
        cardsSha256: context.subject.cardsSha256,
      },
      features: context.features,
      behavior: { ...context.policy, config: policyConfig(context.arm, subject.ratings) },
      lineage: { setId: context.subject.id, poolId: context.row.seed },
      splitGroup: { kind: 'pool', id: context.row.seed },
    },
    decisions: [
      {
        sequence: 0,
        observation: { sha256: botEvidenceSha256(observation), value: observation },
        candidates: {
          status: 'incomplete',
          reason: 'deck search space is not enumerated',
          values: [{ id: candidateId, value: json(output) }],
        },
        choice: { status: 'chosen', candidateId },
      },
    ],
    outcome: { status: 'completed', value: json(output) },
  };
}

function poolObservation(deck: PrintedDeck): JsonValue {
  return json({
    minimumDeckSize: deck.minimumDeckSize,
    suggestedBasicLands: deck.suggestedBasicLands,
    cards: deck.pool.map((card) => ({
      physicalId: card.physicalId,
      printingPhysicalId: card.payload.printing.physicalId,
      facts: card.facts,
    })),
  });
}

function stageExecutor(
  plan: ParsedPlan,
  options: PrintedLimitedConstructionCampaignOptions,
): StageStrengthCampaignOptions['executeStage'] {
  return async (context) => {
    const startedAt = (options.now ?? Date.now)();
    const subject = options.subjects.get(context.subject.id)!;
    const initial = initialDeck(subject, context.row.seed);
    const built = suggestPrintedDeck(initial, context.arm === 'candidate' ? subject.ratings : undefined);
    const episode = constructionEpisode(
      plan.id,
      context,
      subject,
      deckOutput(built),
      poolObservation(initial),
    );
    return {
      episode,
      cost: { elapsedMs: Math.max(0, (options.now ?? Date.now)() - startedAt), spentUsd: 0 },
    };
  };
}

function outcomeExecutor(
  plan: ParsedPlan,
  options: PrintedLimitedConstructionCampaignOptions,
  runGame: PrintedConstructionGameRunner,
): StageStrengthCampaignOptions['executeOutcome'] {
  return async (context): Promise<StageStrengthOutcomeResult> => {
    const subject = options.subjects.get(context.subject.id)!;
    const output = DeckOutputSchema.parse(
      context.episode.outcome.status === 'completed' ? context.episode.outcome.value : {},
    );
    const deck = toDeckRef(
      { ...initialDeck(subject, context.row.seed), ...output },
      'Constructed Limited deck',
    );
    return evaluatePrintedLimitedDeckOutcome(plan, options, context, deck, runGame);
  };
}

/** Score any already-built printed Limited deck under the campaign's frozen Forge schedule. */
export async function evaluatePrintedLimitedDeckOutcome(
  planInput: StageStrengthCampaignPlan,
  options: PrintedLimitedConstructionCampaignOptions,
  context: StageStrengthOutcomeContext,
  deck: DeckRef,
  runGame: PrintedConstructionGameRunner = runForgeObservedPolicyGame,
): Promise<StageStrengthOutcomeResult> {
  return evaluateForgeStageDeckOutcome(forgeOutcomeOptions(planInput, options), context, deck, runGame);
}

/** Compare structural and Forge-ranked construction while holding pools and gameplay fixed. */
export async function runPrintedLimitedConstructionCampaign(
  options: PrintedLimitedConstructionCampaignOptions,
  runGame: PrintedConstructionGameRunner = runForgeObservedPolicyGame,
): Promise<StageStrengthCampaignRun> {
  const captured = snapshotOptions(options);
  const plan = await validateInputs(captured);
  return runStageStrengthCampaign({
    plan,
    executeStage: stageExecutor(plan, captured),
    executeOutcome: outcomeExecutor(plan, captured, runGame),
    ...(captured.onTrial === undefined ? {} : { onTrial: captured.onTrial }),
  });
}

/** Execute the construction holdout while retaining only checkpointed evidence. */
export async function executePrintedLimitedConstructionCampaign(
  options: PrintedLimitedConstructionCampaignOptions,
  runGame: PrintedConstructionGameRunner = runForgeObservedPolicyGame,
): Promise<number> {
  const captured = snapshotOptions(options);
  const plan = await validateInputs(captured);
  return executeStageStrengthCampaign({
    plan,
    executeStage: stageExecutor(plan, captured),
    executeOutcome: outcomeExecutor(plan, captured, runGame),
    ...(captured.onTrial === undefined ? {} : { onTrial: captured.onTrial }),
  });
}
