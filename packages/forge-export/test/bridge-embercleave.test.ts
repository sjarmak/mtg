import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Embercleave boundary', () => {
  it('pins triggered Attach to the exact source, root, singleton target, and local battlefield creatures', () => {
    expect(bridge).toContain('isReviewedEmbercleaveTriggeredAttach');
    expect(bridge).toContain('"Embercleave".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Attach');
    expect(bridge).toContain('ability.isTrigger()');
    expect(bridge).toContain('ability.getMinTargets() == 1');
    expect(bridge).toContain('ability.getMaxTargets() == 1');
    expect(bridge).toContain('"Creature.YouCtrl".equals(ability.getParam("ValidTgts"))');
  });

  it('pins ordinary Equip to the same exact source and {3} mana-only cost', () => {
    expect(bridge).toContain('isReviewedEmbercleaveEquip');
    expect(bridge).toContain('"{3}".equals(mana)');
    expect(bridge).toContain('!ability.isTrigger()');
    expect(bridge).toContain('cost.isOnlyManaCost()');
  });
});
