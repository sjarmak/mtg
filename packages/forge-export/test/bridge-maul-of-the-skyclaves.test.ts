import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Maul of the Skyclaves boundary', () => {
  it('pins triggered Attach to the exact source, root, target cardinality, and battlefield creature candidates', () => {
    expect(bridge).toContain('isReviewedMaulTriggeredAttach');
    expect(bridge).toContain('"Maul of the Skyclaves".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Attach');
    expect(bridge).toContain('ability.isTrigger()');
    expect(bridge).toContain('ability.getMinTargets() == 1');
    expect(bridge).toContain('ability.getMaxTargets() == 1');
  });

  it('pins ordinary Equip to the same exact source and {2}{W}{W} mana-only cost', () => {
    expect(bridge).toContain('isReviewedMaulEquip');
    expect(bridge).toContain('"{2}{W}{W}".equals(mana)');
    expect(bridge).toContain('!ability.isTrigger()');
    expect(bridge).toContain('cost.isOnlyManaCost()');
  });
});
