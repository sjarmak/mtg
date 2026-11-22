import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Zareth San's reviewed return cost", () => {
  it('pins the full hand activation and exact cost vector', () => {
    expect(bridge).toContain('isReviewedZarethReturnCost((CostReturn) part, ability)');
    expect(bridge).toContain('"Zareth San, the Trickster".equals(source.getName())');
    expect(bridge).toContain('ability.getRestrictions().getZone() == ZoneType.Hand');
    expect(bridge).toContain('"Hand".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Battlefield".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Tapped"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Attacking"))');
    expect(bridge).toContain('"{2}{U}{B}".equals(((CostPartMana) parts.get(0)).getMana().getSimpleString())');
    expect(bridge).toContain('"Rogue.unblocked+attacking+YouCtrl".equals(cost.getType())');
    expect(bridge).toContain('parts.get(1).getClass() == CostReturn.class');
  });

  it('routes the exact live Rogue choice through the local seat and checks it again', () => {
    expect(bridge).toContain('return session.chooseZarethReturnCost(');
    expect(bridge).toContain('PaymentDecision chooseZarethReturnCost(');
    expect(bridge).toContain('"cost-return-selection"');
    expect(bridge).toContain('"cost-return-" + card.getId()');
    expect(bridge).toContain('"cost-return-cancel"');
    expect(bridge).toContain('selected return-cost card became illegal');
    expect(bridge).toContain('zarethReturnCandidates(payer, ability, cost)');
  });
});
