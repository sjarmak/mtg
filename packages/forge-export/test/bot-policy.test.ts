import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const benchmark = readFileSync(new URL('../bridge/ForgeBotBenchmark.java', import.meta.url), 'utf8');
const probes = readFileSync(new URL('../bridge/LegacyCubeBotProbes.java', import.meta.url), 'utf8');

it('installs one strongest-play controller for ordinary matches and competence probes', () => {
  expect(benchmark).toContain('new StrongestPlayLobbyPlayerAi(name, options)');
  expect(benchmark.match(/\.setPlayer\(ai\(/g)).toHaveLength(2);
  expect(probes.match(/\.setPlayer\(ForgeBotBenchmark\.ai\(/g)).toHaveLength(2);
});

it('extends Forge through general ability and card metadata rather than probe identities', () => {
  expect(benchmark).toContain('ApiType.TapOrUntap');
  expect(benchmark).toContain('getSVar("UntapMe")');
  expect(benchmark).toContain('getSVar("SacMe")');
  expect(benchmark).toContain('ComputerUtilCard.checkNeedsToPlayReqs');
  expect(benchmark).toContain('ApiType.ChangeZone');
  expect(benchmark).toContain('getCardsIn(ZoneType.Hand).isEmpty()');
  expect(benchmark).toContain('ApiType.PutCounter');
  expect(benchmark).toContain('ApiType.Draw');
  expect(benchmark).not.toMatch(
    /Kiki|Pestermite|Yawgmoth|Gravecrawler|Show and Tell|Emrakul|Sneak Attack|Griselbrand|kiki-combo|sacrifice-loop|cheat-threat/,
  );
});

it('keeps untap triggers on Forge normal preparation and bounds target replacement', () => {
  expect(benchmark).toContain('ability.getMinTargets() == 1');
  expect(benchmark).toContain('ability.getMaxTargets() == 1');
  expect(benchmark).toContain('ability.getSubAbility() == null');
  expect(benchmark).toContain('getMapParams().put("TargetingPlayer", "You")');
  expect(benchmark).toContain('return super.playTrigger(card, trigger, mandatory)');
  expect(benchmark).not.toContain('ComputerUtil.playNoStack');
});

it('limits reusable tap-control fallback to one generic creature tap cost', () => {
  expect(benchmark).toContain('private boolean hasSingleCreatureTapCost(SpellAbility ability)');
  expect(benchmark).toContain('"1".equals(tapCost.getAmount())');
  expect(benchmark).toContain('"Creature".equals(tapCost.getType())');
  expect(benchmark.match(/hasSingleCreatureTapCost\(/g)).toHaveLength(3);
});

it('offers a legal unequipped Equipment activation to the best legal creature', () => {
  expect(benchmark).toContain('private SpellAbility chooseUnequippedEquipmentActivation()');
  expect(benchmark).toContain('ability.isEquip()');
  expect(benchmark).toContain('host.getEquipping() != null');
  expect(benchmark).toContain('ComputerUtilCard.getBestCreatureAI(targets)');
  expect(benchmark).not.toMatch(/Grafted Wargear|Sword of Fire and Ice|wargear-elf|fire-ice-wall/);
  expect(probes).toContain('case "equipment" -> attached && exactAttachment && equipmentStats');
  expect(probes).toContain('", attached=" + attached');
});

it('requires the selected opposing target to remain tapped', () => {
  expect(probes).toContain('.anyMatch(c -> controlTargets.contains(c.getId()) && c.isTapped())');
  expect(probes).not.toContain('tappedOpponentPermanent');
});

it('proves each creature-toolbox route by its exact cost and destination', () => {
  expect(probes).toContain('case "creature-toolbox" -> switch (f.variant())');
  expect(probes).toContain('case "primal-command" -> tutoredToHand && targetInHand');
  expect(probes).toContain(
    'case "birthing-pod" -> exactSacrifice && searched && targetPresent && sourceTapped',
  );
  expect(probes).toContain('from == ZoneType.Library && to == ZoneType.Hand');
  expect(probes).toContain('name.equals(f.sacrifice())');
});

it('offers only a legal payable metadata-declared sacrifice-and-upgrade activation', () => {
  expect(benchmark).toContain('private SpellAbility chooseSacrificeAndUpgradeActivation()');
  expect(benchmark).toContain('"SacAndUpgrade".equals(ability.getParam("AILogic"))');
  expect(benchmark).toContain('"Library".equals(ability.getParam("Origin"))');
  expect(benchmark).toContain('"Battlefield".equals(ability.getParam("Destination"))');
  expect(benchmark).toContain('ability.getPayCosts().hasSpecificCostType(CostSacrifice.class)');
  expect(benchmark).not.toMatch(/Birthing Pod|Primal Command|birthing-pod|primal-command/);
});

it('proves land recursion through an exact replay, sacrifice, and resulting land movement', () => {
  expect(probes).toContain('case "land-recursion" -> switch (f.variant())');
  expect(probes).toContain('case "wasteland-replay" -> replayedLand && spentLand && secondaryMoved');
  expect(probes).toContain('case "fetchland-replay" -> replayedLand && spentLand && secondaryMoved');
  expect(probes).toContain('from == ZoneType.Graveyard && to == ZoneType.Battlefield');
  expect(probes).toContain('from == ZoneType.Battlefield && to == ZoneType.Graveyard');
  expect(probes).toContain('name.equals(f.secondary())');
});

it('uses self-sacrificing land removal only against a high-priority opposing nonbasic', () => {
  expect(benchmark).toContain('private SpellAbility chooseHighPriorityLandRemovalActivation()');
  expect(benchmark).toContain('ability.getApi() != ApiType.Destroy');
  expect(benchmark).toContain('!host.isLand()');
  expect(benchmark).toContain('!ComputerUtilCost.isSacrificeSelfCost(ability.getPayCosts())');
  expect(benchmark).toContain('card.isLand() && !card.isBasicLand() && ability.canTarget(card)');
  expect(benchmark).toContain('ComputerUtilCard.evaluateLandRemovalPriority(player, target, ability) < 150');
  expect(benchmark).not.toMatch(
    /Crucible of Worlds|Wasteland|Flooded Strand|Gaea's Cradle|wasteland-replay|fetchland-replay/,
  );
});

it('proves Upheaval mana by returning three exact rocks and rebuilding in the same main phase', () => {
  expect(probes).toContain('case "upheaval-mana" -> resetRocks.size() == 3');
  expect(probes).toContain('floatedMana && rebuildCast && rebuildResolved && rebuildPresent');
  expect(probes).toContain('(resetPhase == forge.game.phase.PhaseType.MAIN1');
  expect(probes).toContain('|| resetPhase == forge.game.phase.PhaseType.MAIN2)');
  expect(probes).toContain('rebuildPhase == resetPhase && rebuildTurn == resetTurn');
  expect(probes).toContain('Set.of(f.target(), f.sacrifice(), f.secondary())');
  expect(probes).toContain('from == ZoneType.Battlefield && to == ZoneType.Hand');
  expect(probes).toContain('from == ZoneType.Hand && to == ZoneType.Stack');
  expect(probes).toContain('game.getPlayers().get(1).getManaPool().totalMana() > 0');
});

it('floats reusable permanent mana before a selected global permanent reset', () => {
  expect(benchmark).toContain('private SpellAbility pendingGlobalReset;');
  expect(benchmark).toContain('SpellAbility pending = continuePendingGlobalReset();');
  expect(benchmark).toContain('pendingGlobalReset = spell;');
  expect(benchmark).toContain('pendingGlobalReset = null;');
  expect(benchmark).toContain('private SpellAbility chooseAdvantageousGlobalPermanentReset()');
  expect(benchmark).toContain(
    'ComputerUtilCard.evaluatePermanentList(player.getCardsIn(ZoneType.Battlefield))',
  );
  expect(benchmark).toContain('opponentValue <= ownValue');
  expect(benchmark).toContain('private SpellAbility chooseManaToFloatBeforeGlobalReset(');
  expect(benchmark).toContain('spell.getApi() != ApiType.ChangeZoneAll');
  expect(benchmark).toContain('!"Permanent".equals(spell.getParam("ChangeType"))');
  expect(benchmark).toContain('!"Battlefield".equals(spell.getParam("Origin"))');
  expect(benchmark).toContain('!"Hand".equals(spell.getParam("Destination"))');
  expect(benchmark).toContain('ability.getApi() != ApiType.Mana');
  expect(benchmark).toContain('!host.isInZone(ZoneType.Battlefield)');
  expect(benchmark).toContain('!ability.getPayCosts().hasTapCost()');
  expect(benchmark).toContain('ComputerUtilCost.isSacrificeSelfCost(ability.getPayCosts())');
  expect(benchmark).toContain('ability.amountOfManaGenerated(true) <= 0');
  expect(benchmark).not.toMatch(
    /Upheaval|Grim Monolith|Coldsteel Heart|Worn Powerstone|monolith-rebuild|powerstone-rebuild/,
  );
});
