/** Import model deck reviews without trusting supplied card facts or claimed validation. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { buildDeckReviewTask, parseDeckReviewJudgment } from './deck-review';
import { ModelEvidenceProvenanceSchema } from './model-evidence';

export function recordDeckReviewEvidence(
  catalog: PrintedCardCatalog,
  taskInput: unknown,
  response: unknown,
  provenanceInput: unknown,
) {
  const imported = z
    .object({
      coordinates: z.unknown(),
      payload: z.object({
        pool: z.array(z.object({ physicalId: z.string() })).length(45),
        deck: z.object({ selected: z.unknown(), basics: z.unknown() }),
      }),
    })
    .parse(taskInput);
  const task = buildDeckReviewTask(
    catalog,
    {
      pool: imported.payload.pool.map((card) => card.physicalId),
      ...imported.payload.deck,
    },
    imported.coordinates,
  );
  if (!isDeepStrictEqual(taskInput, task)) throw new Error('Imported deck task differs from canonical task');
  const result = parseDeckReviewJudgment(task, response);
  const provenance = ModelEvidenceProvenanceSchema.parse(provenanceInput);
  const body = {
    version: 'legacy-cube-deck-review-evidence/v1',
    ...result,
    task,
    provenance,
    limitations: [
      ...result.limitations,
      'operator-asserted-provenance',
      'model-independence-unmeasured',
      ...(provenance.resolvedModel === null ? ['unreported-model-version'] : []),
    ],
  };
  return { ...body, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}
