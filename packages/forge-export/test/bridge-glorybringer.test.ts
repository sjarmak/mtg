import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns reviewed single-source exert attackers', () => {
  it('routes Forge-enumerated exert identities using exact interaction shapes', () => {
    expect(bridge).toContain('return session.chooseReviewedExertAttackers(getPlayer(), attackers);');
    const predicate = bridge.slice(
      bridge.indexOf('static boolean isReviewedSingleSourceExertCard('),
      bridge.indexOf('List<Card> chooseReviewedExertAttackers('),
    );
    expect(predicate).toContain('costs.size() != 1');
    expect(predicate).toContain('"OptionalAttackCost".equals(ability.getParam("Mode"))');
    expect(predicate).toContain('"Card.Self".equals(ability.getParam("ValidCard"))');
    expect(predicate).toContain('"Exert<1/CARDNAME>".equals(ability.getParam("Cost"))');
    expect(predicate).toContain('card.hasSVar(ability.getParam("Trigger"))');
    expect(predicate).toContain('.containsAll(ability.getMapParams().keySet())');
    expect(predicate).toContain('"Combat Celebrant".equals(card.getName())');
    expect(predicate).toContain('"Creature.Self+notExertedThisTurn".equals(ability.getParam("IsPresent"))');
    expect(predicate).toContain('card.getSVar("TrigUntapAll")');
    expect(predicate).toContain('card.getSVar("DBAddCombat")');
    expect(bridge).toContain('!isReviewedSingleSourceExertCard(attacker)');
    expect(bridge).toContain('"combat-exert"');
    expect(bridge).toContain('"Choose attackers to exert"');
  });

  it('keeps every other exert composition closed', () => {
    expect(bridge).toContain('Forge reached exert outside reviewed-single-source-exert-v1');
  });

  it('guards the resulting combat cost and delegates payment to Forge', () => {
    expect(bridge).toContain('return session.payReviewedSingleSourceExertCombatCost(');
    expect(bridge).toContain('card != ability.getHostCard()');
    expect(bridge).toContain('cost != ability.getPayCosts()');
    expect(bridge).toContain('parts.get(0).getClass() != CostPartMana.class');
    expect(bridge).toContain('!((CostPartMana) parts.get(0)).getMana().isZero()');
    expect(bridge).toContain('parts.get(1).getClass() != CostExert.class');
    expect(bridge).toContain('!"1".equals(exert.getAmount())');
    expect(bridge).toContain('!"CARDNAME".equals(exert.getType())');
    expect(bridge).toContain('!exert.payCostFromSource()');
    expect(bridge).toContain('isReviewedSingleSourceExertCost(part, ability)');
    expect(bridge).toMatch(
      /return PlaySpellAbility\.payCostDuringAbilityResolve\(\s*controller, player, cost, ability, prompt\);/,
    );
    expect(bridge).toContain('Forge reached a combat cost outside reviewed-single-source-exert-v1');
  });
});
