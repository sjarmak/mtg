/** Execute a frozen stage schedule and validate each boundary before proceeding. */
import { botEvidenceSha256, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import {
  StageStrengthCampaignPlanSchema,
  compareStageStrengthCampaign,
  validateStageStrengthEpisode,
  validateStageStrengthTrial,
  type StageStrengthArm,
  type StageStrengthCampaignPlan,
  type StageStrengthComparison,
  type StageStrengthOutcomeEvidence,
  type StageStrengthTrial,
} from './stage-strength-comparison';

type ScheduleRow = StageStrengthCampaignPlan['schedule'][number];
type Subject = StageStrengthCampaignPlan['subjects'][number];
type Policy = StageStrengthCampaignPlan['policies'][StageStrengthArm];
type Feature = StageStrengthCampaignPlan['features'][StageStrengthArm];

export interface StageStrengthExecutionContext {
  readonly arm: StageStrengthArm;
  readonly row: ScheduleRow;
  readonly subject: Subject;
  readonly policy: Policy;
  readonly features: Feature;
  readonly runtime: StageStrengthCampaignPlan['runtime'];
  readonly downstream: StageStrengthCampaignPlan['downstream'];
}

export interface StageStrengthStageResult {
  readonly episode: BotEvidenceEpisode;
  readonly cost: { readonly elapsedMs: number; readonly spentUsd: number };
}

export interface StageStrengthOutcomeContext extends StageStrengthExecutionContext {
  readonly episode: BotEvidenceEpisode;
}

export interface StageStrengthOutcomeResult {
  readonly outcomeEvidence: StageStrengthOutcomeEvidence;
  readonly cost: {
    readonly elapsedMs: number;
    readonly decisions: number;
    readonly spentUsd: number;
  };
}

export type StageStrengthStageExecution = (
  context: StageStrengthExecutionContext,
) => Promise<StageStrengthStageResult>;
export type StageStrengthOutcomeExecution = (
  context: StageStrengthOutcomeContext,
) => Promise<StageStrengthOutcomeResult>;
export type StageStrengthTrialCheckpoint = (trial: StageStrengthTrial) => void | Promise<void>;

export interface StageStrengthCampaignOptions {
  readonly plan: StageStrengthCampaignPlan;
  readonly executeStage: StageStrengthStageExecution;
  readonly executeOutcome: StageStrengthOutcomeExecution;
  readonly onTrial?: StageStrengthTrialCheckpoint;
}

export interface StageStrengthCampaignRun {
  readonly trials: readonly StageStrengthTrial[];
  readonly comparison: StageStrengthComparison;
}

function nonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be nonnegative`);
}

function checkedStageCost(cost: StageStrengthStageResult['cost']): void {
  nonnegative(cost.elapsedMs, 'stage elapsed cost');
  nonnegative(cost.spentUsd, 'stage provider cost');
}

function checkedOutcomeCost(cost: StageStrengthOutcomeResult['cost']): void {
  nonnegative(cost.elapsedMs, 'downstream elapsed cost');
  nonnegative(cost.spentUsd, 'downstream provider cost');
  if (!Number.isSafeInteger(cost.decisions) || cost.decisions < 0) {
    throw new Error('downstream decision cost must be a nonnegative safe integer');
  }
}

/**
 * Stage output is validated against the preregistration before downstream
 * gameplay receives it. Each completed trial is validated before checkpointing.
 */
export async function executeStageStrengthCampaign(options: StageStrengthCampaignOptions): Promise<number> {
  const plan = StageStrengthCampaignPlanSchema.parse(options.plan);
  const subjects = new Map(plan.subjects.map((subject) => [subject.id, subject]));
  let completed = 0;

  for (const row of plan.schedule) {
    const subject = subjects.get(row.subjectId)!;
    for (const arm of ['baseline', 'candidate'] as const) {
      const context: StageStrengthExecutionContext = {
        arm,
        row,
        subject,
        policy: plan.policies[arm],
        features: plan.features[arm],
        runtime: plan.runtime,
        downstream: plan.downstream,
      };
      const stage = structuredClone(await options.executeStage(structuredClone(context)));
      checkedStageCost(stage.cost);
      const episode = validateStageStrengthEpisode(plan, row.unitId, arm, stage.episode);
      const outcome = structuredClone(
        await options.executeOutcome({
          ...structuredClone(context),
          episode: structuredClone(episode),
        }),
      );
      checkedOutcomeCost(outcome.cost);
      const trial = validateStageStrengthTrial(plan, {
        unitId: row.unitId,
        arm,
        episode,
        outcomeEvidenceSha256: botEvidenceSha256(outcome.outcomeEvidence),
        outcomeEvidence: outcome.outcomeEvidence,
        cost: {
          elapsedMs: stage.cost.elapsedMs + outcome.cost.elapsedMs,
          decisions: episode.decisions.length,
          downstreamDecisions: outcome.cost.decisions,
          spentUsd: stage.cost.spentUsd + outcome.cost.spentUsd,
        },
      });
      await options.onTrial?.(structuredClone(trial));
      completed += 1;
    }
  }
  return completed;
}

/** Execute and retain small stage campaigns for in-memory callers. */
export async function runStageStrengthCampaign(
  options: StageStrengthCampaignOptions,
): Promise<StageStrengthCampaignRun> {
  let trials: readonly StageStrengthTrial[] = [];
  await executeStageStrengthCampaign({
    ...options,
    onTrial: async (trial) => {
      trials = [...trials, structuredClone(trial)];
      await options.onTrial?.(structuredClone(trial));
    },
  });
  return { trials, comparison: compareStageStrengthCampaign(options.plan, trials) };
}
