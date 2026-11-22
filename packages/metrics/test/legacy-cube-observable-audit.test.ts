import { expect, it } from 'vitest';
import { evaluateDraft, LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import catalog from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { auditObservableAdvice } from '../src/legacy-cube-calibration/observable-audit';

const observed = {
  seats: 8,
  rounds: 3,
  packSize: 15,
  picks: [],
  observations: [{ round: 1, pickNumber: 1, cards: catalog.cards.slice(0, 15) }],
};
const model = LEGACY_CUBE_ADVISOR_MODEL;
const advice = evaluateDraft(observed, model);
const audit = (value: typeof advice) => auditObservableAdvice(observed, value, model);

it('checks observable references and all authored paths without claiming strategic truth', () => {
  expect(audit(advice)).toMatchObject({ passed: true, violations: [], strategicTruth: 'unmeasured' });
});

it('detects unseen recommendation cards and reason references', () => {
  const hidden = catalog.cards[100]!;
  const result = audit({
    ...advice,
    recommendations: [
      {
        ...advice.recommendations[0]!,
        card: hidden,
        reasons: [{ code: 'test', text: 'Invented', polarity: 'positive', cards: [hidden.physicalId] }],
      },
    ],
  });
  expect(result.violations.map((v) => v.code)).toEqual(
    expect.arrayContaining(['unavailable-recommendation', 'unobserved-reference']),
  );
});

it('detects false observation timestamps, omitted paths, and pool claims about undrafted cards', () => {
  const path = advice.archetypes[0]!;
  const result = audit({
    ...advice,
    archetypes: [
      {
        ...path,
        contributors: [catalog.cards[0]!.physicalId],
        openness: {
          ...path.openness,
          observations: [
            {
              code: 'late-card',
              text: 'Wrong time',
              polarity: 'positive',
              cards: [catalog.cards[0]!.physicalId],
              round: 1,
              pickNumber: 7,
            },
          ],
        },
      },
    ],
  });
  expect(result.violations.map((v) => v.code)).toEqual(
    expect.arrayContaining(['path-roster-mismatch', 'undrafted-pool-reference', 'unobserved-timestamp']),
  );
});

it('checks nested card explanations and missing or surplus piece counts', () => {
  const path = advice.archetypes.find((p) => p.pieces.length)!;
  const piece = { ...path.pieces[0]!, count: 1, cards: [] };
  const card = advice.cards[0]!;
  const result = audit({
    ...advice,
    archetypes: advice.archetypes.map((p) => (p.id === path.id ? { ...p, missing: [piece] } : p)),
    cards: [
      {
        ...card,
        liabilities: [
          { code: 'test', text: 'Hidden', polarity: 'negative', cards: [catalog.cards[100]!.physicalId] },
        ],
      },
    ],
  });
  expect(result.violations.map((v) => v.code)).toEqual(
    expect.arrayContaining(['piece-count-mismatch', 'unobserved-reference', 'pack-roster-mismatch']),
  );
});
