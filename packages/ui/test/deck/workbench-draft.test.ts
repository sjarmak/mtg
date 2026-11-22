import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, draftOf, toCriteriaRequest } from '../../src/routes/deck/workbench/draft';

const POPULATION = {
  id: 'local-field',
  members: [{ id: 'pressure', share: 1, strategy: 'curve out with creatures' }],
};

describe('workbench criteria draft', () => {
  it('carries a declared opponent population through the request and rebuild draft', () => {
    const request = toCriteriaRequest({
      ...EMPTY_DRAFT,
      prompt: 'tune for the field',
      sets: ['SET'],
      opponentPopulation: JSON.stringify(POPULATION),
    });

    expect(request.opponentPopulation).toEqual(POPULATION);
    expect(
      JSON.parse(
        draftOf({
          prompt: 'tune for the field',
          sets: ['SET'],
          colors: [],
          size: 60,
          maxCopies: 4,
          themes: [],
          opponentPopulation: POPULATION,
        }).opponentPopulation,
      ),
    ).toEqual(POPULATION);
  });

  it('leaves malformed population text for the server to refuse at its field', () => {
    const request = toCriteriaRequest({ ...EMPTY_DRAFT, opponentPopulation: '{bad json' });
    expect(request.opponentPopulation).toBe('{bad json');
  });
});
