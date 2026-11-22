import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns the exact Forecast reveal cost', () => {
  it('admits only a source-card hand reveal on an intrinsic Forecast activation', () => {
    expect(bridge).toContain('isReviewedForecastRevealCost');
    expect(bridge).toContain('ability.getRestrictions().getZone() == ZoneType.Hand');
    expect(bridge).toContain('Set.of(PhaseType.UPKEEP).equals(ability.getRestrictions().getPhases())');
    expect(bridge).toContain('"1".equals(ability.getRestrictions().getLimitToCheck())');
    expect(bridge).toContain('reveal.payCostFromSource()');
    expect(bridge).toContain('"CARDNAME".equals(reveal.getType())');
    expect(bridge).toContain('List.of(ZoneType.Hand).equals(reveal.getRevealFrom())');
    expect(bridge).toContain('return PaymentDecision.card(source);');
    expect(bridge).toContain('outside chosen-cost-payment-v26');
  });
});
