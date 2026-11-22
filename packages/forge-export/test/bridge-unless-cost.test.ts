import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the reviewed UnlessCost payments', () => {
  it('keeps the existing shockland payment on its exact path', () => {
    expect(bridge).toContain('return session.payReviewedPreventEffectCost(');
    expect(bridge).toContain('return payShocklandEntryLife(player, cost, ability, alreadyPaid, payers);');
  });

  it('pins Esper Sentinel to its exact dynamic-mana draw shape', () => {
    expect(bridge).toContain('"Esper Sentinel".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Draw');
    expect(bridge).toContain('"X".equals(ability.getParam("UnlessCost"))');
    expect(bridge).toContain('"TriggeredActivator".equals(ability.getParam("UnlessPayer"))');
    expect(bridge).toContain('part.getClass() == CostPartMana.class');
    expect(bridge).toContain('cost.isOnlyManaCost()');
  });

  it('pins Nahiri to its exact optional discard-and-draw shape', () => {
    expect(bridge).toContain('"Nahiri, the Harbinger".equals(source.getName())');
    expect(bridge).toContain('"Discard<1/Card>".equals(ability.getParam("UnlessCost"))');
    expect(bridge).toContain('"True".equals(ability.getParam("UnlessSwitched"))');
    expect(bridge).toContain('"You".equals(ability.getParam("UnlessPayer"))');
    expect(bridge).toContain('"1".equals(discard.getAmount())');
    expect(bridge).toContain('"Card".equals(discard.getType())');
  });

  it('pins Tragic Lesson to an explicit optional return-one-land payment', () => {
    expect(bridge).toContain('isReviewedTragicLessonReturnLandPayment(cost, ability)');
    expect(bridge).toContain('"Tragic Lesson".equals(source.getName())');
    expect(bridge).toContain('ability.getMapParams().equals(Map.of(');
    expect(bridge).toContain('"UnlessCost", "Return<1/Land>"');
    expect(bridge).toContain('"Return a land you control instead of discarding a card?"');
    expect(bridge).toContain('player, "confirm-payment"');
    expect(bridge).toContain('isReviewedTragicLessonDiscard');
  });

  it('pins both Torment cards to their exact alternative-payment trees', () => {
    expect(bridge).toContain('isReviewedTormentAlternativePayment(cost, ability)');
    expect(bridge).toContain('"Torment of Hailfire".equals(source.getName())');
    expect(bridge).toContain('"Torment of Venom".equals(source.getName())');
    expect(bridge).toContain('"Sac<1/Permanent.nonLand/nonland permanent>"');
    expect(bridge).toContain('"Sac<1/Permanent.!IsRemembered+nonLand/another nonland permanent>"');
    expect(bridge).toContain('tormentAlternativePaymentPrompt(part)');
    expect(bridge).toContain('chooseTormentSacrificeCost');
    expect(bridge).toContain('isReviewedTormentSacrificeCost');
  });

  it('admits a one-card typed hand reveal as a scoped optional payment paid through cost-card-selection', () => {
    expect(bridge).toContain('if (part instanceof CostReveal reveal) return isScopedHandRevealCost(reveal);');
    expect(bridge).toContain('static boolean isScopedHandRevealCost(CostReveal reveal)');
    expect(bridge).toContain('&& !reveal.payCostFromSource()');
    expect(bridge).toContain('List.of(ZoneType.Hand).equals(reveal.getRevealFrom())');
    expect(bridge).toContain('&& !"SameColor".equals(reveal.getType())');
    expect(bridge).toContain(
      'if (part instanceof CostReveal reveal && session.isScopedHandRevealCost(reveal)) return;',
    );
    expect(bridge).toContain('return session.chooseHandRevealCost(player, ability, reveal, isEffect());');
    expect(bridge).toContain('PaymentDecision chooseHandRevealCost(');
    expect(bridge).toContain('if (ability.isSpell()) eligible.remove(source);');
    expect(bridge).toContain('if (ability.isSpell()) current.remove(source);');
    expect(bridge).not.toContain('cost-reveal-selection');
  });

  it('reviews a typed hand-reveal cost unconditionally, not only inside the scoped AKH/HOU contract', () => {
    // mtg-72fjo: real LAN/observed play never sets validationPurpose, so
    // supportsScopedContracts is always false there. A check land's reveal
    // cost (Fortified Village: "reveal a Forest or Plains card from your
    // hand") is card-name-independent and must be admitted on that route too,
    // not only under the scoped catalog-discovery/admitted-format contract.
    expect(bridge).toContain(
      'boolean reviewedHandRevealCost = exactPayer\n' +
        '                    && part instanceof CostReveal reveal\n' +
        '                    && isScopedHandRevealCost(reveal);',
    );
    // The three conjuncts are what this test owns; the closing paren is not. Every later
    // set narrows the refusal further with its own && !reviewedX (Kaladesh added energy
    // and fabricate), which moved the paren to the next line and broke a literal pin.
    expect(bridge).toMatch(
      /&& !reviewedGateToTheAfterlife && !scopedAkhHouPayment && !reviewedHandRevealCost\s*(?:&& !\w+\s*)*\) \{/u,
    );
    expect(bridge).toMatch(/if \(\(scopedAkhHouPayment \|\| reviewedHandRevealCost(?: \|\| \w+)*\)/u);
  });

  it('delegates the already-guarded payment to Forge instead of reimplementing it', () => {
    expect(bridge).toContain(
      'return PlaySpellAbility.payCostDuringAbilityResolve(controller, player, cost, ability, null);',
    );
    expect(bridge).toContain('Forge reached an optional payment outside reviewed-prevent-effect-payment-v1');
  });

  it('pins the five exact counterspell payment shapes', () => {
    for (const name of ['Mana Tithe', 'Mana Leak', 'Miscalculation', 'Pact of Negation', 'Supreme Will']) {
      expect(bridge).toContain(`"${name}".equals(source.getName())`);
    }
    expect(bridge).toContain('boolean reviewedCounterUnlessCost =');
    expect(bridge).toContain('isReviewedCounterUnlessCost(ability, cost)');
    expect(bridge).toContain('reviewedSupremeWillCounter');
    expect(bridge).toContain('reviewedMiscalculation');
  });
});

describe("the Forge bridge owns Lethal Sting's chosen counter cost", () => {
  it('pins the exact spell, target, mana, counter, and controlled-creature shape', () => {
    expect(bridge).toContain('isReviewedLethalStingPutCounterCost');
    expect(bridge).toContain('"Lethal Sting".equals(source.getName())');
    expect(bridge).toContain('"Creature.YouCtrl".equals(cost.getType())');
    expect(bridge).toContain('"-1/-1".equals(cost.getCounter().getName())');
    expect(bridge).toContain('isExactLethalStingPutCounterPart');
    expect(bridge).toContain('CardPredicates.canReceiveCounters(cost.getCounter())');
    expect(bridge).toContain('card.canReceiveCounters(cost.getCounter())');
    expect(bridge).toContain('return session.chooseLethalStingPutCounterCost(');
    expect(bridge).toContain('ability.getMapParams().equals(Map.of(');
  });
});
