import { expect, it } from 'vitest';
import catalog from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { evaluateDraft } from '../src/advisor/evaluate';
import { LEGACY_CUBE_ADVISOR_MODEL as model } from '../src/advisor/legacy';
import { DEFAULT_ADVISOR_WEIGHTS, parseAdvisorWeights } from '../src/advisor/weights';
import type { ObservedDraft } from '../src/advisor/state';

const state: ObservedDraft = {
  seats: 8,
  rounds: 3,
  packSize: 15,
  picks: [],
  observations: [{ round: 1, pickNumber: 1, cards: catalog.cards.slice(0, 15) }],
};

it('records complete versioned weights and preserves default recommendations', () => {
  const implicit = evaluateDraft(state, model);
  const explicit = evaluateDraft(state, { ...model, weights: DEFAULT_ADVISOR_WEIGHTS });
  expect(implicit).toEqual(explicit);
  expect(implicit.weights).toEqual(DEFAULT_ADVISOR_WEIGHTS);
  expect(Object.isFrozen(DEFAULT_ADVISOR_WEIGHTS)).toBe(true);
});

it('changes only the requested scoring contribution without changing observed evidence', () => {
  const original = evaluateDraft(state, model);
  const weights = { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'test-quality', quality: 2 };
  const candidate = evaluateDraft(state, { ...model, weights });
  expect(candidate.memory).toEqual(original.memory);
  expect(candidate.archetypes).toEqual(original.archetypes);
  for (const [index, card] of candidate.cards.entries()) {
    const prior = original.cards[index]!;
    const quality = model.profilesByName!.get(card.card.correctedName)!.quality;
    expect(card.flexibleScore - prior.flexibleScore).toBeCloseTo(quality);
    expect(card.reasons).toEqual(prior.reasons);
    expect(card.liabilities).toEqual(prior.liabilities);
  }
  weights.quality = 3;
  expect(candidate.weights.quality).toBe(2);
});

it.each([NaN, Infinity, -1, 5, '1', null])('refuses invalid calibration coefficients: %s', (quality) => {
  expect(() => parseAdvisorWeights({ ...DEFAULT_ADVISOR_WEIGHTS, quality })).toThrow();
});

it('rejects incomplete, unknown-version and extra-field proposals before evaluation', () => {
  expect(() => parseAdvisorWeights({ revision: 'missing' })).toThrow();
  expect(() => parseAdvisorWeights({ ...DEFAULT_ADVISOR_WEIGHTS, schemaVersion: 2 })).toThrow();
  expect(() => parseAdvisorWeights({ ...DEFAULT_ADVISOR_WEIGHTS, hiddenPackBonus: 1 })).toThrow();
  expect(() =>
    evaluateDraft(state, {
      ...model,
      weights: { ...DEFAULT_ADVISOR_WEIGHTS, quality: NaN },
    }),
  ).toThrow();
});
