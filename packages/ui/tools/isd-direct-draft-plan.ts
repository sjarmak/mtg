/** Frozen direct-pick holdout for Innistrad; this plan contains no game schedule. */
import type { PrintedDirectDraftPlan } from './printed-limited-direct-draft-campaign';
import { buildPrintedDirectDraftPlan } from './printed-limited-direct-draft-campaign';

export const ISD_DIRECT_DRAFT_HOLDOUT_ID = 'isd-direct-draft-holdout-v1';
export const ISD_DIRECT_DRAFT_PODS = 50;

export interface IsdDirectDraftPlanInputs {
  readonly runtime: PrintedDirectDraftPlan['runtime'];
  readonly subject: PrintedDirectDraftPlan['subject'];
  readonly policies: PrintedDirectDraftPlan['policies'];
}

export function buildIsdDirectDraftPlan(inputs: IsdDirectDraftPlanInputs): PrintedDirectDraftPlan {
  if (inputs.subject.id !== 'isd') throw new Error('ISD direct draft holdout requires the isd subject');
  const seeds = Array.from(
    { length: ISD_DIRECT_DRAFT_PODS },
    (_unused, index) => `${ISD_DIRECT_DRAFT_HOLDOUT_ID}/pod-${String(index).padStart(2, '0')}/draft`,
  );
  return buildPrintedDirectDraftPlan({
    id: ISD_DIRECT_DRAFT_HOLDOUT_ID,
    split: 'holdout',
    runtime: inputs.runtime,
    subject: inputs.subject,
    policies: inputs.policies,
    seeds,
    topTierQuality: 4,
    minimumIndependentUnits: ISD_DIRECT_DRAFT_PODS,
    smallestUsefulEffect: 0.1,
    regressionMargin: 0.05,
  });
}
