/** Static boundary for the two reviewed Legacy Cube companion scripts. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge keeps reviewed companion choices narrow', () => {
  it('pins the real pregame companion callback to Yorion and Obosh', () => {
    expect(bridge).toContain('ability.getApi() == ApiType.CompanionChoose');
    expect(bridge).toContain('candidate.isInZone(ZoneType.Sideboard)');
    expect(bridge).toContain('outside reviewed-companion-choice-v1');
    expect(bridge).toContain('"Yorion, Sky Nomad" ->');
    expect(bridge).toContain('"Obosh, the Preypiercer" ->');
    expect(bridge).toContain('"companion-selection"');
  });

  it('pins Yorion hidden-zone selection and its delayed return chain', () => {
    expect(bridge).toContain('boolean reviewedYorionBattlefieldExile =');
    expect(bridge).toContain('"Yorion, Sky Nomad".equals(source.getName())');
    expect(bridge).toContain('origin.equals(List.of(ZoneType.Battlefield))');
    expect(bridge).toContain('destination == ZoneType.Exile');
    expect(bridge).toContain(
      '"Permanent.nonLand+Other+YouOwn+YouCtrl".equals(ability.getParam("ChangeType"))',
    );
    expect(bridge).toContain('"True".equals(ability.getParam("Hidden"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RememberChanged"))');
    expect(bridge).toContain('isReviewedYorionDelayedReturn(ability.getSubAbility())');
  });
});
