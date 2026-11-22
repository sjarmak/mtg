import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Lorwyn choice contracts', () => {
  it('admits the exact targeted revealed-hand singleton discard', () => {
    expect(bridge).toContain('isReviewedTargetedRevealDiscard(');
    expect(bridge).toContain('"RevealYouChoose".equals(ability.getParam("Mode"))');
    expect(bridge).toContain('"Card.nonLand".equals(ability.getParam("DiscardValid"))');
    expect(bridge).toContain('discardingPlayer == player');
    expect(bridge).toContain('ability.getTargets().contains(discardingPlayer)');
    expect(bridge).toContain('discardingPlayer.getCardsIn(ZoneType.Hand).contains(card)');
    expect(bridge).toContain('"revealed-hand-discard-selection"');
  });

  it('admits only the exact optional Champion battlefield exile choice', () => {
    expect(bridge).toContain('isReviewedChampionBattlefieldExile(');
    expect(bridge).toContain('"Battlefield".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Exile".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Champion"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RememberChanged"))');
    expect(bridge).toContain('source.hasKeyword(Keyword.CHAMPION)');
    expect(bridge).toContain('card != source');
    expect(bridge).toContain('card.getController() == player');
    expect(bridge).toContain('card.isValid(');
  });
});
