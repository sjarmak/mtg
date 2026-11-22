/** Static lock for the exact Force of Negation, Force of Will, and Daze payment routes. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const bridge = readFileSync(fileURLToPath(new URL('../bridge/ForgeBridge.java', import.meta.url)), 'utf8');

describe('reviewed free-counterspell alternate payments', () => {
  it('adds only the exact reviewed alternate abilities to the priority menu', () => {
    expect(bridge).toContain('reviewedFreeCounterspellAlternativeAbilities(player)');
    expect(bridge).toContain('ability.isOptionalCostPaid(OptionalCost.AltCost)');
    expect(bridge).toContain('" (alternative cost)"');
    expect(bridge).toContain('session.orderReviewedForceOfWillCosts(costs)');
    expect(bridge).toContain('return List.of(costs.get(0), costs.get(2), costs.get(1));');
  });

  it('guards the two exact blue-card exile payments before offering candidates', () => {
    expect(bridge).toContain('isReviewedFreeCounterspellHandExileCost(exile, ability)');
    expect(bridge).toContain('chooseFreeCounterspellHandExileCost(');
    expect(bridge).toContain('"Card.Blue+Other".equals(exile.getType())');
    expect(bridge).toContain('exile.getFrom().equals(List.of(ZoneType.Hand))');
    expect(bridge).toContain('"Force of Negation".equals(source.getName())');
    expect(bridge).toContain('"Force of Will".equals(source.getName())');
  });

  it('guards Daze as the exact singleton controlled-Island return payment', () => {
    expect(bridge).toContain('isReviewedDazeReturnCost(returned, ability)');
    expect(bridge).toContain('chooseDazeReturnCost(');
    expect(bridge).toContain('"Daze".equals(source.getName())');
    expect(bridge).toContain('"Island".equals(cost.getType())');
  });

  it('keeps Daze tax payment inside the exact reviewed counter UnlessCost shape', () => {
    expect(bridge).toContain('boolean reviewedDaze = "Daze".equals(source.getName())');
    // Daze is the tail of the counter disjunction today; a later set appends its own
    // reviewed counter after it, ahead of the semicolon, so tolerate terms in between.
    expect(bridge).toMatch(/\|\|\s*reviewedDaze\s*(?:\|\|\s*\w+\s*)*;/u);
  });
});
