import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Grim Lavamancer's reviewed graveyard-exile cost", () => {
  it('closes the route around the exact root ability and complete cost vector', () => {
    expect(bridge).toContain('isReviewedGrimLavamancerExileCost(');
    expect(bridge).toContain('"Grim Lavamancer".equals(source.getName())');
    expect(bridge).toContain('ability.isActivatedAbility()');
    expect(bridge).toContain('ability.getParent() == null');
    expect(bridge).toContain('ability.getApi() == ApiType.DealDamage');
    expect(bridge).toContain('"Any".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"2".equals(ability.getParam("NumDmg"))');
    expect(bridge).toContain('parts.size() == 3');
    expect(bridge).toContain('parts.get(0).getClass() == CostTap.class');
    expect(bridge).toContain('parts.get(1).getClass() == CostPartMana.class');
    expect(bridge).toContain('"{R}".equals(((CostPartMana) parts.get(1)).getMana().getSimpleString())');
    expect(bridge).toContain('parts.get(2).getClass() == CostExile.class');
  });

  it('requires exactly two cards from the payer graveyard and rechecks legality', () => {
    expect(bridge).toContain('return session.chooseGrimLavamancerExileCost(');
    expect(bridge).toContain('payer.getCardsIn(cost.getFrom())');
    expect(bridge).toContain('cost.getType().split(";")');
    expect(bridge).toContain('"cost-card-selection"');
    expect(bridge).toContain('"Choose cards to exile from your graveyard"');
    expect(bridge).toContain('chosen.size() != required');
    expect(bridge).toContain('!current.containsAll(chosen)');
    expect(bridge).toContain('!cost.canPay(ability, payer, effect)');
    expect(bridge).toContain('return PaymentDecision.card(chosen);');
  });

  it('keeps adjacent exile shapes outside the boundary', () => {
    expect(bridge).toContain('!exile.payCostFromSource()');
    expect(bridge).toContain('"2".equals(exile.getAmount())');
    expect(bridge).toContain('"Card".equals(exile.getType())');
    expect(bridge).toContain('exile.zoneRestriction == 1');
    expect(bridge).toContain('exile.getFrom().equals(List.of(ZoneType.Graveyard))');
    expect(bridge).toContain('Forge reached a chosen cost payment outside chosen-cost-payment-v26');
  });
});
