import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Forbid's reviewed Buyback route", () => {
  it('pins the root counter and exact optional cost before offering Buyback', () => {
    expect(bridge).toContain('isReviewedForbidCounter(SpellAbility ability)');
    expect(bridge).toContain('"Forbid".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Counter');
    expect(bridge).toContain('cost.getType() != OptionalCost.Buyback');
    expect(bridge).toContain('"2".equals(discard.getAmount())');
    expect(bridge).toContain('"Card".equals(discard.getType())');
  });

  it("admits Forbid's discard-two only through the same exact Forbid root", () => {
    expect(bridge).toContain('isReviewedForbidBuybackDiscardCost(discard, ability)');
    expect(bridge).toContain('ability.isBuyback()');
    expect(bridge).toContain('parts.size() == 2');
    expect(bridge).toContain('parts.get(1).getClass() == CostDiscard.class');
  });

  it('offers exact hand identities one at a time with cancellation until two are chosen', () => {
    expect(bridge).toContain('chooseFixedCountDiscardCost(');
    expect(bridge).toContain('while (chosen.size() < required)');
    expect(bridge).toContain('"cost-discard-cancel"');
    expect(bridge).toContain('remaining.remove(card)');
    expect(bridge).toContain('return PaymentDecision.card(chosen);');
  });
});
