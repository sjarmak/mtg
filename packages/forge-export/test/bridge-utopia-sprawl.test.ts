import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Utopia Sprawl boundary', () => {
  it('pins casting to the exact source, spell root, singleton target, and Forge Aura zones', () => {
    expect(bridge).toContain('isReviewedUtopiaSprawlAura');
    expect(bridge).toContain('"Utopia Sprawl".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Attach');
    expect(bridge).toContain('ability.isSpell()');
    expect(bridge).toContain('ability.getRootAbility() == ability');
    expect(bridge).toContain('ability.getMinTargets() == 1');
    expect(bridge).toContain('ability.getMaxTargets() == 1');
    expect(bridge).toContain('"Card.CanBeEnchantedBy,Player.CanBeEnchantedBy".equals(');
  });

  it('rejects every offered candidate outside battlefield Forests', () => {
    expect(bridge).toContain('reviewedUtopiaSprawlAura && !card.isLand()');
    expect(bridge).toContain('reviewedUtopiaSprawlAura && !card.getType().hasSubtype("Forest")');
  });
});
