import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Myr Battlesphere's reviewed decisions", () => {
  it('pins the exact optional attack trigger and its pump-and-damage chain', () => {
    expect(bridge).toContain('isReviewedMyrBattlesphereEtbAbility');
    expect(bridge).toContain('isReviewedMyrBattlesphereEtbTrigger');
    expect(bridge).toContain('isReviewedMyrBattlesphereCombatTrigger');
    expect(bridge).toContain('isReviewedMyrBattlesphereAttackAbility');
    expect(bridge).toContain('isReviewedMyrBattlesphereAttackStackAbility');
    expect(bridge).toContain('"Myr Battlesphere".equals(source.getName())');
    expect(bridge).toContain('"Self".equals(ability.getParam("Defined"))');
    expect(bridge).toContain('"+X".equals(ability.getParam("NumAtt"))');
    expect(bridge).toContain('selected.getApi() != ApiType.DealDamage');
    expect(bridge).toContain('"X".equals(selected.getParam("NumDmg"))');
    expect(bridge).toContain('"TriggeredDefender.Opponent & Valid Planeswalker.TriggeredDefender"');
    expect(bridge).toContain('.equals(selected.getParam("Defined"))');
    expect(bridge).toContain('parentWrapper.getWrappedAbility() == ability');
    expect(bridge).toContain('selected.getRootAbility() == parentWrapper');
    expect(bridge).toContain(
      'Forge reached Myr Battlesphere trigger confirmation outside its exact reviewed route',
    );
    expect(bridge).toContain('if (isReviewedMyrBattlesphereAttackAbility(ability))');
    expect(bridge).toContain('PlaySpellAbility.playSpellAbilityNoStack(');
  });

  it('pins and routes only the variable Myr tap payment', () => {
    expect(bridge).toContain('isReviewedMyrBattlesphereTapCost');
    expect(bridge).toContain('"X".equals(tap.getAmount())');
    expect(bridge).toContain('"Myr".equals(tap.getType())');
    expect(bridge).toContain('chooseMyrBattlesphereTapCount');
    expect(bridge).toContain('minimum != 0 || maximum != candidates.size()');
    expect(bridge).toContain('return session.choosePermanentTapCost(player, ability, tap);');
    expect(bridge).toContain('"cost-tap-cancel"');
  });
});
