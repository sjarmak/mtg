/** Constrain references mechanically; strategic judgments remain the reviewer's decision. */
import { z } from 'zod';
import { AdviceReviewJudgmentSchema } from './advice-review';
import { DeckReviewJudgmentSchema } from './deck-review';
import type { buildQualityReviewPair } from './quality-pair';

type Arm = ReturnType<typeof buildQualityReviewPair>['baseline'];
type Task = Arm['deck'] | Arm['advice'][number];

const references = (ids: readonly string[], maximum: number) =>
  ids.length === 0 ? z.array(z.string()).max(0) : z.array(z.enum(ids)).max(maximum);

/** This shapes model output, not task admission; canonical reconstruction still validates receipts. */
export function qualityJudgmentSchema(task: Task) {
  const taskSha256 = z.enum([task.sha256]);
  const payload = task.payload;
  if ('pool' in payload) {
    const criterion = DeckReviewJudgmentSchema.shape.criteria.element.extend({
      cards: references(
        payload.pool.map((card) => card.physicalId),
        45,
      ),
    });
    return DeckReviewJudgmentSchema.extend({ taskSha256, criteria: z.array(criterion).length(3) });
  }
  const criterion = AdviceReviewJudgmentSchema.shape.criteria.element.extend({
    cards: references(
      payload.context.observedCards.map((card) => card.physicalId),
      600,
    ),
    claims: references(
      payload.advice.claims.map((claim) => claim.id),
      100,
    ),
    archetypes: references(
      payload.advice.paths.map((path) => path.id),
      17,
    ),
  });
  return AdviceReviewJudgmentSchema.extend({ taskSha256, criteria: z.array(criterion).length(2) });
}
