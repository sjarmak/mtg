import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("Forge bridge exact Umezawa's Jitte boundary", () => {
  it('pins Equip to the exact source, activated root, singleton local creature target, and {2}', () => {
    expect(bridge).toContain('isReviewedUmezawasJitteEquip');
    expect(bridge).toContain('"Umezawa\'s Jitte".equals(source.getName())');
    expect(bridge).toContain('"{2}".equals(mana)');
    expect(bridge).toContain('ability.isEquip()');
    expect(bridge).toContain('cost.isOnlyManaCost()');
  });

  it('pins the paid Charm to one source charge counter and its exact three native modes', () => {
    expect(bridge).toContain('isReviewedUmezawasJitteCharm');
    expect(bridge).toContain('ability.getApi() != ApiType.Charm');
    expect(bridge).toContain('!"JittePump,JitteCurse,JitteLife".equals(ability.getParam("Choices"))');
    expect(bridge).toContain('cost.getClass() != CostRemoveCounter.class');
    expect(bridge).toContain('!"1".equals(cost.getAmount())');
    expect(bridge).toContain('!"Charge".equals(cost.counter.getName())');
    expect(bridge).toContain('isReviewedUmezawasJittePumpMode');
    expect(bridge).toContain('isReviewedUmezawasJitteCurseMode');
    expect(bridge).toContain('isReviewedUmezawasJitteLifeMode');
  });

  it('pins the curse target to the exact selected Jitte mode and a singleton creature', () => {
    expect(bridge).toContain('isReviewedUmezawasJitteCurseTarget');
    expect(bridge).toContain('"Creature".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"-1".equals(ability.getParam("NumAtt"))');
    expect(bridge).toContain('"-1".equals(ability.getParam("NumDef"))');
    expect(bridge).toContain('"True".equals(ability.getParam("IsCurse"))');
  });
});
