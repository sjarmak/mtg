/** Execute a pre-registered bot-strength schedule without changing its population. */
import type { BotEvidenceEpisode } from '@mtg/bot-evidence';
import {
  BotStrengthCampaignPlanSchema,
  compareBotStrengthCampaign,
  validateBotStrengthTrial,
  type BotStrengthArm,
  type BotStrengthCampaignPlan,
  type BotStrengthComparison,
  type BotStrengthOpponent,
  type BotStrengthTrial,
} from './bot-strength-comparison';

type ScheduleRow = BotStrengthCampaignPlan['schedule'][number];
type FormatIdentity = BotStrengthCampaignPlan['formats'][number];
type PolicyIdentity = BotStrengthCampaignPlan['policies'][BotStrengthArm];
type FeatureIdentity = BotStrengthCampaignPlan['features'][BotStrengthArm];

export interface BotStrengthTrialContext {
  readonly arm: BotStrengthArm;
  readonly row: ScheduleRow;
  readonly format: FormatIdentity;
  readonly opponent: BotStrengthOpponent;
  readonly policy: PolicyIdentity;
  readonly features: FeatureIdentity;
  readonly runtime: BotStrengthCampaignPlan['runtime'];
}

export interface BotStrengthTrialResult {
  readonly episode: BotEvidenceEpisode;
  readonly cost: BotStrengthTrial['cost'];
}

export type BotStrengthTrialExecution = (context: BotStrengthTrialContext) => Promise<BotStrengthTrialResult>;

export interface BotStrengthCampaignRun {
  readonly trials: readonly BotStrengthTrial[];
  readonly comparison: BotStrengthComparison;
}

export type BotStrengthTrialCheckpoint = (trial: BotStrengthTrial) => void | Promise<void>;

/**
 * Parse the complete fixed schedule before running games, then execute it in
 * stable row/arm order. The executor owns engine-specific setup and must return
 * failures as evidence so completion and cost remain measurable.
 */
export async function executeBotStrengthCampaign(
  input: BotStrengthCampaignPlan,
  execute: BotStrengthTrialExecution,
  onTrial?: BotStrengthTrialCheckpoint,
): Promise<number> {
  const plan = BotStrengthCampaignPlanSchema.parse(input);
  const formats = new Map(plan.formats.map((format) => [format.id, format]));
  const opponents = new Map(plan.opponents.map((opponent) => [opponent.id, opponent]));
  let completed = 0;

  for (const row of plan.schedule) {
    const format = formats.get(row.formatId)!;
    const opponent = opponents.get(row.opponentId)!;
    for (const arm of ['baseline', 'candidate'] as const) {
      const result = await execute({
        arm,
        row,
        format,
        opponent,
        policy: plan.policies[arm],
        features: plan.features[arm],
        runtime: plan.runtime,
      });
      const trial: BotStrengthTrial = {
        unitId: row.unitId,
        arm,
        focalSeat: row.focalSeat,
        opponent,
        focalDeckSha256: row.focalDeckSha256,
        cost: result.cost,
        episode: result.episode,
      };
      const validated = validateBotStrengthTrial(plan, trial);
      await onTrial?.(validated);
      completed += 1;
    }
  }

  return completed;
}

/** Execute and retain small campaigns for callers that need an in-memory run. */
export async function runBotStrengthCampaign(
  input: BotStrengthCampaignPlan,
  execute: BotStrengthTrialExecution,
  onTrial?: BotStrengthTrialCheckpoint,
): Promise<BotStrengthCampaignRun> {
  let trials: readonly BotStrengthTrial[] = [];
  await executeBotStrengthCampaign(input, execute, async (trial) => {
    trials = [...trials, trial];
    await onTrial?.(trial);
  });

  return { trials, comparison: compareBotStrengthCampaign(input, trials) };
}
