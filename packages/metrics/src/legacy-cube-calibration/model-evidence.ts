/** Offline response receipts. Structural validity is not strategic validation. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { buildModelReviewTask, ModelReviewCoordinatesSchema, parseModelJudgment } from './model-review';

const id = z.string().trim().min(1).max(200);
const taskInputSchema = z.object({
  coordinates: ModelReviewCoordinatesSchema,
  payload: z.object({
    picks: z.array(id).max(44),
    observations: z
      .array(
        z.object({
          round: z.number().int().min(1).max(3),
          pickNumber: z.number().int().min(1).max(15),
          cards: z.array(id).min(1).max(15),
        }),
      )
      .min(1)
      .max(45),
  }),
});
export const ModelEvidenceProvenanceSchema = z
  .object({
    provider: z.literal('codex-cli'),
    authentication: z.literal('chatgpt-oauth'),
    cliVersion: id,
    requestedModel: id.nullable(),
    resolvedModel: id.nullable(),
    runId: id,
    completedAt: z.string().datetime(),
    generatorRuntimeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export function readCanonicalModelTask(catalog: PrintedCardCatalog, input: unknown) {
  const parsed = taskInputSchema.parse(input);
  const resolve = (physicalId: string) => {
    const card = catalog.cards.find((c) => c.physicalId === physicalId);
    if (!card) throw new Error(`Unknown imported card ${physicalId}`);
    return card;
  };
  const task = buildModelReviewTask(
    catalog,
    {
      seats: 8,
      rounds: 3,
      packSize: 15,
      picks: parsed.payload.picks,
      observations: parsed.payload.observations.map((o) => ({ ...o, cards: o.cards.map(resolve) })),
    },
    parsed.coordinates,
  );
  // Also rejects extra fields, fabricated Oracle data, wrong hashes, and changed instructions.
  if (!isDeepStrictEqual(input, task)) throw new Error('Imported task differs from canonical catalog task');
  return task;
}

export function recordModelEvidence(
  catalog: PrintedCardCatalog,
  taskInput: unknown,
  response: unknown,
  provenanceInput: unknown,
) {
  const task = readCanonicalModelTask(catalog, taskInput);
  const result = parseModelJudgment(task, response);
  const provenance = ModelEvidenceProvenanceSchema.parse(provenanceInput);
  const body = {
    version: 'legacy-cube-model-evidence/v1',
    ...result,
    task,
    provenance,
    adoptionEligible: false as const,
    limitations: [
      'operator-asserted-provenance',
      'strategic-truth-unmeasured',
      'model-independence-unmeasured',
      ...(provenance.resolvedModel === null ? ['unreported-model-version'] : []),
    ],
  };
  return { ...body, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}

/** Check stored receipts again, including their claimed origin and content digest. */
export function readModelEvidence(catalog: PrintedCardCatalog, input: unknown) {
  const fields = z.object({ task: z.unknown(), judgment: z.unknown(), provenance: z.unknown() }).parse(input);
  const receipt = recordModelEvidence(catalog, fields.task, fields.judgment, fields.provenance);
  if (!isDeepStrictEqual(input, receipt)) throw new Error('Modified model evidence receipt');
  return receipt;
}
