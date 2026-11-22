/** Adjacent-source interpretation is model evidence, never matched human validation. */
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import {
  buildTransferReviewTasks,
  recordTransferReviewEvidence,
  TransferJudgmentSchema,
} from './transfer-review';
import { ModelEvidenceProvenanceSchema } from './model-evidence';
import { runReviewBatch } from './review-batch';
import type { QualityReviewer } from './review-batch';

type Task = ReturnType<typeof buildTransferReviewTasks>[number];
const pathsSchema = z
  .object({
    ledger: z.string().min(1).max(4096),
    split: z.enum(['tuning', 'holdout']),
    maxCalls: z.number().int().min(0).max(500000),
  })
  .strict();
const references = (names: readonly string[]) =>
  names.length === 0 ? z.array(z.string()).max(0) : z.array(z.enum([...new Set(names)])).max(600);

function schemaOf(task: Task) {
  const original = task.payload.original;
  const source =
    original.kind === 'deck'
      ? original.cards.map((card) => card.name)
      : [...original.picks, ...original.observations.flatMap((observation) => observation.cards)];
  const lesson = TransferJudgmentSchema.shape.lessons.element.extend({
    sourceCards: references(source),
    cubeCards: references(task.payload.cube.map((card) => card.name)),
  });
  return z.toJSONSchema(
    TransferJudgmentSchema.extend({
      taskSha256: z.enum([task.sha256]),
      lessons: z.array(lesson).min(1).max(20),
    }),
  );
}

export async function runTransferReviews(
  input: unknown,
  corpus: unknown,
  catalog: PrintedCardCatalog,
  runtimeInput: string,
  reviewer: QualityReviewer,
) {
  const paths = pathsSchema.parse(input);
  const runtime = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(runtimeInput);
  const model = z.string().trim().min(1).max(200).parse(reviewer.model);
  const snapshot = { corpus: structuredClone(corpus), catalog: structuredClone(catalog) };
  const tasks = buildTransferReviewTasks(snapshot.corpus, snapshot.catalog, paths.split);
  if (tasks.length === 0) throw new Error('No adjacent human sources available for transfer review');
  // Identity excludes model/runtime so changing them cannot replace an earlier sample.
  const campaign = createHash('sha256')
    .update(JSON.stringify(tasks.map((task) => task.sha256)))
    .digest('hex');
  await mkdir(paths.ledger, { recursive: true });
  const result = await runReviewBatch({
    root: join(paths.ledger, `transfer-reviews-${campaign}`),
    configuration: { version: 'legacy-cube-transfer-run/v1', campaign, model, runtime },
    tasks: tasks.map((task) => ({
      task,
      schema: schemaOf(task),
      prompt: `${task.instructions}\nTask SHA-256: ${task.sha256}\n${JSON.stringify(task.payload)}\n`,
    })),
    maxCalls: paths.maxCalls,
    reviewer: { model, review: reviewer.review.bind(reviewer) },
    receiptFor: (subject, raw) => {
      const result = z
        .object({ response: z.unknown(), provenance: ModelEvidenceProvenanceSchema })
        .strict()
        .parse(raw);
      if (result.provenance.requestedModel !== model || result.provenance.generatorRuntimeSha256 !== runtime)
        throw new Error('Reviewer provenance differs from frozen model or runtime');
      return recordTransferReviewEvidence(
        snapshot.catalog,
        snapshot.corpus,
        subject.task,
        result.response,
        result.provenance,
      );
    },
  });
  return { campaign, ...result };
}
