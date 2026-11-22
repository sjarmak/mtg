import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge mandatory trigger placement', () => {
  it('mirrors the human controller when a mandatory targeted trigger has no legal target', () => {
    expect(bridge).toContain('PlaySpellAbility.playSpellAbility(player.getController(), player, ability);');
    expect(bridge).not.toContain('selected mandatory triggered ability could not be placed on the stack');
  });
});
