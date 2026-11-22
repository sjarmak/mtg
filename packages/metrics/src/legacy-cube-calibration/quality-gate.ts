/** Numerical gate on canonical model reviews, not a claim of semantic truth or adoption authority. */
import { createHash } from 'node:crypto';
import type { summarizeQualityCampaign } from './quality-summary';

type Summary = ReturnType<typeof summarizeQualityCampaign>;
const CRITERIA = [
  'coherence',
  'castability',
  'pool-alternatives',
  'explanation-accuracy',
  'exploration-usefulness',
] as const;
const FAMILY_ERROR = 0.05;
const MIN_SEEDS = 2;

function criterionResult(row: Summary['criteria'][number]) {
  const differences = row.sessions.map((s) => s.pairedDifference);
  const resolved = differences.every((d): d is number => d !== null);
  const mean = resolved ? differences.reduce((a, b) => a + b, 0) / differences.length : null;
  // One-sided Hoeffding on [-1,1], Bonferroni across the fixed five criteria.
  const radius = Math.sqrt((2 * Math.log(CRITERIA.length / FAMILY_ERROR)) / differences.length);
  const policies = row.sessions.flatMap((s) => s.policies);
  return {
    criterion: row.criterion,
    independentSeeds: differences.length,
    meanPairedDifference: mean,
    lowerBound: mean === null || differences.length < MIN_SEEDS ? null : Math.max(-1, mean - radius),
    candidateAllPass: policies.every(
      (p) => p.candidate.pass === p.observations && p.candidate.fail === 0 && p.candidate.uncertain === 0,
    ),
    unresolved: !resolved || policies.some((p) => p.uncertain > 0 || p.reviewerInconsistencies > 0),
  };
}

/** Internal arithmetic seam. IO callers must reconstruct the summary from canonical receipts first. */
export function assessQualitySummary(summary: Summary) {
  if (
    summary.criteria.length !== CRITERIA.length ||
    CRITERIA.some((name) => summary.criteria.filter((c) => c.criterion === name).length !== 1)
  )
    throw new Error('Quality gate requires all five distinct criteria');
  if (
    !Number.isSafeInteger(summary.independentSessions) ||
    summary.independentSessions < 1 ||
    summary.criteria.some(
      (c) =>
        c.sessions.length !== summary.independentSessions ||
        new Set(c.sessions.map((s) => s.session)).size !== c.sessions.length,
    )
  )
    throw new Error('Quality gate requires distinct independent draft seeds');
  const criteria = CRITERIA.map((name) =>
    criterionResult(summary.criteria.find((c) => c.criterion === name)!),
  );
  const reasons = [
    ...(summary.split === 'holdout' ? [] : ['not-held-out']),
    ...(summary.independentSessions >= MIN_SEEDS ? [] : ['insufficient-independent-seeds']),
    ...(criteria.some((c) => c.unresolved) ? ['unresolved-quality-judgments'] : []),
    ...(criteria.every((c) => c.candidateAllPass) ? [] : ['candidate-quality-not-all-pass']),
    ...(criteria.some((c) => c.lowerBound !== null && c.lowerBound > 0)
      ? []
      : ['improvement-not-established']),
  ];
  const body = {
    version: 'legacy-cube-quality-gate/v1',
    status: reasons.length ? ('retain-baseline' as const) : ('quality-supported' as const),
    summary: summary.sha256,
    campaign: summary.campaign,
    origin: 'model' as const,
    independentHumanEvidence: false as const,
    adoptionEligible: false as const,
    criteria,
    reasons,
    method: {
      name: 'one-sided-simultaneous-Hoeffding',
      familyError: FAMILY_ERROR,
      criteria: CRITERIA.length,
      independentUnit: 'draft-seed',
      range: [-1, 1],
    },
    pending: [
      'transfer-context-review',
      'sampling-and-reviewer-audit',
      'regression-gates',
      'competent-bot-evidence-if-used',
      'reversible-local-installation',
    ],
    limitations: [
      'model-bias-not-bounded',
      'random-independent-seeds-assumed',
      'no-observed-candidate-failures-is-not-population-noninferiority',
      'not-independent-human-validation',
    ],
  };
  return { ...body, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}
