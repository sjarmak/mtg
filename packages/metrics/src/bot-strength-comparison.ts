/** Canonical paired strength comparison over complete decision-to-outcome episodes. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { BotEvidenceEpisodeSchema, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import { canonicalJson } from '@mtg/dsl';
import { z } from 'zod';
import {
  comparePairedPromotion,
  requiredIndependentUnitsFor,
  type PRIMARY_INTERVAL_METHOD,
  type PromotionPower,
  type SECONDARY_INTERVAL_METHOD,
} from './paired-promotion';

const MAX_UNITS = 100_000;
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const nonempty = z.string().trim().min(1);
const seat = z.union([z.literal(0), z.literal(1)]);

const PolicyIdentitySchema = z.strictObject({
  policyId: nonempty,
  configSha256: digest,
  modelSha256: digest.nullable(),
  dataSha256: digest.nullable(),
});

const OpponentSchema = PolicyIdentitySchema.extend({
  id: nonempty,
  deckSha256: digest,
});

const ScheduleRowSchema = z.strictObject({
  unitId: nonempty,
  formatId: nonempty,
  opponentId: nonempty,
  seed: nonempty,
  focalSeat: seat,
  focalDeckSha256: digest,
});

const FormatSchema = z.strictObject({
  id: nonempty,
  formatSha256: digest,
  cardsSha256: digest,
});

export const BotStrengthCampaignPlanSchema = z
  .strictObject({
    version: z.literal('bot-strength-campaign-plan/v1'),
    id: nonempty,
    split: z.enum(['tuning', 'holdout']),
    stage: z.literal('gameplay'),
    engine: z.enum(['native', 'forge']),
    runtime: z.strictObject({ version: nonempty, buildSha256: digest }),
    features: z.strictObject({
      baseline: z.strictObject({ schemaId: nonempty, schemaSha256: digest }),
      candidate: z.strictObject({ schemaId: nonempty, schemaSha256: digest }),
    }),
    formats: z.array(FormatSchema).min(1).max(MAX_UNITS),
    primaryOutcome: z.literal('candidate-game-score-minus-baseline'),
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
    policies: z.strictObject({
      baseline: PolicyIdentitySchema,
      candidate: PolicyIdentitySchema,
    }),
    opponents: z.array(OpponentSchema).min(1).max(MAX_UNITS),
    schedule: z
      .array(ScheduleRowSchema)
      .min(2)
      .max(MAX_UNITS * 2),
  })
  .superRefine((plan, context) => {
    if (isDeepStrictEqual(plan.policies.baseline, plan.policies.candidate)) {
      context.addIssue({ code: 'custom', message: 'baseline and candidate policies must differ' });
    }
    const opponentIds = plan.opponents.map((opponent) => opponent.id);
    if (new Set(opponentIds).size !== opponentIds.length) {
      context.addIssue({ code: 'custom', message: 'opponent identities must be unique' });
    }
    const opponents = new Set(opponentIds);
    const formatIds = plan.formats.map((format) => format.id);
    if (new Set(formatIds).size !== formatIds.length) {
      context.addIssue({ code: 'custom', message: 'format identities must be unique' });
    }
    const formats = new Set(formatIds);
    const units = new Map<string, typeof plan.schedule>();
    const scheduleKeys = new Set<string>();
    for (const row of plan.schedule) {
      if (!opponents.has(row.opponentId)) {
        context.addIssue({
          code: 'custom',
          message: `schedule references unknown opponent ${row.opponentId}`,
        });
      }
      if (!formats.has(row.formatId)) {
        context.addIssue({
          code: 'custom',
          message: `schedule references unknown format ${row.formatId}`,
        });
      }
      const key = `${row.unitId}\u0000${String(row.focalSeat)}`;
      if (scheduleKeys.has(key)) {
        context.addIssue({ code: 'custom', message: `duplicate scheduled seat for ${row.unitId}` });
      }
      scheduleKeys.add(key);
      units.set(row.unitId, [...(units.get(row.unitId) ?? []), row]);
    }
    for (const [unitId, rows] of units) {
      const seats = new Set(rows.map((row) => row.focalSeat));
      const profiles = new Set(
        rows.map(
          (row) => `${row.formatId}\u0000${row.opponentId}\u0000${row.seed}\u0000${row.focalDeckSha256}`,
        ),
      );
      if (rows.length !== 2 || seats.size !== 2 || profiles.size !== 1) {
        context.addIssue({
          code: 'custom',
          message: `independent unit ${unitId} must be seat-balanced over one format, opponent, and seed`,
        });
      }
    }
    if (plan.stoppingRule.count !== units.size) {
      context.addIssue({ code: 'custom', message: 'fixed stopping count must equal scheduled units' });
    }
    if (plan.minimumIndependentUnits > plan.stoppingRule.count) {
      context.addIssue({
        code: 'custom',
        message: 'minimum independent units exceed the fixed stopping count',
      });
    }
    const calculatedUnits = requiredIndependentUnitsFor(
      plan.powerPlan.anticipatedStandardDeviation,
      plan.smallestUsefulEffect,
    );
    if (plan.powerPlan.requiredIndependentUnits !== calculatedUnits) {
      context.addIssue({
        code: 'custom',
        message: 'power plan required unit count differs from its calculation',
      });
    }
    if (plan.stoppingRule.count < plan.powerPlan.requiredIndependentUnits) {
      context.addIssue({ code: 'custom', message: 'fixed stopping count is below the power plan' });
    }
  });

export type BotStrengthCampaignPlan = z.input<typeof BotStrengthCampaignPlanSchema>;
export type BotStrengthOpponent = z.infer<typeof OpponentSchema>;
export type BotStrengthArm = 'baseline' | 'candidate';

export interface BotStrengthTrial {
  readonly unitId: string;
  readonly arm: BotStrengthArm;
  readonly focalSeat: 0 | 1;
  readonly opponent: BotStrengthOpponent;
  readonly focalDeckSha256: string;
  readonly cost: { readonly elapsedMs: number; readonly decisions: number };
  readonly episode: BotEvidenceEpisode;
}

/** Compact comparison input produced only after a full trial validates. */
export interface BotStrengthTrialSummary {
  readonly key: string;
  readonly unitId: string;
  readonly arm: BotStrengthArm;
  readonly focalSeat: 0 | 1;
  readonly episodeId: string;
  readonly outcomeStatus: BotEvidenceEpisode['outcome']['status'];
  readonly score: number | null;
  readonly cost: BotStrengthTrial['cost'];
}

export interface BotStrengthInterval {
  readonly low: number;
  readonly high: number;
}

export interface BotStrengthSegment {
  readonly id: string;
  readonly independentUnits: number;
  readonly meanPairedDifference: number | null;
  readonly interval95: BotStrengthInterval | null;
  readonly hoeffdingInterval95: BotStrengthInterval | null;
}

export interface BotStrengthComparison {
  readonly version: 'bot-strength-comparison/v2';
  readonly planSha256: string;
  readonly evidenceSha256: string;
  readonly scope: {
    readonly engine: 'native' | 'forge';
    readonly stage: 'gameplay';
    readonly split: 'tuning' | 'holdout';
  };
  readonly population: {
    readonly formats: number;
    readonly opponents: number;
    readonly scheduledGamesPerArm: number;
  };
  readonly completion: Readonly<Record<BotStrengthArm, CompletionSummary>>;
  readonly strength: {
    readonly intervalMethod: typeof PRIMARY_INTERVAL_METHOD;
    readonly secondaryIntervalMethod: typeof SECONDARY_INTERVAL_METHOD;
    readonly status: 'measured' | 'under-sampled';
    readonly independentUnits: number;
    readonly excludedUnits: number;
    readonly meanPairedDifference: number | null;
    readonly interval95: BotStrengthInterval | null;
    readonly hoeffdingInterval95: BotStrengthInterval | null;
    readonly power: PromotionPower;
    readonly byFormat: readonly BotStrengthSegment[];
    readonly byOpponent: readonly BotStrengthSegment[];
  };
  readonly cost: Readonly<Record<BotStrengthArm, CostSummary>>;
  readonly promotion: {
    readonly status: 'promote-candidate' | 'retain-baseline';
    readonly reasons: readonly string[];
  };
  readonly sha256: string;
}

interface CompletionSummary {
  readonly attempted: number;
  readonly completed: number;
  readonly failures: number;
  readonly rate: number;
  readonly byStatus: Readonly<Record<string, number>>;
}

interface CostSummary {
  readonly games: number;
  readonly elapsedMs: number;
  readonly decisions: number;
}

interface UnitResult {
  readonly unitId: string;
  readonly formatId: string;
  readonly opponentId: string;
  readonly difference: number | null;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function trialKey(unitId: string, focalSeat: 0 | 1, arm: BotStrengthArm): string {
  return `${unitId}\u0000${String(focalSeat)}\u0000${arm}`;
}

/** Stable identity that binds retained evidence to its scheduled arm and seat. */
export function botStrengthEpisodeId(
  planId: string,
  unitId: string,
  focalSeat: 0 | 1,
  arm: BotStrengthArm,
): string {
  return `${planId}/${unitId}/${String(focalSeat)}/${arm}`;
}

function policyIdentity(behavior: BotEvidenceEpisode['episode']['behavior']) {
  return {
    policyId: behavior.policyId,
    configSha256: behavior.configSha256,
    modelSha256: behavior.modelSha256,
    dataSha256: behavior.dataSha256,
  };
}

function gameScore(episode: BotEvidenceEpisode, focalSeat: 0 | 1): number | null {
  if (episode.outcome.status !== 'completed') return null;
  const value = episode.outcome.value;
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`completed episode ${episode.episode.id} has no structured winner`);
  }
  const winner = (value as Readonly<Record<string, unknown>>)['winner'];
  if (winner === null) return 0.5;
  if (winner !== 0 && winner !== 1) {
    throw new Error(`completed episode ${episode.episode.id} has an invalid winner`);
  }
  return winner === focalSeat ? 1 : 0;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validateTrialIdentity(
  plan: z.infer<typeof BotStrengthCampaignPlanSchema>,
  input: BotStrengthTrial,
  row: z.infer<typeof ScheduleRowSchema>,
  opponent: BotStrengthOpponent,
  format: z.infer<typeof FormatSchema>,
): BotStrengthTrial {
  const episode = BotEvidenceEpisodeSchema.parse(input.episode);
  const key = trialKey(input.unitId, input.focalSeat, input.arm);
  const expectedEpisodeId = botStrengthEpisodeId(plan.id, input.unitId, input.focalSeat, input.arm);
  if (
    episode.episode.id !== expectedEpisodeId ||
    episode.episode.lineage.gameId !== expectedEpisodeId ||
    episode.episode.splitGroup.kind !== 'game' ||
    episode.episode.splitGroup.id !== expectedEpisodeId
  ) {
    throw new Error(`trial ${key} episode identity differs from its scheduled arm and seat`);
  }
  if (!isDeepStrictEqual(input.opponent, opponent)) {
    throw new Error(`trial ${key} opponent identity differs from the campaign plan`);
  }
  if (input.focalDeckSha256 !== row.focalDeckSha256) throw new Error(`trial ${key} focal deck drift`);
  if (!Number.isFinite(input.cost.elapsedMs) || input.cost.elapsedMs < 0) {
    throw new Error(`trial ${key} has invalid elapsed cost`);
  }
  if (input.cost.decisions !== episode.decisions.length) {
    throw new Error(`trial ${key} decision count differs from its evidence`);
  }
  if (episode.episode.stage !== plan.stage || episode.episode.runtime.kind !== plan.engine) {
    throw new Error(`trial ${key} uses the wrong stage or engine`);
  }
  if (
    episode.episode.runtime.version !== plan.runtime.version ||
    episode.episode.runtime.buildSha256 !== plan.runtime.buildSha256
  ) {
    throw new Error(`trial ${key} runtime drift`);
  }
  if (!isDeepStrictEqual(episode.episode.features, plan.features[input.arm])) {
    throw new Error(`trial ${key} feature schema drift`);
  }
  if (
    !isDeepStrictEqual(episode.episode.subject, {
      formatId: format.id,
      formatSha256: format.formatSha256,
      cardsSha256: format.cardsSha256,
    })
  ) {
    throw new Error(`trial ${key} format drift`);
  }
  if (episode.episode.seed !== row.seed) throw new Error(`trial ${key} seed drift`);
  if (!isDeepStrictEqual(policyIdentity(episode.episode.behavior), plan.policies[input.arm])) {
    throw new Error(`trial ${key} policy drift`);
  }
  return { ...input, episode };
}

/** Validate one engine result before it is written as a campaign checkpoint. */
export function validateBotStrengthTrial(
  planInput: BotStrengthCampaignPlan,
  input: BotStrengthTrial,
): BotStrengthTrial {
  const plan = BotStrengthCampaignPlanSchema.parse(planInput);
  const row = plan.schedule.find(
    (scheduled) => scheduled.unitId === input.unitId && scheduled.focalSeat === input.focalSeat,
  );
  if (row === undefined) {
    throw new Error(
      `trial ${trialKey(input.unitId, input.focalSeat, input.arm)} is not in the campaign schedule`,
    );
  }
  const opponent = plan.opponents.find((candidate) => candidate.id === row.opponentId)!;
  const format = plan.formats.find((candidate) => candidate.id === row.formatId)!;
  return validateTrialIdentity(plan, input, row, opponent, format);
}

function validateTrials(
  plan: z.infer<typeof BotStrengthCampaignPlanSchema>,
  trials: readonly BotStrengthTrial[],
): ReadonlyMap<string, BotStrengthTrial> {
  const expected = new Map(plan.opponents.map((opponent) => [opponent.id, opponent]));
  const formats = new Map(plan.formats.map((format) => [format.id, format]));
  const schedule = new Map(plan.schedule.map((row) => [`${row.unitId}\u0000${String(row.focalSeat)}`, row]));
  const indexed = new Map<string, BotStrengthTrial>();
  const episodeIds = new Set<string>();
  for (const input of trials) {
    const key = trialKey(input.unitId, input.focalSeat, input.arm);
    if (indexed.has(key)) throw new Error(`expected exactly one trial for ${key}`);
    const row = schedule.get(`${input.unitId}\u0000${String(input.focalSeat)}`);
    if (row === undefined) throw new Error(`trial ${key} is not in the campaign schedule`);
    const opponent = expected.get(row.opponentId);
    const format = formats.get(row.formatId);
    if (opponent === undefined || format === undefined)
      throw new Error(`trial ${key} plan identity is missing`);
    const trial = validateTrialIdentity(plan, input, row, opponent, format);
    const episode = trial.episode;
    if (episodeIds.has(episode.episode.id)) throw new Error(`episode ${episode.episode.id} is reused`);
    episodeIds.add(episode.episode.id);
    indexed.set(key, trial);
  }
  for (const row of plan.schedule) {
    for (const arm of ['baseline', 'candidate'] as const) {
      const key = trialKey(row.unitId, row.focalSeat, arm);
      if (!indexed.has(key)) throw new Error(`expected exactly one trial for ${key}`);
    }
  }
  if (indexed.size !== plan.schedule.length * 2)
    throw new Error('trial population exceeds the campaign schedule');
  return indexed;
}

function summaryOfValidatedTrial(trial: BotStrengthTrial): BotStrengthTrialSummary {
  return {
    key: trialKey(trial.unitId, trial.focalSeat, trial.arm),
    unitId: trial.unitId,
    arm: trial.arm,
    focalSeat: trial.focalSeat,
    episodeId: trial.episode.episode.id,
    outcomeStatus: trial.episode.outcome.status,
    score: gameScore(trial.episode, trial.focalSeat),
    cost: trial.cost,
  };
}

/** Validate a full retained trial and release it to a compact comparison row. */
export function summarizeBotStrengthTrial(
  planInput: BotStrengthCampaignPlan,
  input: BotStrengthTrial,
): BotStrengthTrialSummary {
  return summaryOfValidatedTrial(validateBotStrengthTrial(planInput, input));
}

function validateTrialSummaries(
  plan: z.infer<typeof BotStrengthCampaignPlanSchema>,
  input: readonly BotStrengthTrialSummary[],
): ReadonlyMap<string, BotStrengthTrialSummary> {
  const schedule = new Set(
    plan.schedule.flatMap((row) =>
      (['baseline', 'candidate'] as const).map((trialArm) => trialKey(row.unitId, row.focalSeat, trialArm)),
    ),
  );
  const indexed = new Map<string, BotStrengthTrialSummary>();
  const episodeIds = new Set<string>();
  for (const summary of input) {
    const key = trialKey(summary.unitId, summary.focalSeat, summary.arm);
    if (summary.key !== key || !schedule.has(key)) throw new Error(`invalid trial summary ${key}`);
    if (indexed.has(key)) throw new Error(`expected exactly one trial for ${key}`);
    if (episodeIds.has(summary.episodeId)) throw new Error(`episode ${summary.episodeId} is reused`);
    const expectedEpisodeId = botStrengthEpisodeId(plan.id, summary.unitId, summary.focalSeat, summary.arm);
    if (summary.episodeId !== expectedEpisodeId) throw new Error(`trial ${key} episode identity drift`);
    if ((summary.outcomeStatus === 'completed') !== (summary.score !== null)) {
      throw new Error(`trial ${key} summary outcome drift`);
    }
    if (summary.score !== null && ![0, 0.5, 1].includes(summary.score)) {
      throw new Error(`trial ${key} has an invalid score`);
    }
    if (
      !Number.isFinite(summary.cost.elapsedMs) ||
      summary.cost.elapsedMs < 0 ||
      !Number.isInteger(summary.cost.decisions) ||
      summary.cost.decisions < 0
    ) {
      throw new Error(`trial ${key} has invalid cost`);
    }
    episodeIds.add(summary.episodeId);
    indexed.set(key, summary);
  }
  if (indexed.size !== schedule.size) throw new Error(`expected ${String(schedule.size)} trial summaries`);
  return indexed;
}

function summaryCompletion(
  trials: readonly BotStrengthTrialSummary[],
  arm: BotStrengthArm,
): CompletionSummary {
  const selected = trials.filter((trial) => trial.arm === arm);
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

function summaryCost(trials: readonly BotStrengthTrialSummary[], arm: BotStrengthArm): CostSummary {
  const selected = trials.filter((trial) => trial.arm === arm);
  return {
    games: selected.length,
    elapsedMs: selected.reduce((sum, trial) => sum + trial.cost.elapsedMs, 0),
    decisions: selected.reduce((sum, trial) => sum + trial.cost.decisions, 0),
  };
}

function pairedUnits(
  plan: z.infer<typeof BotStrengthCampaignPlanSchema>,
  trials: ReadonlyMap<string, BotStrengthTrialSummary>,
): readonly UnitResult[] {
  const rows = new Map<string, (typeof plan.schedule)[number]>();
  for (const row of plan.schedule) rows.set(row.unitId, row);
  return [...rows.values()].map((row) => {
    const armScore = (arm: BotStrengthArm): number | null => {
      const scores = ([0, 1] as const).map(
        (focalSeat) => trials.get(trialKey(row.unitId, focalSeat, arm))!.score,
      );
      return scores.some((score) => score === null) ? null : mean(scores as number[]);
    };
    const baseline = armScore('baseline');
    const candidate = armScore('candidate');
    return {
      unitId: row.unitId,
      formatId: row.formatId,
      opponentId: row.opponentId,
      difference: baseline === null || candidate === null ? null : candidate - baseline,
    };
  });
}

/** Compare compact rows previously produced by full trial validation. */
export function compareBotStrengthTrialSummaries(
  planInput: BotStrengthCampaignPlan,
  summaryInput: readonly BotStrengthTrialSummary[],
  evidenceSha256Input: string,
): BotStrengthComparison {
  const plan = BotStrengthCampaignPlanSchema.parse(planInput);
  const evidenceSha256 = digest.parse(evidenceSha256Input);
  const indexed = validateTrialSummaries(plan, summaryInput);
  const trials = [...indexed.values()];
  const units = pairedUnits(plan, indexed);
  const baselineCompletion = summaryCompletion(trials, 'baseline');
  const candidateCompletion = summaryCompletion(trials, 'candidate');
  const paired = comparePairedPromotion({
    split: plan.split,
    units: units.map((unit) => ({
      unitId: unit.unitId,
      difference: unit.difference,
      segments: { format: unit.formatId, opponent: unit.opponentId },
    })),
    segmentDimensions: [
      { id: 'format', values: plan.formats.map((format) => format.id).sort() },
      { id: 'opponent', values: plan.opponents.map((opponent) => opponent.id).sort() },
    ],
    minimumIndependentUnits: plan.minimumIndependentUnits,
    smallestUsefulEffect: plan.smallestUsefulEffect,
    anticipatedStandardDeviation: plan.powerPlan.anticipatedStandardDeviation,
    regressionMargin: plan.regressionMargin,
    maximumFailureRate: plan.maximumFailureRate,
    completion: { baseline: baselineCompletion, candidate: candidateCompletion },
  });
  const byFormat = paired.strength.bySegment
    .filter((segment) => segment.dimension === 'format')
    .map(({ dimension: _dimension, ...segment }) => segment);
  const byOpponent = paired.strength.bySegment
    .filter((segment) => segment.dimension === 'opponent')
    .map(({ dimension: _dimension, ...segment }) => segment);
  const body = {
    version: 'bot-strength-comparison/v2' as const,
    planSha256: sha256(plan),
    evidenceSha256,
    scope: { engine: plan.engine, stage: plan.stage, split: plan.split },
    population: {
      formats: new Set(plan.schedule.map((row) => row.formatId)).size,
      opponents: new Set(plan.schedule.map((row) => row.opponentId)).size,
      scheduledGamesPerArm: plan.schedule.length,
    },
    completion: { baseline: baselineCompletion, candidate: candidateCompletion },
    strength: {
      intervalMethod: paired.strength.intervalMethod,
      secondaryIntervalMethod: paired.strength.secondaryIntervalMethod,
      status: paired.strength.status,
      independentUnits: paired.strength.independentUnits,
      excludedUnits: paired.strength.excludedUnits,
      meanPairedDifference: paired.strength.meanPairedDifference,
      interval95: paired.strength.interval95,
      hoeffdingInterval95: paired.strength.hoeffdingInterval95,
      power: paired.strength.power,
      byFormat,
      byOpponent,
    },
    cost: { baseline: summaryCost(trials, 'baseline'), candidate: summaryCost(trials, 'candidate') },
    promotion: paired.promotion,
  };
  return { ...body, sha256: sha256(body) };
}

/** Recompute every headline from exact episodes; failed games remain in completion and cost. */
export function compareBotStrengthCampaign(
  planInput: BotStrengthCampaignPlan,
  trialInput: readonly BotStrengthTrial[],
): BotStrengthComparison {
  const plan = BotStrengthCampaignPlanSchema.parse(planInput);
  const indexed = validateTrials(plan, trialInput);
  const trials = [...indexed.values()];
  const evidenceSha256 = sha256(
    [...indexed.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, trial]) => ({ key, trial })),
  );
  return compareBotStrengthTrialSummaries(plan, trials.map(summaryOfValidatedTrial), evidenceSha256);
}

/** Reject a hand-edited headline by reconstructing the canonical comparison. */
export function readBotStrengthComparison(
  plan: BotStrengthCampaignPlan,
  trials: readonly BotStrengthTrial[],
  input: unknown,
): BotStrengthComparison {
  const canonical = compareBotStrengthCampaign(plan, trials);
  if (!isDeepStrictEqual(input, canonical))
    throw new Error('bot strength comparison differs from canonical evidence');
  return canonical;
}
