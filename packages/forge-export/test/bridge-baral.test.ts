import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Baral's reviewed triggered loot", () => {
  it('uses the already-owned human trigger confirmation callback', () => {
    expect(bridge).toContain('return session.confirmTrigger(getPlayer(), wrapper);');
    expect(bridge).toContain('"confirm-trigger"');
  });

  it('routes only the exact singleton hand discard back to the seat', () => {
    expect(bridge).toContain('return session.chooseBaralLootDiscard(');
    expect(bridge).toContain('ability.getApi() != ApiType.Discard');
    expect(bridge).toContain('!"TgtChoose".equals(ability.getParam("Mode"))');
    expect(bridge).toContain('alreadyChosen != validCards');
    expect(bridge).toContain('Forge reached discard selection outside reviewed-baral-loot-v1');
  });
});
