/**
 * What `concentrated` measures, on a sheet that is not uniform.
 *
 * A collation sheet is a weighted bag: the sampler draws a card at
 * `weight / totalWeight`, so the honest answer to "how much more often does a
 * card off this slot repeat" is the ratio of the weights, not the ratio of the
 * distinct-card counts. The two agree exactly when every weight is one, which is
 * what the shared five-position fixture is, and that is why the first version of
 * this check shipped counting cards and no test could see it.
 *
 * Both cases below are sheets where the two ratios disagree, and they disagree in
 * opposite directions, so a check that reads either quantity alone fails one of
 * them.
 */
import { describe, expect, it } from 'vitest';
import {
  SLOT_CONCENTRATION_THRESHOLD,
  buildPartialExecutableReferenceSet,
  type ReducedSlotFinding,
} from '@mtg/data';
import { UUID, corpus, withRefusedRed } from './fixtures/reduced-reference-set';

/**
 * The shared fixture with the two-card common sheet reweighted. Position 3 is
 * the one the evidence refuses, so `kept` is the weight that survives and
 * `dropped` is the weight that leaves.
 */
function withCommonWeights(kept: number, dropped: number): unknown {
  const reference = structuredClone(corpus()) as {
    sets: {
      draftBooster: { sheets: Record<string, { cards: Record<string, number>; totalWeight: number }> };
    }[];
  };
  const set = reference.sets[0];
  if (set === undefined) throw new Error('fixture set missing');
  const sheet = set.draftBooster.sheets.common;
  if (sheet === undefined) throw new Error('fixture common sheet missing');
  sheet.cards = { [UUID(2)]: kept, [UUID(3)]: dropped };
  sheet.totalWeight = kept + dropped;
  return reference;
}

const concentrationOf = (findings: readonly ReducedSlotFinding[], sheet: string): number | null => {
  const found = findings.find((finding) => finding.kind === 'concentrated' && finding.sheet === sheet);
  return found?.kind === 'concentrated' ? found.concentration : null;
};

describe('a concentrated slot is measured in weight', () => {
  it('does not report a doubling when the surviving card barely gained', () => {
    // Two cards of four survive in card-count terms, which is the shape that
    // reads as a doubling; in weight terms the card a drafter opens went from
    // 100/102 to 100/100, which is 1.02 times as likely.
    const reduced = buildPartialExecutableReferenceSet(withCommonWeights(100, 2), withRefusedRed());
    const sheet = reduced.collation.sheets.find((candidate) => candidate.name === 'common');

    expect([sheet?.sourceCards, sheet?.cards]).toEqual([2, 1]);
    expect([sheet?.sourceTotalWeight, sheet?.totalWeight]).toEqual([102, 100]);
    expect(concentrationOf(reduced.collation.slotFindings, 'common')).toBe(null);
  });

  it('reports the weight ratio rather than the card ratio when both would fire', () => {
    const reduced = buildPartialExecutableReferenceSet(withCommonWeights(1, 9), withRefusedRed());

    // Card counts would say 2; the sampler says the survivor is ten times as
    // likely, and ten is what the reader is told.
    expect(concentrationOf(reduced.collation.slotFindings, 'common')).toBe(10);
  });

  it('holds the policy boundary at two rather than at the value that rounds to two', () => {
    // 399 weight over 200 is 1.995, which `toFixed(2)` renders as "2.00". The
    // comparison runs on the exact ratio, so this slot is under the line.
    const under = buildPartialExecutableReferenceSet(withCommonWeights(200, 199), withRefusedRed());
    expect(concentrationOf(under.collation.slotFindings, 'common')).toBe(null);

    // One more unit of dropped weight puts it over, so the boundary is a real
    // edge and not an absence of findings on this fixture.
    const over = buildPartialExecutableReferenceSet(withCommonWeights(200, 200), withRefusedRed());
    expect(concentrationOf(over.collation.slotFindings, 'common')).toBe(SLOT_CONCENTRATION_THRESHOLD);
  });
});
