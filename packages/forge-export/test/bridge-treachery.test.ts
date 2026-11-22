import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Treachery boundary', () => {
  it('pins the Aura spell to the exact source and singleton creature target', () => {
    expect(bridge).toContain('isReviewedTreacheryAura');
    expect(bridge).toContain('"Treachery".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Attach');
    expect(bridge).toContain('ability.getMinTargets() == 1');
    expect(bridge).toContain('ability.getMaxTargets() == 1');
    expect(bridge).toContain('reviewedTreacheryAura && !card.isCreature()');
  });

  it("accepts only Forge's exact all-battlefield untappable-land callback", () => {
    expect(bridge).toContain('isReviewedTreacheryUntapAbility');
    expect(bridge).toContain('chooseTreacheryLandsToUntap');
    expect(bridge).toContain('outside reviewed-treachery-v1');
    expect(bridge).toContain('ability.getApi() == ApiType.Untap');
    expect(bridge).toContain('"True".equals(ability.getParam("UntapUpTo"))');
    expect(bridge).toContain('"Land".equals(ability.getParam("UntapType"))');
    expect(bridge).toContain('"5".equals(ability.getParam("Amount"))');
    expect(bridge).toContain('min != 0');
    expect(bridge).toContain('max != 5');
    expect(bridge).toContain('!isOptional');
    expect(bridge).toContain('params != null');
    expect(bridge).toContain('card.getZone().getZoneType() != ZoneType.Battlefield');
    expect(bridge).toContain('!card.isLand()');
    expect(bridge).toContain('!card.canUntap(null, false)');
    expect(bridge).toContain('battlefieldUntappableLands');
  });
});
