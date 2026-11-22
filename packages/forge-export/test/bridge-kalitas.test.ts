import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Kalitas boundary', () => {
  it('pins the activated ability and its full cost vector', () => {
    expect(bridge).toContain('isReviewedKalitasAbility');
    expect(bridge).toContain('"Kalitas, Traitor of Ghet".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.PutCounter');
    expect(bridge).toContain('"P1P1".equals(ability.getParam("CounterType"))');
    expect(bridge).toContain('"2".equals(ability.getParam("CounterNum"))');
    expect(bridge).toContain('"{2}{B}".equals(((CostPartMana) parts.get(0)).getMana().getSimpleString())');
  });

  it('pins the exact other Vampire-or-Zombie sacrifice and uses the reviewed chooser', () => {
    expect(bridge).toContain('isReviewedKalitasSacrificeCost');
    expect(bridge).toContain('"Vampire.Other;Zombie.Other".equals(cost.getType())');
    expect(bridge).toContain('"another Vampire or Zombie".equals(cost.getTypeDescription())');
    expect(bridge).toContain('return session.chooseOtherCreatureSacrificeCost(');
    expect(bridge).toContain('"cost-sacrifice-cancel"');
    expect(bridge).toContain('selected sacrifice-cost card became illegal');
  });

  it('fails closed when an activated Kalitas shape drifts', () => {
    expect(bridge).toContain('Forge reached Kalitas outside his exact reviewed counter route');
    expect(bridge).toContain('Forge reached Kalitas cost payment outside his exact reviewed counter route');
    expect(bridge).toContain('outside chosen-cost-payment-v26');
  });
});
