import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the reviewed generated-token sacrifice payments', () => {
  it('pins Koma to its exact Charm cost and exact two-mode composition', () => {
    expect(bridge).toContain('private static boolean isReviewedGeneratedTokenSacrificeCost(');
    expect(bridge).toContain('"Koma, Cosmos Serpent".equals(reviewedSourceName(source))');
    expect(bridge).toContain('ability.getApi() == ApiType.Charm');
    expect(bridge).toContain('"Serpent.Other".equals(cost.getType())');
    expect(bridge).toContain('"another Serpent".equals(cost.getTypeDescription())');
    expect(bridge).toContain('"DBTap,DBPump".equals(ability.getParam("Choices"))');
    expect(bridge).toContain('selectedMode instanceof AbilitySub selected');
    expect(bridge).toContain('isReviewedKomaPumpMode(selected, ability)');
  });

  it('pins both Foundry conversions and Treasure Cove draw to their whole cost vectors', () => {
    expect(bridge).toContain('"Retrofitter Foundry".equals(reviewedSourceName(source))');
    expect(bridge).toContain('"c_1_1_a_thopter_flying".equals(ability.getParam("TokenScript"))');
    expect(bridge).toContain('"c_4_4_a_construct".equals(ability.getParam("TokenScript"))');
    expect(bridge).toContain('"Treasure Map".equals(reviewedSourceName(source))');
    expect(bridge).toContain('ability.getApi() == ApiType.Draw');
    expect(bridge).toContain('"Treasure".equals(cost.getType())');
    expect(bridge).toContain('parts.get(0).getClass() == CostTap.class');
    expect(bridge).toContain('parts.get(parts.size() - 1).getClass() != CostSacrifice.class');
  });

  it('routes exact candidates through the seat and rechecks legality after the answer', () => {
    expect(bridge).toContain('return session.chooseGeneratedTokenSacrificeCost(');
    expect(bridge).toContain('PaymentDecision chooseGeneratedTokenSacrificeCost(');
    expect(bridge).toContain('generatedTokenSacrificeCandidates(');
    expect(bridge).toContain('payer, ability, cost, effect);');
    expect(bridge).toContain('"cost-sacrifice-" + card.getId()');
    expect(bridge).toContain('"cost-sacrifice-cancel"');
    expect(bridge).toContain('selected generated-token sacrifice became illegal');
    expect(bridge).toContain('outside chosen-cost-payment-v26');
  });
});
