/** Grounded paired judgments, not independent human evidence or adoption authority. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { readQualityReviewPair } from './quality-pair';
import { recordDeckReviewEvidence } from './deck-review-evidence';
import { readAdviceReviewEvidence } from './advice-review';

const armSchema = z.object({ deck: z.unknown(), advice: z.array(z.unknown()).length(6) }).strict();
type Pair = ReturnType<typeof readQualityReviewPair>;
type Verdict = { criterion: string; assessment: 'pass' | 'fail' | 'uncertain' };

function readArm(
  catalog: PrintedCardCatalog,
  input: z.infer<typeof armSchema>,
  expected: Pair['baseline'],
  runtime: string,
) {
  const fields = z
    .object({ task: z.unknown(), judgment: z.unknown(), provenance: z.unknown() })
    .parse(input.deck);
  const deck = recordDeckReviewEvidence(catalog, fields.task, fields.judgment, fields.provenance);
  if (!isDeepStrictEqual(input.deck, deck)) throw new Error('Modified deck review receipt');
  const advice = input.advice.map((receipt) => readAdviceReviewEvidence(catalog, receipt));
  if (
    deck.task.sha256 !== expected.deck.sha256 ||
    advice.some((r, i) => r.task.sha256 !== expected.advice[i]!.sha256)
  )
    throw new Error('Quality review task does not belong to this arm/stage');
  if ([deck, ...advice].some((r) => r.provenance.generatorRuntimeSha256 !== runtime))
    throw new Error('Quality review receipt runtime mismatch');
  return { deck, advice };
}

function counts(rows: readonly Verdict[]) {
  return {
    pass: rows.filter((row) => row.assessment === 'pass').length,
    fail: rows.filter((row) => row.assessment === 'fail').length,
    uncertain: rows.filter((row) => row.assessment === 'uncertain').length,
  };
}

/** Consumers must reconstruct criteria and flags rather than trust an edited report. */
export function readQualityComparison(
  catalog: PrintedCardCatalog,
  pair: unknown,
  input: unknown,
  runtime: unknown,
) {
  const evidence = z.object({ baseline: armSchema, candidate: armSchema }).parse(input);
  const canonical = compareQualityReviewPair(catalog, pair, evidence, runtime);
  if (!isDeepStrictEqual(input, canonical))
    throw new Error('Quality comparison differs from canonical review');
  return canonical;
}

function compareCriteria(baseline: ReturnType<typeof readArm>, candidate: ReturnType<typeof readArm>) {
  const rows = (arm: typeof baseline) => [
    ...arm.deck.judgment.criteria.map((row) => ({ ...row, subject: arm.deck.task.payload })),
    ...arm.advice.flatMap((receipt) =>
      receipt.judgment.criteria.map((row) => ({ ...row, subject: receipt.task.payload })),
    ),
  ];
  return [
    'coherence',
    'castability',
    'pool-alternatives',
    'explanation-accuracy',
    'exploration-usefulness',
  ].map((criterion) => {
    const before = rows(baseline).filter((row) => row.criterion === criterion);
    const after = rows(candidate).filter((row) => row.criterion === criterion);
    const transitions = before.map((row, index) => ({
      baseline: row.assessment,
      candidate: after[index]!.assessment,
      subjectChanged: !isDeepStrictEqual(row.subject, after[index]!.subject),
    }));
    return {
      criterion,
      samples: before.length,
      baseline: counts(before),
      candidate: counts(after),
      transitions,
      discordantUnchanged: transitions.filter((row) => !row.subjectChanged && row.baseline !== row.candidate)
        .length,
    };
  });
}

/** Equal stage weights within one session; replicas/stages are not independent sample units. */
export function compareQualityReviewPair(
  catalog: PrintedCardCatalog,
  pairInput: unknown,
  evidenceInput: unknown,
  runtimeInput: unknown,
) {
  const pair = readQualityReviewPair(catalog, pairInput, runtimeInput);
  const evidence = z.object({ baseline: armSchema, candidate: armSchema }).strict().parse(evidenceInput);
  const baseline = readArm(catalog, evidence.baseline, pair.baseline, pair.request.runtimeSha256);
  const candidate = readArm(catalog, evidence.candidate, pair.candidate, pair.request.runtimeSha256);
  const body = {
    version: 'legacy-cube-quality-comparison/v1',
    pair: pair.sha256,
    session: pair.session,
    split: pair.request.split,
    policy: pair.request.policy,
    origin: 'model' as const,
    independentHumanEvidence: false as const,
    adoptionEligible: false as const,
    baseline,
    candidate,
    criteria: compareCriteria(baseline, candidate),
    limitations: [
      'model-judgment-not-independent-validation',
      'semantic-accuracy-not-mechanically-proven',
      'uncertain-is-not-a-failure-or-improvement',
      'one-session-not-independent-stage-samples',
      'holdout-reservation-not-checked',
      'no-gameplay-evidence',
    ],
  };
  return { ...body, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}
