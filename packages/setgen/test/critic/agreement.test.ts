/**
 * `summarizeAgreement`: the join between an adjudication file and a verdicts
 * file, and the kappa arithmetic applied to what joins.
 *
 * Every pair rated here is fabricated by this test file, to validate the JOIN
 * CODE only. It is never presented as, and must never be read as, a real
 * faithfulness measurement — that requires the playtester's genuine adjudication,
 * which does not exist in this session. See `mtg-bc2.152.9`.
 */
import { describe, expect, it } from 'vitest';
import { summarizeAgreement } from '../../src/critic/agreement';
import type { AdjudicationFile, VerdictsFile } from '../../src/critic/records';

/**
 * Three slots, A/B/C, built so each exercises a different join edge case:
 *  - A: every per-criterion answer has a matching critic criterion.
 *  - B: the critic call failed (no criteria/overall at all) -> unmatched.
 *  - C: the human answered a criterion the critic's verdict does not name
 *    (a rubric drift, or simply a differently-shaped call) -> that one
 *    per-criterion pair is skipped, but `overall` still joins.
 */
const adjudication: AdjudicationFile = {
  seed: 's',
  size: 3,
  answers: [
    {
      slotId: 'A',
      cardName: 'Card A',
      position: 1,
      criteria: [
        { criterion: 'mechanicIntent', label: 'faithful' },
        { criterion: 'roleIntent', label: 'partial' },
      ],
      overall: { label: 'faithful' },
      answeredAt: '2026-08-15T00:00:00.000Z',
    },
    {
      slotId: 'B',
      cardName: 'Card B',
      position: 2,
      criteria: [{ criterion: 'mechanicIntent', label: 'unfaithful' }],
      overall: { label: 'unfaithful' },
      answeredAt: '2026-08-15T00:00:00.000Z',
    },
    {
      slotId: 'C',
      cardName: 'Card C',
      position: 3,
      criteria: [{ criterion: 'noInvention', label: 'faithful' }],
      overall: { label: 'partial' },
      answeredAt: '2026-08-15T00:00:00.000Z',
    },
  ],
};

const verdicts: VerdictsFile = {
  seed: 's',
  size: 3,
  recordedAt: '2026-08-15T00:00:00.000Z',
  results: [
    {
      slotId: 'A',
      cardName: 'Card A',
      position: 1,
      criteria: [
        { criterion: 'mechanicIntent', label: 'faithful', reason: 'r' },
        { criterion: 'roleIntent', label: 'faithful', reason: 'r' },
      ],
      overall: { label: 'faithful', reason: 'r' },
    },
    {
      slotId: 'B',
      cardName: 'Card B',
      position: 2,
      error: 'the model never produced a schema-valid answer',
    },
    {
      slotId: 'C',
      cardName: 'Card C',
      position: 3,
      // Names a different criterion than the human answered: the
      // `noInvention` pair is unjoinable, `overall` still is.
      criteria: [{ criterion: 'roleIntent', label: 'faithful', reason: 'r' }],
      overall: { label: 'partial', reason: 'r' },
    },
  ],
};

describe('summarizeAgreement', () => {
  const summary = summarizeAgreement(adjudication, verdicts);

  it('marks the failed critic call unmatched, and only that one', () => {
    expect(summary.unmatchedSlotIds).toStrictEqual(['B']);
  });

  it('counts matched items as the slots that joined on at least one pair', () => {
    // A joins on mechanicIntent, roleIntent and overall; C joins on overall
    // only (noInvention has no critic counterpart); B joins on nothing.
    expect(summary.matchedItems).toBe(2);
  });

  it('computes per-criterion kappa only from criteria that joined', () => {
    const mechanicIntent = summary.perCriterion.get('mechanicIntent');
    expect(mechanicIntent?.n).toBe(1);
    expect(mechanicIntent?.observedAgreement).toBe(1);
    expect(mechanicIntent?.kappa).toBe(1); // p_e = 1 degenerate case, both raters said "faithful"

    const roleIntent = summary.perCriterion.get('roleIntent');
    expect(roleIntent?.n).toBe(1);
    expect(roleIntent?.observedAgreement).toBe(0);
    expect(roleIntent?.kappa).toBe(0);

    expect(summary.perCriterion.has('noInvention')).toBe(false);
  });

  it('computes overall kappa from both slots that carried a full verdict', () => {
    const overall = summary.perCriterion.get('overall');
    expect(overall?.n).toBe(2);
    expect(overall?.observedAgreement).toBe(1);
    expect(overall?.kappa).toBeCloseTo(1, 10);
  });

  it('pools every joined pair into one aggregate figure', () => {
    // 4 pairs total: mechanicIntent match, roleIntent mismatch, two overall
    // matches. p_o = 3/4 = 0.75; p_e = 0.5*0.75 + 0.5*0.25 = 0.5;
    // kappa = (0.75 - 0.5) / (1 - 0.5) = 0.5.
    expect(summary.aggregate.n).toBe(4);
    expect(summary.aggregate.observedAgreement).toBeCloseTo(0.75, 10);
    expect(summary.aggregate.expectedAgreement).toBeCloseTo(0.5, 10);
    expect(summary.aggregate.kappa).toBeCloseTo(0.5, 10);
  });

  it('refuses to compute anything when nothing joins', () => {
    const noOverlap: AdjudicationFile = {
      seed: 's',
      size: 1,
      answers: [
        {
          slotId: 'Z',
          cardName: 'Card Z',
          position: 1,
          criteria: [{ criterion: 'mechanicIntent', label: 'faithful' }],
          overall: { label: 'faithful' },
          answeredAt: '2026-08-15T00:00:00.000Z',
        },
      ],
    };
    const noVerdicts: VerdictsFile = {
      seed: 's',
      size: 1,
      recordedAt: '2026-08-15T00:00:00.000Z',
      results: [],
    };
    expect(() => summarizeAgreement(noOverlap, noVerdicts)).toThrow(/nothing to compute agreement over/);
  });
});
