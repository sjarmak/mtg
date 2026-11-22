/** Once-only offline reviews. Interrupted attempts are evidence gaps, never automatic re-samples. */
import { join } from 'node:path';
import { z } from 'zod';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { readQualityReviewTasks } from './quality-bundle';
import { recordDeckReviewEvidence } from './deck-review-evidence';
import { recordAdviceReviewEvidence } from './advice-review';
import { ModelEvidenceProvenanceSchema } from './model-evidence';

import { runReviewBatch } from './review-batch';
import type { QualityReviewer } from './review-batch';
export type { QualityReviewer } from './review-batch';
const pathsSchema = z
  .object({
    bundle: z.string().min(1).max(4096),
    ledger: z.string().min(1).max(4096),
    maxCalls: z.number().int().min(0).max(500000),
  })
  .strict();
type Subject = Awaited<ReturnType<typeof readQualityReviewTasks>>['tasks'][number];

function receiptFor(
  catalog: PrintedCardCatalog,
  subject: Subject,
  input: unknown,
  model: string,
  runtime: string,
) {
  const result = z
    .object({ response: z.unknown(), provenance: ModelEvidenceProvenanceSchema })
    .strict()
    .parse(input);
  if (result.provenance.requestedModel !== model || result.provenance.generatorRuntimeSha256 !== runtime)
    throw new Error('Reviewer provenance differs from frozen model or runtime');
  const record =
    subject.task.version === 'legacy-cube-deck-review-task/v1'
      ? recordDeckReviewEvidence
      : recordAdviceReviewEvidence;
  return record(catalog, subject.task, result.response, result.provenance);
}

/** The ledger determines output locations so changing --out cannot re-sample a campaign. */
export async function runQualityReviews(
  input: unknown,
  catalog: PrintedCardCatalog,
  runtime: string,
  reviewer: QualityReviewer,
) {
  const paths = pathsSchema.parse(input);
  const catalogSnapshot = structuredClone(catalog);
  const model = z.string().trim().min(1).max(200).parse(reviewer.model);
  const frozenReviewer = { model, review: reviewer.review.bind(reviewer) };
  const { campaign, tasks } = await readQualityReviewTasks(
    paths.bundle,
    paths.ledger,
    catalogSnapshot,
    runtime,
  );
  const root = join(paths.ledger, `reviews-${campaign.sha256}`);
  const result = await runReviewBatch({
    root,
    configuration: { version: 'legacy-cube-quality-run/v1', campaign: campaign.sha256, model, runtime },
    tasks,
    maxCalls: paths.maxCalls,
    reviewer: frozenReviewer,
    receiptFor: (subject, raw) => receiptFor(catalogSnapshot, subject, raw, model, runtime),
  });
  return { campaign: campaign.sha256, ...result };
}
