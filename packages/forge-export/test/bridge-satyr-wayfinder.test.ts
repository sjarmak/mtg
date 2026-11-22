import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Satyr Wayfinder boundary', () => {
  it('pins the triggered Dig to the exact source, root, and parameters', () => {
    expect(bridge).toContain('isReviewedSatyrWayfinderDigAbility');
    expect(bridge).toContain('"Satyr Wayfinder".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Dig');
    expect(bridge).toContain('ability.isTrigger()');
    expect(bridge).toContain('"4".equals(ability.getParam("DigNum"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Reveal"))');
    expect(bridge).toContain('"1".equals(ability.getParam("ChangeNum"))');
    expect(bridge).toContain('"Land".equals(ability.getParam("ChangeValid"))');
    expect(bridge).toContain('"Graveyard".equals(ability.getParam("DestinationZone2"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Optional"))');
  });

  it('bounds the optional selection to exposed library lands and rejects neighboring calls', () => {
    expect(bridge).toContain('chooseSatyrWayfinderLand');
    expect(bridge).toContain('outside reviewed-satyr-wayfinder-v1');
    expect(bridge).toContain('minimum != 0');
    expect(bridge).toContain('maximum != Math.min(1, options.size())');
    expect(bridge).toContain('delayedReveal != null');
    expect(bridge).toContain('targetedPlayer != player');
    expect(bridge).toContain('card.getZone() == null');
    expect(bridge).toContain('card.getZone().getZoneType() != ZoneType.Library');
    expect(bridge).toContain('!player.getCardsIn(ZoneType.Library).contains(card)');
    expect(bridge).toContain('!card.isLand()');
  });
});
