import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge handles general printed Limited costs', () => {
  it('treats milling from the top of the payer library as decision-free', () => {
    expect(bridge).toContain('type == CostMill.class');
  });

  it('admits a fixed positive number of graveyard cards under a scoped installed contract', () => {
    expect(bridge).toContain('isScopedGraveyardExileCost(');
    expect(bridge).toContain('session.supportsScopedContracts');
    expect(bridge).toContain('!exile.payCostFromSource()');
    expect(bridge).toContain('reviewedGraveyardExileAmount(exile, ability, Integer.MAX_VALUE) >= 0');
    expect(bridge).toContain('exile.getFrom().equals(List.of(ZoneType.Graveyard))');
    expect(bridge).toContain('return session.chooseGraveyardExileCost(');
  });

  it('resolves announced variable amounts without exceeding the eligible graveyard', () => {
    expect(bridge).toContain('private static int reviewedGraveyardExileAmount(');
    expect(bridge).toContain('"X".equals(exile.getAmount())');
    expect(bridge).toContain('ability.getXManaCostPaid()');
    expect(bridge).toContain('BridgeController.reviewedGraveyardExileAmount(');
  });

  it('rechecks the exact eligible graveyard set after the choice', () => {
    expect(bridge).toContain('PaymentDecision chooseGraveyardExileCost(');
    expect(bridge).toContain('payer.getCardsIn(ZoneType.Graveyard)');
    expect(bridge).toContain('cost.getType().split(";")');
    expect(bridge).toContain('chosen.size() != required');
    expect(bridge).toContain('!current.containsAll(chosen)');
    expect(bridge).toContain('!cost.canPay(ability, payer, effect)');
  });

  it('versions the widened chosen-cost boundary', () => {
    expect(bridge).toContain('outside chosen-cost-payment-v26');
    expect(bridge).not.toContain('outside chosen-cost-payment-v25');
  });
});
