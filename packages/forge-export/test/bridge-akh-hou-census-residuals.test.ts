/** Exact refusal boundaries for residuals discovered by the AKH/HOU card census. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('AKH/HOU card-census residual guards', () => {
  it('scopes reusable catalog controller contracts to a scoped inventory, not to a format name', () => {
    expect(bridge).toContain('private boolean supportsScopedContracts;');
    expect(bridge).toContain('supportsScopedContracts = scopedInventory;');
    expect(bridge).not.toContain('supportsScopedContracts = string(request, "format")');
  });

  it('enumerates bounded AKH/HOU targets without delegating decisions to Forge AI', () => {
    expect(bridge).toContain('chooseScopedAkhHouTargets(');
    expect(bridge).toContain('isScopedAkhHouTargetContract(ability)');
    expect(bridge).toContain('ability.getMaxTargets() <= MAX_SCOPED_AKH_HOU_TARGETS');
    expect(bridge).toContain('restrictions.isRandomTarget()');
    expect(bridge).toContain('ability.hasParam("TargetingPlayer")');
    expect(bridge).toContain('collectStackTargets(player, ability, choices);');
    expect(bridge).toContain('meetsMustTargetRestriction(ability, candidate)');
  });

  it('admits only bounded chosen costs inside the scoped AKH/HOU contract', () => {
    expect(bridge).toContain('isScopedAkhHouChosenCost(part, ability)');
    expect(bridge).toContain('isScopedAkhHouSourceExileCost((CostExile) part, ability)');
    expect(bridge).toContain('isScopedAkhHouSingleSacrificeCost((CostSacrifice) part, ability)');
    expect(bridge).toContain('isScopedAkhHouSourceExertCost(part, ability)');
  });

  it('exposes scoped AKH/HOU optional payments to the decision principal', () => {
    expect(bridge).toContain('boolean scopedAkhHouPayment = supportsScopedContracts');
    expect(bridge).toContain('isScopedAkhHouOptionalPayment(part, cost, ability)');
    expect(bridge).toContain('"Pay " + cost + "?"');
    expect(bridge).toContain('PlaySpellAbility.payCostDuringAbilityResolve(');
  });

  it('chooses a bounded scoped AKH/HOU discard only from the Forge-provided hand candidates', () => {
    expect(bridge).toContain('boolean scopedAkhHouSingleDiscard = isScopedAkhHouSingleDiscard(');
    expect(bridge).toContain('private boolean isScopedAkhHouSingleDiscard(');
    expect(bridge).toContain('ability.getApi() != ApiType.Discard');
    expect(bridge).toContain('alreadyChosen != validCards');
    expect(bridge).toContain('discardingPlayer.getCardsIn(ZoneType.Hand).contains(card)');
  });

  it('chooses one scoped AKH/HOU zone card without widening the Forge-provided candidate set', () => {
    expect(bridge).toContain('isScopedAkhHouSingleZoneCardChoice(');
    expect(bridge).toContain('chooseScopedAkhHouSingleZoneCard(');
    expect(bridge).toContain('fetchList.contains(card)');
    expect(bridge).toContain('origin.contains(card.getZone().getZoneType())');
    expect(bridge).toContain('choices.add(new Choice("zone-card-none", "Choose no card", null))');
    expect(bridge).toContain('if (value == null && isOptional) return null');
  });

  it("does not run cycling lookahead through Samut's visible divided-damage Forge bug", () => {
    expect(bridge).toContain('hasVisibleSamutDividedDamage(player.getGame())');
    expect(bridge).toContain('for (Player seat : game.getPlayers())');
    expect(bridge).toContain('seat.getCardsIn(ZoneType.Battlefield)');
    expect(bridge).toContain('"Samut, the Tested".equals(card.getName())');
  });

  it('retargets a scoped AKH/HOU singleton spell only among Forge-legal candidates', () => {
    expect(bridge).toContain('isScopedAkhHouSingletonRetarget(ability)');
    expect(bridge).toContain('chooseScopedAkhHouSingletonRetarget(');
    expect(bridge).toContain('filter == null || filter.test(candidate)');
    expect(bridge).toContain('candidate.equals(original)');
    expect(bridge).toContain('ability.setTargets(originalTargets)');
  });

  it('orders structurally wrapped optional triggers without a format or card-name exception', () => {
    expect(bridge).toContain('isReviewedSimultaneousOptionalTrigger(ability, player)');
    expect(bridge).toContain('ability instanceof WrappedAbility wrapper');
    expect(bridge).toContain('ability.isOptionalTrigger()');
    expect(bridge).toContain('wrapped.getActivatingPlayer() == player');
  });

  it("owns only Vizier of the Anointed's exact optional graveyard search", () => {
    expect(bridge).toContain('boolean reviewedVizierOfTheAnointedSearch =');
    expect(bridge).toContain('"Vizier of the Anointed".equals(source.getName())');
    expect(bridge).toMatch(
      /"Creature\.withEmbalm\+YouCtrl,Creature\.withEternalize\+YouCtrl"\s+\.equals\(ability\.getParam\("ChangeType"\)\)/u,
    );
    expect(bridge).toContain(
      '"DB$ ChangeZone | Origin$ Library | Destination$ Graveyard | ChangeNum$ 1 | ChangeType$ Creature.withEmbalm+YouCtrl,Creature.withEternalize+YouCtrl"',
    );
    expect(bridge).toContain('reviewedVizierOfTheAnointedSearch');
  });

  it("admits Fraying Sanity's player target without widening card-target Auras", () => {
    expect(bridge).toContain('boolean reviewedFrayingSanityAura = isReviewedFrayingSanityAura(ability);');
    expect(bridge).toContain('"Fraying Sanity".equals(source.getName())');
    expect(bridge).toMatch(
      /reviewedPlayerCastAura\) \{\s+for \(GameEntity candidate[^]*candidate instanceof Player/u,
    );
    expect(bridge).toContain('Forge offered a Fraying Sanity target outside its exact player profile');
  });

  it('accepts the exact triggerless single-source exert static shape', () => {
    expect(bridge).toContain('boolean hasTrigger = ability.hasParam("Trigger");');
    expect(bridge).toMatch(
      /Set\.of\("Mode", "ValidCard", "Cost", "Description"\)\s+\.equals\(ability\.getMapParams\(\)\.keySet\(\)\)/u,
    );
    expect(bridge).toContain('card.hasSVar(ability.getParam("Trigger"))');
  });

  it("accepts Combat Celebrant's exact exert availability condition", () => {
    expect(bridge).toContain('boolean reviewedCombatCelebrantExert =');
    expect(bridge).toContain('"Combat Celebrant".equals(card.getName())');
    expect(bridge).toContain('"Creature.Self+notExertedThisTurn".equals(ability.getParam("IsPresent"))');
    expect(bridge).toContain('Set.of("Mode", "ValidCard", "IsPresent", "Trigger", "Cost", "Description")');
  });

  it("owns only Fervent Paincaster's exact activated exert cost", () => {
    expect(bridge).toContain('isReviewedFerventPaincasterExertCost(part, ability)');
    expect(bridge).toContain('"Fervent Paincaster".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.DealDamage');
    expect(bridge).toContain('"Creature".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('parts.get(0).getClass() == CostTap.class');
    expect(bridge).toContain('CostExert listed =');
    expect(bridge).toContain('"1".equals(listed.getAmount())');
    expect(bridge).toContain('part.getClass() == CostExert.class');
  });

  it('reuses one exact Forge-expanded Embalm profile across AKH creatures', () => {
    expect(bridge).toContain('isReviewedEmbalmAbility(ability)');
    expect(bridge).toContain('ability.isEmbalm()');
    expect(bridge).toContain('"Embalm".equals(ability.getParam("PrecostDesc"))');
    expect(bridge).toContain('"White".equals(ability.getParam("SetColor"))');
    expect(bridge).toContain('"Zombie".equals(ability.getParam("AddTypes"))');
    expect(bridge).toContain('ability.getMapParams().size() == 12');
  });

  it("owns only Synchronized Strike's exact optional two-creature target chain", () => {
    expect(bridge).toContain('isReviewedSynchronizedStrikeTarget(ability)');
    expect(bridge).toContain('"Synchronized Strike".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Untap');
    expect(bridge).toContain('"Creature".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('pump.getApi() == ApiType.Pump');
    expect(bridge).toContain('"Targeted".equals(pump.getParam("Defined"))');
    expect(bridge).toContain('"+2".equals(pump.getParam("NumAtt"))');
    expect(bridge).toContain('"+2".equals(pump.getParam("NumDef"))');
    expect(bridge).toContain('reviewedSynchronizedStrike');
  });

  it("owns only Steward of Solidarity's exact tap-and-exert token activation", () => {
    expect(bridge).toContain('isReviewedStewardOfSolidarityExertCost(part, ability)');
    expect(bridge).toContain('"Steward of Solidarity".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Token');
    expect(bridge).toContain('"w_1_1_warrior_vigilance".equals(ability.getParam("TokenScript"))');
    expect(bridge).toContain('parts.get(0).getClass() == CostTap.class');
  });

  it("owns only Seeker of Insight's exact draw-then-discard chain", () => {
    expect(bridge).toContain('boolean reviewedSeekerOfInsight =');
    expect(bridge).toContain('"Seeker of Insight".equals(source.getName())');
    expect(bridge).toContain(
      '"Count$ThisTurnCast_Card.YouCtrl+nonCreature".equals(source.getSVar("CastTest"))',
    );
    expect(bridge).toContain('parent.getApi() == ApiType.Draw');
    expect(bridge).toContain('parent.getSubAbility() == ability');
  });

  it("owns only Bloodrage Brawler's mandatory enters-the-battlefield discard", () => {
    expect(bridge).toContain('boolean reviewedBloodrageBrawler =');
    expect(bridge).toContain('"Bloodrage Brawler".equals(source.getName())');
    expect(bridge).toMatch(
      /"DB\$ Discard \| Defined\$ You \| NumCards\$ 1 \| Mode\$ TgtChoose"\s+\.equals\(source\.getSVar\("TrigDiscard"\)\)/u,
    );
    expect(bridge).toContain('reviewedBloodrageBrawler');
  });

  it("owns only Torment of Scarabs' exact player Aura target", () => {
    expect(bridge).toContain('isReviewedTormentOfScarabsAura(ability)');
    expect(bridge).toContain('"Torment of Scarabs".equals(source.getName())');
    expect(bridge).toContain('boolean reviewedPlayerCastAura =');
    expect(bridge).toContain('Forge offered a reviewed player Aura target outside its exact profile');
  });

  it("owns only Doomfall's exact forced battlefield creature choice", () => {
    expect(bridge).toContain('boolean reviewedDoomfallBattlefieldZoneChange =');
    expect(bridge).toContain('"Targeted".equals(ability.getParam("Chooser"))');
    expect(bridge).toContain('origin.equals(List.of(ZoneType.Battlefield))');
    expect(bridge).toContain(
      '"DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Opponent',
    );
    expect(bridge).toContain('reviewedDoomfallBattlefieldZoneChange');
  });

  it("owns only Gate to the Afterlife's exact optional draw-then-discard payment", () => {
    expect(bridge).toContain('boolean reviewedGateToTheAfterlife =');
    expect(bridge).toContain('isReviewedGateToTheAfterlifeDiscardAbility(ability)');
    expect(bridge).toContain('"Gate to the Afterlife".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Discard');
    expect(bridge).toContain('"Draw<1/You>".equals(ability.getParam("UnlessCost"))');
    expect(bridge).toContain('part.getClass() == CostDraw.class');
    expect(bridge).toContain('"Draw a card, then discard a card?"');
  });

  it("owns only Gate to the Afterlife's exact graveyard-hand-library search", () => {
    expect(bridge).toContain('boolean reviewedGateToTheAfterlifeSearch =');
    expect(bridge).toContain('origin.equals(List.of(ZoneType.Library, ZoneType.Graveyard, ZoneType.Hand))');
    expect(bridge).toContain('"Card.YouOwn+namedGod-Pharaoh\'s Gift".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('isReviewedGateToTheAfterlifeSearchCandidate(player, card)');
    expect(bridge).toMatch(
      /reviewedGateToTheAfterlifeSearch =[^;]*delayedReveal\.getZone\(\)\.size\(\) == 1[^;]*delayedReveal\.getZone\(\)\.contains\(ZoneType\.Library\)/u,
    );
    // Pin Gate's search feeding the library-zone guard, not the whole disjunction: a
    // later set adds its own reviewed search to it (Kaladesh added Nissa's) and would
    // otherwise fail an AKH/HOU test for changing nothing AKH/HOU owns.
    expect(bridge).toMatch(
      /reviewedLibraryZoneChange =\s*reviewedGateToTheAfterlifeSearch\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedLibraryZoneChange;/u,
    );
  });

  it("owns only Countervailing Winds' graveyard-sized counter payment", () => {
    expect(bridge).toContain('boolean reviewedCountervailingWinds =');
    expect(bridge).toContain('"Countervailing Winds".equals(source.getName())');
    expect(bridge).toContain('"Count$ValidGraveyard Card.YouOwn".equals(source.getSVar("Y"))');
    expect(bridge).toContain('source.getController().getCardsIn(ZoneType.Graveyard).size()');
    expect(bridge).toContain('"Y".equals(ability.getParam("UnlessCost"))');
  });

  it("owns only Dreamstealer's combat-damage discard trigger", () => {
    expect(bridge).toContain('chooseDreamstealerDiscard(');
    expect(bridge).toContain('"Dreamstealer".equals(source.getName())');
    expect(bridge).toContain('"DB$ Discard | Defined$ TriggeredTarget | NumCards$ X | Mode$ TgtChoose"');
    expect(bridge).toContain('"TriggerCount$DamageAmount".equals(source.getSVar("X"))');
    expect(bridge).toContain('player.isOpponentOf(ability.getActivatingPlayer())');
    expect(bridge).toContain('min < 1');
  });

  it("owns only Unburden's exact two-card target-player discard", () => {
    expect(bridge).toContain('chooseUnburdenDiscard(');
    expect(bridge).toContain('"Unburden".equals(source.getName())');
    expect(bridge).toContain('"Player".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"2".equals(ability.getParam("NumCards"))');
    expect(bridge).toContain('"{1}{B}{B}".equals(mana)');
    expect(bridge).toContain('ability.getTargets().contains(discardingPlayer)');
  });

  it('reuses the exact two-card target-player discard contract for Oblivion', () => {
    expect(bridge).toContain('chooseReviewedTwoCardTargetDiscard(');
    expect(bridge).toContain('isReviewedTwoCardTargetDiscard(');
    expect(bridge).toContain('"Oblivion".equals(source.getName())');
    expect(bridge).toContain('"Opponent".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"{4}{B}".equals(mana)');
    expect(bridge).toContain('min < 1');
    expect(bridge).toContain('max > 2');
  });

  it("owns only Dispossess's named-card hand and library exile chain", () => {
    expect(bridge).toContain('isReviewedDispossessZoneChoice(');
    expect(bridge).toContain('"Dispossess".equals(source.getName())');
    expect(bridge).toContain('"Card.NamedCard".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"NumInHand".equals(changeNum)');
    expect(bridge).toContain('"NumInLib".equals(changeNum)');
  });

  it("owns only God-Pharaoh's Gift's optional graveyard creature exile", () => {
    expect(bridge).toContain('isReviewedGodPharaohsGiftExile(');
    expect(bridge).toContain('"God-Pharaoh\'s Gift".equals(source.getName())');
    expect(bridge).toContain('"Creature.YouCtrl".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RememberChanged"))');
  });

  it("owns only Nissa's Encouragement's three named library-or-graveyard searches", () => {
    expect(bridge).toContain('isReviewedNissasEncouragementSearch(');
    expect(bridge).toContain('"Nissa\'s Encouragement".equals(source.getName())');
    expect(bridge).toContain('Set.of("Card.namedForest", "Card.namedBrambleweft Behemoth",');
    expect(bridge).toContain('"Card.namedNissa; Genesis Mage")');
  });

  it("owns only Uncage the Menagerie's X bounded different-name library search", () => {
    expect(bridge).toContain('isReviewedUncageTheMenagerieSearch(');
    expect(bridge).toContain('"Uncage the Menagerie".equals(source.getName())');
    expect(bridge).toContain('"Creature.cmcEQX".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"True".equals(ability.getParam("DifferentNames"))');
    expect(bridge).toContain('card.getCMC() == ability.getXManaCostPaid()');
  });

  it("orders only Doomsday's remembered five-card library pile", () => {
    expect(bridge).toContain('isReviewedDoomsdayRearrange(');
    expect(bridge).toContain('"Doomsday".equals(source.getName())');
    expect(bridge).toContain('"Count$ValidLibrary Card.YouOwn".equals(source.getSVar("X"))');
    expect(bridge).toContain('cards.size() > 5');
  });

  it("owns only Pride Sovereign's exact tap-and-exert Cat token activation", () => {
    expect(bridge).toContain('isReviewedPrideSovereignExertCost(part, ability)');
    expect(bridge).toContain('"Pride Sovereign".equals(source.getName())');
    expect(bridge).toContain('"2".equals(ability.getParam("TokenAmount"))');
    expect(bridge).toContain('"w_1_1_cat_lifelink".equals(ability.getParam("TokenScript"))');
    expect(bridge).toContain('parts.get(0).getClass() == CostTap.class');
    expect(bridge).toContain('parts.get(1).getClass() == CostPartMana.class');
    expect(bridge).toContain('"{W}".equals(((CostPartMana) parts.get(1)).getMana().getSimpleString())');
  });

  it('keeps optional-trigger ordering separate from later trigger resolution decisions', () => {
    expect(bridge).toContain('PlaySpellAbility.playSpellAbility(player.getController(), player, ability)');
    expect(bridge).toContain('public boolean confirmTrigger(WrappedAbility wrapper)');
    expect(bridge).toContain('return session.confirmTrigger(getPlayer(), wrapper);');
  });

  it("owns only Samut, the Tested's exact optional double-strike target", () => {
    expect(bridge).toContain('isReviewedSamutTheTestedPumpTarget(ability)');
    expect(bridge).toContain('"Samut, the Tested".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Pump');
    expect(bridge).toContain('"Double Strike".equals(ability.getParam("KW"))');
    expect(bridge).toContain('"Creature".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('ability.getMinTargets() == 0');
    expect(bridge).toContain('ability.getMaxTargets() == 1');
    expect(bridge).toContain('parts.get(0).getClass() == CostPutCounter.class');
    expect(bridge).toContain('reviewedSamutTheTestedPumpTarget');
  });

  it("owns only Wander in Death's exact optional two-creature graveyard targets", () => {
    expect(bridge).toContain('isReviewedWanderInDeathTargets(ability)');
    expect(bridge).toContain('"Wander in Death".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.ChangeZone');
    expect(bridge).toContain('"Creature.YouOwn".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"Graveyard".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Hand".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('ability.getMinTargets() == 0');
    expect(bridge).toContain('ability.getMaxTargets() == 2');
    expect(bridge).toContain('session.chooseWanderInDeathTargets(getPlayer(), ability)');
  });
});
