import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the exact alternate-cost generated-object payments', () => {
  it('pins Shark Typhoon Cycling to its exact source-discard ability and cost vector', () => {
    expect(bridge).toContain('private static boolean isReviewedSharkTyphoonCyclingDiscardCost(');
    expect(bridge).toContain('"Shark Typhoon".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Draw');
    expect(bridge).toContain('"{X}{1}{U}".equals(((CostPartMana) parts.get(0)).getMana().getSimpleString())');
    expect(bridge).toContain('"CARDNAME".equals(discard.getType())');
    expect(bridge).toContain('discard.payCostFromSource()');
  });

  it('keeps fixed-source Cycling discard automatic and every neighboring payment refused', () => {
    expect(bridge).toContain('|| isReviewedSharkTyphoonCyclingDiscardCost(discard, ability)');
    expect(bridge).toContain('PaymentDecision.card(source)');
    expect(bridge).toContain('outside chosen-cost-payment-v26');
  });
});
