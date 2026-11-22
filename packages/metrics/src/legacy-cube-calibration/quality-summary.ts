/** Review stages and policy variants share a seed; only seed-level differences are aggregated. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { readQualityCampaign } from './quality-ledger';
import { readQualityComparison } from './quality-comparison';

type Campaign = ReturnType<typeof readQualityCampaign>;
type Comparison = ReturnType<typeof readQualityComparison>;
type Criterion = Comparison['criteria'][number];
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function readReviews(catalog: PrintedCardCatalog, campaign: Campaign, input: unknown, runtime: unknown) {
  const entries = z
    .array(z.object({ pair: z.unknown(), comparison: z.unknown() }).strict())
    .max(32000)
    .parse(input);
  if (entries.length !== campaign.units.length) throw new Error('Incomplete quality campaign matrix');
  const reviews = entries.map((entry) => {
    const { request } = z.object({ request: z.unknown() }).parse(entry.pair);
    const coordinates = z.object({ index: z.number(), policy: z.string() }).parse(request);
    const { indices: _indices, policies: _policies, ...common } = campaign.request;
    if (!isDeepStrictEqual(request, { ...common, ...coordinates }))
      throw new Error('Quality pair does not belong to campaign weight arms');
    // This reader reconstructs the pair as well as its receipts; do not run both drafts twice here.
    return readQualityComparison(catalog, entry.pair, entry.comparison, runtime);
  });
  if (
    campaign.units.some(
      (unit) => reviews.filter((r) => r.session === unit.session && r.policy === unit.policy).length !== 1,
    )
  )
    throw new Error('Quality campaign matrix contains missing or duplicate units');
  return reviews;
}

function policyDifference(criterion: Criterion) {
  const unresolved = criterion.transitions.some(
    (row) =>
      row.baseline === 'uncertain' ||
      row.candidate === 'uncertain' ||
      (!row.subjectChanged && row.baseline !== row.candidate),
  );
  return unresolved
    ? null
    : mean(
        criterion.transitions.map(
          (row) => Number(row.candidate === 'pass') - Number(row.baseline === 'pass'),
        ),
      );
}

function summarizeCriterion(campaign: Campaign, reviews: readonly Comparison[], criterion: string) {
  const sessions = campaign.sessions.map((session) => {
    const policies = reviews
      .filter((r) => r.session === session)
      .map((review) => {
        const row = review.criteria.find((c) => c.criterion === criterion)!;
        return {
          policy: review.policy,
          observations: row.samples,
          candidate: { ...row.candidate },
          pairedDifference: policyDifference(row),
          uncertain: row.transitions.filter((r) => r.baseline === 'uncertain' || r.candidate === 'uncertain')
            .length,
          reviewerInconsistencies: row.discordantUnchanged,
        };
      });
    const differences = policies.map((row) => row.pairedDifference);
    return {
      session,
      policies,
      pairedDifference: differences.some((value) => value === null) ? null : mean(differences as number[]),
    };
  });
  const differences = sessions.map((row) => row.pairedDifference);
  return {
    criterion,
    observations: sessions.flatMap((s) => s.policies).reduce((sum, p) => sum + p.observations, 0),
    unresolvedSessions: differences.filter((value) => value === null).length,
    meanPairedDifference: differences.some((value) => value === null) ? null : mean(differences as number[]),
    sessions,
  };
}

/** Rebuild every receipt; never drop missing or uncertain units to improve the reported result. */
export function summarizeQualityCampaign(
  catalog: PrintedCardCatalog,
  campaignInput: unknown,
  reviewsInput: unknown,
  runtime: unknown,
) {
  const campaign = readQualityCampaign(catalog, campaignInput, runtime);
  const reviews = readReviews(catalog, campaign, reviewsInput, runtime);
  const body = {
    version: 'legacy-cube-quality-summary/v1',
    campaign: campaign.sha256,
    split: campaign.request.split,
    origin: 'model' as const,
    independentHumanEvidence: false as const,
    adoptionEligible: false as const,
    independentSessions: campaign.sessions.length,
    policyUnits: campaign.units.length,
    comparisons: reviews.map((r) => r.sha256),
    criteria: campaign.protocol.criteria.map((criterion) => summarizeCriterion(campaign, reviews, criterion)),
    limitations: [
      'model-judgment-not-independent-validation',
      'reservation-not-checked',
      'no-confidence-interval-or-adoption-decision',
      'unresolved-units-not-dropped',
      'no-gameplay-evidence',
    ],
  };
  return { ...body, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}
