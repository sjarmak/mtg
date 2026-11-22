/** Canonical paired promotion evidence shared by gameplay, draft, and construction stages. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { BotEvidenceEpisodeSchema, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import { canonicalJson } from '@mtg/dsl';
import { z } from 'zod';
import {
  comparePairedPromotion,
  type PRIMARY_INTERVAL_METHOD,
  type SECONDARY_INTERVAL_METHOD,
  requiredIndependentUnitsFor,
  type PromotionInterval,
  type PromotionPower,
  type PromotionSegment,
} from './paired-promotion';

const MAX_UNITS = 100_000;
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const nonempty = z.string().trim().min(1);
const arm = z.enum(['baseline', 'candidate']);
const failureStatus = z.enum(['incomplete', 'timeout', 'illegal-action', 'unsupported', 'engine-failure']);

const PolicyIdentitySchema = z.strictObject({
  policyId: nonempty,
  configSha256: digest,
  modelSha256: digest.nullable(),
  dataSha256: digest.nullable(),
});

const SubjectSchema = z.strictObject({
  id: nonempty,
  formatSha256: digest,
  cardsSha256: digest,
});

const SegmentDimensionSchema = z.strictObject({
  id: nonempty,
  values: z.array(nonempty).min(1).max(MAX_UNITS),
});

const OutcomeGameScheduleSchema = z.strictObject({
  gameId: nonempty,
  seed: nonempty,
  focalSeat: z.union([z.literal(0), z.literal(1)]),
  opponentId: nonempty,
});

const ScheduleRowSchema = z.strictObject({
  unitId: nonempty,
  subjectId: nonempty,
  seed: nonempty,
  evidenceSeed: nonempty.nullable(),
  outcomeSchedule: z.array(OutcomeGameScheduleSchema).min(2).max(MAX_UNITS),
  segments: z.record(z.string(), nonempty),
});

export const StageStrengthCampaignPlanSchema = z
  .strictObject({
    version: z.literal('stage-strength-campaign-plan/v1'),
    id: nonempty,
    split: z.enum(['tuning', 'holdout']),
    stage: z.enum(['gameplay', 'limited-construction', 'draft', 'constructed-construction', 'end-to-end']),
    evidenceStage: z.enum(['gameplay', 'draft', 'deckbuilding']),
    engine: z.enum(['native', 'forge']),
    runtime: z.strictObject({
      kind: z.enum(['native', 'forge', 'analysis']),
      version: nonempty,
      buildSha256: digest,
    }),
    features: z.strictObject({
      baseline: z.strictObject({ schemaId: nonempty, schemaSha256: digest }),
      candidate: z.strictObject({ schemaId: nonempty, schemaSha256: digest }),
    }),
    subjects: z.array(SubjectSchema).min(1).max(MAX_UNITS),
    primaryOutcome: nonempty,
    downstream: z.strictObject({
      runtime: z.strictObject({
        kind: z.enum(['native', 'forge']),
        version: nonempty,
        buildSha256: digest,
      }),
      features: z.strictObject({ schemaId: nonempty, schemaSha256: digest }),
      focalPolicy: PolicyIdentitySchema,
      opponentPolicy: PolicyIdentitySchema,
      opponents: z
        .array(z.strictObject({ id: nonempty, artifactSha256: digest }))
        .min(1)
        .max(MAX_UNITS),
    }),
    smallestUsefulEffect: z.number().finite().gt(0).max(1),
    regressionMargin: z.number().finite().min(0).max(1),
    maximumFailureRate: z.number().finite().min(0).max(1),
    minimumIndependentUnits: z.number().int().min(2).max(MAX_UNITS),
    stoppingRule: z.strictObject({
      kind: z.literal('fixed-independent-units'),
      count: z.number().int().min(2).max(MAX_UNITS),
    }),
    powerPlan: z.strictObject({
      method: z.literal('paired-normal-approximation'),
      alpha: z.literal(0.05),
      targetPower: z.literal(0.8),
      anticipatedStandardDeviation: z.number().finite().gt(0).max(1),
      requiredIndependentUnits: z.number().int().min(2).max(MAX_UNITS),
    }),
    policies: z.strictObject({ baseline: PolicyIdentitySchema, candidate: PolicyIdentitySchema }),
    segmentDimensions: z.array(SegmentDimensionSchema).min(1).max(20),
    schedule: z.array(ScheduleRowSchema).min(2).max(MAX_UNITS),
  })
  .superRefine((plan, context) => {
    if (isDeepStrictEqual(plan.policies.baseline, plan.policies.candidate)) {
      context.addIssue({ code: 'custom', message: 'baseline and candidate policies must differ' });
    }
    const expectedEvidenceStage = {
      gameplay: 'gameplay',
      'limited-construction': 'deckbuilding',
      draft: 'draft',
      'constructed-construction': 'deckbuilding',
      'end-to-end': 'gameplay',
    }[plan.stage];
    if (plan.evidenceStage !== expectedEvidenceStage) {
      context.addIssue({ code: 'custom', message: 'evidence stage does not match the campaign stage' });
    }
    if (plan.downstream.runtime.kind !== plan.engine) {
      context.addIssue({ code: 'custom', message: 'downstream runtime kind must match the campaign engine' });
    }
    const downstreamOpponentIds = plan.downstream.opponents.map((opponent) => opponent.id);
    if (new Set(downstreamOpponentIds).size !== downstreamOpponentIds.length) {
      context.addIssue({ code: 'custom', message: 'downstream opponent identities must be unique' });
    }
    const downstreamOpponents = new Set(downstreamOpponentIds);
    const subjectIds = plan.subjects.map((subject) => subject.id);
    if (new Set(subjectIds).size !== subjectIds.length) {
      context.addIssue({ code: 'custom', message: 'subject identities must be unique' });
    }
    const subjects = new Set(subjectIds);
    const dimensionIds = plan.segmentDimensions.map((dimension) => dimension.id);
    if (new Set(dimensionIds).size !== dimensionIds.length) {
      context.addIssue({ code: 'custom', message: 'segment dimension identities must be unique' });
    }
    for (const dimension of plan.segmentDimensions) {
      if (new Set(dimension.values).size !== dimension.values.length) {
        context.addIssue({ code: 'custom', message: `segment ${dimension.id} values must be unique` });
      }
    }
    const unitIds = new Set<string>();
    for (const row of plan.schedule) {
      if (unitIds.has(row.unitId)) {
        context.addIssue({ code: 'custom', message: `duplicate scheduled unit ${row.unitId}` });
      }
      unitIds.add(row.unitId);
      if (!subjects.has(row.subjectId)) {
        context.addIssue({ code: 'custom', message: `schedule references unknown subject ${row.subjectId}` });
      }
      const rowDimensions = Object.keys(row.segments).sort();
      if (!isDeepStrictEqual(rowDimensions, [...dimensionIds].sort())) {
        context.addIssue({ code: 'custom', message: `unit ${row.unitId} has incomplete segment dimensions` });
      }
      for (const dimension of plan.segmentDimensions) {
        const value = row.segments[dimension.id];
        if (value === undefined || !dimension.values.includes(value)) {
          context.addIssue({ code: 'custom', message: `unit ${row.unitId} has an invalid segment value` });
        }
      }
      const gameIds = row.outcomeSchedule.map((game) => game.gameId);
      const outcomeKeys = row.outcomeSchedule.map(
        (game) => `${game.opponentId}\u0000${game.seed}\u0000${String(game.focalSeat)}`,
      );
      const firstSeatGames = row.outcomeSchedule.filter((game) => game.focalSeat === 0).length;
      const secondSeatGames = row.outcomeSchedule.length - firstSeatGames;
      if (
        new Set(gameIds).size !== gameIds.length ||
        new Set(outcomeKeys).size !== outcomeKeys.length ||
        firstSeatGames !== secondSeatGames
      ) {
        context.addIssue({
          code: 'custom',
          message: `unit ${row.unitId} outcome schedule must have unique seat-balanced games`,
        });
      }
      for (const game of row.outcomeSchedule) {
        if (!downstreamOpponents.has(game.opponentId)) {
          context.addIssue({
            code: 'custom',
            message: `unit ${row.unitId} references unknown downstream opponent ${game.opponentId}`,
          });
        }
      }
      for (const opponentId of new Set(row.outcomeSchedule.map((game) => game.opponentId))) {
        const opponentGames = row.outcomeSchedule.filter((game) => game.opponentId === opponentId);
        const firstSeat = opponentGames.filter((game) => game.focalSeat === 0).length;
        if (firstSeat * 2 !== opponentGames.length) {
          context.addIssue({
            code: 'custom',
            message: `unit ${row.unitId} outcome schedule must be seat-balanced for opponent ${opponentId}`,
          });
        }
      }
    }
    if (plan.stoppingRule.count !== plan.schedule.length) {
      context.addIssue({ code: 'custom', message: 'fixed stopping count must equal scheduled units' });
    }
    if (plan.minimumIndependentUnits > plan.stoppingRule.count) {
      context.addIssue({
        code: 'custom',
        message: 'minimum independent units exceed the fixed stopping count',
      });
    }
    const required = requiredIndependentUnitsFor(
      plan.powerPlan.anticipatedStandardDeviation,
      plan.smallestUsefulEffect,
    );
    if (plan.powerPlan.requiredIndependentUnits !== required) {
      context.addIssue({
        code: 'custom',
        message: 'power plan required unit count differs from its calculation',
      });
    }
    if (plan.stoppingRule.count < required) {
      context.addIssue({ code: 'custom', message: 'fixed stopping count is below the power plan' });
    }
  });

export type StageStrengthCampaignPlan = z.input<typeof StageStrengthCampaignPlanSchema>;
export type StageStrengthArm = z.infer<typeof arm>;

const OutcomeGameSchema = OutcomeGameScheduleSchema.extend({
  opponent: z.strictObject({
    artifactSha256: digest,
    policy: PolicyIdentitySchema,
  }),
  result: z.enum(['win', 'loss', 'draw']).nullable(),
  evidence: BotEvidenceEpisodeSchema,
  measurement: z.strictObject({
    elapsedMs: z.number().finite().nonnegative(),
    decisions: z.number().int().nonnegative(),
  }),
});
const OutcomeEvidenceSchema = z.discriminatedUnion('status', [
  z.strictObject({
    version: z.literal('stage-strength-game-outcome/v1'),
    unitId: nonempty,
    arm,
    status: z.literal('completed'),
    sourceEpisodeSha256: digest,
    games: z.array(OutcomeGameSchema).min(2).max(MAX_UNITS),
  }),
  z.strictObject({
    version: z.literal('stage-strength-game-outcome/v1'),
    unitId: nonempty,
    arm,
    status: failureStatus,
    sourceEpisodeSha256: digest,
    error: nonempty,
    games: z.array(OutcomeGameSchema).max(MAX_UNITS),
  }),
]);
export type StageStrengthOutcomeEvidence = z.infer<typeof OutcomeEvidenceSchema>;

export interface StageStrengthTrial {
  readonly unitId: string;
  readonly arm: StageStrengthArm;
  readonly episode: BotEvidenceEpisode;
  readonly outcomeEvidenceSha256: string;
  readonly outcomeEvidence: StageStrengthOutcomeEvidence;
  readonly cost: {
    readonly elapsedMs: number;
    /** Decisions retained by the stage episode itself. */
    readonly decisions: number;
    /** Decisions made by the downstream games that score this stage output. */
    readonly downstreamDecisions: number;
    /** Provider charges incurred by the stage episode. */
    readonly spentUsd: number;
  };
}

/** Compact comparison input produced only after a full stage trial validates. */
export interface StageStrengthTrialSummary {
  readonly key: string;
  readonly unitId: string;
  readonly arm: StageStrengthArm;
  readonly episodeId: string;
  readonly outcomeStatus: StageStrengthOutcomeEvidence['status'];
  readonly score: number | null;
  readonly opponentScores: Readonly<Record<string, number | null>>;
  readonly cost: StageStrengthTrial['cost'];
}

interface CompletionSummary {
  readonly attempted: number;
  readonly completed: number;
  readonly failures: number;
  readonly rate: number;
  readonly byStatus: Readonly<Record<string, number>>;
}

interface CostSummary {
  readonly trials: number;
  readonly elapsedMs: number;
  readonly decisions: number;
  readonly downstreamDecisions: number;
  readonly spentUsd: number;
}

export interface StageStrengthComparison {
  readonly version: 'stage-strength-comparison/v2';
  readonly planSha256: string;
  readonly evidenceSha256: string;
  readonly scope: {
    readonly engine: 'native' | 'forge';
    readonly stage: StageStrengthCampaignPlan['stage'];
    readonly split: 'tuning' | 'holdout';
  };
  readonly population: { readonly subjects: number; readonly scheduledTrialsPerArm: number };
  readonly completion: Readonly<Record<StageStrengthArm, CompletionSummary>>;
  readonly strength: {
    readonly intervalMethod: typeof PRIMARY_INTERVAL_METHOD;
    readonly secondaryIntervalMethod: typeof SECONDARY_INTERVAL_METHOD;
    readonly status: 'measured' | 'under-sampled';
    readonly independentUnits: number;
    readonly excludedUnits: number;
    readonly meanPairedDifference: number | null;
    readonly interval95: PromotionInterval | null;
    readonly hoeffdingInterval95: PromotionInterval | null;
    readonly power: PromotionPower;
    readonly bySegment: readonly PromotionSegment[];
    /** Paired unit-level results recomputed within each frozen downstream opponent. */
    readonly byOpponent: readonly PromotionSegment[];
  };
  readonly cost: Readonly<Record<StageStrengthArm, CostSummary>>;
  readonly promotion: {
    readonly status: 'promote-candidate' | 'retain-baseline';
    readonly reasons: readonly string[];
  };
  readonly sha256: string;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function stageStrengthEpisodeId(planId: string, unitId: string, trialArm: StageStrengthArm): string {
  return `${planId}/${unitId}/${trialArm}`;
}

export function stageStrengthGameEpisodeId(
  planId: string,
  unitId: string,
  trialArm: StageStrengthArm,
  gameId: string,
): string {
  return `${stageStrengthEpisodeId(planId, unitId, trialArm)}/${gameId}`;
}

function policyIdentity(behavior: BotEvidenceEpisode['episode']['behavior']) {
  return {
    policyId: behavior.policyId,
    configSha256: behavior.configSha256,
    modelSha256: behavior.modelSha256,
    dataSha256: behavior.dataSha256,
  };
}

function trialKey(unitId: string, trialArm: StageStrengthArm): string {
  return `${unitId}\u0000${trialArm}`;
}

function validateOutcomeEvidence(
  plan: z.infer<typeof StageStrengthCampaignPlanSchema>,
  row: z.infer<typeof ScheduleRowSchema>,
  input: StageStrengthTrial,
): StageStrengthOutcomeEvidence {
  const evidence = OutcomeEvidenceSchema.parse(input.outcomeEvidence);
  if (sha256(evidence) !== digest.parse(input.outcomeEvidenceSha256)) {
    throw new Error(`trial ${input.unitId} outcome evidence SHA-256 mismatch`);
  }
  if (evidence.unitId !== input.unitId || evidence.arm !== input.arm) {
    throw new Error(`trial ${input.unitId} outcome evidence identity drift`);
  }
  for (const [index, game] of evidence.games.entries()) {
    const expected = row.outcomeSchedule[index];
    const expectedOpponent = plan.downstream.opponents.find((opponent) => opponent.id === game.opponentId);
    if (
      expected === undefined ||
      expected.gameId !== game.gameId ||
      expected.seed !== game.seed ||
      expected.focalSeat !== game.focalSeat ||
      expected.opponentId !== game.opponentId
    ) {
      throw new Error(`trial ${input.unitId} outcome games must be an ordered prefix of its schedule`);
    }
    if (
      expectedOpponent === undefined ||
      game.opponent.artifactSha256 !== expectedOpponent.artifactSha256 ||
      !isDeepStrictEqual(game.opponent.policy, plan.downstream.opponentPolicy)
    ) {
      throw new Error(`trial ${input.unitId} downstream game ${game.gameId} opponent evidence drift`);
    }
    const subject = plan.subjects.find((candidate) => candidate.id === row.subjectId)!;
    const identity = game.evidence.episode;
    if (
      identity.id !== stageStrengthGameEpisodeId(plan.id, row.unitId, input.arm, game.gameId) ||
      identity.stage !== 'gameplay' ||
      identity.seed !== game.seed ||
      !isDeepStrictEqual(identity.runtime, plan.downstream.runtime) ||
      !isDeepStrictEqual(identity.features, plan.downstream.features) ||
      !isDeepStrictEqual(policyIdentity(identity.behavior), plan.downstream.focalPolicy) ||
      !isDeepStrictEqual(identity.subject, {
        formatId: subject.id,
        formatSha256: subject.formatSha256,
        cardsSha256: subject.cardsSha256,
      }) ||
      identity.lineage.gameId !== game.gameId ||
      identity.splitGroup.kind !== 'game' ||
      identity.splitGroup.id !== game.gameId ||
      game.measurement.decisions !== game.evidence.decisions.length
    ) {
      throw new Error(`trial ${input.unitId} downstream game ${game.gameId} evidence drift`);
    }
    if (game.result === null) {
      if (game.evidence.outcome.status === 'completed' || index !== evidence.games.length - 1) {
        throw new Error(`trial ${input.unitId} downstream game ${game.gameId} failure evidence drift`);
      }
    } else {
      if (game.evidence.outcome.status !== 'completed') {
        throw new Error(`trial ${input.unitId} downstream game ${game.gameId} result hides a failure`);
      }
      const value = game.evidence.outcome.value;
      const winner =
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? (value as Readonly<Record<string, unknown>>)['winner']
          : undefined;
      const expectedResult = winner === null ? 'draw' : winner === game.focalSeat ? 'win' : 'loss';
      if ((winner !== null && winner !== 0 && winner !== 1) || game.result !== expectedResult) {
        throw new Error(`trial ${input.unitId} downstream game ${game.gameId} result evidence drift`);
      }
    }
  }
  if (evidence.status === 'completed' && evidence.games.length !== row.outcomeSchedule.length) {
    throw new Error(`trial ${input.unitId} completed outcome is missing scheduled games`);
  }
  if (evidence.status === 'completed' && evidence.games.some((game) => game.result === null)) {
    throw new Error(`trial ${input.unitId} completed outcome has a failed game`);
  }
  const terminalGame = evidence.games.at(-1);
  if (evidence.status !== 'completed' && terminalGame?.result === null) {
    const terminalOutcome = terminalGame.evidence.outcome;
    if (
      terminalOutcome.status === 'completed' ||
      terminalOutcome.status !== evidence.status ||
      terminalOutcome.error !== evidence.error
    ) {
      throw new Error(`trial ${input.unitId} aggregate failure differs from terminal game evidence`);
    }
  }
  return evidence;
}

function outcomeScore(evidence: StageStrengthOutcomeEvidence): number | null {
  if (evidence.status !== 'completed') return null;
  const score = evidence.games.reduce(
    (sum, game) => sum + (game.result === 'win' ? 1 : game.result === 'draw' ? 0.5 : 0),
    0,
  );
  return score / evidence.games.length;
}

function opponentScore(evidence: StageStrengthOutcomeEvidence, opponentId: string): number | null {
  if (evidence.status !== 'completed') return null;
  const games = evidence.games.filter((game) => game.opponentId === opponentId);
  if (games.length === 0) return null;
  return (
    games.reduce((sum, game) => sum + (game.result === 'win' ? 1 : game.result === 'draw' ? 0.5 : 0), 0) /
    games.length
  );
}

function validateEpisode(
  plan: z.infer<typeof StageStrengthCampaignPlanSchema>,
  unitId: string,
  trialArm: StageStrengthArm,
  input: BotEvidenceEpisode,
): BotEvidenceEpisode {
  const row = plan.schedule.find((candidate) => candidate.unitId === unitId);
  if (row === undefined) throw new Error(`trial ${unitId} is not in the campaign schedule`);
  const subject = plan.subjects.find((candidate) => candidate.id === row.subjectId)!;
  const episode = BotEvidenceEpisodeSchema.parse(input);
  const expectedId = stageStrengthEpisodeId(plan.id, unitId, trialArm);
  if (episode.episode.id !== expectedId) throw new Error(`trial ${unitId} episode identity drift`);
  if (episode.episode.stage !== plan.evidenceStage) throw new Error(`trial ${unitId} evidence stage drift`);
  if (!isDeepStrictEqual(episode.episode.runtime, plan.runtime)) {
    throw new Error(`trial ${unitId} runtime drift`);
  }
  if (!isDeepStrictEqual(episode.episode.features, plan.features[trialArm])) {
    throw new Error(`trial ${unitId} feature schema drift`);
  }
  if (
    !isDeepStrictEqual(episode.episode.subject, {
      formatId: subject.id,
      formatSha256: subject.formatSha256,
      cardsSha256: subject.cardsSha256,
    })
  ) {
    throw new Error(`trial ${unitId} subject drift`);
  }
  if (episode.episode.seed !== row.evidenceSeed) throw new Error(`trial ${unitId} evidence seed drift`);
  if (episode.episode.splitGroup.id !== row.seed) {
    throw new Error(`trial ${unitId} scheduled seed differs from retained build provenance`);
  }
  if (!isDeepStrictEqual(policyIdentity(episode.episode.behavior), plan.policies[trialArm])) {
    throw new Error(`trial ${unitId} policy drift`);
  }
  return episode;
}

/** Validate one stage episode against its preregistered unit before downstream work starts. */
export function validateStageStrengthEpisode(
  planInput: StageStrengthCampaignPlan,
  unitId: string,
  trialArm: StageStrengthArm,
  input: BotEvidenceEpisode,
): BotEvidenceEpisode {
  return validateEpisode(StageStrengthCampaignPlanSchema.parse(planInput), unitId, trialArm, input);
}

function validateTrial(
  plan: z.infer<typeof StageStrengthCampaignPlanSchema>,
  input: StageStrengthTrial,
): StageStrengthTrial {
  const row = plan.schedule.find((candidate) => candidate.unitId === input.unitId);
  if (row === undefined) throw new Error(`trial ${input.unitId} is not in the campaign schedule`);
  const episode = validateEpisode(plan, input.unitId, input.arm, input.episode);
  const outcomeEvidence = validateOutcomeEvidence(plan, row, input);
  if (outcomeEvidence.sourceEpisodeSha256 !== sha256(episode)) {
    throw new Error(`trial ${input.unitId} source episode SHA-256 mismatch`);
  }
  if (episode.outcome.status !== 'completed' && outcomeEvidence.status !== episode.outcome.status) {
    throw new Error(`trial ${input.unitId} hides its decision-stage failure`);
  }
  if (
    episode.outcome.status === 'completed' &&
    outcomeEvidence.status !== 'completed' &&
    (outcomeEvidence.games.length === 0 || outcomeEvidence.games.at(-1)?.result !== null)
  ) {
    throw new Error(`trial ${input.unitId} omits its terminal downstream failure evidence`);
  }
  if (!Number.isFinite(input.cost.elapsedMs) || input.cost.elapsedMs < 0) {
    throw new Error(`trial ${input.unitId} has invalid elapsed cost`);
  }
  if (input.cost.decisions !== episode.decisions.length) {
    throw new Error(`trial ${input.unitId} decision count differs from its evidence`);
  }
  if (!Number.isInteger(input.cost.downstreamDecisions) || input.cost.downstreamDecisions < 0) {
    throw new Error(`trial ${input.unitId} has invalid downstream decision cost`);
  }
  const retainedDownstreamDecisions = outcomeEvidence.games.reduce(
    (sum, game) => sum + game.measurement.decisions,
    0,
  );
  if (input.cost.downstreamDecisions !== retainedDownstreamDecisions) {
    throw new Error(`trial ${input.unitId} downstream decision count differs from its evidence`);
  }
  if (!Number.isFinite(input.cost.spentUsd) || input.cost.spentUsd < 0) {
    throw new Error(`trial ${input.unitId} has invalid provider cost`);
  }
  return { ...input, episode, outcomeEvidence };
}

/** Validate one complete stage trial before it is checkpointed or compared. */
export function validateStageStrengthTrial(
  planInput: StageStrengthCampaignPlan,
  input: StageStrengthTrial,
): StageStrengthTrial {
  return validateTrial(StageStrengthCampaignPlanSchema.parse(planInput), input);
}

function indexedTrials(
  plan: z.infer<typeof StageStrengthCampaignPlanSchema>,
  input: readonly StageStrengthTrial[],
): ReadonlyMap<string, StageStrengthTrial> {
  const indexed = new Map<string, StageStrengthTrial>();
  const episodeIds = new Set<string>();
  for (const trialInput of input) {
    const key = trialKey(trialInput.unitId, trialInput.arm);
    if (indexed.has(key)) throw new Error(`expected exactly one trial for ${key}`);
    const trial = validateTrial(plan, trialInput);
    if (episodeIds.has(trial.episode.episode.id))
      throw new Error(`episode ${trial.episode.episode.id} is reused`);
    episodeIds.add(trial.episode.episode.id);
    indexed.set(key, trial);
  }
  for (const row of plan.schedule) {
    for (const trialArm of arm.options) {
      const key = trialKey(row.unitId, trialArm);
      if (!indexed.has(key)) throw new Error(`expected exactly one trial for ${key}`);
    }
  }
  if (indexed.size !== plan.schedule.length * arm.options.length) {
    throw new Error('trial population exceeds the campaign schedule');
  }
  return indexed;
}

function summaryOfValidatedTrial(
  plan: z.infer<typeof StageStrengthCampaignPlanSchema>,
  trial: StageStrengthTrial,
): StageStrengthTrialSummary {
  return {
    key: trialKey(trial.unitId, trial.arm),
    unitId: trial.unitId,
    arm: trial.arm,
    episodeId: trial.episode.episode.id,
    outcomeStatus: trial.outcomeEvidence.status,
    score: outcomeScore(trial.outcomeEvidence),
    opponentScores: Object.fromEntries(
      plan.downstream.opponents.map(({ id }) => [id, opponentScore(trial.outcomeEvidence, id)]),
    ),
    cost: trial.cost,
  };
}

/** Validate a full retained stage trial and release it to a compact comparison row. */
export function summarizeStageStrengthTrial(
  planInput: StageStrengthCampaignPlan,
  input: StageStrengthTrial,
): StageStrengthTrialSummary {
  const plan = StageStrengthCampaignPlanSchema.parse(planInput);
  return summaryOfValidatedTrial(plan, validateTrial(plan, input));
}

function indexedSummaries(
  plan: z.infer<typeof StageStrengthCampaignPlanSchema>,
  input: readonly StageStrengthTrialSummary[],
): ReadonlyMap<string, StageStrengthTrialSummary> {
  const schedule = new Map(plan.schedule.map((row) => [row.unitId, row]));
  const indexed = new Map<string, StageStrengthTrialSummary>();
  const episodeIds = new Set<string>();
  for (const summary of input) {
    if (summary.outcomeStatus !== 'completed' && !failureStatus.options.includes(summary.outcomeStatus)) {
      throw new Error(`stage trial summary ${summary.key} has an invalid outcome status`);
    }
    const key = trialKey(summary.unitId, summary.arm);
    const row = schedule.get(summary.unitId);
    if (summary.key !== key || row === undefined) throw new Error(`invalid stage trial summary ${key}`);
    if (indexed.has(key)) throw new Error(`expected exactly one trial for ${key}`);
    if (episodeIds.has(summary.episodeId)) throw new Error(`episode ${summary.episodeId} is reused`);
    if (summary.episodeId !== stageStrengthEpisodeId(plan.id, summary.unitId, summary.arm)) {
      throw new Error(`trial ${key} episode identity drift`);
    }
    if ((summary.outcomeStatus === 'completed') !== (summary.score !== null)) {
      throw new Error(`trial ${key} summary outcome drift`);
    }
    if (
      summary.score !== null &&
      (!Number.isFinite(summary.score) || summary.score < 0 || summary.score > 1)
    ) {
      throw new Error(`trial ${key} has an invalid score`);
    }
    const scheduledOpponents = new Set(row.outcomeSchedule.map(({ opponentId }) => opponentId));
    for (const { id } of plan.downstream.opponents) {
      const score = summary.opponentScores[id];
      const expectedScore = summary.outcomeStatus === 'completed' && scheduledOpponents.has(id);
      if ((score !== null && score !== undefined) !== expectedScore) {
        throw new Error(`trial ${key} downstream opponent summary drift`);
      }
      if (score !== null && score !== undefined && (!Number.isFinite(score) || score < 0 || score > 1)) {
        throw new Error(`trial ${key} has an invalid downstream opponent score`);
      }
    }
    if (
      !isDeepStrictEqual(
        Object.keys(summary.opponentScores).sort(),
        [...plan.downstream.opponents.map(({ id }) => id)].sort(),
      )
    ) {
      throw new Error(`trial ${key} downstream opponent summary drift`);
    }
    if (
      !Number.isFinite(summary.cost.elapsedMs) ||
      summary.cost.elapsedMs < 0 ||
      !Number.isInteger(summary.cost.decisions) ||
      summary.cost.decisions < 0 ||
      !Number.isInteger(summary.cost.downstreamDecisions) ||
      summary.cost.downstreamDecisions < 0 ||
      !Number.isFinite(summary.cost.spentUsd) ||
      summary.cost.spentUsd < 0
    ) {
      throw new Error(`trial ${key} has invalid cost`);
    }
    episodeIds.add(summary.episodeId);
    indexed.set(key, summary);
  }
  if (indexed.size !== plan.schedule.length * arm.options.length) {
    throw new Error(`expected ${String(plan.schedule.length * arm.options.length)} stage trial summaries`);
  }
  return indexed;
}

function completion(
  trials: readonly StageStrengthTrialSummary[],
  trialArm: StageStrengthArm,
): CompletionSummary {
  const selected = trials.filter((trial) => trial.arm === trialArm);
  const completed = selected.filter((trial) => trial.outcomeStatus === 'completed').length;
  const byStatus: Record<string, number> = {};
  for (const trial of selected) {
    if (trial.outcomeStatus !== 'completed') {
      byStatus[trial.outcomeStatus] = (byStatus[trial.outcomeStatus] ?? 0) + 1;
    }
  }
  return {
    attempted: selected.length,
    completed,
    failures: selected.length - completed,
    rate: selected.length === 0 ? 0 : completed / selected.length,
    byStatus,
  };
}

function cost(trials: readonly StageStrengthTrialSummary[], trialArm: StageStrengthArm): CostSummary {
  const selected = trials.filter((trial) => trial.arm === trialArm);
  return {
    trials: selected.length,
    elapsedMs: selected.reduce((sum, trial) => sum + trial.cost.elapsedMs, 0),
    decisions: selected.reduce((sum, trial) => sum + trial.cost.decisions, 0),
    downstreamDecisions: selected.reduce((sum, trial) => sum + trial.cost.downstreamDecisions, 0),
    spentUsd: selected.reduce((sum, trial) => sum + trial.cost.spentUsd, 0),
  };
}

function opponentSegments(
  plan: z.infer<typeof StageStrengthCampaignPlanSchema>,
  indexed: ReadonlyMap<string, StageStrengthTrialSummary>,
): readonly PromotionSegment[] {
  return plan.downstream.opponents.map(({ id: opponentId }) => {
    const rows = plan.schedule.filter((row) =>
      row.outcomeSchedule.some((game) => game.opponentId === opponentId),
    );
    const rowIds = new Set(rows.map((row) => row.unitId));
    const selectedTrials = [...indexed.values()].filter((trial) => rowIds.has(trial.unitId));
    const compared = comparePairedPromotion({
      split: plan.split,
      units: rows.map((row) => {
        const baseline = indexed.get(trialKey(row.unitId, 'baseline'))!.opponentScores[opponentId] ?? null;
        const candidate = indexed.get(trialKey(row.unitId, 'candidate'))!.opponentScores[opponentId] ?? null;
        return {
          unitId: row.unitId,
          segments: { 'downstream-opponent': opponentId },
          difference: baseline === null || candidate === null ? null : candidate - baseline,
        };
      }),
      segmentDimensions: [{ id: 'downstream-opponent', values: [opponentId] }],
      minimumIndependentUnits: plan.minimumIndependentUnits,
      smallestUsefulEffect: plan.smallestUsefulEffect,
      anticipatedStandardDeviation: plan.powerPlan.anticipatedStandardDeviation,
      regressionMargin: plan.regressionMargin,
      maximumFailureRate: plan.maximumFailureRate,
      completion: {
        baseline: completion(selectedTrials, 'baseline'),
        candidate: completion(selectedTrials, 'candidate'),
      },
    });
    return compared.strength.bySegment[0]!;
  });
}

/** Recompute all stage-strength headlines from exact decision and downstream outcome evidence. */
export function compareStageStrengthTrialSummaries(
  planInput: StageStrengthCampaignPlan,
  summaryInput: readonly StageStrengthTrialSummary[],
  evidenceSha256Input: string,
): StageStrengthComparison {
  const plan = StageStrengthCampaignPlanSchema.parse(planInput);
  const evidenceSha256 = digest.parse(evidenceSha256Input);
  const indexed = indexedSummaries(plan, summaryInput);
  const trials = [...indexed.values()];
  const summaries = {
    baseline: completion(trials, 'baseline'),
    candidate: completion(trials, 'candidate'),
  };
  const units = plan.schedule.map((row) => {
    const baseline = indexed.get(trialKey(row.unitId, 'baseline'))!.score;
    const candidate = indexed.get(trialKey(row.unitId, 'candidate'))!.score;
    return {
      unitId: row.unitId,
      segments: row.segments,
      difference: baseline === null || candidate === null ? null : candidate - baseline,
    };
  });
  const paired = comparePairedPromotion({
    split: plan.split,
    units,
    segmentDimensions: plan.segmentDimensions,
    minimumIndependentUnits: plan.minimumIndependentUnits,
    smallestUsefulEffect: plan.smallestUsefulEffect,
    anticipatedStandardDeviation: plan.powerPlan.anticipatedStandardDeviation,
    regressionMargin: plan.regressionMargin,
    maximumFailureRate: plan.maximumFailureRate,
    completion: summaries,
  });
  const byOpponent = opponentSegments(plan, indexed);
  const opponentRegression = byOpponent.some(
    ({ interval95 }) => interval95 === null || interval95.low < -plan.regressionMargin,
  );
  const promotionReasons = opponentRegression
    ? [...paired.promotion.reasons, 'downstream-opponent-regression-not-excluded']
    : paired.promotion.reasons;
  const body = {
    version: 'stage-strength-comparison/v2' as const,
    planSha256: sha256(plan),
    evidenceSha256,
    scope: { engine: plan.engine, stage: plan.stage, split: plan.split },
    population: { subjects: plan.subjects.length, scheduledTrialsPerArm: plan.schedule.length },
    completion: summaries,
    strength: { ...paired.strength, byOpponent },
    cost: { baseline: cost(trials, 'baseline'), candidate: cost(trials, 'candidate') },
    promotion: {
      status: promotionReasons.length === 0 ? ('promote-candidate' as const) : ('retain-baseline' as const),
      reasons: promotionReasons,
    },
  };
  return { ...body, sha256: sha256(body) };
}

/** Recompute all stage-strength headlines from exact decision and downstream outcome evidence. */
export function compareStageStrengthCampaign(
  planInput: StageStrengthCampaignPlan,
  trialInput: readonly StageStrengthTrial[],
): StageStrengthComparison {
  const plan = StageStrengthCampaignPlanSchema.parse(planInput);
  const indexed = indexedTrials(plan, trialInput);
  const evidenceSha256 = sha256(
    [...indexed.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, trial]) => ({ key, trial })),
  );
  return compareStageStrengthTrialSummaries(
    plan,
    [...indexed.values()].map((trial) => summaryOfValidatedTrial(plan, trial)),
    evidenceSha256,
  );
}

/** Reject a hand-edited report by reconstructing it from the retained evidence. */
export function readStageStrengthComparison(
  plan: StageStrengthCampaignPlan,
  trials: readonly StageStrengthTrial[],
  input: unknown,
): StageStrengthComparison {
  const canonical = compareStageStrengthCampaign(plan, trials);
  if (!isDeepStrictEqual(input, canonical)) {
    throw new Error('stage strength comparison differs from canonical evidence');
  }
  return canonical;
}
