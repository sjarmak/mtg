import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Sword of Fire and Ice boundary', () => {
  it('pins Equip to the exact source, root, singleton local creature target, and {2} mana-only cost', () => {
    expect(bridge).toContain('isReviewedSwordOfFireAndIceEquip');
    expect(bridge).toContain('"Sword of Fire and Ice".equals(source.getName())');
    expect(bridge).toContain('"{2}".equals(mana)');
    expect(bridge).toContain('ability.isEquip()');
    expect(bridge).toContain('cost.isOnlyManaCost()');
  });

  it('pins the combat trigger to exact singleton Any targeting and its damage-two then draw-one chain', () => {
    expect(bridge).toContain('isReviewedSwordOfFireAndIceTrigger');
    expect(bridge).toContain('ability.getApi() == ApiType.DealDamage');
    expect(bridge).toContain('"Any".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"2".equals(ability.getParam("NumDmg"))');
    expect(bridge).toContain('subAbility.getApi() == ApiType.Draw');
    expect(bridge).toContain('"You".equals(subAbility.getParam("Defined"))');
    expect(bridge).toContain('"1".equals(subAbility.getParam("NumCards"))');
  });
});
