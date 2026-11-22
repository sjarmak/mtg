import { expect, it } from 'vitest';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import { proposeCalibrationWeights } from '../src/legacy-cube-calibration/proposals';

it('enumerates a deterministic bounded neighborhood with the baseline first', () => {
  const candidates = proposeCalibrationWeights(DEFAULT_ADVISOR_WEIGHTS);
  expect(candidates).toHaveLength(21);
  expect(candidates[0]).toEqual(DEFAULT_ADVISOR_WEIGHTS);
  expect(proposeCalibrationWeights(DEFAULT_ADVISOR_WEIGHTS)).toEqual(candidates);
  for (const candidate of candidates.slice(1)) {
    const changed = Object.entries(candidate).filter(
      ([key, value]) =>
        key !== 'revision' && value !== DEFAULT_ADVISOR_WEIGHTS[key as keyof typeof candidate],
    );
    expect(changed).toHaveLength(1);
    expect([0.75, 1.25]).toContain(changed[0]![1]);
    expect(candidate.revision).toMatch(/^proposal\/v1\/[a-f0-9]{64}$/);
    expect(Object.isFrozen(candidate)).toBe(true);
  }
});

it('skips out-of-range moves, copies inputs, and rejects invalid search parameters', () => {
  const baseline = { ...DEFAULT_ADVISOR_WEIGHTS, quality: 0, fixing: 4 };
  const candidates = proposeCalibrationWeights(baseline, 1);
  expect(candidates).toHaveLength(19);
  expect(candidates[0]).not.toBe(baseline);
  expect(baseline).toEqual({ ...DEFAULT_ADVISOR_WEIGHTS, quality: 0, fixing: 4 });
  for (const step of [0, -1, Infinity, NaN, 1.01]) {
    expect(() => proposeCalibrationWeights(baseline, step)).toThrow();
  }
  expect(() => proposeCalibrationWeights({ ...baseline, quality: 5 })).toThrow();
});
