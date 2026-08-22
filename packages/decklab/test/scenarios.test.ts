import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIOS } from '../src/scenarios';

/**
 * mtg-bc2.47. Every scenario used to state its own land count, so the eval
 * measured a constant six times over instead of the pipeline's judgment — and
 * the burn scenario's constant was 24, which is what the blind judge named as
 * the reason the informed deck lost that scenario worst.
 */
describe('DEFAULT_SCENARIOS', () => {
  it('leaves the land count to the pipeline, so it can vary by archetype', () => {
    for (const scenario of DEFAULT_SCENARIOS) {
      expect(scenario.criteria.landCount, scenario.id).toBeUndefined();
    }
  });

  it('still states the deck size, which is a fact about the format rather than a judgment', () => {
    for (const scenario of DEFAULT_SCENARIOS) {
      expect(scenario.criteria.size, scenario.id).toBeDefined();
    }
  });
});
