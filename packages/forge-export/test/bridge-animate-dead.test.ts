import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Animate Dead boundary', () => {
  it('pins casting to the exact graveyard Aura root and creature candidates', () => {
    expect(bridge).toContain('isReviewedAnimateDeadAura');
    expect(bridge).toContain('"Animate Dead".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Attach');
    expect(bridge).toContain('ability.getRootAbility() == ability');
    expect(bridge).toContain('ability.getMinTargets() == 1');
    expect(bridge).toContain('ability.getMaxTargets() == 1');
    expect(bridge).toContain('restrictions.getZone().contains(ZoneType.Graveyard)');
    expect(bridge).toContain('reviewedAnimateDeadAura && !card.isInZone(ZoneType.Graveyard)');
    expect(bridge).toContain('reviewedAnimateDeadAura && !card.isCreature()');
  });

  it('does not widen the generic Aura route', () => {
    expect(bridge).toContain('&& !reviewedAnimateDeadAura');
    expect(bridge).toContain('Forge reached Aura targeting outside mandatory-singleton-aura-target-v1');
    expect(bridge).toContain('Forge offered an Aura target outside its exact graveyard creature profile');
  });
});
