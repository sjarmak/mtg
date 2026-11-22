import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Huntmaster boundary', () => {
  it('pins both stages of the Ravager damage target chain', () => {
    expect(
      [
        'isReviewedHuntmasterDamageTarget',
        'source.getOriginalState(CardStateName.Original).getName()',
        '"Huntmaster of the Fells".equals(sourceName)',
        '"Ravager of the Fells".equals(source.getName())',
        'root.getApi() == ApiType.DealDamage',
        '"Opponent,Planeswalker".equals(root.getParam("ValidTgts"))',
        '"2".equals(root.getParam("NumDmg"))',
        '"True".equals(root.getParam("DamageMap"))',
        'more.getApi() == ApiType.DealDamage',
        '"Creature.ControlledBy TargetedOrController".equals(more.getParam("ValidTgts"))',
        'more.getMinTargets() == 0',
        'more.getMaxTargets() == 1',
        'resolve.getApi() == ApiType.DamageResolve',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('derives the optional creature candidates from the first exact target', () => {
    expect(bridge).toContain('reviewedHuntmasterDamageTarget');
    expect(bridge).toContain('targetedPlayerOrController');
    expect(bridge).toContain('card.getController() != targetedPlayerOrController');
    expect(bridge).toContain(
      'card.isInZone(ZoneType.Battlefield)\n                                                        && card.isPlaneswalker())',
    );
    expect(bridge).not.toContain(
      'card.isPlaneswalker()\n                                                        && card.getController() != player',
    );
    expect(bridge).toContain('outside reviewed-huntmaster-damage-targets-v1');
  });
});
