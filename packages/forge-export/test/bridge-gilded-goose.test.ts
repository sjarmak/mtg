import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns Gilded Goose's exact Food payment", () => {
  it('pins the complete activated mana and cost-part shape before the visitor runs', () => {
    expect(bridge).toContain('private static boolean isReviewedGildedGooseFoodSacrificeCost(');
    expect(bridge).toContain('"Gilded Goose".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Mana');
    expect(bridge).toContain('"Any".equals(ability.getParam("Produced"))');
    expect(bridge).toContain('"1".equals(cost.getAmount())');
    expect(bridge).toContain('"Food".equals(cost.getType())');
    expect(bridge).toContain('!cost.payCostFromSource()');
    expect(bridge).toContain('parts.get(0).getClass() == CostTap.class');
    expect(bridge).toContain('parts.get(1).getClass() == CostSacrifice.class');
    const guard = bridge.slice(
      bridge.indexOf('private static boolean isReviewedGildedGooseFoodSacrificeCost('),
      bridge.indexOf('private static boolean isReviewedGoldspanTreasureManaAbility('),
    );
    expect(guard).not.toContain('parts.get(1) == cost');
    expect(bridge).toContain(
      'ability.getTargetRestrictions() == null\n                                    ? "null"',
    );
  });

  it('routes the exact sacrifice through backend-issued choices and checks it again', () => {
    expect(bridge).toContain('return session.chooseGildedGooseFoodSacrificeCost(');
    expect(bridge).toContain('PaymentDecision chooseGildedGooseFoodSacrificeCost(');
    expect(bridge).toContain('gildedGooseFoodSacrificeCandidates(payer, ability, cost, effect)');
    expect(bridge).toContain('"cost-sacrifice-" + card.getId()');
    expect(bridge).toContain('"cost-sacrifice-cancel"');
    expect(bridge).toContain('selected Gilded Goose Food sacrifice became illegal');
  });

  it('opens no generic Food-sacrifice fallback', () => {
    expect(bridge).toContain(
      'part.getClass() == CostSacrifice.class\n                    && isReviewedGildedGooseFoodSacrificeCost((CostSacrifice) part, ability)',
    );
    expect(bridge).toContain('if (isReviewedGildedGooseFoodSacrificeCost(sacrifice, ability)) {');
  });
});
