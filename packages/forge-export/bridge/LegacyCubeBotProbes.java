// SPDX-License-Identifier: GPL-3.0-only
// Original, separately executed Forge companion. No choices are scripted.
import org.eclipse.jetty.util.ajax.JSON;
import com.google.common.eventbus.Subscribe;
import forge.deck.io.DeckSerializer;
import forge.game.*;
import forge.game.card.Card;
import forge.game.event.*;
import forge.game.player.*;
import forge.game.zone.ZoneType;
import forge.util.MyRandom;
import java.io.File;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

/** Controlled opportunities, not a claim of general Magic playing competence. */
public final class LegacyCubeBotProbes {
    public record Report(String id, String variant, String status, List<String> evidence) {}
    private record Fixture(String id, String variant, String spell, String target, String sacrifice, String secondary, List<String> hand,
            List<String> battlefield, List<String> graveyard, List<String> library,
            List<String> opponentBattlefield, int opponentLife) {}

    public static Report run(String deckA, String deckB, long seed, String id, String requestedVariant) {
        try {
            Path path = Path.of(System.getProperty("mtg.bot.probes"));
            Object[] fixtures = (Object[]) JSON.parse(Files.readString(path));
            List<Map<?, ?>> matches = new ArrayList<>();
            for (Object value : fixtures) {
                Map<?, ?> candidate = (Map<?, ?>) value;
                Object candidateVariant = candidate.get("variant");
                String normalizedVariant = candidateVariant instanceof String ? (String) candidateVariant : "default";
                if (id.equals(candidate.get("id")) && requestedVariant.equals(normalizedVariant)) matches.add(candidate);
            }
            if (matches.size() != 1) throw new IllegalArgumentException("Expected exactly one probe fixture variant");
            Map<?, ?> row = matches.get(0);
            Object variant = row.get("variant");
            Fixture fixture = new Fixture(id, variant instanceof String ? (String) variant : "default",
                    (String) row.get("spell"), (String) row.get("target"), (String) row.get("sacrifice"), (String) row.get("secondary"),
                    names(row, "hand"), names(row, "battlefield"), names(row, "graveyard"),
                    names(row, "library"), names(row, "opponentBattlefield"), ((Number) row.get("opponentLife")).intValue());
            MyRandom.setRandom(new Random(seed));
            RegisteredPlayer first = new RegisteredPlayer(DeckSerializer.fromFile(new File(deckA)))
                    .setPlayer(ForgeBotBenchmark.ai("Human", "hybrid"));
            RegisteredPlayer second = new RegisteredPlayer(DeckSerializer.fromFile(new File(deckB)))
                    .setPlayer(ForgeBotBenchmark.ai("AI", "hybrid"));
            Match match = new Match(new GameRules(GameType.Puzzle), List.of(first, second), id);
            Game game = match.createGame();
            Probe observer = new Probe(game, fixture);
            InitialState initial = new InitialState();
            initial.parse(lines(fixture));
            game.subscribeToEvents(observer);
            AtomicReference<Throwable> error = new AtomicReference<>();
            Thread thread = new Thread(() -> {
                try {
                    match.startGame(game, () -> {
                        initial.applyOnGameThread(game);
                        verify(game, fixture);
                        observer.evidence.add("Fixture variant: " + fixture.variant());
                        observer.evidence.add("Exact initial hands, libraries, battlefields, graveyards and life verified");
                        observer.armed = true;
                    });
                } catch (Throwable failure) { error.set(failure); }
            }, "forge-competence-probe");
            thread.start();
            thread.join(30000);
            if (thread.isAlive()) {
                game.setGameOver(GameEndReason.Draw);
                thread.interrupt();
                thread.join(2000);
                return new Report(id, fixture.variant(), "unproven", List.of("Probe exceeded its wall-clock safety bound"));
            }
            if (error.get() != null) return new Report(id, fixture.variant(), "unproven", List.of("Probe error: " + error.get()));
            observer.evidence.add("Objective: " + observer.objective());
            return new Report(id, fixture.variant(), observer.success ? "passed" : "unproven", List.copyOf(observer.evidence));
        } catch (Throwable error) { return new Report(id, requestedVariant, "unproven", List.of("Probe setup error: " + error)); }
    }

    /** The match callback already runs on the game thread; applyToGame otherwise queues asynchronously. */
    private static final class InitialState extends GameState {
        private void applyOnGameThread(Game game) { applyGameOnThread(game); }
    }

    private static List<String> names(Map<?, ?> row, String key) {
        return Arrays.stream((Object[]) row.get(key)).map(value -> (String) value).toList();
    }

    private static List<String> lines(Fixture f) {
        return List.of("humanlife=" + f.opponentLife(), "ailife=20", "activeplayer=ai", "activephase=MAIN1",
                "humanhand=", "humanlibrary=" + String.join(";", Collections.nCopies(40, "Island")),
                "humangraveyard=", "humanbattlefield=" + String.join(";", f.opponentBattlefield()),
                "aihand=" + String.join(";", f.hand()), "ailibrary=" + String.join(";", f.library()),
                "aigraveyard=" + String.join(";", f.graveyard()), "aibattlefield=" + String.join(";", f.battlefield()));
    }

    private static void verify(Game game, Fixture f) {
        Player own = game.getPlayers().get(1), opponent = game.getPlayers().get(0);
        verifyZone(own, ZoneType.Hand, f.hand());
        verifyZone(own, ZoneType.Library, f.library());
        verifyZone(own, ZoneType.Battlefield, f.battlefield());
        verifyZone(own, ZoneType.Graveyard, f.graveyard());
        verifyZone(opponent, ZoneType.Hand, List.of());
        verifyZone(opponent, ZoneType.Library, Collections.nCopies(40, "Island"));
        verifyZone(opponent, ZoneType.Battlefield, f.opponentBattlefield());
        verifyZone(opponent, ZoneType.Graveyard, List.of());
        if (own.getLife() != 20 || opponent.getLife() != f.opponentLife())
            throw new IllegalStateException("Initial life mismatch");
        if (game.getPhaseHandler().getPhase() != forge.game.phase.PhaseType.MAIN1
                || game.getPhaseHandler().getPlayerTurn() != own)
            throw new IllegalStateException("Initial active player or phase mismatch");
        if (own.getCardsIn(ZoneType.Battlefield).stream().anyMatch(c -> c.isTapped()))
            throw new IllegalStateException("Initial battlefield must be untapped");
    }

    private static void verifyZone(Player p, ZoneType zone, List<String> expected) {
        List<String> actual = p.getCardsIn(zone).stream().map(c -> c.getName()).sorted().toList();
        if (!actual.equals(expected.stream().sorted().toList()))
            throw new IllegalStateException(p.getName() + " " + zone + ": expected " + expected + ", got " + actual);
    }

    public static final class Probe {
        private final Game game;
        private final Fixture f;
        private final List<String> evidence = new ArrayList<>();
        private final Set<Integer> tokens = new HashSet<>();
        private final Set<Integer> controlTargets = new HashSet<>();
        private final Set<String> resetRocks = new HashSet<>();
        private boolean armed, success, cast, resolved, cheated, left, returned, sacrifice, searched, tutoredToHand, exactSacrifice, artifactDestroyed, drawn, recast, benefit, untapped, damage, landPlayed, tokenTapped, opponentTapped, attached, replayedLand, spentLand, secondaryMoved, floatedMana, rebuildCast, rebuildResolved;
        private int turns, resetTurn = -1, rebuildTurn = -1;
        private forge.game.phase.PhaseType resetPhase, rebuildPhase;
        private Probe(Game game, Fixture fixture) { this.game = game; this.f = fixture; }

        @Subscribe public void zone(GameEventCardChangeZone event) {
            if (!armed || event.card() == null || event.to() == null) return;
            String name = event.card().getOracleName();
            ZoneType from = event.from() == null ? null : event.from().zoneType();
            ZoneType to = event.to().zoneType();
            boolean own = event.card().getOwner().equals(game.getPlayers().get(1).getView());
            if (name.equals(f.spell()) && own && to == ZoneType.Stack
                    && (from == ZoneType.Hand || (f.id().equals("graveyard-value") && from == ZoneType.Graveyard))) {
                cast = true;
                if (f.id().equals("upheaval-mana")) {
                    resetTurn = turns;
                    resetPhase = game.getPhaseHandler().getPhase();
                }
            }
            if (f.id().equals("graveyard-value") && own && name.equals(f.spell())
                    && from == ZoneType.Hand && to == ZoneType.Battlefield) landPlayed = true;
            if ((f.id().equals("spells-density") || f.id().equals("tokens-wide") || f.id().equals("opposition-tokens"))
                    && own && event.card().isToken()
                    && to == ZoneType.Battlefield) tokens.add(event.card().getId());
            if (name.equals(f.target()) && own) {
                if (from == ZoneType.Hand && to == ZoneType.Battlefield) cheated = true;
                if (from == ZoneType.Battlefield && to == ZoneType.Exile) left = true;
                if (left && from == ZoneType.Exile && to == ZoneType.Battlefield) returned = true;
                if (from == ZoneType.Graveyard && to == ZoneType.Battlefield) searched = true;
                if (from == ZoneType.Library && to == ZoneType.Battlefield) searched = true;
                if (from == ZoneType.Library && to == ZoneType.Hand) tutoredToHand = true;
                if (from == ZoneType.Battlefield && to == ZoneType.Graveyard) sacrifice = true;
                if (sacrifice && from == ZoneType.Graveyard && to == ZoneType.Stack) recast = true;
                if (recast && from == ZoneType.Stack && to == ZoneType.Battlefield) returned = true;
                if (event.card().isToken() && to == ZoneType.Battlefield) tokens.add(event.card().getId());
            }
            if (own && f.sacrifice() != null && name.equals(f.sacrifice())
                    && from == ZoneType.Battlefield && to == ZoneType.Graveyard) exactSacrifice = true;
            if (f.id().equals("land-recursion") && own && name.equals(f.target())) {
                if (from == ZoneType.Graveyard && to == ZoneType.Battlefield) replayedLand = true;
                if (from == ZoneType.Battlefield && to == ZoneType.Graveyard) spentLand = true;
            }
            if (f.id().equals("land-recursion") && f.secondary() != null && name.equals(f.secondary())) {
                if (f.variant().equals("wasteland-replay") && !own
                        && from == ZoneType.Battlefield && to == ZoneType.Graveyard) secondaryMoved = true;
                if (f.variant().equals("fetchland-replay") && own
                        && from == ZoneType.Library && to == ZoneType.Battlefield) secondaryMoved = true;
            }
            if (f.id().equals("upheaval-mana") && own
                    && Set.of(f.target(), f.sacrifice(), f.secondary()).contains(name)) {
                if (cast && from == ZoneType.Battlefield && to == ZoneType.Hand) resetRocks.add(name);
                if (resolved && name.equals(f.target()) && from == ZoneType.Hand && to == ZoneType.Stack) {
                    rebuildCast = true;
                    rebuildTurn = turns;
                    rebuildPhase = game.getPhaseHandler().getPhase();
                }
            }
            if (own && from == ZoneType.Library && to == ZoneType.Hand && (returned || f.id().equals("mana-ramp") || sacrifice)) drawn = true;
            if (f.id().equals("natural-order") && own && Set.of("Llanowar Elves", "Elvish Mystic", "Fyndhorn Elves").contains(name)
                    && from == ZoneType.Battlefield && to == ZoneType.Graveyard) sacrifice = true;
            if (f.id().equals("artifact-engine") && from == ZoneType.Battlefield && to == ZoneType.Graveyard) {
                if (own && name.equals("Mind Stone")) sacrifice = true;
                if (!own && name.equals(f.target())) artifactDestroyed = true;
            }
            if (evidence.size() < 200 && (name.equals(f.spell()) || name.equals(f.target())
                    || (f.secondary() != null && name.equals(f.secondary())) || sacrifice || drawn))
                evidence.add("zone " + name + " " + from + " -> " + to + (event.card().isToken() ? " token#" + event.card().getId() : ""));
            check();
        }

        @Subscribe public void resolved(GameEventSpellResolved event) {
            if (!armed || event.hasFizzled() || event.spell().getHostCard() == null) return;
            var host = event.spell().getHostCard();
            if (!host.getController().equals(game.getPlayers().get(1).getView())) return;
            if (host.getOracleName().equals(f.spell())) {
                if (event.spell().isSpell()) resolved = true;
                else if (!f.id().equals("opposition-tokens") || !controlTargets.isEmpty()) benefit = true;
                evidence.add("resolved " + host.getOracleName() + (event.spell().isSpell() ? " spell" : " ability"));
            }
            if (f.id().equals("upheaval-mana") && host.getOracleName().equals(f.spell())
                    && event.spell().isSpell()) {
                floatedMana = game.getPlayers().get(1).getManaPool().totalMana() > 0;
            }
            if (f.id().equals("upheaval-mana") && host.getOracleName().equals(f.target())
                    && event.spell().isSpell() && rebuildCast) rebuildResolved = true;
            if (f.id().equals("blink-etb") && host.getOracleName().equals(f.target()) && returned && drawn) benefit = true;
            // Twin grants the copy ability to the enchanted creature, not to the Aura.
            if ((f.id().equals("twin-combo") || f.id().equals("kiki-combo"))
                    && host.getOracleName().equals(f.target()) && !event.spell().isSpell() && !tokens.isEmpty()) benefit = true;
            check();
        }

        @Subscribe public void cast(GameEventSpellAbilityCast event) {
            if (!armed || !f.id().equals("opposition-tokens") || !tokenTapped
                    || event.sa().isSpell() || event.sa().getHostCard() == null
                    || !event.sa().getHostCard().getOracleName().equals(f.spell())) return;
            for (var card : event.si().getTargetCards()) {
                if (card.getController().equals(game.getPlayers().get(0).getView())) controlTargets.add(card.getId());
            }
            if (!controlTargets.isEmpty()) evidence.add("activation targeted opposing permanent after observed token tap cost");
            check();
        }

        @Subscribe public void attached(GameEventCardAttachment event) {
            if (!armed || !f.id().equals("equipment") || event.equipment() == null || event.newTarget() == null) return;
            if (event.equipment().getName().equals(f.spell()) && event.newTarget().getName().equals(f.target())) {
                attached = true;
                evidence.add("attached " + event.equipment().getName() + " to " + event.newTarget().getName());
                check();
            }
        }

        @Subscribe public void damaged(GameEventPlayerDamaged event) {
            if (armed && event.source() != null && event.source().getOracleName().equals(f.spell())
                    && event.target().equals(game.getPlayers().get(0).getView()) && event.amount() >= 3) damage = true;
        }
        @Subscribe public void tapped(GameEventCardTapped event) {
            if (!armed) return;
            if (f.id().equals("opposition-tokens") && event.tapped()) {
                boolean own = event.card().getController().equals(game.getPlayers().get(1).getView());
                if (own && event.card().isToken() && tokens.contains(event.card().getId())) tokenTapped = true;
                if (!own && controlTargets.contains(event.card().getId())) opponentTapped = true;
                if (tokenTapped || opponentTapped)
                    evidence.add("tapped " + event.card().getOracleName() + (event.card().isToken() ? " token#" + event.card().getId() : ""));
                check();
            }
            if (!event.tapped() && !event.card().isToken()
                    && event.card().getController().equals(game.getPlayers().get(1).getView())
                    && (event.card().getOracleName().equals(f.spell()) || event.card().getOracleName().equals(f.target())) && !tokens.isEmpty()) untapped = true;
        }
        @Subscribe public void turn(GameEventTurnBegan event) {
            if (!armed) return;
            // Two ordinary copies on different turns do not establish a combo loop.
            if (f.id().equals("twin-combo") || f.id().equals("kiki-combo")) tokens.clear();
            untapped = false;
            if (f.id().equals("opposition-tokens")) {
                tokenTapped = false;
                opponentTapped = false;
                benefit = false;
                controlTargets.clear();
            }
            if (++turns >= 4) game.setGameOver(GameEndReason.Draw);
        }
        private String objective() {
            return "cast=" + cast + ", resolved=" + resolved + ", cheatedFromHand=" + cheated + ", blinkReturn=" + returned + ", sacrifice=" + sacrifice
                    + ", searched=" + searched + ", tutoredToHand=" + tutoredToHand + ", exactSacrifice=" + exactSacrifice
                    + ", artifactPayoffDestroyedTarget=" + artifactDestroyed + ", drawn=" + drawn + ", recast=" + recast + ", benefit=" + benefit
                    + ", tokenCopies=" + tokens.size() + ", untapped=" + untapped + ", boltDamage=" + damage
                    + ", landPlayed=" + landPlayed + ", tokenTapped=" + tokenTapped + ", opponentTapped=" + opponentTapped
                    + ", attached=" + attached + ", replayedLand=" + replayedLand + ", spentLand=" + spentLand
                    + ", secondaryMoved=" + secondaryMoved + ", resetRocks=" + resetRocks.size()
                    + ", floatedMana=" + floatedMana + ", rebuildCast=" + rebuildCast
                    + ", rebuildResolved=" + rebuildResolved + ", resetTurn=" + resetTurn
                    + ", rebuildTurn=" + rebuildTurn + ", resetPhase=" + resetPhase + ", rebuildPhase=" + rebuildPhase;
        }
        private void check() {
            if (success) return;
            if (f.id().equals("graveyard-value")) {
                boolean targetPresent = game.getPlayers().get(1).getCardsIn(ZoneType.Battlefield).stream()
                        .anyMatch(c -> c.getName().equals(f.target()));
                boolean met = switch (f.variant()) {
                    case "uro-escape" -> cast && resolved && targetPresent;
                    case "bloodghast-landfall" -> landPlayed && searched && targetPresent;
                    default -> false;
                };
                if (met) { success = true; evidence.add("Verified autonomous objective: " + objective()); game.setGameOver(GameEndReason.Draw); }
                return;
            }
            if (!cast || !resolved) return;
            long presentBoostedTokens = game.getPlayers().get(1).getCardsIn(ZoneType.Battlefield).stream()
                    .filter(c -> tokens.contains(c.getId()))
                    .filter(c -> c.getNetPower() >= 2 && c.getNetToughness() >= 2)
                    .count();
            boolean tappedObservedToken = game.getPlayers().get(1).getCardsIn(ZoneType.Battlefield).stream()
                    .anyMatch(c -> tokens.contains(c.getId()) && c.isTapped());
            boolean tappedOpponentTarget = game.getPlayers().get(0).getCardsIn(ZoneType.Battlefield).stream()
                    .anyMatch(c -> controlTargets.contains(c.getId()) && c.isTapped());
            Card equipment = game.getPlayers().get(1).getCardsIn(ZoneType.Battlefield).stream()
                    .filter(c -> c.getName().equals(f.spell())).findFirst().orElse(null);
            Card equippedCreature = game.getPlayers().get(1).getCardsIn(ZoneType.Battlefield).stream()
                    .filter(c -> c.getName().equals(f.target())).findFirst().orElse(null);
            boolean targetInHand = game.getPlayers().get(1).getCardsIn(ZoneType.Hand).stream()
                    .anyMatch(c -> c.getName().equals(f.target()));
            boolean targetPresent = game.getPlayers().get(1).getCardsIn(ZoneType.Battlefield).stream()
                    .anyMatch(c -> c.getName().equals(f.target()));
            Card toolboxSource = game.getPlayers().get(1).getCardsIn(ZoneType.Battlefield).stream()
                    .filter(c -> c.getName().equals(f.spell())).findFirst().orElse(null);
            boolean sourceTapped = toolboxSource != null && toolboxSource.isTapped();
            boolean rebuildPresent = game.getPlayers().get(1).getCardsIn(ZoneType.Battlefield).stream()
                    .anyMatch(c -> c.getName().equals(f.target()));
            boolean exactAttachment = equipment != null && equippedCreature != null
                    && equipment.getEquipping() != null && equipment.getEquipping().getId() == equippedCreature.getId();
            boolean equipmentStats = equippedCreature != null && switch (f.variant()) {
                case "wargear-elf" -> equippedCreature.getNetPower() == 4 && equippedCreature.getNetToughness() == 3;
                case "fire-ice-wall" -> equippedCreature.getNetPower() == 2 && equippedCreature.getNetToughness() == 6;
                default -> false;
            };
            boolean met = switch (f.id()) {
                case "fundamentals" -> damage;
                case "reanimate" -> searched && game.getPlayers().get(1).getCardsIn(ZoneType.Battlefield).stream().anyMatch(c -> c.getName().equals(f.target()));
                case "cheat-threat" -> cheated;
                case "spells-density" -> !tokens.isEmpty();
                case "tokens-wide" -> tokens.size() >= 2 && presentBoostedTokens == tokens.size();
                case "opposition-tokens" -> !tokens.isEmpty() && tokenTapped && opponentTapped && benefit
                        && tappedObservedToken && tappedOpponentTarget;
                case "equipment" -> attached && exactAttachment && equipmentStats;
                case "creature-toolbox" -> switch (f.variant()) {
                    case "primal-command" -> tutoredToHand && targetInHand;
                    case "birthing-pod" -> exactSacrifice && searched && targetPresent && sourceTapped;
                    default -> false;
                };
                case "land-recursion" -> switch (f.variant()) {
                    case "wasteland-replay" -> replayedLand && spentLand && secondaryMoved;
                    case "fetchland-replay" -> replayedLand && spentLand && secondaryMoved;
                    default -> false;
                };
                case "upheaval-mana" -> resetRocks.size() == 3
                        && floatedMana && rebuildCast && rebuildResolved && rebuildPresent
                        && (resetPhase == forge.game.phase.PhaseType.MAIN1
                                || resetPhase == forge.game.phase.PhaseType.MAIN2)
                        && rebuildPhase == resetPhase && rebuildTurn == resetTurn;
                case "blink-etb" -> left && returned && drawn && benefit;
                case "natural-order" -> sacrifice && searched;
                case "green-suns-zenith" -> searched
                        && game.getPlayers().get(1).getCardsIn(ZoneType.Battlefield).stream()
                                .anyMatch(c -> c.getName().equals(f.target()))
                        && game.getPlayers().get(1).getCardsIn(ZoneType.Library).stream()
                                .anyMatch(c -> c.getName().equals(f.spell()));
                case "mana-ramp" -> searched && drawn;
                case "twin-combo", "kiki-combo" -> tokens.size() >= 2 && untapped && benefit;
                case "sacrifice-loop" -> sacrifice && recast && returned && drawn && benefit;
                // Daretti converts artifact fodder into removal, not a library search.
                case "artifact-engine" -> sacrifice && artifactDestroyed && benefit;
                default -> false;
            };
            if (met) { success = true; evidence.add("Verified autonomous objective: " + objective()); game.setGameOver(GameEndReason.Draw); }
        }
    }
}
