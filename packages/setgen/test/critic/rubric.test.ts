/**
 * The rubric's structural half: which criteria apply to an entry, and whether
 * a verdict answered exactly the criteria it was asked. Neither function makes
 * a faithfulness judgment — see `../../src/critic/rubric.ts`'s docblock.
 */
import { describe, expect, it } from 'vitest';
import {
  coversExpectedCriteria,
  CRITERION_RUBRIC,
  criteriaFor,
  FAITHFULNESS_CRITERIA,
} from '../../src/critic/rubric';
import type { CriterionVerdict, FaithfulnessCriterion } from '../../src/critic/rubric';
import { testEntry } from './support';

function verdictItem(criterion: FaithfulnessCriterion): CriterionVerdict {
  return { criterion, label: 'faithful', reason: 'because' };
}

describe('criteriaFor', () => {
  it('judges only the three core criteria on a plain slot', () => {
    const entry = testEntry();
    expect(criteriaFor(entry, new Set())).toStrictEqual(['mechanicIntent', 'roleIntent', 'noInvention']);
  });

  it('adds requiredCardIntent when the slot carries a required card', () => {
    const entry = testEntry({
      requiredCard: {
        name: 'Test Required Card',
        flavorDirection: 'One line.',
        equipment: false,
        legendary: false,
      },
    });
    expect(criteriaFor(entry, new Set())).toStrictEqual([
      'mechanicIntent',
      'roleIntent',
      'noInvention',
      'requiredCardIntent',
    ]);
  });

  it('adds revisionIntent when the slot id is in the applied-revision set', () => {
    const entry = testEntry({ id: 'CU01' });
    expect(criteriaFor(entry, new Set(['CU01']))).toStrictEqual([
      'mechanicIntent',
      'roleIntent',
      'noInvention',
      'revisionIntent',
    ]);
  });

  it('adds both conditional criteria when both apply', () => {
    const entry = testEntry({
      id: 'CU01',
      requiredCard: {
        name: 'Test Required Card',
        flavorDirection: 'One line.',
        equipment: false,
        legendary: false,
      },
    });
    expect(criteriaFor(entry, new Set(['CU01']))).toStrictEqual(FAITHFULNESS_CRITERIA);
  });

  it('does not add revisionIntent for a slot id absent from the applied set', () => {
    const entry = testEntry({ id: 'CU01' });
    expect(criteriaFor(entry, new Set(['CU02']))).toStrictEqual([
      'mechanicIntent',
      'roleIntent',
      'noInvention',
    ]);
  });
});

describe('CRITERION_RUBRIC', () => {
  it('carries one non-empty sentence for every criterion', () => {
    for (const criterion of FAITHFULNESS_CRITERIA) {
      expect(CRITERION_RUBRIC[criterion].length).toBeGreaterThan(0);
    }
  });
});

describe('coversExpectedCriteria', () => {
  it('is true when the verdict answers exactly the expected criteria, any order', () => {
    const expected: FaithfulnessCriterion[] = ['mechanicIntent', 'roleIntent', 'noInvention'];
    const verdict = {
      criteria: [verdictItem('noInvention'), verdictItem('mechanicIntent'), verdictItem('roleIntent')],
    };
    expect(coversExpectedCriteria(verdict, expected)).toBe(true);
  });

  it('is false when a criterion is missing', () => {
    const expected: FaithfulnessCriterion[] = ['mechanicIntent', 'roleIntent', 'noInvention'];
    const verdict = { criteria: [verdictItem('mechanicIntent'), verdictItem('roleIntent')] };
    expect(coversExpectedCriteria(verdict, expected)).toBe(false);
  });

  it('is false when an unexpected criterion is present', () => {
    const expected: FaithfulnessCriterion[] = ['mechanicIntent', 'roleIntent', 'noInvention'];
    const verdict = {
      criteria: [verdictItem('mechanicIntent'), verdictItem('roleIntent'), verdictItem('requiredCardIntent')],
    };
    expect(coversExpectedCriteria(verdict, expected)).toBe(false);
  });

  it('is false when a criterion is answered twice', () => {
    const expected: FaithfulnessCriterion[] = ['mechanicIntent', 'roleIntent'];
    const verdict = { criteria: [verdictItem('mechanicIntent'), verdictItem('mechanicIntent')] };
    expect(coversExpectedCriteria(verdict, expected)).toBe(false);
  });
});
