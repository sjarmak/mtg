/**
 * Admit a candidate to the native gameplay holdout on the strength of its tuning campaign.
 *
 * The holdout population is seeded separately from tuning and is spent once, so a
 * candidate reaches it only after a completed tuning campaign on the same model
 * promoted it. The admission reads that campaign's persisted plan, runtime and
 * comparison, checks each against the others and against the candidate model, and
 * returns the identity the holdout runtime records so the two campaigns stay bound.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { botEvidenceSha256 } from '@mtg/bot-evidence';

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

const TuningPlanSchema = z.looseObject({
  id: z.string().trim().min(1),
  split: z.enum(['tuning', 'holdout']),
});

const TuningRuntimeSchema = z.looseObject({
  version: z.literal('native-gameplay-campaign-runtime/v1'),
  modelSha256: Sha256,
});

const TuningComparisonSchema = z.looseObject({
  planSha256: Sha256,
  sha256: Sha256,
  scope: z.looseObject({ engine: z.literal('native'), split: z.enum(['tuning', 'holdout']) }),
  promotion: z.looseObject({
    status: z.enum(['promote-candidate', 'retain-baseline']),
    reasons: z.array(z.string()),
  }),
});

export interface NativeGameplayHoldoutAdmission {
  readonly tuningCampaignId: string;
  readonly tuningPlanSha256: string;
  readonly tuningComparisonSha256: string;
}

function json(directory: string, name: string): unknown {
  return JSON.parse(readFileSync(join(directory, name), 'utf8')) as unknown;
}

/** Refuse a holdout whose tuning campaign is missing, unfinished, on another model, or not promoted. */
export function admitNativeGameplayHoldout(options: {
  readonly tuningDirectory: string;
  readonly modelSha256: string;
}): NativeGameplayHoldoutAdmission {
  const directory = resolve(options.tuningDirectory);
  const plan = TuningPlanSchema.parse(json(directory, 'plan.json'));
  const runtime = TuningRuntimeSchema.parse(json(directory, 'runtime.json'));
  const comparison = TuningComparisonSchema.parse(json(directory, 'comparison.json'));
  if (plan.split !== 'tuning' || comparison.scope.split !== 'tuning') {
    throw new Error(`native gameplay holdout admission needs a tuning campaign; ${plan.id} is ${plan.split}`);
  }
  const planSha256 = botEvidenceSha256(plan);
  if (comparison.planSha256 !== planSha256) {
    throw new Error(`tuning comparison in ${directory} does not belong to its plan`);
  }
  const { sha256, ...body } = comparison;
  if (botEvidenceSha256(body) !== sha256) {
    throw new Error(`tuning comparison in ${directory} does not match its recorded digest`);
  }
  if (runtime.modelSha256 !== options.modelSha256) {
    throw new Error(
      `tuning campaign ${plan.id} evaluated model ${runtime.modelSha256}, not the holdout candidate ${options.modelSha256}`,
    );
  }
  if (comparison.promotion.status !== 'promote-candidate') {
    throw new Error(
      `tuning campaign ${plan.id} retained the baseline (${comparison.promotion.reasons.join(', ')}); the holdout is not admitted`,
    );
  }
  return { tuningCampaignId: plan.id, tuningPlanSha256: planSha256, tuningComparisonSha256: sha256 };
}
