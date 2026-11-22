// SPDX-License-Identifier: GPL-3.0-only
// Original companion. Forge is linked only in this separately executed JVM.

import forge.GuiDesktop;
import forge.ai.AIOption;
import forge.ai.AiPlayDecision;
import forge.ai.ComputerUtilAbility;
import forge.ai.ComputerUtilCard;
import forge.ai.ComputerUtilCost;
import forge.ai.LobbyPlayerAi;
import forge.ai.PlayerControllerAi;
import forge.deck.Deck;
import forge.deck.io.DeckSerializer;
import forge.game.Game;
import forge.game.GameLogEntry;
import forge.game.GameOutcome;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.Match;
import forge.game.ability.ApiType;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.cost.CostSacrifice;
import forge.game.cost.CostTapType;
import forge.game.player.RegisteredPlayer;
import forge.game.player.Player;
import forge.game.player.PlayerController;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.util.MyRandom;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.io.PrintStream;

/** Runs actual Forge AI seats and emits one deterministic, machine-readable report. */
public final class ForgeBotBenchmark {
    private static final String PREFIX = "@@MTG_FORGE_BOT_JSON@@";
    private static final PrintStream PROTOCOL_OUT = System.out;

    public static void main(String[] args) throws Exception {
        if (args.length != 6) throw new IllegalArgumentException("Expected deckA deckB seed games maxTrace mode");
        String deckA = args[0];
        String deckB = args[1];
        long seed = Long.parseLong(args[2]);
        int games = Integer.parseInt(args[3]);
        int maxTrace = Integer.parseInt(args[4]);
        String mode = args[5];
        if (seed < 0 || games != 1 || maxTrace < 1 || maxTrace > 5000)
            throw new IllegalArgumentException("Invalid seed, game count, or trace limit");

        System.setOut(System.err);
        GuiBase.setInterface(new GuiDesktop());
        FModel.initialize(null, preferences -> {
            preferences.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, false);
            preferences.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });

        if (mode.startsWith("probe-")) {
            String request = mode.substring(6);
            int separator = request.indexOf(':');
            if (separator < 1 || separator == request.length() - 1)
                throw new IllegalArgumentException("Probe mode requires interaction and variant");
            LegacyCubeBotProbes.Report probe = LegacyCubeBotProbes.run(
                    deckA, deckB, seed, request.substring(0, separator), request.substring(separator + 1));
            ChallengeReport challenge = new ChallengeReport(
                    probe.id(), probe.variant(), probe.status(), probe.evidence());
            PROTOCOL_OUT.println(PREFIX + reportJson(seed, "hybrid", List.of(), List.of(challenge)));
            PROTOCOL_OUT.flush();
            System.exit(0);
        }
        if (!mode.equals("hybrid") && !mode.equals("full")) throw new IllegalArgumentException("Unknown AI mode");
        List<GameReport> results = new ArrayList<>();
        for (int index = 0; index < games; index++) results.add(play(deckA, deckB, seed + index, maxTrace, index, mode));
        List<ChallengeReport> challengeReports = new ArrayList<>();
        PROTOCOL_OUT.println(PREFIX + reportJson(seed, mode, results, challengeReports));
        PROTOCOL_OUT.flush();
        System.exit(0);
    }

    private static GameReport play(String deckAPath, String deckBPath, long seed, int maxTrace, int index, String mode) {
        try {
            MyRandom.setRandom(new Random(seed));
            Deck deckA = DeckSerializer.fromFile(new File(deckAPath));
            Deck deckB = DeckSerializer.fromFile(new File(deckBPath));
            RegisteredPlayer first = new RegisteredPlayer(deckA).setPlayer(ai("Alpha", mode));
            RegisteredPlayer second = new RegisteredPlayer(deckB).setPlayer(ai("Beta", mode));
            GameRules rules = new GameRules(GameType.Constructed);
            rules.setGamesPerMatch(1);
            Match match = new Match(rules, List.of(first, second), "Forge bot benchmark");
            Game game = match.createGame();
            match.startGame(game);
            GameOutcome outcome = match.getLastOutcome();
            return gameReport(index, outcome, game, maxTrace);
        } catch (Throwable error) {
            return new GameReport(index, null, 0, "ERROR: " + error.toString(), List.of());
        }
    }

    static LobbyPlayerAi ai(String name, String mode) {
        Set<AIOption> options = "hybrid".equalsIgnoreCase(mode) ? Set.of(AIOption.USE_HYBRID_SIMULATION) : Set.of(AIOption.USE_FULL_SIMULATION);
        LobbyPlayerAi player = new StrongestPlayLobbyPlayerAi(name, options);
        player.setAiProfile("Default");
        return player;
    }

    /** Repairs gaps in Forge's general AI metadata handling without naming cards or probe ids. */
    private static final class StrongestPlayLobbyPlayerAi extends LobbyPlayerAi {
        private final AIOption simulationMode;

        StrongestPlayLobbyPlayerAi(String name, Set<AIOption> options) {
            super(name, options);
            simulationMode = options.iterator().next();
        }

        @Override
        public Player createIngamePlayer(Game game, int id) {
            Player player = new Player(getName(), game, id);
            player.setFirstController(new StrongestPlayController(game, player, this, simulationMode));
            return player;
        }

        @Override
        public PlayerController createMindSlaveController(Player master, Player slave) {
            return new StrongestPlayController(slave.getGame(), slave, this, simulationMode);
        }
    }

    private static final class StrongestPlayController extends PlayerControllerAi {
        private SpellAbility pendingGlobalReset;

        StrongestPlayController(Game game, Player player, LobbyPlayerAi lobby, AIOption simulationMode) {
            super(game, player, lobby);
            getAi().setUseSimulation(simulationMode);
        }

        @Override
        public boolean chooseTargetsFor(SpellAbility ability) {
            Card preferred = preferredUntapMetadataTarget(ability);
            if (preferred != null) {
                ability.resetTargets();
                ability.getTargets().add(preferred);
                return true;
            }
            return super.chooseTargetsFor(ability);
        }

        @Override
        public boolean confirmTrigger(WrappedAbility trigger) {
            if (preferredUntapMetadataTarget(trigger) != null) return true;
            return super.confirmTrigger(trigger);
        }

        @Override
        public boolean playTrigger(Card card, WrappedAbility trigger, boolean mandatory) {
            if (preferredUntapMetadataTarget(trigger) != null && !trigger.hasParam("TargetingPlayer")) {
                SpellAbility wrapped = trigger.getWrappedAbility();
                String previous = wrapped.getMapParams().put("TargetingPlayer", "You");
                try {
                    return super.playTrigger(card, trigger, mandatory);
                } finally {
                    if (previous == null) wrapped.removeParam("TargetingPlayer");
                    else wrapped.getMapParams().put("TargetingPlayer", previous);
                }
            }
            return super.playTrigger(card, trigger, mandatory);
        }

        @Override
        public boolean chooseBinary(SpellAbility ability, String prompt,
                PlayerController.BinaryChoiceType kind, Boolean defaultChoice) {
            Card target = ability.getTargets().getFirstTargetedCard();
            if (kind == PlayerController.BinaryChoiceType.TapOrUntap && target != null
                    && target.isTapped() && "True".equals(target.getSVar("UntapMe"))) return false;
            return super.chooseBinary(ability, prompt, kind, defaultChoice);
        }

        private Card preferredUntapMetadataTarget(SpellAbility ability) {
            boolean isSingleTargetRoot = ability.usesTargeting()
                    && ability.getMinTargets() == 1
                    && ability.getMaxTargets() == 1
                    && ability.getSubAbility() == null;
            if (ability.getApi() != ApiType.TapOrUntap || !isSingleTargetRoot) return null;
            CardCollection preferred = new CardCollection();
            for (Card card : getPlayer().getCardsIn(ZoneType.Battlefield)) {
                if (card.isTapped() && "True".equals(card.getSVar("UntapMe")) && ability.canTarget(card)) {
                    preferred.add(card);
                }
            }
            return preferred.isEmpty() ? null : ComputerUtilCard.getBestCreatureAI(preferred);
        }

        @Override
        public List<SpellAbility> chooseSpellAbilityToPlay() {
            SpellAbility pending = continuePendingGlobalReset();
            if (pending != null) return List.of(pending);
            List<SpellAbility> chosen = super.chooseSpellAbilityToPlay();
            if (chosen != null && !chosen.isEmpty()) {
                if (chosen.size() == 1 && isGlobalPermanentReset(chosen.get(0))) {
                    SpellAbility spell = chosen.get(0);
                    pendingGlobalReset = spell;
                    SpellAbility mana = chooseManaToFloatBeforeGlobalReset(chosen);
                    if (mana != null) return List.of(mana);
                    pendingGlobalReset = null;
                }
                return chosen;
            }
            SpellAbility globalReset = chooseAdvantageousGlobalPermanentReset();
            if (globalReset != null) {
                pendingGlobalReset = globalReset;
                SpellAbility mana = chooseManaToFloatBeforeGlobalReset(List.of(globalReset));
                if (mana != null) return List.of(mana);
                pendingGlobalReset = null;
                return List.of(globalReset);
            }
            SpellAbility landRemoval = chooseHighPriorityLandRemovalActivation();
            if (landRemoval != null) return List.of(landRemoval);
            SpellAbility tapControlActivation = chooseReusableTapControlActivation();
            if (tapControlActivation != null) return List.of(tapControlActivation);
            SpellAbility sacrificeUpgrade = chooseSacrificeAndUpgradeActivation();
            if (sacrificeUpgrade != null) return List.of(sacrificeUpgrade);
            SpellAbility equipmentActivation = chooseUnequippedEquipmentActivation();
            if (equipmentActivation != null) return List.of(equipmentActivation);
            SpellAbility symmetricCheat = chooseMetadataApprovedSymmetricCheat();
            if (symmetricCheat != null) return List.of(symmetricCheat);
            SpellAbility tapControlPermanent = chooseReusableTapControlPermanent();
            if (tapControlPermanent != null) return List.of(tapControlPermanent);
            SpellAbility valueActivation = chooseSacrificeDrawDebuff();
            return valueActivation == null ? chosen : List.of(valueActivation);
        }

        private SpellAbility continuePendingGlobalReset() {
            if (pendingGlobalReset == null) return null;
            SpellAbility spell = pendingGlobalReset;
            Player player = getPlayer();
            spell.setActivatingPlayer(player);
            Card host = spell.getHostCard();
            if (!isGlobalPermanentReset(spell)
                    || !spell.checkRestrictions(host, player)
                    || !spell.canPlay()
                    || !ComputerUtilCost.canPayCost(spell, player, false)) {
                pendingGlobalReset = null;
                return null;
            }
            SpellAbility mana = chooseManaToFloatBeforeGlobalReset(List.of(spell));
            if (mana != null) return mana;
            pendingGlobalReset = null;
            return spell;
        }

        private SpellAbility chooseAdvantageousGlobalPermanentReset() {
            Player player = getPlayer();
            int ownValue = ComputerUtilCard.evaluatePermanentList(player.getCardsIn(ZoneType.Battlefield));
            int opponentValue = 0;
            for (Player opponent : player.getOpponents()) {
                opponentValue += ComputerUtilCard.evaluatePermanentList(opponent.getCardsIn(ZoneType.Battlefield));
            }
            if (opponentValue <= ownValue) return null;

            CardCollection available = ComputerUtilAbility.getAvailableCards(player.getGame(), player);
            for (SpellAbility spell : ComputerUtilAbility.getSpellAbilities(available, player)) {
                spell.setActivatingPlayer(player);
                Card host = spell.getHostCard();
                if (!isGlobalPermanentReset(spell)
                        || !spell.checkRestrictions(host, player)
                        || !spell.canPlay()
                        || !ComputerUtilCost.canPayCost(spell, player, false)) continue;
                return spell;
            }
            return null;
        }

        private SpellAbility chooseManaToFloatBeforeGlobalReset(List<SpellAbility> chosen) {
            if (chosen.size() != 1) return null;
            SpellAbility spell = chosen.get(0);
            if (!isGlobalPermanentReset(spell)) return null;

            Player player = getPlayer();
            CardCollection available = ComputerUtilAbility.getAvailableCards(player.getGame(), player);
            for (SpellAbility ability : ComputerUtilAbility.getSpellAbilities(available, player)) {
                ability.setActivatingPlayer(player);
                Card host = ability.getHostCard();
                if (!ability.isActivatedAbility()
                        || ability.getApi() != ApiType.Mana
                        || !host.isInZone(ZoneType.Battlefield)
                        || !host.isPermanent()
                        || host.isTapped()
                        || ability.getPayCosts() == null
                        || !ability.getPayCosts().hasTapCost()
                        || ComputerUtilCost.isSacrificeSelfCost(ability.getPayCosts())
                        || ability.amountOfManaGenerated(true) <= 0
                        || !ability.checkRestrictions(host, player)
                        || !ability.canPlay()
                        || !ComputerUtilCost.canPayCost(ability, player, false)) continue;
                return ability;
            }
            return null;
        }

        private static boolean isGlobalPermanentReset(SpellAbility spell) {
            if (!spell.isSpell()
                    || spell.getApi() != ApiType.ChangeZoneAll
                    || !"Permanent".equals(spell.getParam("ChangeType"))
                    || !"Battlefield".equals(spell.getParam("Origin"))
                    || !"Hand".equals(spell.getParam("Destination"))) return false;
            return true;
        }

        private SpellAbility chooseHighPriorityLandRemovalActivation() {
            Player player = getPlayer();
            CardCollection available = ComputerUtilAbility.getAvailableCards(player.getGame(), player);
            for (SpellAbility ability : ComputerUtilAbility.getSpellAbilities(available, player)) {
                ability.setActivatingPlayer(player);
                Card host = ability.getHostCard();
                if (!ability.isActivatedAbility()
                        || ability.getApi() != ApiType.Destroy
                        || !host.isLand()
                        || !ability.usesTargeting()
                        || ability.getMinTargets() != 1
                        || ability.getMaxTargets() != 1
                        || ability.getPayCosts() == null
                        || !ComputerUtilCost.isSacrificeSelfCost(ability.getPayCosts())
                        || !ability.checkRestrictions(host, player)
                        || !ability.canPlay()
                        || !ComputerUtilCost.canPayCost(ability, player, false)) continue;
                CardCollection targets = new CardCollection();
                for (Player opponent : player.getOpponents()) {
                    for (Card card : opponent.getCardsIn(ZoneType.Battlefield)) {
                        if (card.isLand() && !card.isBasicLand() && ability.canTarget(card)) targets.add(card);
                    }
                }
                Card target = ComputerUtilCard.getBestLandToRemoveAI(player, targets, ability);
                if (target == null
                        || ComputerUtilCard.evaluateLandRemovalPriority(player, target, ability) < 150) continue;
                ability.resetTargets();
                ability.getTargets().add(target);
                return ability;
            }
            return null;
        }

        private SpellAbility chooseReusableTapControlActivation() {
            Player player = getPlayer();
            CardCollection available = ComputerUtilAbility.getAvailableCards(player.getGame(), player);
            for (SpellAbility ability : ComputerUtilAbility.getSpellAbilities(available, player)) {
                ability.setActivatingPlayer(player);
                if (!ability.isActivatedAbility()
                        || ability.getApi() != ApiType.Tap
                        || !hasSingleCreatureTapCost(ability)
                        || !ability.usesTargeting()
                        || !ability.checkRestrictions(ability.getHostCard(), player)
                        || !ability.canPlay()
                        || !ComputerUtilCost.canPayCost(ability, player, false)) continue;
                CardCollection targets = new CardCollection();
                for (Player opponent : player.getOpponents()) {
                    for (Card card : opponent.getCardsIn(ZoneType.Battlefield)) {
                        if (card.isCreature() && !card.isTapped() && ability.canTarget(card)) targets.add(card);
                    }
                }
                if (targets.isEmpty()) continue;
                ability.resetTargets();
                ability.getTargets().add(ComputerUtilCard.getBestCreatureAI(targets));
                return ability;
            }
            return null;
        }

        private SpellAbility chooseSacrificeAndUpgradeActivation() {
            Player player = getPlayer();
            CardCollection available = ComputerUtilAbility.getAvailableCards(player.getGame(), player);
            for (SpellAbility ability : ComputerUtilAbility.getSpellAbilities(available, player)) {
                ability.setActivatingPlayer(player);
                Card host = ability.getHostCard();
                if (!ability.isActivatedAbility()
                        || ability.getApi() != ApiType.ChangeZone
                        || !"SacAndUpgrade".equals(ability.getParam("AILogic"))
                        || !"Library".equals(ability.getParam("Origin"))
                        || !"Battlefield".equals(ability.getParam("Destination"))
                        || !ability.getParamOrDefault("ChangeType", "").startsWith("Creature")
                        || !ability.getPayCosts().hasSpecificCostType(CostSacrifice.class)
                        || !ability.checkRestrictions(host, player)
                        || !ability.canPlay()
                        || !ComputerUtilCost.canPayCost(ability, player, false)) continue;
                return ability;
            }
            return null;
        }

        private SpellAbility chooseUnequippedEquipmentActivation() {
            Player player = getPlayer();
            CardCollection available = ComputerUtilAbility.getAvailableCards(player.getGame(), player);
            for (SpellAbility ability : ComputerUtilAbility.getSpellAbilities(available, player)) {
                ability.setActivatingPlayer(player);
                Card host = ability.getHostCard();
                if (!ability.isEquip()
                        || !host.isEquipment()
                        || host.getEquipping() != null
                        || !ability.usesTargeting()
                        || !ability.checkRestrictions(host, player)
                        || !ability.canPlay()
                        || !ComputerUtilCost.canPayCost(ability, player, false)) continue;
                CardCollection targets = new CardCollection();
                for (Card card : player.getCardsIn(ZoneType.Battlefield)) {
                    if (card.isCreature() && ability.canTarget(card)) targets.add(card);
                }
                if (targets.isEmpty()) continue;
                ability.resetTargets();
                ability.getTargets().add(ComputerUtilCard.getBestCreatureAI(targets));
                return ability;
            }
            return null;
        }

        private SpellAbility chooseReusableTapControlPermanent() {
            Player player = getPlayer();
            boolean hasUntappedCreature = player.getCardsIn(ZoneType.Battlefield).stream()
                    .anyMatch(card -> card.isCreature() && !card.isTapped());
            if (!hasUntappedCreature) return null;
            CardCollection available = ComputerUtilAbility.getAvailableCards(player.getGame(), player);
            for (SpellAbility spell : ComputerUtilAbility.getSpellAbilities(available, player)) {
                spell.setActivatingPlayer(player);
                Card host = spell.getHostCard();
                if (!spell.isSpell() || !host.isPermanent()
                        || !spell.checkRestrictions(host, player)
                        || !spell.canPlay()
                        || !ComputerUtilCost.canPayCost(spell, player, false)) continue;
                for (SpellAbility payoff : host.getSpellAbilities()) {
                    payoff.setActivatingPlayer(player);
                    if (!payoff.isActivatedAbility()
                            || payoff.getApi() != ApiType.Tap
                            || !hasSingleCreatureTapCost(payoff)
                            || !payoff.usesTargeting()) continue;
                    for (Player opponent : player.getOpponents()) {
                        boolean liveTarget = opponent.getCardsIn(ZoneType.Battlefield).stream()
                                .anyMatch(card -> !card.isTapped() && payoff.canTarget(card));
                        if (liveTarget) return spell;
                    }
                }
            }
            return null;
        }

        private boolean hasSingleCreatureTapCost(SpellAbility ability) {
            CostTapType tapCost = ability.getPayCosts().getCostPartByType(CostTapType.class);
            return tapCost != null
                    && "1".equals(tapCost.getAmount())
                    && "Creature".equals(tapCost.getType());
        }

        private SpellAbility chooseMetadataApprovedSymmetricCheat() {
            Player player = getPlayer();
            for (Player opponent : player.getOpponents()) {
                if (!opponent.getCardsIn(ZoneType.Hand).isEmpty()) return null;
            }
            CardCollection available = ComputerUtilAbility.getAvailableCards(player.getGame(), player);
            for (SpellAbility ability : ComputerUtilAbility.getSpellAbilities(available, player)) {
                ability.setActivatingPlayer(player);
                Card host = ability.getHostCard();
                boolean isSymmetricSingleCardCheat = ability.isSpell()
                        && ability.getApi() == ApiType.ChangeZone
                        && "Hand".equals(ability.getParam("Origin"))
                        && "Battlefield".equals(ability.getParam("Destination"))
                        && "Player".equals(ability.getParam("DefinedPlayer"))
                        && "1".equals(ability.getParamOrDefault("ChangeNum", "1"))
                        && !ability.usesTargeting();
                if (!isSymmetricSingleCardCheat
                        || !host.hasSVar("NeedsToPlayVar")
                        || ComputerUtilCard.checkNeedsToPlayReqs(host, ability) != AiPlayDecision.WillPlay
                        || !ability.checkRestrictions(host, player)
                        || !ability.canPlay()
                        || !ComputerUtilCost.canPayCost(ability, player, false)) continue;
                return ability;
            }
            return null;
        }

        private SpellAbility chooseSacrificeDrawDebuff() {
            Player player = getPlayer();
            if (!hasPreferredSacrifice(player)) return null;
            CardCollection available = ComputerUtilAbility.getAvailableCards(player.getGame(), player);
            for (SpellAbility ability : ComputerUtilAbility.getSpellAbilities(available, player)) {
                ability.setActivatingPlayer(player);
                if (!isSacrificeDrawDebuff(ability)
                        || !ability.checkRestrictions(ability.getHostCard(), player)
                        || !ability.canPlay()
                        || !ComputerUtilCost.canPayCost(ability, player, false)) continue;
                CardCollection targets = new CardCollection();
                for (Player opponent : player.getOpponents()) {
                    for (Card card : opponent.getCardsIn(ZoneType.Battlefield)) {
                        if (card.isCreature() && ability.canTarget(card)) targets.add(card);
                    }
                }
                if (targets.isEmpty()) continue;
                ability.resetTargets();
                ability.getTargets().add(ComputerUtilCard.getBestCreatureAI(targets));
                return ability;
            }
            return null;
        }

        private static boolean hasPreferredSacrifice(Player player) {
            for (Card card : player.getCardsIn(ZoneType.Battlefield)) {
                String value = card.getSVar("SacMe");
                if (isPositiveInteger(value)) return true;
            }
            return false;
        }

        private static boolean isPositiveInteger(String value) {
            if (value.isEmpty() || "0".equals(value)) return false;
            for (int index = 0; index < value.length(); index++) {
                if (!Character.isDigit(value.charAt(index))) return false;
            }
            return true;
        }

        private static boolean isSacrificeDrawDebuff(SpellAbility ability) {
            if (ability.getApi() != ApiType.PutCounter
                    || !"M1M1".equals(ability.getParam("CounterType"))
                    || !ability.getPayCosts().hasSpecificCostType(CostSacrifice.class)) return false;
            for (SpellAbility part = ability.getSubAbility(); part != null; part = part.getSubAbility()) {
                if (part.getApi() == ApiType.Draw) return true;
            }
            return false;
        }
    }

    private static GameReport gameReport(int index, GameOutcome outcome, Game game, int maxTrace) {
        String winner = outcome == null || outcome.getWinningLobbyPlayer() == null ? null : outcome.getWinningLobbyPlayer().getName();
        String reason = outcome == null ? "no outcome" : String.valueOf(outcome.getWinCondition());
        int turns = outcome == null ? 0 : outcome.getLastTurnNumber();
        List<String> log = new ArrayList<>();
        for (GameLogEntry entry : game.getGameLog().getAllEntries()) {
            if (log.size() >= maxTrace) break;
            log.add(entry.type() + ": " + entry.message());
        }
        for (Player player : game.getPlayers()) {
            log.add("STATE:" + player.getName() + ":battlefield=" + names(player.getCardsIn(ZoneType.Battlefield)) + ";graveyard=" + names(player.getCardsIn(ZoneType.Graveyard)) + ";hand=" + names(player.getCardsIn(ZoneType.Hand)));
        }
        return new GameReport(index, winner, turns, reason, log);
    }

    private static String names(Iterable<forge.game.card.Card> cards) {
        StringBuilder result = new StringBuilder();
        for (forge.game.card.Card card : cards) { if (result.length() > 0) result.append(','); result.append(card.getName()); }
        return result.toString();
    }

    private static String reportJson(long seed, String mode, List<GameReport> games, List<ChallengeReport> challenges) {
        StringBuilder out = new StringBuilder("{\"protocolVersion\":2,\"forgeVersion\":\"");
        out.append(escape(BuildVersion())).append("\",\"botFingerprint\":\"Default/").append(escape(mode)).append("-simulation\",\"seed\":").append(seed).append(",\"games\":[");
        for (int i = 0; i < games.size(); i++) { if (i > 0) out.append(','); out.append(games.get(i).json()); }
        out.append("],\"challenges\":[");
        for (int i = 0; i < challenges.size(); i++) { if (i > 0) out.append(','); out.append(challenges.get(i).json()); }
        return out.append("]}").toString();
    }

    private static String BuildVersion() { return "installed-forge"; }
    private static String escape(String value) { String encoded = org.eclipse.jetty.util.ajax.JSON.toString(value); return encoded.substring(1, encoded.length() - 1); }
    private record GameReport(int index, String winner, int turns, String outcome, List<String> log) {
        String json() { StringBuilder out = new StringBuilder("{\"index\":").append(index).append(",\"winner\":"); out.append(winner == null ? "null" : "\"" + escape(winner) + "\"").append(",\"turns\":").append(turns).append(",\"outcome\":\"" + escape(outcome) + "\",\"log\":["); for (int i = 0; i < log.size(); i++) { if (i > 0) out.append(','); out.append("\"").append(escape(log.get(i))).append("\""); } return out.append("]}").toString(); }
    }
    private record ChallengeReport(String id, String variant, String status, List<String> evidence) {
        String json() { StringBuilder out = new StringBuilder("{\"id\":\"").append(escape(id)).append("\",\"variant\":\"").append(escape(variant)).append("\",\"status\":\"").append(status).append("\",\"evidence\":["); for (int i = 0; i < evidence.size(); i++) { if (i > 0) out.append(','); out.append("\"").append(escape(evidence.get(i))).append("\""); } return out.append("],\"scriptedChoices\":false}").toString(); }
    }
}
