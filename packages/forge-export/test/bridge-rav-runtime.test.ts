import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns the exact Ravnica interaction gaps', () => {
  it('admits only Torpid Moloch sacrifice-three-lands payments', () => {
    expect(bridge).toContain('private static boolean isReviewedTorpidMolochLandSacrificeCost(');
    expect(bridge).toContain('"Torpid Moloch".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Debuff');
    expect(bridge).toContain('"3".equals(cost.getAmount())');
    expect(bridge).toContain('"Land".equals(cost.getType())');
    expect(bridge).toContain('return session.chooseTorpidMolochLandSacrificeCost(');
    expect(bridge).toContain('selected Torpid Moloch land sacrifice became illegal');
  });

  it('admits the seven RAV and GPT bounce lands without broadening permanent returns', () => {
    expect(bridge).toContain('boolean reviewedMandatoryOwnLandBounce = source != null');
    expect(bridge).toContain('"Dimir Aqueduct"');
    expect(bridge).toContain('"Golgari Rot Farm"');
    expect(bridge).toContain('"Selesnya Sanctuary"');
    expect(bridge).toContain('"Izzet Boilerworks"');
    expect(bridge).toContain('"Gruul Turf"');
    expect(bridge).toContain('"Orzhov Basilica"');
    expect(bridge).toContain('"Land.YouCtrl".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('isReviewedMandatoryOwnLandBounceCandidate(player, card)');
    expect(bridge).toContain('return card.isLand()');
  });
});
