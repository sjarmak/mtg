import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Hour of Eternity boundary', () => {
  it('pins the X-card callback to the exact spell, graveyard filter, and token-copy tree', () => {
    expect(bridge).toContain('chooseHourOfEternityTargets');
    expect(bridge).toContain('isReviewedHourOfEternityTarget');
    expect(bridge).toContain('"Hour of Eternity".equals(source.getName())');
    expect(bridge).toContain('"X".equals(restrictions.getMinTargets())');
    expect(bridge).toContain('"X".equals(restrictions.getMaxTargets())');
    expect(bridge).toContain('"Creature.YouOwn".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"Graveyard".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Exile".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('"Count$xPaid".equals(source.getSVar("X"))');
    expect(bridge).toContain('"Remembered".equals(copy.getParam("Defined"))');
    expect(bridge).toContain('"Zombie".equals(copy.getParam("SetCreatureTypes"))');
    expect(bridge).toContain('"True".equals(cleanup.getParam("ClearRemembered"))');
    expect(bridge).toContain('ability.getMapParams().equals(Map.ofEntries(');
    expect(bridge).toContain('copy.getMapParams().equals(Map.of(');
    expect(bridge).toContain('cleanup.getMapParams().equals(Map.of(');
  });

  it('requires exactly the announced X and checks every offered target again', () => {
    expect(bridge).toContain('int required = ability.getXManaCostPaid();');
    expect(bridge).toContain('ability.getMinTargets() != required');
    expect(bridge).toContain('ability.getMaxTargets() != required');
    expect(bridge).toContain('card.getOwner() != player');
    expect(bridge).toContain('!player.getCardsIn(ZoneType.Graveyard).contains(card)');
    expect(bridge).toContain('while (ability.getTargets().size() < required)');
    expect(bridge).toContain('ability.getTargets().add(target)');
  });
});
