import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Prismari Command boundary', () => {
  it('pins the root and four ordered modes before choosing exactly two distinct modes', () => {
    expect(
      [
        'isReviewedPrismariCommandCharm',
        '"Prismari Command".equals(source.getName())',
        '!"DBShock,DBLoot,DBTreasure,DBShatter".equals(ability.getParam("Choices"))',
        'min != 2',
        'num != 2',
        'allowRepeat',
        'isReviewedPrismariCommandShockMode(modes.get(0), ability)',
        'isReviewedPrismariCommandLootMode(modes.get(1), ability)',
        'isReviewedPrismariCommandTreasureMode(modes.get(2), ability)',
        'isReviewedPrismariCommandShatterMode(modes.get(3), ability)',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('pins all target-bearing modes to their exact target restrictions and effect bodies', () => {
    expect(
      [
        'isReviewedPrismariCommandTarget',
        '"Any".equals(ability.getParam("ValidTgts"))',
        '"2".equals(ability.getParam("NumDmg"))',
        '"Player".equals(ability.getParam("ValidTgts"))',
        '"ThisTargetedPlayer".equals(ability.getParam("Defined"))',
        '"c_a_treasure_sac".equals(ability.getParam("TokenScript"))',
        '"ThisTargetedPlayer".equals(ability.getParam("TokenOwner"))',
        '"Artifact".equals(ability.getParam("ValidTgts"))',
        '"ThisTargetedCard".equals(ability.getParam("Defined"))',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('pins the loot discard callback to the exact child and targeted player', () => {
    expect(
      [
        'boolean reviewedPrismari = source != null',
        '"Prismari Command".equals(source.getName())',
        'isReviewedPrismariCommandActiveMode(parent, ability.getRootAbility(), 1)',
        'parent.getSubAbility() == ability',
        'parent.getTargets().size() == 1',
        'parent.getTargets().contains(discardingPlayer)',
        'ability.getActivatingPlayer() == ability.getRootAbility().getActivatingPlayer()',
        'reviewedSeasoned || reviewedPrismari',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('keeps every other mode and target shape on the fail-closed path', () => {
    expect(bridge).toContain('if (sourceCard != null && "Prismari Command".equals(sourceCard.getName()))');
    expect(bridge).toContain('outside its exact reviewed route');
    expect(bridge).toContain('|| isReviewedPrismariCommandTarget(ability)');
  });
});
