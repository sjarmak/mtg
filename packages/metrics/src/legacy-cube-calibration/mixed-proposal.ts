/** Tuning diagnostics select a candidate; only a separate held-out review can support adoption. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LEGACY_CUBE_ADVISOR_MODEL, parseAdvisorWeights } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { auditMixedEvidence } from './mixed-evidence';
import { selectTuningCandidate } from './tuning';
import { readModelEvidence } from './model-evidence';
import { compareModelEvidence } from './model-comparison';
import { proposeCalibrationWeights } from './proposals';
import { buildQualityCampaign } from './quality-ledger';

const requestSchema = z
  .object({
    root: z.string().trim().min(1).max(256),
    indices: z.array(z.number().int().nonnegative()).min(1).max(1000),
    runtimeSha256: z.string().regex(/^[a-f0-9]{64}$/),
    baseline: z.unknown().transform(parseAdvisorWeights),
    step: z.number().finite().positive().max(1),
  })
  .strict();

export function buildMixedProposalCampaign(
  catalog: PrintedCardCatalog,
  corpus: unknown,
  modelInput: unknown,
  requestInput: unknown,
) {
  const request = requestSchema.parse(requestInput);
  const context = auditMixedEvidence(corpus, catalog, 'tuning', request.baseline);
  const human = selectTuningCandidate(corpus, catalog, request.baseline, request.step);
  const receipts = z
    .array(z.unknown())
    .max(10000)
    .parse(modelInput)
    .map((input) => readModelEvidence(catalog, input));
  if (receipts.some((receipt) => receipt.task.coordinates.split !== 'tuning'))
    throw new Error('Cannot tune using holdout model evidence');
  if (receipts.some((receipt) => receipt.provenance.generatorRuntimeSha256 !== request.runtimeSha256))
    throw new Error('Model tuning evidence runtime mismatch');
  const candidates = proposeCalibrationWeights(request.baseline, request.step).map((weights, index) => ({
    weights,
    humanAgreement: human.candidates[index]?.agreement ?? null,
    modelAgreement: receipts.length
      ? compareModelEvidence(catalog, receipts, 'tuning', request.baseline, weights).candidate.agreement
      : null,
  }));
  // Never trade measured human agreement for model agreement. Baseline wins complete ties.
  const winner = candidates.reduce((best, candidate) => {
    if (candidate.humanAgreement !== best.humanAgreement)
      return (candidate.humanAgreement ?? -1) > (best.humanAgreement ?? -1) ? candidate : best;
    return (candidate.modelAgreement ?? -1) > (best.modelAgreement ?? -1) ? candidate : best;
  });
  const campaign = buildQualityCampaign(catalog, {
    root: request.root,
    split: 'holdout',
    indices: request.indices,
    policies: [
      'current',
      'flexible',
      'pivot',
      ...LEGACY_CUBE_ADVISOR_MODEL.archetypes.map((path) => `pin:${path.id}`),
    ],
    baseline: request.baseline,
    candidate: winner.weights,
    runtimeSha256: request.runtimeSha256,
  });
  if (
    receipts.some((receipt) => campaign.sessions.includes(receipt.task.coordinates.session)) ||
    context.cases.some((entry) => campaign.sessions.includes(entry.original.source.session))
  )
    throw new Error('Tuning session overlaps proposed holdout campaign');
  const body = {
    version: 'legacy-cube-mixed-proposal/v1',
    status:
      winner.humanAgreement === null && winner.modelAgreement === null
        ? 'insufficient-evidence'
        : winner === candidates[0]
          ? 'baseline-retained'
          : 'candidate-proposed',
    selected: winner.weights,
    adoptionEligible: false as const,
    context,
    modelReceipts: receipts.map((receipt) => receipt.sha256).sort(),
    candidates,
    campaign,
    limitations: [
      'model-agreement-is-not-deck-quality',
      'adjacent-decks-are-context-not-pick-labels',
      'human-authorship-not-mechanically-verified',
      'fresh-held-out-quality-review-required',
      'renamed-session-provenance-not-mechanically-proven',
    ],
  };
  return { ...body, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}
