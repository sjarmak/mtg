import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Sword of Feast and Famine boundary', () => {
  it('pins Equip to the exact source, root, singleton local creature target, and {2} mana-only cost', () => {
    expect(bridge).toContain('isReviewedSwordOfFeastAndFamineEquip');
    expect(bridge).toContain('"Sword of Feast and Famine".equals(source.getName())');
    expect(bridge).toContain('"{2}".equals(mana)');
    expect(bridge).toContain('ability.isEquip()');
    expect(bridge).toContain('cost.isOnlyManaCost()');
  });

  it('pins mandatory discard to the exact trigger root, opposing player, hand, and one-card choice', () => {
    const discardGuard = bridge.slice(
      bridge.indexOf('CardCollection chooseSwordOfFeastAndFamineDiscard'),
      bridge.indexOf('CardCollection chooseDreamstealerDiscard'),
    );
    expect(bridge).toContain('chooseSwordOfFeastAndFamineDiscard');
    expect(bridge).toContain('ability.getApi() != ApiType.Discard');
    expect(bridge).toContain('"TriggeredTarget".equals(ability.getParam("Defined"))');
    expect(bridge).toContain('"1".equals(ability.getParam("NumCards"))');
    expect(bridge).toContain('"TgtChoose".equals(ability.getParam("Mode"))');
    expect(bridge).toContain('subAbility.getApi() != ApiType.UntapAll');
    expect(bridge).toContain('"Land.YouCtrl".equals(subAbility.getParam("ValidCards"))');
    expect(bridge).toContain('discardingPlayer == ability.getActivatingPlayer()');
    expect(bridge).toContain('chooseExactHandDiscard(player, validCards, "Sword of Feast and Famine")');
    expect(discardGuard).toContain('|| !ability.isTrigger()');
    expect(discardGuard).not.toContain('|| ability.isTrigger()');
  });
});
