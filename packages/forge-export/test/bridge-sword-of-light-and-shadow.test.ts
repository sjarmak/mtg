import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Sword of Light and Shadow boundary', () => {
  it('pins Equip to the exact source, root, singleton local creature target, and {2} mana-only cost', () => {
    expect(bridge).toContain('isReviewedSwordOfLightAndShadowEquip');
    expect(bridge).toContain('"Sword of Light and Shadow".equals(source.getName())');
    expect(bridge).toContain('"{2}".equals(mana)');
    expect(bridge).toContain('ability.isEquip()');
    expect(bridge).toContain('cost.isOnlyManaCost()');
  });

  it('pins the trigger chain to three life and an optional zero-or-one local graveyard creature', () => {
    expect(bridge).toContain('isReviewedSwordOfLightAndShadowReturn');
    expect(bridge).toContain('root.getApi() == ApiType.GainLife');
    expect(bridge).toContain('"You".equals(root.getParam("Defined"))');
    expect(bridge).toContain('"3".equals(root.getParam("LifeAmount"))');
    expect(bridge).toContain('ability.getApi() == ApiType.ChangeZone');
    expect(bridge).toContain('"Graveyard".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Hand".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('"Creature.YouCtrl".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('ability.getMinTargets() == 0');
    expect(bridge).toContain('ability.getMaxTargets() == 1');
  });
});
