import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact spell-copy retarget boundary', () => {
  it('routes only the two reviewed copied spells through a Forge-legality-derived menu', () => {
    expect(
      [
        'chooseReviewedCopySpellTargets',
        '"Malicious Affliction"',
        '"Chain Lightning"',
        'ability.isCopied()',
        'ability.getTargetRestrictions().getAllCandidates(ability)',
        'ability.canTarget(candidate)',
        '"copy-target-selection"',
        '"copy-target-keep"',
        'TargetChoices originalTargets = ability.getTargets()',
        'ability.setTargets(originalTargets)',
        'outside reviewed-copy-spell-retarget-v1',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('guards Chain Lightning reciprocal copying behind its exact RR payer and ability shape', () => {
    expect(
      [
        'isReviewedChainLightningCopyPayment',
        'ability.getApi() == ApiType.CopySpellAbility',
        '"TargetedOrController".equals(ability.getParam("Controller"))',
        '"TargetedOrController".equals(ability.getParam("UnlessPayer"))',
        '"R R".equals(ability.getParam("UnlessCost"))',
        '"True".equals(ability.getParam("UnlessSwitched"))',
        '"True".equals(ability.getParam("MayChooseTarget"))',
        'cost.isOnlyManaCost()',
        '"{R}{R}".equals(mana)',
        'PlaySpellAbility.payCostDuringAbilityResolve',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('keeps copied spells distinct from simultaneous trigger ordering', () => {
    expect(bridge).toContain('playReviewedCopiedSpells');
    expect(bridge).toContain('orderAndPlaySimultaneousSa');
    expect(bridge).toContain('outside reviewed-copied-spell-stack-v1');
  });

  it('admits copied Replicate spells while preserving Forge target legality', () => {
    expect(
      [
        'isReviewedReplicateCopy',
        'keyword.getOriginal().startsWith("Replicate:")',
        'isReviewedCopySpellTarget(ability, player) || isReviewedReplicateCopy(ability, player)',
        'if (ability.usesTargeting())',
        'ability.getTargets().isEmpty()',
        'ability.isMayChooseNewTargets()',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });
});
