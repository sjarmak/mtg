import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Sword of Body and Mind boundary', () => {
  it('pins Equip to the exact source, root, singleton local creature target, and {2} mana-only cost', () => {
    expect(bridge).toContain('isReviewedSwordOfBodyAndMindEquip');
    expect(bridge).toContain('"Sword of Body and Mind".equals(source.getName())');
    expect(bridge).toContain('"{2}".equals(mana)');
    expect(bridge).toContain('ability.isEquip()');
    expect(bridge).toContain('cost.isOnlyManaCost()');
  });
});
