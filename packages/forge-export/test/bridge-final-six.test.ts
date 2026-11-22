import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact final-six boundaries', () => {
  it('pins Sylvan Library returns to its exact trigger and four-life payment', () => {
    expect(bridge).toContain('isReviewedSylvanLibraryPayment');
    expect(bridge).toContain('"Sylvan Library".equals(source.getName())');
    expect(bridge).toContain('"4".equals(payLife.getAmount())');
    expect(bridge).toContain('outside reviewed-sylvan-library-payment-v1');
  });

  it('leaves Whisperwood manifest semantics in Forge and only automates its fixed source payment', () => {
    // The three cost classes Whisperwood pays from the source; a later set that pays another
    // cost class from its source adds a term anywhere in this disjunction.
    expect(bridge).toMatch(
      /type == CostRemoveCounter\.class\s*(?:\|\|\s*type == \w+\.class\s*)*\|\|\s*type == CostPutCounter\.class\s*(?:\|\|\s*type == \w+\.class\s*)*\|\|\s*type == CostSacrifice\.class/u,
    );
    expect(bridge).toContain('return part.payCostFromSource();');
    expect(bridge).not.toContain('"Whisperwood Elemental"');
  });

  it('pins Master return damage to its noncombat callback and live tapped Wolves', () => {
    expect(bridge).toContain('isReviewedMasterOfTheWildHuntReturnDamage');
    expect(bridge).toContain('outside reviewed-master-return-damage-v1');
    expect(bridge).toContain('recipient.getType().hasSubtype("Wolf")');
    expect(bridge).toContain(
      '"Master of the Wild Hunt".equals(BridgeController.reviewedSourceName(candidate))',
    );
  });

  it('keeps live attackers and blockers on the ordinary combat-damage path', () => {
    expect(bridge).toContain('boolean ordinaryCombat = combat != null');
    expect(bridge).toContain('source.isAttacking() || combat.isBlocking(source)');
    expect(bridge).toContain('if (damage < 0 && !ordinaryCombat)');
    expect(bridge).toContain('int assignableDamage = Math.max(0, damage)');
    expect(bridge).toContain('boolean noncombatDivision = !ordinaryCombat');
  });

  it('pins Sawtusk mutate ordering to the exact spell and target composition', () => {
    expect(bridge).toContain('isReviewedSawtuskMutateTopChoice');
    expect(bridge).toContain('outside reviewed-sawtusk-mutate-top-choice-v1');
    expect(bridge).toContain('"Sawtusk Demolisher".equals(reviewedSourceName(source))');
    expect(bridge).toContain('"{3}{G}".equals(((CostPartMana) parts.get(0)).getMana().getSimpleString())');
  });

  it('pins both Yawgmoth activations, their costs, and exact proliferate candidates', () => {
    expect(bridge).toContain('isReviewedYawgmothPutCounterAbility');
    expect(bridge).toContain('isReviewedYawgmothSacrificeCost');
    expect(bridge).toContain('isReviewedYawgmothProliferateAbility');
    expect(bridge).toContain('isReviewedYawgmothDiscardCost');
    expect(bridge).toContain('isReviewedYawgmothProliferateChoice');
  });

  it('separates Mindslaver rules ownership from its causally authorized decision principal', () => {
    expect(bridge).toContain('isReviewedMindslaverAbility');
    expect(bridge).toContain('reviewedMindslaverTurns.add(new MindslaverTurn(ability, player, controlled))');
    expect(bridge).toContain('forgetReviewedMindslaverTurn(paidAbility, player)');
    expect(bridge).toContain('claimReviewedMindslaverPrincipal');
    expect(bridge).toContain('return bridge.decisionPrincipal;');
    expect(bridge).toContain('outside reviewed-mindslaver-next-turn-v1');
  });
});
