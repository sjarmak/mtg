import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns the exact Pia and Siege-Gang sacrifice payments', () => {
  it('pins all three source, ability, target, cost, and sacrifice shapes', () => {
    expect(bridge).toContain('private static boolean isReviewedPiaSiegeGangSacrificeCost(');
    expect(bridge).toContain('"Pia Nalaar".equals(source.getName())');
    expect(bridge).toContain('"Pia and Kiran Nalaar".equals(source.getName())');
    expect(bridge).toContain('"Siege-Gang Commander".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Pump');
    expect(bridge).toContain('ability.getApi() == ApiType.DealDamage');
    expect(bridge).toContain('"Creature".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"Any".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"2".equals(ability.getParam("NumDmg"))');
    expect(bridge).toContain('"Artifact".equals(cost.getType())');
    expect(bridge).toContain('"Goblin".equals(cost.getType())');
    expect(bridge).toContain('parts.get(0).getClass() == CostPartMana.class');
    expect(bridge).toContain('parts.get(1).getClass() == CostSacrifice.class');
  });

  it('routes only that guard through backend-issued candidates and rechecks legality', () => {
    expect(bridge).toContain('return session.choosePiaSiegeGangSacrificeCost(');
    expect(bridge).toContain('PaymentDecision choosePiaSiegeGangSacrificeCost(');
    expect(bridge).toContain('piaSiegeGangSacrificeCandidates(payer, ability, cost, effect)');
    expect(bridge).toContain('"cost-sacrifice-" + card.getId()');
    expect(bridge).toContain('"cost-sacrifice-cancel"');
    expect(bridge).toContain('selected Pia/Siege-Gang sacrifice became illegal');
    expect(bridge).toContain(
      'part.getClass() == CostSacrifice.class\n                    && isReviewedPiaSiegeGangSacrificeCost((CostSacrifice) part, ability)',
    );
  });
});
