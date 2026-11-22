import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns reviewed discard costs', () => {
  it('recognizes only the two reviewed script shapes before the visitor runs', () => {
    expect(bridge).toContain('part.getClass() == CostDiscard.class');
    expect(bridge).toContain('"1".equals(discard.getAmount()) && "Card".equals(discard.getType())');
    expect(bridge).toContain('"0".equals(discard.getAmount()) && "Hand".equals(discard.getType())');
    expect(bridge).toContain('isReviewedFaunaShamanDiscardCost(discard, ability)');
    expect(bridge).toContain('isReviewedMiscalculationCyclingDiscardCost(discard, ability)');
  });

  it('routes the actual payment through the session instead of AiCostDecision', () => {
    expect(bridge).toContain('return session.chooseDiscardCost(player, ability, discard, isEffect());');
    expect(bridge).toContain('PaymentDecision chooseDiscardCost(');
    expect(bridge).toContain('return session.chooseOtherCreatureSacrificeCost(');
    expect(bridge).toContain('PaymentDecision chooseOtherCreatureSacrificeCost(');
  });

  it('automatically pays an exact intrinsic source-card discard for a hand-activated or self-discard search', () => {
    expect(bridge).toContain('private static boolean isReviewedSourceHandDiscardCost(');
    expect(bridge).toContain('boolean reviewedSelfDiscardSearch =');
    expect(bridge).toContain('boolean reviewedSelfDiscardLibrarySearch =');
    expect(bridge).toContain('BridgeController.isReviewedSelfDiscardLibrarySearch(ability)');
    expect(bridge).toContain('ability.getApi() == ApiType.ChangeZone');
    expect(bridge).toContain('"Library".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Hand".equals(ability.getParam("Destination"))');
    // Self-discard search is one reviewed term in the zone-restriction exemption; a later
    // set's own reviewed search can land between it and the structural Hand-zone check.
    expect(bridge).toMatch(
      /reviewedSelfDiscardSearch\s*(?:\|\|\s*\w+\s*)*\|\|\s*ability\.getRestrictions\(\)\.getZone\(\) == ZoneType\.Hand/u,
    );
    expect(bridge).toContain('parts.get(1).getClass() == CostDiscard.class');
    expect(bridge).not.toContain('&& parts.contains(discard)');
    expect(bridge).toContain(
      'if (!discard.canPay(ability, player, isEffect())\n                                || !player.equals(source.getOwner())) return null;',
    );
    expect(bridge).toContain('return PaymentDecision.card(source);');
  });

  it('leaves a fixed-source sacrifice with Forge instead of routing it as a chosen sacrifice', () => {
    expect(bridge).toContain('if (sacrifice.payCostFromSource()) return sacrifice.accept(automatic);');
  });

  it('checks Forge legality before and after the human choice', () => {
    // Reviewed chosen-cost cohorts add checks before showing each menu and
    // after the selected object is checked again. Generated-token sacrifice
    // the reviewed planeswalker, Magda, Lethal Sting, and Torment payments, and
    // the shared exact Titan Escape payment add the latest pairs to this census.
    expect(bridge.match(/cost\.canPay\(ability, payer, effect\)/gu)).toHaveLength(43);
    expect(bridge).toContain(
      'CardLists.getValidCards(hand, cost.getType().split(";"), payer, source, ability)',
    );
  });

  it('keeps source-sacrifice searches on an exact activated-card boundary', () => {
    expect(bridge).toContain('REVIEWED_SOURCE_SACRIFICE_SEARCHES');
    expect(bridge).toContain('REVIEWED_SOURCE_SACRIFICE_SEARCHES.contains(source.getName())');
    expect(bridge).toContain('ability.isActivatedAbility()');
    expect(bridge).toContain('|| reviewedSourceSacrificeSearch');
    expect(bridge).toContain('|| reviewedBoundedTriggeredLibraryToHand');
  });

  it('pins Fiend Artisan sacrifice payment to its one exact installed cost shape', () => {
    expect(bridge).toContain('"Fiend Artisan".equals(source.getName())');
    expect(bridge).toContain('"1".equals(cost.getAmount())');
    expect(bridge).toContain('"Creature.Other".equals(cost.getType())');
    expect(bridge).toContain('"another creature".equals(cost.getTypeDescription())');
    expect(bridge).toContain('ability.isActivatedAbility()');
    expect(bridge).toContain('ability.getParent() == null');
  });

  it('pins Fiend Artisan library search to the reviewed singleton creature-fetch shape', () => {
    expect(bridge).toContain('boolean reviewedFiendArtisanSearch =');
    expect(bridge).toContain('"1".equals(ability.getParam("ChangeNum"))');
    expect(bridge).toContain('ability.getParam("ChangeType").matches("Creature\\\\.cmcLE\\\\d+")');
    expect(bridge).toContain('("Creature.cmcLEX".equals(ability.getParam("ChangeType"))');
    // Fiend Artisan's search is the first term of the library-zone-change extension today;
    // a later set's own reviewed search can be inserted ahead of it.
    expect(bridge).toMatch(
      /reviewedLibraryZoneChange = reviewedLibraryZoneChange\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedFiendArtisanSearch/u,
    );
  });

  it('pins Fauna Shaman payment and library search to the exact activated shape', () => {
    expect(bridge).toContain('boolean reviewedFaunaShamanSearch =');
    expect(bridge).toContain('"Fauna Shaman".equals(source.getName())');
    expect(bridge).toContain('"Creature".equals(ability.getParam("ChangeType"))');
    // The three library-to-hand searches in order; a later set's own reviewed search can
    // land between any two of them.
    expect(bridge).toMatch(
      /reviewedBoundedTriggeredLibraryToHand\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedFaunaShamanSearch\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedSelfDiscardLibrarySearch/u,
    );
    expect(bridge).toContain('private static boolean isReviewedFaunaShamanDiscardCost(');
    expect(bridge).toContain('"1".equals(cost.getAmount())');
    expect(bridge).toContain('"Creature".equals(cost.getType())');
  });

  it('pins the three added creature-sacrifice costs to their complete ability shapes', () => {
    expect(bridge).toContain('isReviewedChosenCreatureSacrificeCost(cost, ability)');
    expect(bridge).toContain('isReviewedMagusOfTheOrderSacrificeCost(cost, ability)');
    expect(bridge).toContain('isReviewedNaturalOrderSacrificeCost(cost, ability)');
    expect(bridge).toContain('isReviewedFalkenrathAristocratSacrificeCost(cost, ability)');
    expect(bridge).toContain('boolean reviewedSacrificeUpgradeSearch =');
    expect(bridge).toContain('"Magus of the Order".equals(source.getName())');
    expect(bridge).toContain('"Natural Order".equals(source.getName())');
    expect(bridge).toContain('"Falkenrath Aristocrat".equals(source.getName())');
    // This test owns reviewedSacrificeUpgradeSearch, not Fiend Artisan's search beside it;
    // a later set's own reviewed search can land between the two in this disjunction.
    expect(bridge).toMatch(
      /reviewedFiendArtisanSearch\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedSacrificeUpgradeSearch/u,
    );
  });

  it("routes only Cavalier of Night's exact reflexive sacrifice around Forge's AI no-stack seam", () => {
    expect(bridge).toContain('isReviewedCavalierReflexiveSacrificeAbility(ability)');
    expect(bridge).toContain('ability.getApi() != ApiType.ImmediateTrigger');
    expect(bridge).toContain('execute.getApi() != ApiType.Destroy');
    expect(bridge).toContain('"Creature.OppCtrl".equals(execute.getParam("ValidTgts"))');
    expect(bridge).toContain('"Creature.Other".equals(sacrifice.getType())');
    expect(bridge).toContain(
      'PlaySpellAbility.playSpellAbilityNoStack(\n                        this, getPlayer(), ability, targetsAlreadyChosen)',
    );
    expect(bridge).toContain(
      'isReviewedCavalierReflexiveSacrificeAbility(ability)\n                            && ability.getPayCosts().getCostParts().get(0) == cost',
    );
  });

  it('checks the exact selected permanent again before returning the sacrifice payment', () => {
    expect(bridge).toContain('otherCreatureSacrificeCandidates(payer, ability, cost, effect)');
    expect(bridge).toContain('selected sacrifice-cost card became illegal');
    expect(bridge).toContain('"cost-sacrifice-" + card.getId()');
    expect(bridge).toContain('"cost-sacrifice-cancel"');
  });

  it('retains the simultaneous-trigger boundary while admitting structurally wrapped optional triggers', () => {
    expect(bridge).toContain('boolean singleton = remaining.size() == 1;');
    expect(bridge).toContain('!isReviewedSimultaneousOptionalTrigger(ability, player)');
    expect(bridge).toContain('ability instanceof WrappedAbility wrapper');
    expect(bridge).toContain('"Forge reached a simultaneous ability outside reviewed-trigger-order-v2: "');
    expect(bridge).toContain('.map(BridgeSession::describeTriggerOrderAbility)');
  });

  it('limits optional library-to-hand searches to reviewed structural restrictions', () => {
    expect(bridge).toContain('isReviewedBoundedTriggeredLibraryToHand(');
    expect(bridge).toContain('"1".equals(ability.getParam("ChangeNum"))');
    // The three library-to-hand searches in order; a later set's own reviewed search can
    // land between any two of them.
    expect(bridge).toMatch(
      /reviewedBoundedTriggeredLibraryToHand\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedFaunaShamanSearch\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedSelfDiscardLibrarySearch/u,
    );
  });

  it('pins Tidehollow Sculler to its exact direct hidden-hand callback shape', () => {
    expect(bridge).toContain('boolean reviewedTidehollowHiddenHandZoneChange =');
    expect(bridge).toContain('"Tidehollow Sculler".equals(source.getName())');
    expect(bridge).toContain('"Card.nonLand".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RememberChanged"))');
    expect(bridge).toContain('"True".equals(ability.getParam("ForgetOtherRemembered"))');
    expect(bridge).toContain('!ability.hasParam("Duration")');
    // This test owns Tidehollow's guard, not Kitesail's beside it; a later set's own
    // hidden-hand guard can land between the two in this disjunction.
    expect(bridge).toMatch(
      /reviewedKitesailHiddenHandZoneChange\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedTidehollowHiddenHandZoneChange/u,
    );
  });

  it('pins Vendilion Clique to its exact optional hidden-hand-to-library callback shape', () => {
    expect(bridge).toContain('boolean reviewedVendilionHiddenHandZoneChange =');
    expect(bridge).toContain('"Vendilion Clique".equals(source.getName())');
    expect(bridge).toContain('destination == ZoneType.Library');
    expect(bridge).toContain('"-1".equals(ability.getParam("LibraryPosition"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Hidden"))');
    expect(bridge).toContain('isReviewedVendilionDraw(ability.getSubAbility())');
    expect(bridge).toContain('|| reviewedVendilionHiddenHandZoneChange');
    // This test owns Vendilion's exemption from the composite hidden-hand-zone-change
    // guard, not that guard's own membership; a later set can add its own hidden-hand
    // guard into the composite between the two names.
    expect(bridge).toMatch(
      /!reviewedHiddenHandZoneChange\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedVendilionHiddenHandZoneChange/u,
    );
  });
});
