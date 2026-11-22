import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Sword of Hearth and Home boundary', () => {
  it('pins Equip to the exact source, root, singleton local creature target, and {2} mana-only cost', () => {
    expect(bridge).toContain('isReviewedSwordOfHearthAndHomeEquip');
    expect(bridge).toContain('"Sword of Hearth and Home".equals(source.getName())');
    expect(bridge).toContain('"{2}".equals(mana)');
    expect(bridge).toContain('ability.isEquip()');
    expect(bridge).toContain('cost.isOnlyManaCost()');
  });

  it('pins the trigger to an optional owned creature blink and the exact remembered return chain', () => {
    expect(bridge).toContain('isReviewedSwordOfHearthAndHomeBlink');
    expect(bridge).toContain('"Creature.YouOwn".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('ability.getMinTargets() == 0');
    expect(bridge).toContain('ability.getMaxTargets() == 1');
    expect(bridge).toContain('"Battlefield".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Exile".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RememberChanged"))');
    expect(bridge).toContain('isReviewedSwordOfHearthAndHomeSearch');
  });

  it('pins the library callback to optional basic selection and the same exact trigger chain', () => {
    expect(bridge).toContain('destination == ZoneType.Library');
    expect(bridge).toContain('origin.equals(List.of(ZoneType.Library))');
    expect(bridge).toContain('"Land.Basic".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('card.isBasicLand()');
    expect(bridge).toContain('player.getCardsIn(ZoneType.Library).contains(card)');
  });
});
