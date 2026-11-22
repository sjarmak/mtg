import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact blue library-selection boundary', () => {
  it('pins Augur, Azcanta, and Narset to their distinct Dig shapes', () => {
    expect(bridge).toContain('isReviewedBlueLibrarySelectionDigAbility');
    expect(bridge).toContain('"Augur of Bolas".equals(source.getName())');
    expect(bridge).toContain('"Azcanta, the Sunken Ruin".equals(source.getName())');
    expect(bridge).toContain('"Narset, Parter of Veils".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Dig');
    expect(bridge).toContain('"3".equals(ability.getParam("DigNum"))');
    expect(bridge).toContain('"4".equals(ability.getParam("DigNum"))');
    expect(bridge).toContain('"1".equals(ability.getParam("ChangeNum"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Optional"))');
    expect(bridge).toContain('"Instant,Sorcery".equals(ability.getParam("ChangeValid"))');
    expect(bridge).toContain('"Card.nonCreature+nonLand".equals(ability.getParam("ChangeValid"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RestRandomOrder"))');
    expect(bridge).toContain('"True".equals(ability.getParam("ForceRevealToController"))');
    expect(bridge).toContain('"2".equals(loyalty.getAmount())');
    expect(bridge).toContain('"Loyalty".equals(loyalty.counter.getName())');
  });

  it('checks the exact live top-of-library candidates and callback bounds', () => {
    expect(bridge).toContain('chooseBlueLibrarySelectionCard');
    expect(bridge).toContain('outside reviewed-blue-library-selection-v1');
    expect(bridge).toContain('minimum != 0');
    expect(bridge).toContain('maximum != Math.min(1, expected.size())');
    expect(bridge).toContain('narset ? delayedReveal != null : delayedReveal == null');
    expect(bridge).toContain('targetedPlayer != player');
    expect(bridge).toContain('options.size() != expected.size()');
    expect(bridge).toContain('card != expected.get(index)');
  });

  it('pins Search transform confirmation and non-random bottom ordering', () => {
    expect(bridge).toContain('isReviewedSearchForAzcantaTransformConfirmation');
    expect(bridge).toContain('ability.getApi() == ApiType.SetState');
    expect(bridge).toContain('"Transform".equals(ability.getParam("Mode"))');
    expect(bridge).toContain('"GE7".equals(ability.getParam("ConditionCompare"))');
    expect(bridge).toContain('outside reviewed-search-for-azcanta-transform-v1');
    expect(bridge).toContain('isReviewedBlueLibrarySelectionBottomOrder');
    expect(bridge).toContain('outside reviewed-blue-library-selection-order-v1');
  });
});
