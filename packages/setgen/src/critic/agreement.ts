/**
 * Joining the playtester's adjudication to the critic's verdicts, and the kappa
 * this bead exists to publish once both are real.
 *
 * This module is the one place allowed to read both files — deliberately,
 * because computing agreement is the only reason to ever hold both at once.
 * `tools/adjudicate.ts` never imports this module.
 */
import type { RatingPair } from './kappa';
import { cohensKappa } from './kappa';
import type { AdjudicationFile, VerdictsFile } from './records';
import type { FaithfulnessCriterion } from './rubric';

export type AgreementCriterion = FaithfulnessCriterion | 'overall';

interface LabeledPair extends RatingPair {
  readonly criterion: AgreementCriterion;
}

/**
 * One rating pair per (item, criterion) both files answered. A criterion the
 * human answered that the critic's verdict does not name — a stale verdict
 * run against a rubric that has since changed, or a failed critic call — is
 * skipped here and surfaced by `summarizeAgreement`'s `skipped` list instead
 * of silently missing from the count.
 */
function buildLabeledPairs(adjudication: AdjudicationFile, verdicts: VerdictsFile): LabeledPair[] {
  const verdictsBySlot = new Map(verdicts.results.map((result) => [result.slotId, result]));
  const pairs: LabeledPair[] = [];

  for (const answer of adjudication.answers) {
    const verdict = verdictsBySlot.get(answer.slotId);
    if (verdict?.criteria === undefined || verdict.overall === undefined) continue;

    const criticByCriterion = new Map(verdict.criteria.map((item) => [item.criterion, item.label]));
    for (const humanCriterion of answer.criteria) {
      const criticLabel = criticByCriterion.get(humanCriterion.criterion);
      if (criticLabel === undefined) continue;
      pairs.push({
        itemId: `${answer.slotId}:${humanCriterion.criterion}`,
        criterion: humanCriterion.criterion,
        a: humanCriterion.label,
        b: criticLabel,
      });
    }
    pairs.push({
      itemId: `${answer.slotId}:overall`,
      criterion: 'overall',
      a: answer.overall.label,
      b: verdict.overall.label,
    });
  }
  return pairs;
}

/** Slot ids the playtester answered that the critic never produced a usable verdict for. */
function unmatchedSlotIds(adjudication: AdjudicationFile, verdicts: VerdictsFile): readonly string[] {
  const verdictsBySlot = new Map(verdicts.results.map((result) => [result.slotId, result]));
  return adjudication.answers
    .filter((answer) => {
      const verdict = verdictsBySlot.get(answer.slotId);
      return verdict === undefined || verdict.criteria === undefined || verdict.overall === undefined;
    })
    .map((answer) => answer.slotId);
}

export interface AgreementSummary {
  /** κ per criterion, including the `overall` pseudo-criterion. */
  readonly perCriterion: ReadonlyMap<AgreementCriterion, ReturnType<typeof cohensKappa>>;
  /** κ pooling every criterion and `overall` together into one set of pairs. */
  readonly aggregate: ReturnType<typeof cohensKappa>;
  readonly matchedItems: number;
  /** Answered by the playtester but the critic produced no usable verdict for; not counted above. */
  readonly unmatchedSlotIds: readonly string[];
}

export function summarizeAgreement(adjudication: AdjudicationFile, verdicts: VerdictsFile): AgreementSummary {
  const pairs = buildLabeledPairs(adjudication, verdicts);
  if (pairs.length === 0) {
    throw new Error(
      'no (item, criterion) pair matched between the adjudication file and the verdicts file: ' +
        'nothing to compute agreement over yet',
    );
  }

  const byCriterion = new Map<AgreementCriterion, LabeledPair[]>();
  for (const pair of pairs) {
    const group = byCriterion.get(pair.criterion);
    if (group === undefined) byCriterion.set(pair.criterion, [pair]);
    else group.push(pair);
  }

  const perCriterion = new Map(
    [...byCriterion.entries()].map(([criterion, group]) => [criterion, cohensKappa(group)] as const),
  );

  return {
    perCriterion,
    aggregate: cohensKappa(pairs),
    matchedItems: new Set(pairs.map((pair) => pair.itemId.split(':')[0])).size,
    unmatchedSlotIds: unmatchedSlotIds(adjudication, verdicts),
  };
}
