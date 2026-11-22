import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Cryptbreaker's reviewed decisions", () => {
  it('pins the exact discard-token root before routing the selected hand cost', () => {
    expect(bridge).toContain('isReviewedCryptbreakerTokenAbility');
    expect(bridge).toContain('isReviewedCryptbreakerDiscardCost');
    expect(bridge).toContain('"Cryptbreaker".equals(source.getName())');
    expect(bridge).toContain('"b_2_2_zombie".equals(ability.getParam("TokenScript"))');
    expect(bridge).toContain('"1".equals(discard.getAmount())');
    expect(bridge).toContain('"Card".equals(discard.getType())');
  });

  it('pins the exact tap-three-Zombies draw/life-loss chain before using the bounded chooser', () => {
    expect(bridge).toContain('isReviewedCryptbreakerDrawAbility');
    expect(bridge).toContain('isReviewedCryptbreakerTapCost');
    expect(bridge).toContain('"3".equals(tap.getAmount())');
    expect(bridge).toContain('"Zombie".equals(tap.getType())');
    expect(bridge).toContain('"1".equals(ability.getParam("NumCards"))');
    expect(bridge).toContain('"DBLoseLife".equals(ability.getParam("SubAbility"))');
    expect(bridge).toContain('selected.getApi() != ApiType.LoseLife');
    expect(bridge).toContain('boolean detachedSelected = selected != null');
    expect(bridge).toContain('boolean linkedSelected = selected != null');
    expect(bridge).toContain('&& selected.getParent() == ability');
    expect(bridge).toContain('|| !(detachedSelected || linkedSelected)');
    expect(bridge).toContain('"1".equals(selected.getParam("LifeAmount"))');
    expect(bridge).toContain('return session.choosePermanentTapCost(player, ability, tap);');
  });
});
