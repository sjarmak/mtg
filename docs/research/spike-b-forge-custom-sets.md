# Spike B — custom-set round trip through Forge

Run 2026-08-09 against Forge 2.0.14 on the lab box. The toy set is the DSL's own fixture set
(`EXAMPLE_SET` in `@mtg/dsl`): 16 nonland cards covering all ten effect primitives, all nine
evergreen keywords, all four targeting modes, five colors plus colorless, plus the five basic
lands. It was exported by `@mtg/forge-export`'s transpiler, not hand-written.

**Verdicts**

| Question | Answer |
|---|---|
| Does a transpiled custom set load in Forge? | **Yes** — 16 card scripts and 1 token script loaded, 0 complaints |
| Does it play? | **Yes** — AI-vs-AI game completed, custom cards cast and resolved |
| Is a boot-and-play gate trustworthy? | **Only with output parsing** — Forge exits 0 on both a missing card and a crashing card script |
| Do draft boosters work for custom editions? | **Partial** — the data path exists and `Type=Custom` is a first-class edition type, but no headless entry point can generate a booster, so the last step is unverified here |

---

## 1. What was exported

`transpileSet(EXAMPLE_SET, …)` produced, under Forge's documented user-content tree
(`<userDir>/custom/{cards,editions,tokens}`, per the distribution's own
`docs/Creating-a-custom-Set.md`):

- `editions/SLC.txt` — `[metadata]` with `Type=Custom`, then 21 `[cards]` entries;
- `cards/*.txt` — 16 card scripts;
- `tokens/g_2_2_bear.txt` — 1 token script.

Two shape decisions are visible in that list and both were deliberate:

1. **The five basic lands got no card script.** They are listed in `[cards]` with rarity code `L`
   and reuse Forge's own printings. Forge's custom-set doc is explicit that a custom card sharing a
   name with a real card is a conflict, and the only sanctioned exceptions are reprints and basic
   lands. `transpileCard` marks these `stock: true`.
2. **Tokens are emitted as scripts, not inlined.** Modern Forge references tokens by script name
   (`TokenScript$ g_2_2_bear`), so a token-making card without its token script crashes the game —
   the custom-set doc calls this out by name.

Two sample outputs, next to the Forge cards they are shaped after:

```
Name:Lightning Lash                             Name:Lightning Strike        (res/cardsfolder)
ManaCost:1 R                                    ManaCost:1 R
Types:Instant                                   Types:Instant
A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 |  A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 |
  SpellDescription$ CARDNAME deals 3 damage        SpellDescription$ CARDNAME deals 3 damage
  to any target.                                   to any target.
Oracle:Lightning Lash deals 3 damage to any     Oracle:Lightning Strike deals 3 damage to any
  target.                                          target.
```

```
Name:Radiant Charge
ManaCost:1 W
Types:Instant
A:SP$ Pump | ValidTgts$ Creature | NumAtt$ +2 | NumDef$ +2 | SubAbility$ DBEffect1 | SpellDescription$ Target creature gets +2/+2 until end of turn. You gain 2 life.
SVar:DBEffect1:DB$ GainLife | Defined$ You | LifeAmount$ 2
DeckHas:Ability$LifeGain
Oracle:Target creature gets +2/+2 until end of turn. You gain 2 life.
```

The multi-effect chaining follows Forge's own `SubAbility$` convention (`Aang's Defense`, `Absorb`
in the shipped corpus): the whole printed text sits on the primary `A:` line, each subsequent
effect is an `SVar:DBEffect<n>` link.

---

## 2. Round trip: it loads and it plays

```
$ DISPLAY=:99 npx tsx packages/forge-export/src/cli.ts boot-gate
{ "status": "passed", "setCode": "SLC", "cardCount": 21, "problemCards": [],
  "forgeVersion": "2.0.14",
  "games": [{ "gamesPlayed": 1, "outcomes": ["Ai(1)-bootgate-slc-1 has won!"], "durationMs": 7152 }] }
```

Direct evidence that the custom content, and not just Forge's stock corpus, was loaded — from the
run's own output:

```
Read cards: 33617 archived files in 0 ms (25 parts) using thread pool   <- Forge's corpus
Read cards: 16 files in 0 ms (1 parts) using thread pool                <- our custom/cards
Read cards: 836 files in 0 ms (8 parts) using thread pool               <- Forge's loose scripts
Read cards: 1 files in 0 ms (1 parts) using thread pool                 <- our custom/tokens
```

And from a full-log run of the same decks, custom cards actually being played:

```
Skywatch Sentinel   ×19 mentions
Lightning Lash      ×4
Bronze Monument     ×2
```

The gate builds its decks from the set itself (one copy of every nonland card, padded to 60 with
basics in the colors those cards need) precisely so that "did this script load" becomes an
observable property of a real game rather than a claim.

---

## 3. Forge exits 0 when your set is broken — twice over

This is the most important finding of the spike, and it is what the boot gate is built around.

**Control 1 — a card Forge does not have.** Replace one deck line with a nonexistent card name:

```
An unsupported card was requested: "Nonexistent Bogus Card" from "SLC".
An unsupported card was requested: "Nonexistent Bogus Card" from "[N.A.]".
...
Game Result: Game 1 ended in 1836 ms. Ai(2)-bootgate-slc-2 has won!
$ echo $?
0
```

Forge drops the card, plays a 59-card deck, declares a winner, and exits 0.

**Control 2 — a card script that names something outside Forge's enums.** Change one ability line
to `A:SP$ NotARealApi | …`:

```
java.lang.RuntimeException: crash in raw Ability, check card script of Lightning Lash
Caused by: java.lang.RuntimeException: AbilityFactory:getAbility: crash when trying to create ability  of card: Lightning Lash
Caused by: java.lang.RuntimeException: Element NotARealApi not found in ApiType enum
...
Game Result: Game 1 ended in 95 ms. Ai(2)-bootgate-slc-2 has won!
$ echo $?
0
```

The game aborts after 95 ms (versus ~1,800 ms healthy), Forge still prints a `Game Result` line,
and still exits 0.

**Therefore a conformance gate must parse output, not exit codes.** `bootGate` fails on any of:
a card of our set named in an `An unsupported card was requested` line; a `crash in raw Ability,
check card script of <Name>` trace; any Java exception in the transcript (clean 100-game runs
contain zero); no completed game; or a timeout. Both control transcripts are unit-test fixtures in
`packages/forge-export/test/sim-output.test.ts`, so the detection cannot silently rot.

---

## 4. Draft boosters for custom editions — partial

The undocumented question from the engines lane. Here is exactly what is established and what is
not.

**Established:**

1. `Type=Custom` is not a second-class citizen. Forge's `CardEdition$Type` enum contains a
   `CUSTOM_SET` member alongside `CORE`, `EXPANSION`, `DRAFT` and the rest; the custom-set doc
   states `Type=Custom` only changes image-download behavior.
2. The edition format's booster grammar is the ordinary one. Stock editions carry a plain
   `Booster=10 Common, 3 Uncommon, 1 RareMythic, 1 BasicLand` line (e.g. `res/editions/Magic
   2010.txt`); modern sets use the richer `BoosterSlots=…` + print-sheet form (`Duskmourn`). The
   simple form needs no print-sheet definitions, and our `[cards]` rarity codes (`C/U/R/L`) are
   exactly what it consumes.
3. `renderEdition` in `@mtg/forge-export` takes an optional `booster` string, so emitting the line
   is a one-argument change, not new work.
4. Adding a `Booster=` line to the custom edition did not perturb loading or play: three variants
   (no line, a valid line, a deliberately bogus `1 TotallyBogusSlot` line) all loaded and played
   identically with zero booster-related log output. **Booster templates are parsed lazily**, so
   this test proves only that the line is harmless — it does not prove the line is honored.
5. Forge's draft path filters editions through `CardEdition$Predicates.CAN_MAKE_BOOSTER` and
   `CardEdition.isDraftable` (both present in `forge/card/CardEdition`), i.e. the gate is
   "does this edition have a booster template", not "is this edition official".
6. The documented route for making arbitrary sets appear as a draftable/sealed block is
   `res/blockdata/fantasyblocks.txt` (distribution `docs/fantasy-blocks.md`; current line format is
   `Name, Draft/Sealed/Lands, Sets…` as in `blocks.txt`). That file lives in the Forge distribution,
   not in the user's `custom/` tree, so it is an edit to the artifact rather than user content.

**Not established, and why:** that a custom edition actually appears in the Booster Draft dialog and
yields legal 15-card packs. Forge exposes **no headless draft entry point** — `sim` takes finished
decks and nothing else (`docs/AI.md`), and booster generation only runs behind the Swing draft,
sealed and quest screens. The GUI does start under Xvfb, but driving it needs `xdotool`-class
automation that is not on this box. The obvious alternative — a small Java probe calling
`CardEdition.isDraftable` and `BoosterGenerator` in-process — is **deliberately not written**:
Forge is GPL-3.0 and this project's standing rule is subprocess-only, never linked.

**Verdict: partial.** Everything under our control (edition file, rarity codes, booster line) is in
place and cheap; the remaining risk is entirely inside Forge's draft-screen filtering, and it is a
two-minute manual check for anyone with a desktop (§6). Nothing in the phase-1 slice depends on the
answer — the boot gate uses constructed decks, and the drafting lane is Draftmancer's job per
`decision-synthesis.md` §4.

---

## 5. Round-trip repro

```bash
# Forge distribution + Xvfb: see spike-a-forge-throughput.md §7 steps 0-2.
DISPLAY=:99 npx tsx packages/forge-export/src/cli.ts boot-gate            # transpile, boot, play
DISPLAY=:99 npx tsx packages/forge-export/src/cli.ts export /tmp/slc-out  # files only, no Forge
```

The gate writes to `tools/forge/dist/userdata/custom/` and
`tools/forge/dist/userdata/decks/constructed/`, and points Forge at that sandbox by writing
`forge.profile.properties` into the distribution — so a lab run never touches a developer's own
`~/.forge` profile.

Reproducing the two controls in §3:

```bash
D=tools/forge/dist; JAR=$D/forge-gui-desktop-2.0.14-jar-with-dependencies.jar
# control 1: unknown card in a deck
sed -i 's/1 Skywatch Sentinel|SLC/1 Nonexistent Bogus Card|SLC/' \
  $D/userdata/decks/constructed/bootgate-slc-1.dck
# control 2: broken ability line in a card script
sed -i 's/SP\$ DealDamage/SP$ NotARealApi/' $D/userdata/custom/cards/lightning_lash.txt
(cd $D && DISPLAY=:99 java -jar $(basename $JAR) sim -D "$PWD/userdata/decks/constructed" \
   -d bootgate-slc-1.dck bootgate-slc-2.dck -n 1 -q; echo "exit=$?")
```

---

## 6. The one manual step left

For anyone with a graphical desktop, ~2 minutes settles §4:

1. Add `Booster=10 Common, 3 Uncommon, 1 RareMythic, 1 BasicLand` to
   `<userDir>/custom/editions/SLC.txt` (or pass `booster` to `renderEdition`).
2. Launch `forge.sh`, choose **New Game → Draft → Booster Draft**.
3. Look for `SLC` in the set/block chooser. If it is there, open a pack and confirm the slot
   counts; if it is not, add a `fantasyblocks.txt` line for `SLC` and retry.
4. Record the outcome here and flip §4's verdict to yes or no.

---

## 7. What this changes downstream

- The oracle gate in `decision-synthesis.md` §5 is **implemented and green** on the fixture set:
  `bootGate(cards)` transpiles, boots and plays, and returns `skipped` (never `passed`) when Forge
  or its display is missing.
- Forge's silent-success failure modes (§3) are the reason that gate parses transcripts. Any future
  consumer of Forge output — a metrics harness, a bridge — inherits the same warning: **`exit 0`
  from Forge means "the process finished", not "your content is sound".**
- Exported sets are playable by humans in Forge's GUI today, which is the graft-#3 capability the
  synthesis wanted from week one.
