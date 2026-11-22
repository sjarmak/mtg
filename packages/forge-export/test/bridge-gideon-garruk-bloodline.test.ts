import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Gideon, Garruk, and Bloodline boundary', () => {
  it('pins both Gideon loyalty targets and the optional keyword route', () => {
    expect(bridge).toContain('isReviewedGideonBlackbladeTarget');
    expect(bridge).toContain('"Gideon Blackblade".equals(source.getName())');
    expect(bridge).toContain('"Creature.YouCtrl+Other".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"Permanent.nonLand".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"1".equals(loyalty.getAmount())');
    expect(bridge).toContain('"6".equals(loyalty.getAmount())');
    expect(bridge).toContain('validateReviewedGideonKeywordChoice');
    expect(bridge).toContain('List.of("Vigilance", "Lifelink", "Indestructible")');
    expect(bridge).toContain('outside reviewed-gideon-blackblade-keyword-v1');
  });

  it('pins Garruk to exactly two distinct battlefield lands', () => {
    expect(bridge).toContain('isReviewedGarrukWildspeakerUntap');
    expect(bridge).toContain('"Garruk Wildspeaker".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Untap');
    expect(bridge).toContain('"Land".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('minimum != 2 || maximum != 2');
    // This test owns reviewedGarruk's membership in the two-target cancel-choice
    // disjunction beside Plow Under's own guard; a later set can add its own guard
    // between the two.
    expect(bridge).toMatch(/reviewedPlowUnder\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedGarruk/u);
    expect(bridge).toContain('remaining.remove(target)');
  });

  it('routes only the reviewed cards through their bounded target callbacks', () => {
    expect(bridge).toContain('reviewedGideonBlackbladeTarget');
    expect(bridge).toContain('reviewedGarruk');
    expect(bridge).toContain('|| "Garruk Wildspeaker".equals(ability.getHostCard().getName())');
    expect(bridge).toContain(
      'Forge reached Gideon Blackblade targeting outside its exact reviewed abilities',
    );
    expect(bridge).toContain('reviewed-multiple-target-v2');
  });
});
