# Spike C — can Forge carry the composition measurement?

Measured 2026-08-16 on the lab box, for `mtg-bc2.152.8`. Every number below came from a command run
on this machine; §8 reproduces them verbatim. Nothing is carried over from spike A except where it
is named and either confirmed or corrected.

**Verdict. Forge boots and plays headlessly here, and — new — it is bit-reproducible under `-s`. It
still cannot serve as the parity oracle `mtg-bc2.152.8` needs, and the blocker is now measured
rather than inferred: `sim` takes decks and nothing else, and its full game log contains no object
characteristics at all. Zero power/toughness strings appear in 1,732 lines across three fully logged
games. A CR 613 divergence is therefore invisible in `sim` output unless it changes who wins.** The
board-state serializer `mtg-bc2.152`'s notes name (`.pzl` plus `GameState`) does ship in the jar,
is bidirectional, and covers boards far larger than this spike would generate — 371 puzzles, median
13 battlefield permanents, one of 1,005. It is reachable only from the GUI: `forge.view.Main` knows
two modes, `sim` and `parse`. Closing that gap is exactly the bridge ADR-0001 §11 authorizes, and on
this box the bridge is blocked on one thing that is cheap to clear and was not previously recorded:
**there is no JDK installed, only a JRE.** `javac` does not exist.

**No divergence rate was measured, and none can be until the bridge exists.** §6 states what n
would be needed once it does; §7 argues the fallback substrate and recommends it as a pre-filter
rather than as the measurement.

---

## 1. Environment

| Fact | Value |
|---|---|
| Forge | 2.0.14, `forge-gui-desktop-2.0.14-jar-with-dependencies.jar`, from `tools/forge/dist` |
| JVM | OpenJDK 21.0.11 (Ubuntu), **JRE only** — `/usr/lib/jvm/java-21-openjdk-amd64/bin` holds `java`, `jpackage`, `keytool`, `rmiregistry`, and no `javac` |
| X server | `/usr/bin/Xvfb` present; the session's `DISPLAY` is empty |
| Host | Linux 7.0.0-28-generic, 16 logical CPUs |
| Decks | the two shipped precons spike A used, `Abzan Siege` (KTK) and `Air Forces` |
| Working directory | a scratchpad Forge home of symlinks into `tools/forge/dist` with its own `forge.profile.properties`; nothing under `tools/forge/` was written to |

---

## 2. Forge runs headlessly, and it is seed-reproducible

### 2.1 A display is still required, and `-Djava.awt.headless=true` does not substitute

Spike A §1.1 recorded that the desktop jar exits 1 printing nothing with no `DISPLAY`. Confirmed,
and extended: **passing `-Djava.awt.headless=true` also exits 1 printing nothing.** The requirement
is not AWT's headless mode, it is `forge.view.Main` constructing `forge.GuiDesktop` before it
dispatches to `sim`. Under `Xvfb :77` the same command exits 0.

| Command | Exit | Output |
|---|---|---|
| `java -jar <jar> sim … -n 1 -q -s 1`, no `DISPLAY` | 1 | none |
| the same plus `-Djava.awt.headless=true`, no `DISPLAY` | 1 | none |
| the same under `DISPLAY=:77` | 0 | 5 games in 8.5 s wall |

Five games at `-n 5 -q` took 8.5 s including start-up, which is consistent with spike A's ~1.06
games/s steady state and ~3.9 s fixed start-up. Throughput is not re-measured here.

### 2.2 `-s` reproduces, and this closes a standing open question

Spike A §5 left it explicitly open: the `-s` flag exists in `SimulateMatch`, parses with
`Long.parseLong`, and reaches `MyRandom.setRandom`, but nobody had run the probe. ADR-0001 §8 item 2
and `decision-synthesis.md` §7 item 2 both still carry it as unverified. It is now verified.

- **Quiet mode, `-n 5 -s 1`, run twice.** The `Game Result` winner lines are identical. The
  `Game Outcome` lines are identical.
- **Full log, `-n 3 -s 7`, run twice.** Both logs are 1,732 lines. With millisecond durations
  stripped, the whole-file diff is **14 lines**, all of them the six-line `GuiBase` start-up banner
  on each side, which carries a wall-clock timestamp. Every phase, mana payment, stack entry,
  resolution, damage assignment, zone change, mulligan, replacement effect and outcome is identical.
- **`-s 2` against `-s 1` disagrees on 3 of 5 game winners**, so the seed is doing work rather than
  the matchup being degenerate.

The measured statement: **an `-s`-seeded `sim` run is a reproducible trace at the granularity the
log reports.** Spike A §5's three consequences update as follows. Consequence 2 (balance CI cannot
pin a Forge number) is recoverable. Consequence 3 (bisecting a Forge divergence) is unblocked.
**Consequence 1 is unchanged and is the one that matters here**: a seed buys a Forge game we can
rerun, not a Forge game we can compare against ours field by field. §4 makes that precise.

---

## 3. What exists of a parity harness

`@mtg/forge-export` is 17 source files and 16 test files, and it is a **boot-and-play conformance
gate**, not a parity harness. `mtg-bc2.41` being open is accurate.

What it does today:

- `transpile.ts`, `card-script.ts`, `ability-script.ts`, `effect-script.ts`, `vocabulary-map.ts` —
  compile a DSL set into Forge card scripts, with `rejection.ts` failing loudly on any construct
  with no Forge mapping.
- `install.ts` — locates the distribution, writes `forge.profile.properties` so runs stay inside the
  gitignored artifact directory, and returns `null` rather than guessing when Forge is absent.
- `run.ts` — spawns `java -jar <jar> …` with a wall clock, captures stdout and stderr whole, reports
  `timedOut` rather than hanging. This is the whole subprocess boundary and it is sound.
- `boot-gate.ts` — transpile, write the set and decks, play games, and fail on transpile rejections,
  non-zero exit, zero completed games, an in-game exception, or a named card Forge could not load.
  It returns `skipped` with a reason when the environment cannot start Forge, and never returns
  `passed` for a check it did not run.
- `sim-output.ts` — parses `sim` output into games, outcomes, exceptions and the card-file count.

What it does not do, and cannot be extended to do through `sim`: set up a board, read a board back,
or compare anything against our kernel. There is no scenario type, no expected-state type, and no
diff anywhere in the package. The gate's assertion is "the set loads and a game finishes", which is
a strictly weaker claim than parity and is honest about being one.

---

## 4. Why `sim` cannot be the parity substrate — three independent reasons

Any one of these is fatal on its own.

**(a) There is no state in.** `forge.view.Main` dispatches on two mode strings, `sim` and `parse`,
and prints `Unknown mode. Known mode is 'sim', 'parse'` otherwise. `SimulateMatch`'s entire input
surface is its syntax line, read out of the shipped class file:

```
Syntax: forge.exe sim -d <deck1[.dck]> ... <deckX[.dck]> -D [D] -n [N] -m [M] -t [T] -p [P] -f [F] -s [S] -a [A] -q
```

Decks, deck directory, game count, match count, tournament type, player count, format, seed, AI
profile, quiet. Nothing that names a board. `parse` mode goes to
`forge.gui.card.CardReaderExperiments.parseAllCards`, which is a card-database exerciser.

**(b) There is no state out, and this is the reason that would survive a state loader.** A fully
logged three-game run is 1,732 lines whose entire vocabulary is events:

| line kind | count | line kind | count |
|---|---|---|---|
| `Phase:` | 934 | `Zone Change:` | 26 |
| `Mana:` | 217 | `Game Outcome:` | 9 |
| `Add To Stack:` | 85 | `Mulligan:` | 7 |
| `Resolve Stack:` | 78 | `Replacement Effect:` | 6 |
| `Turn:` | 73 | `Player Control:` | 6 |
| `Damage:` | 64 | `Match Result:` | 3 |
| `Combat:` | 62 | `Game Result:` | 3 |
| `Land:` | 51 | `Read cards:` | 2 |
| `Life:` | 41 | | |

**The count of strings matching `[0-9]+/[0-9]+` in that log is 0.** No power, no toughness, no
type line, no keyword set, no controller after a control-change, no timestamp. `Replacement Effect:`
lines exist and are the one continuous-effect class that is partly observable, at six occurrences in
three games and by effect name only. Layers are not observable at all. A kernel that computed
Humility plus a Glorious Anthem in the wrong order, or failed a 613.8 dependency reordering, would
produce a log identical to a correct one until the mis-sized creature changed a combat result — and
combat results are also the noisiest channel Forge has.

**(c) The choices are Forge's.** Even with a state loader and a state dumper, `sim` plays the game
with Forge's AI. Manabrew's method ("same decks, same seed, deterministic choices, diff the first
divergent field") needs our choices driven into the other engine. `-a` selects an AI profile; it
does not accept a decision list. A parity harness that has to agree on choices before it can compare
states is a harness that has to be driven, which is the bridge.

---

## 5. The substrate that would work, and the one thing missing

ADR-0001 §11 (working tree, uncommitted) authorizes the bridge and scopes it. Three facts measured
here bear on §11.4's stated unknowns, and none of them was previously in the record.

**The classpath is the shipped artifact.** The distribution ships no `forge-game` jar — only fat GUI
jars. It does not need to: the desktop fat jar contains **899 classes under `forge/game/`**,
including `forge/game/GameState.class`, `forge/game/StaticEffects.class`,
`forge/game/staticability/StaticAbilityLayer.class` and
`forge/game/replacement/ReplacementHandler.class`. A bridge compiles against
`-cp forge-gui-desktop-2.0.14-jar-with-dependencies.jar` with no Maven resolution, no network, and
no new dependency decision. §5's conditions are untouched: the jar stays a downloaded artifact and
the bridge stays a separate process.

**The readback the corpus needs already exists as public API.** `forge.game.card.Card` exposes
`getNetPower`, `getNetToughness`, `getType`, `getKeywords`, `getController`, `getTimestamp`,
`getLayerTimestamp` — and, usefully beyond what §11.4 asks for, `getNetPowerBreakdown` and
`getNetToughnessBreakdown`. A breakdown turns a divergence from "we say 3/3, Forge says 2/2" into
"we and Forge disagree at this layer", which is the difference between a bug report and a bug.

**`GameState` is bidirectional and the corpus format scales.** The class carries `parseLine`,
`parsePlayerString`, `applyToGame`, `applyGameOnThread`, `applyCountersToGameEntity`,
`countersToString`, and emits the `turn=`, `activeplayer=`, `activephase=`, `life=`, `counters=`,
`manapool=`, `landsplayed=` keys the `.pzl` files use. The GUI's puzzle-create screen writes it and
`PuzzleIO` reads it. Over the 371 shipped puzzles: **median 13 battlefield permanents, mean 17.9,
p90 25, max 1,005** (`PP30.pzl`, an Elf-token combo serialized in full), and **307 of 371 carry
per-card modifiers** across 2,447 modifier-bearing card entries — `|Tapped`, `|NoETBTrigs`,
`|Counters:`, `|Id:`, `|AttachedTo:`, `|Imprinting:`, `|ExiledWith:`, and inline `t:` token
definitions with explicit `P:`, `T:`, `Types:` and `Keywords:`. Whatever N this spike generates, the
format has already carried it.

Note what the modifiers are: **setup inputs, not computed characteristics.** A `GameState` round-trip
would confirm the board was built as asked. The comparison has to read `Card.getNetPower()` and
friends after `applyToGame`, which is the serializer §11.4 scopes and is why a `.pzl` dump alone is
not the oracle.

**The blocker: no JDK.** `javac` is absent; the JVM here is a JRE. Everything above is compile-time
work against the jar, so the bridge cannot be built on this box as it stands. That is the whole
blocker, it is one package, and it is worth recording precisely because it is invisible from the
issue titles: `java -version` succeeds, so every prior reading of this environment concluded Java was
present.

Two things `mtg-bc2.41` should verify in its first hour, once a JDK exists, because both change the
harness's shape and neither is settled by anything here. First, whether the bridge needs a display:
the requirement measured in §2.1 belongs to `forge.view.Main`, and a bridge with its own `main` that
never calls `GuiBase.setInterface(new GuiDesktop())` may need none — but `FModel.initialize`, which
loads the card database, takes an `IProgressBar` and reaches `forge.gui.FThreads` and
`forge.util.Localizer`, so "GUI-free" is a claim to test rather than assume. Second, whether the
card database can be loaded once and reused across scenarios, since spike A measured 3.9 s of
start-up dominated by 33,617 card scripts and a per-scenario JVM would put that in the inner loop.

---

## 6. What was not measured, and what n would be needed

**No divergence rate is reported here, at any N.** The bead's acceptance criterion is unmet and this
spike does not partially meet it. Nothing in §2 or §5 is evidence about composition; §2 is a
feasibility result and §5 is an inventory.

What was also not measured, and should not be inferred from this report:

- Whether our kernel and Forge agree on any layer case. No case was run against both.
- Whether Forge is *correct* on any layer case. The bead's own framing is that layers are where hobby
  engines are wrong in ways their own tests agree with, and adopting Forge as the oracle adopts its
  object model as the de-facto specification. ADR-0001 §11.5 makes that trade consciously; this
  report does not test it.
- Any error rate of Forge's own, at any board complexity. A proxy was considered — counting Forge's
  self-reported rules-engine complaints per game against decks of rising layer-relevant density —
  and rejected. It varies the deck to vary N, so game length, AI behavior and card pool move
  together with the treatment, and the readout is one engine's self-reports rather than a divergence
  between two. A number from it could not be attributed and would read as evidence.

**The n the real measurement needs.** Treat each scenario as a Bernoulli trial (the two engines'
per-object characteristic vectors agree, or they do not) and compare a low-N arm against a high-N
arm. Two-proportion, α = 0.05 two-sided, 80% power:

| Hypothesized divergence, low-N arm → high-N arm | scenarios per arm |
|---|---|
| 5% → 20% (climbing, coarse) | **75** |
| 5% → 10% (climbing, subtle) | **435** |

Three arms at N = 2, 4, 8 is therefore **225 scenarios** to catch a coarse climb and **1,305** to
catch a subtle one. That is small. At the measured ~1 s per Forge *game*, and a scenario being a
state application plus a characteristic dump rather than a game, the compute is minutes. **The cost
of this measurement is entirely the bridge, and none of it is the runs** — which also means a spike
that reports "too few scenarios to separate the hypotheses" would have no excuse.

One methodological consequence of the acceptance criterion's second half ("with the scenario
generator retained"). The generator has to be seeded and its scenarios have to be replayable as
fixtures, because ADR-0001 §10.7(c) wants divergences banked permanently on the pkmn/engine model
rather than harvested after the fact the way XMage's seven layer tests were. A generator that emits
scenarios and forgets them satisfies the letter and misses the point.

---

## 7. The fallback substrate, and whether it is worth doing

If the bridge is refused or deferred, the alternative is our kernel as its own differential subject.
It splits into two forms that are not equally useful.

**Hand-derived CR expectations do not scale, and are the failure mode already named.** Writing the
expected characteristic vector for an n-way scenario from the CR text is exactly what produced
XMage's seven layer tests and our own twelve CR 613 cases. ADR-0001 §10.5 records that interaction
tests in the mature engines are harvested rather than derived. Hand-deriving a few dozen more buys a
few dozen more cases and no rate, because the cases are chosen by the same person whose model of the
layer system is under test.

**Metamorphic invariants are the form that scales without an oracle, and they are not
self-consistency.** A metamorphic relation is a property the CR entails that the implementation does
not encode anywhere, so a violation is a real bug found without knowing the right answer. Four are
available cheaply against the existing layer system:

1. **Timestamp permutation of independent effects.** 613.7 orders by timestamp within a layer;
   effects that do not depend on each other must produce the same characteristics under any
   permutation of their timestamps. Generate k independent effects, permute, compare.
2. **Idempotence.** Recomputing continuous effects over an unchanged game state must yield an
   identical characteristic vector.
3. **Add-remove restoration.** Applying an effect and then removing it must restore the prior vector
   exactly, for every layer.
4. **Dependency-loop termination.** 613.8's loop rule is a stated behavior; a generator that plants
   loops of increasing length must not hang, and must apply in timestamp order when it breaks one.

Each gives a violation rate per scenario, each takes N as a parameter, and each is checkable with no
second engine. **This is worth building, as a pre-filter, and it is not the measurement.** Three
reasons, in order of how much they bite.

It cannot see a **uniform** error — every effect applied in the wrong layer, or the whole dependency
rule inverted — because permutation, idempotence and restoration all still hold under a consistently
wrong model. Uniform errors are precisely the class CR 613 bugs fall into, which is why
`mtg-bc2.41`'s own argument rejects self-consistency for layers. A flat metamorphic violation rate
is therefore consistent with both hypotheses the bead is trying to separate, and a climbing one is
evidence only about the bugs this instrument can see.

It answers a narrower question than the bead's. The bead asks whether N individually-correct card
implementations produce a correct engine; a metamorphic suite asks whether one engine's continuous
effects are internally coherent at scale. The second is a necessary condition for the first and is
nowhere near sufficient.

And it costs days where the bridge costs a week or so, so buying it *instead* saves less than it
looks. Building it *first* is genuinely cheap and pays twice: every violation it finds is a real
divergence, bankable as a §10.7(c) regression fixture immediately, and the scenario generator it
needs — the thing that plants k independent effects on a board and varies k — is the same generator
the bridge harness will consume. That generator is the reusable artifact in either world.

**Recommendation.** Build the scenario generator and the metamorphic suite now, in the kernel's own
lane, as `mtg-bc2.41`'s first half; install a JDK and build the bridge as its second; report the
divergence rate at N = 2, 4, 8 with 75 scenarios per arm and widen to 435 only if the coarse test is
ambiguous. Leave `mtg-bc2.152.8` open until the bridge has run, and do not let the metamorphic
numbers be quoted as its answer.

---

## 8. Exact commands

Every measurement above came from these. The scratchpad Forge home exists so that nothing under
`tools/forge/` is written to; it is symlinks plus one properties file.

```bash
# 0. a Forge home that writes nowhere near the artifact directory
S=/tmp/<scratchpad>
mkdir -p "$S/forgehome/userdata/decks/constructed"
cd "$S/forgehome"
for f in /path/to/mtg/tools/forge/dist/*; do
  b=$(basename "$f")
  case "$b" in forge.profile.properties|userdata) continue;; esac
  ln -sfn "$f" "$b"
done
printf 'userDir=%s\ncacheDir=%s\n' "$S/forgehome/userdata" "$S/forgehome/userdata/cache" \
  > forge.profile.properties
cp -f "/path/to/mtg/tools/forge/dist/res/quest/precons/Abzan Siege.dck" \
      userdata/decks/constructed/precon-a.dck
cp -f "/path/to/mtg/tools/forge/dist/res/quest/precons/Air Forces.dck" \
      userdata/decks/constructed/precon-b.dck

JAR=forge-gui-desktop-2.0.14-jar-with-dependencies.jar

# 1. §2.1 — the display requirement, and that headless mode does not substitute
java -Xmx2048m -jar $JAR sim -d precon-a.dck precon-b.dck -n 1 -q -s 1              # exit 1, no output
java -Xmx2048m -Djava.awt.headless=true -jar $JAR sim -d precon-a.dck precon-b.dck -n 1 -q  # exit 1, no output
Xvfb :77 -screen 0 1280x1024x24 -nolisten tcp &
time DISPLAY=:77 java -Xmx2048m -jar $JAR sim -d precon-a.dck precon-b.dck -n 5 -q -s 1     # exit 0, 8.5 s

# 2. §2.2 — seed reproducibility, quiet and full
for r in 1 2; do
  DISPLAY=:77 java -Xmx2048m -jar $JAR sim -d precon-a.dck precon-b.dck -n 3 -s 7 > full-s7-r$r.log 2>&1
done
diff <(sed 's/[0-9]\+ ms//g' full-s7-r1.log) <(sed 's/[0-9]\+ ms//g' full-s7-r2.log) | wc -l   # 14

# 3. §4(b) — the log carries no characteristics
grep -oE '^[A-Za-z][A-Za-z ]{0,24}:' full-s7-r1.log | sort | uniq -c | sort -rn
grep -cE '[0-9]+/[0-9]+' full-s7-r1.log                                                        # 0

# 4. §4(a), §5 — read the jar without extracting it
cd /path/to/mtg/tools/forge/dist
unzip -p $JAR forge/view/Main.class        | strings | grep -A2 'Unknown mode'
unzip -p $JAR forge/view/SimulateMatch.class | strings | grep 'Syntax:'
unzip -p $JAR forge/game/GameState.class   | strings | grep -iE 'parse|apply|counters'
unzip -p $JAR forge/game/card/Card.class   | strings | grep -oE 'getNet[A-Za-z]+'
unzip -l $JAR | grep -c '  forge/game/'                                                        # 899

# 5. §5 — the puzzle corpus
ls /path/to/mtg/tools/forge/dist/res/puzzle/*.pzl | wc -l                             # 371
```

Nothing was written under `tools/forge/`, `out/art/` or `out/XMP/`. The `Xvfb :77` process was
stopped afterward.
