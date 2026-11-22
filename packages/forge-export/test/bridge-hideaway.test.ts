import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Hideaway-four boundary', () => {
  it('pins the generated Dig root and mandatory top-four choice', () => {
    expect(bridge).toContain('isReviewedHideawayDigAbility');
    expect(bridge).toContain('"Windbrisk Heights".equals(source.getName())');
    expect(bridge).toContain('"Shelldock Isle".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Dig');
    expect(bridge).toContain('ability.isTrigger()');
    expect(bridge).toContain('"4".equals(ability.getParam("DigNum"))');
    expect(bridge).toContain('"Exile".equals(ability.getParam("DestinationZone"))');
    expect(bridge).toContain('"True".equals(ability.getParam("ExileFaceDown"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RememberChanged"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RestRandomOrder"))');
    expect(bridge).toContain('chooseHideawayCard');
    expect(bridge).toContain('outside reviewed-hideaway-four-v1');
    expect(bridge).toContain('minimum != 1');
    expect(bridge).toContain('maximum != 1');
    expect(bridge).toContain('delayedReveal == null');
    expect(bridge).toContain('targetedPlayer != player');
    expect(bridge).toContain('options.size() != Math.min(4, library.size())');
  });

  it('pins each conditional optional free-play activation before confirmation', () => {
    expect(bridge).toContain('isReviewedHideawayPlayAbility');
    expect(bridge).toContain('ability.getApi() == ApiType.Play');
    expect(bridge).toContain('ability.isActivatedAbility()');
    expect(bridge).toContain('"ExiledWith".equals(ability.getParam("Defined"))');
    expect(bridge).toContain('"All".equals(ability.getParam("Amount"))');
    expect(bridge).toContain('"You".equals(ability.getParam("Controller"))');
    expect(bridge).toContain('"True".equals(ability.getParam("WithoutManaCost"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Optional"))');
    expect(bridge).toContain('isReviewedHideawayPlayAbility(ability) && !ability.metConditions()');
    expect(bridge).toContain('isReviewedHideawayPlayConfirmation');
    expect(bridge).toContain('outside reviewed-hideaway-play-confirmation-v1');
  });
});
