# Prior art: MTG rules engines & simulators

Lane report for the engine-strategy decision deferred in `docs/design-brief.md`. Researched 2026-08-09; every repo fact verified against the GitHub API or the repo's own files on that date. The question this lane answers: **build a custom TypeScript rules kernel + mechanics DSL, wrap an existing engine headless, or run a hybrid (deterministic kernel + LLM referee for uncompiled mechanics)?**

**Lane recommendation (detail in §8): hybrid, weighted heavily toward build.** Build the TS kernel + DSL as the lab's core (no adoptable TS engine exists; the co-design invariant demands we own the enforceable space), keep the DSL transpilable to Forge's card-script format so headless Forge serves as a second-opinion sim oracle, mine MIT-licensed XMage/Argentum for reference implementations of mechanics, and scope the LLM referee to narrow adjudication of not-yet-compiled mechanics with all game state owned by the kernel.

---

## 1. Forge (Card-Forge/forge) — the incumbent scriptable engine

Repo: <https://github.com/Card-Forge/forge>

| Fact | Value | Source |
|---|---|---|
| License | **GPL-3.0** — LICENSE file opens verbatim: "GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007" | <https://github.com/Card-Forge/forge/blob/master/LICENSE> |
| Health | 2,586 stars, 1,025 forks; release `forge-2.0.14` ("The Hobbit Release") published 2026-08-08; pushed 2026-08-09 | GitHub API, 2026-08-09 |
| Language | Java (17+ required) | <https://github.com/Card-Forge/forge/blob/master/README.md> |
| Card corpus | **~33,614 card script files** in `forge-gui/res/cardsfolder` (counted via git-trees API per letter directory, 2026-08-09) | <https://github.com/Card-Forge/forge/tree/master/forge-gui/res/cardsfolder> |

### 1.1 Card scripting DSL

Cards are plain-text property files, one per card, no Java per card ([Card scripting API wiki](https://github.com/Card-Forge/forge/wiki/Card-scripting-API)):

```
Name:Lightning Strike
ManaCost:1 R
Types:Instant
A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3
Oracle:Lightning Strike deals 3 damage to any target.
```

Line types: `A:` activated/spell abilities (`AB$`/`SP$` + an effect API name + `|`-separated params), `T:` triggered abilities, `S:` static abilities, `R:` **replacement effects**, `K:` keywords (parameterless and parameterized, e.g. `K:Flashback:{cost}`), `SVar:` computed variables (`Count$` is a general value-computation function). Double-faced cards via `AlternateMode`/`ALTERNATE`.

### 1.2 Custom-mechanic ceiling (the load-bearing question)

- **Composition of existing primitives = pure script, no Java.** The effect vocabulary is the `ApiType` enum: **~204 effect APIs** backed by **206 effect classes** in `forge-game/src/main/java/forge/game/ability/effects` ([ApiType.java](https://github.com/Card-Forge/forge/blob/master/forge-game/src/main/java/forge/game/ability/ApiType.java), counted from raw source 2026-08-09). Keywords are a Java enum of **~202 entries** with per-keyword classes ([keyword dir](https://github.com/Card-Forge/forge/tree/master/forge-game/src/main/java/forge/game/keyword) — includes crossover mechanics Forge itself ships, e.g. `Firebending.java`). Because `A/T/S/R/SVar` lines compose these primitives freely, a very large space of custom *cards* and many custom *mechanics* need zero Java.
- **New primitives = Java.** A genuinely new keyword action, effect API, zone, or turn-structure change means extending the enums and writing effect classes. The wiki notes some plaintext oddball keywords ("CARDNAME can't block unless…") are hardcoded rather than scriptable ([Card scripting API](https://github.com/Card-Forge/forge/wiki/Card-scripting-API)).
- **Custom sets are first-class user content**: `%appdata%/Forge/custom/{cards,editions,tokens}` with an edition file (`[metadata]` + `[cards]` list with rarity codes); custom creature types via `TypeLists.txt`. Draft-booster support for custom editions is **not documented** ([Creating a custom set](https://github.com/Card-Forge/forge/wiki/Creating-a-custom-set), [Creating a custom Card](https://github.com/Card-Forge/forge/wiki/Creating-a-custom-Card)). The Magic Set Editor community maintains a database of Forge-ready `.txt` files for custom sets, evidence this path is well-trodden ([MSE-Forge-Database](https://github.com/FLAREdirector-mse/MSE-Forge-Database)).

### 1.3 Headless sim & AI

- **Sim mode is built in**: `SimulateMatch.java` lives in `forge-gui-desktop` ([source](https://github.com/Card-Forge/forge/blob/master/forge-gui-desktop/src/main/java/forge/view/SimulateMatch.java)). CLI: `sim -d <deck1.dck> <deck2.dck> -n [games] -m [best-of] -f [format: Commander|Oathbreaker|Brawl|…] -t [Bracket|RoundRobin|Swiss] -p [players] -q (quiet) -c [clock-limit seconds, default 120]` ([AI wiki page](https://github.com/Card-Forge/forge/wiki/AI)).
- **AI is heuristic, not trained**: "The AI is *not* 'trained'. It uses basic rules and can be easy to overcome knowing its weaknesses." Strong at aggro/midrange, "poor to ok" at control, "pretty bad" at combo ([AI wiki](https://github.com/Card-Forge/forge/wiki/AI)). Community corroboration: Forge's AI is regarded as better than XMage's for goldfishing ([forge-mtg-tools README](https://github.com/jborden/forge-mtg-tools)); HN users report it "can't play any kind of combo… or even assemble Tron" and has weak multiplayer threat assessment ([HN thread on Forge](https://news.ycombinator.com/item?id=38651346)).
- **Throughput: no published numbers anywhere we could find.** The wiki's own caveat: games can become "almost unbearably long when the AI has a lot to think about"; the 120 s/game default clock bounds worst cases. Users routinely "bash 100's of games" per the wiki. **A local benchmark spike is required before any wrap decision leans on Forge for *mass* simulation.**

### 1.4 Embeddability from a TypeScript lab

Three proven or demonstrated paths:

1. **JVM subprocess** running `sim` and parsing text logs/results — zero engine work, weakest contract (results are printed logs, `-q` gives results-only output).
2. **JVM subprocess with a purpose-built Java bridge** speaking JSON over stdio — Forge is a clean Maven multi-module build (`forge-game` is GUI-free), so a thin driver against `forge-game` is straightforward Java, and this is what Manabrew's fallback path does (§2).
3. **GraalVM native-image**: Manabrew compiles a Forge harness into a **native shared library (`libforgeharness.so`) exposing a C ABI**, linked in-process into their Rust node — "no JVM, no jar subprocess" ([forge-harness/native/README.md](https://github.com/witchesofthehill/manabrew/blob/main/forge-harness/native/README.md)). Existence proof that in-process embedding from a non-JVM host works, at real build-toolchain cost (GraalVM JDK 21 + reflection configs).

**Verdict: interop.** Use headless Forge as an external validation oracle and secondary mass-sim backend for custom sets exported to its DSL; do not vendor GPL code into the TS codebase. (GPL-3.0 obligations trigger on distribution; a subprocess boundary plus non-commercial, non-distributed lab usage is unproblematic, but keep it at arm's length so shipped bundles stay clean.)

---

## 2. Manabrew (witchesofthehill/manabrew) — Rust reimplementation of Forge's DSL

Repo: <https://github.com/witchesofthehill/manabrew>

| Fact | Value | Source |
|---|---|---|
| License | **AGPL-3.0-or-later** for its own code ("This project is licensed under AGPL-3.0-or-later"); vendored `forge/` tree "remains GPL-3.0-or-later under its upstream terms"; protocol docs CC-BY-4.0 | <https://github.com/witchesofthehill/manabrew/blob/main/LICENSE.md> |
| Health | 28 stars, 13 forks; created 2026-05-18; release v3.9.2 2026-08-08; pushed 2026-08-09 | GitHub API, 2026-08-09 |
| Status | Self-described **pre-release**; "the Rust engine works for selected matchups, but broad card coverage is still in progress"; the Java-Forge-backed client is "the most practical way to play today" | <https://github.com/witchesofthehill/manabrew/blob/main/README.md> |

Why it matters to us despite its youth:

- **It treats Forge's card-script corpus as a reusable asset**: parses the `.txt` DSL into a typed IR (`SpellAbilityIr`, `TriggerIr`, `ReplacementEffectIr`, `StaticAbilityIr`) at card construction, deliberately lazy about `SVar` resolution because SVars depend on runtime state ([PARITY_AND_IR.md](https://github.com/witchesofthehill/manabrew/blob/main/docs/PARITY_AND_IR.md)). They wrote down the DSL's grammar and semantics ([forge-dsl-grammar.md](https://github.com/witchesofthehill/manabrew/blob/main/docs/forge-dsl-grammar.md), [forge-dsl-semantics.md](https://github.com/witchesofthehill/manabrew/blob/main/docs/forge-dsl-semantics.md)) — confirmation that Forge's DSL is a parseable, transpile-targetable format, not just config soup.
- **The parity-harness pattern**: run the new engine and Java Forge "with the same deck pair, seed, and deterministic choices," diff state snapshots, report "the first field-level divergence: phase, turn, player, object, and differing values" — described as "the core development tool for the engine," not a test suite ([PARITY_AND_IR.md](https://github.com/witchesofthehill/manabrew/blob/main/docs/PARITY_AND_IR.md)). This is exactly how a custom kernel de-risks the comprehensive-rules cliff: an oracle you diff against, mechanic by mechanic.
- The GraalVM native harness (§1.4) is their engineering, reusable as a recipe.

**Verdict: inspire.** AGPL rules out code adoption for anything we might distribute; the parity-harness methodology and the DSL-to-typed-IR compilation pattern are the highest-value imports. Watch the project: if the Rust engine matures, it becomes a wrappable, natively-embeddable Forge-compatible engine.

---

## 3. XMage (magefree/mage) — biggest card coverage, friendliest license, wrong shape

Repo: <https://github.com/magefree/mage>

| Fact | Value | Source |
|---|---|---|
| License | **MIT** — `LICENSE.txt` verbatim: "MIT License / Copyright (c) 2010 betasteward@gmail.com" | <https://github.com/magefree/mage/blob/master/LICENSE.txt> |
| Health | 2,328 stars, 926 forks; release `xmage_1.4.60V3` 2026-07-11; pushed 2026-08-09 | GitHub API, 2026-08-09 |
| Coverage | "full rules enforcement for over **31 000** unique cards and more than 91 000 reprints" | <https://github.com/magefree/mage/blob/master/readme.md> |

- **Custom cards require Java, one class per card.** There is no text DSL; every card is a Java class under `Mage.Sets/src/mage/cards/` (verified by directory listing: `AAT1.java`, `AJedisFervor.java`, …). Abilities are composed from a large Java class library, so per-card code is usually short, but the authoring loop for a generated set would be codegen-Java-compile-load. Custom sets exist (readme cites a Star Wars set) but were written by hand in Java.
- **Architecture is client/server** (`Mage.Server`, `Mage.Client`, `Mage.Common` modules); you can self-host a server and play vs AI; a "special test mode" supports preset game states ([Development-Testing-Tools wiki](https://github.com/magefree/mage/wiki/Development-Testing-Tools)). `Mage.Tests` contains a serverside functional-test framework plus `load`/`performance` suites (verified listing), which is how AI-vs-AI games run headless in practice.
- **Mass simulation is not a supported mode.** Community assessment: "XMage wasn't really designed for large-scale automated testing, so running 100–1000 games without GUI can be tricky… stability and accurate statistics can be an issue" ([slightlymagic forum via search](https://slightlymagic.net/forum/viewtopic.php?f=70&t=31061)). A developer on HN: XMage's JSON output is "mostly a couple of identifying fields and a string describing what happened" ([HN](https://news.ycombinator.com/item?id=38651346)).
- Its AI is generally considered weaker than Forge's for autoplay ([forge-mtg-tools README](https://github.com/jborden/forge-mtg-tools)).

**Verdict: inspire (mine it), skip (don't wrap it).** MIT means its 31k battle-tested mechanic implementations — including the layers system and replacement-effect machinery — are legally free to port into a TS kernel as reference logic, with attribution. As a headless sim backend it is the worst of the three Java engines: Java-per-card authoring, server-centric shape, no sim CLI.

---

## 4. Argentum Engine (wingedsheep/argentum-engine) — the modern architecture blueprint

Repo: <https://github.com/wingedsheep/argentum-engine>

| Fact | Value | Source |
|---|---|---|
| License | **MIT** — verbatim: "MIT License / Copyright (c) 2026 Vincent Bons @ bons.ai (https://wingedsheep.com)" | <https://github.com/wingedsheep/argentum-engine/blob/main/LICENSE> |
| Health | 55 stars, 21 forks; created 2026-01-18; pushed 2026-08-09 (daily activity) | GitHub API, 2026-08-09 |
| Stack | Kotlin 2.2, Spring Boot; React/TS client | <https://github.com/wingedsheep/argentum-engine/blob/main/README.md> |

- **Rules completeness claims are unusually deep for a young engine**: full turn/priority structure, stack, combat, triggered/activated/static abilities, **CR 613 layer system**, **replacement effects**, state-based actions, targeting legality (README). There is a dedicated design doc for continuous-effect dependency ordering ([continuous-effect-dependency-system.md](https://github.com/wingedsheep/argentum-engine/blob/main/docs/continuous-effect-dependency-system.md)) — the exact spot where hobby engines die.
- **Card definition is a Kotlin-embedded DSL** (builder/lambda style, `card("…") { manaCost = …; triggeredAbility { … } }`); new mechanics require engine code plus a DSL facade in the same change ([card-sdk-language-reference.md](https://github.com/wingedsheep/argentum-engine/blob/main/docs/card-sdk-language-reference.md)). Their `mtgish-tooling` parses oracle text into a structured IR and generates draft implementations — a working small-scale version of Arena's text→rules parser (§7).
- **Headless/RL-first design**: the engine is a standalone library; the `gym` module offers O(1) state forking via immutability, snapshot/restore for MCTS, batch stepping over work-stealing pools, versioned observation schemas; **`gym-server` exposes it over HTTP REST so Python agents drive it without JVM embedding**; `gym-trainer` ships PUCT MCTS self-play (README). Built-in engine AI is multi-ply alpha-beta search; optional LLM AI via OpenRouter-compatible APIs. No throughput numbers published.
- **Coverage is partial**: implemented sets span Portal, Onslaught block, Khans of Tarkir, Dominaria; live tracker at [magic.wingedsheep.com/set-completion](https://magic.wingedsheep.com/set-completion) (SPA; numbers not scrapeable headlessly).

**Verdict: inspire, with a future interop option.** MIT lets us port its architecture wholesale into TS: the layered continuous-effects design, immutable-state forking for cheap rollouts, the gym observation-schema/versioning pattern, and the oracle-text→IR tooling shape. Wrapping it as *the* engine would trade our TS-strict lock and co-design invariant for a partially-covered Kotlin SDK — not worth it — but its HTTP gym is a credible plug-in later for AlphaZero-style bot training.

---

## 5. Magarena, Wagic, and the graveyard

### Magarena (magarena/magarena) — unmaintained, instructive DSL split

- **GPL-3.0** (LICENSE.txt verbatim header: "GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007") — <https://github.com/magarena/magarena/blob/master/LICENSE.txt>
- 444 stars; **last release 1.96 December 2019; last push 2023-04-24** — dead by any maintenance standard (GitHub API, 2026-08-09).
- Card corpus: `release/Magarena/scripts` holds **14,988 files, of which 1,917 are `.groovy`** (counted via git-trees API) — simple cards are declarative `.txt` property files, complex cards drop into Groovy. MCTS-based AI (README credits) — historically regarded as the strongest open MTG AI of its era. Single-player only, Java 8+.
- Lesson worth keeping: the **two-tier DSL** (declarative properties for the 85%, escape hatch to a real language for the tail) matches our DSL + LLM-referee staging almost exactly.
- **Verdict: skip** (unmaintained, GPL, single-player shape); carry the two-tier-DSL lesson.

### Wagic (WagicProject/wagic)

C++ homebrew engine (PSP-era) with its own text card format; 401 stars; sporadic pushes (last 2026-06-26); license reported NOASSERTION by GitHub's license API — <https://github.com/WagicProject/wagic>. **Skip**: unclear license, dated architecture, weaker rules coverage than the Java engines.

### The graveyard (searched: `mtg rules engine`, `magic the gathering engine/simulator`, language-filtered TS/JS/Rust/Python; GitHub, 2026-08-09)

No credible TypeScript engine exists. The best-known attempts, all effectively dead or embryonic:

| Repo | Lang | Stars | License | State |
|---|---|---|---|---|
| [wanqizhu/mtg-python-engine](https://github.com/wanqizhu/mtg-python-engine) | Python | 69 | MIT | "aiming to replicate the Comprehensive Rules"; sporadic, last push 2025-05 |
| [kurokikaze/mtg-engine](https://github.com/kurokikaze/mtg-engine) | JS | 3 | none | dead 2014 |
| [snebel29/mtg-rules-engine](https://github.com/snebel29/mtg-rules-engine) | TS | 0 | — | dead 2025-01 |
| [AaronFriel/overseer](https://github.com/AaronFriel/overseer) | Rust | 6 | MIT | dead 2024 |
| [msmorgan/deckmaste.rs](https://github.com/msmorgan/deckmaste.rs) | Rust | 3 | other | created 2026-08-07, two days old |
| [tfausak/pawl](https://github.com/tfausak/pawl) | Haskell | 4 | 0BSD | created 2026-07-21, active, embryonic |
| [yevbar/witchcraft](https://github.com/yevbar/witchcraft) | Python+Datalog | 3 | UPL-1.0 | rules-as-Datalog experiment (Soufflé fork), stalled 2026-07 |
| [marthinwurer/MTGEngine](https://github.com/marthinwurer/MTGEngine) | Java | 1 | — | deliberately creature-only for AI research |
| [thesilencelies/LearnForge](https://github.com/thesilencelies/LearnForge) | Java | 7 | none | RL over Forge, dead 2021 |

The pattern across dozens of hits: engines get through turn structure and the stack, then stall at the layers system (CR 613), replacement effects, and the combinatorics of targeting/legality — precisely the subsystems Argentum wrote dedicated design docs for and XMage/Forge spent 15+ years hardening. Two implications: (a) "build" is only credible with a *bounded, staged* mechanic space and an oracle to diff against; (b) nothing exists to adopt in our stack, so "build" is also the only way to get a TS kernel.

---

## 6. Non-enforcing contrast: Cockatrice

Repo: <https://github.com/Cockatrice/Cockatrice> — **GPL-2.0** (GitHub API); 1,815 stars; release 3.0.2 2026-06-26; active.

- Virtual tabletop, **no rules enforcement whatsoever** — the client is the arbiter-free baseline ([Custom Cards & Sets wiki](https://github.com/Cockatrice/Cockatrice/wiki/Custom-Cards-&-Sets)).
- Custom cards are XML card databases (format v4, up to 25 custom DB files, `<card><prop>` fields for type/cost/PT/loyalty, token linkage, per-format legality tags). A large community ecosystem distributes custom sets this way.
- **Verdict: interop (cheap, later).** Emitting our generated sets as Cockatrice XML is a low-cost export target that gives human playtesters a networked tabletop long before our own multiplayer exists. Not a sim platform: nothing to measure without enforcement.

---

## 7. Proprietary and academic context

### MTG Arena's GRE (proprietary, instructive)

Wizards' official engineering article ["On Whiteboards, Naps, and Living Breakthrough"](https://magic.wizards.com/en/news/mtg-arena/on-whiteboards-naps-and-living-breakthrough) (July 2023) describes Arena's architecture: a Game Rules Engine driven by **CLIPS rules**, fed by a Python **Game Rules Parser** that compiles raw English card text into CLIPS rules — "it's what allows 80% or so of newly written Magic cards to just work in MTG Arena automatically." The industry's production engine thus validates our core bet: *cards as data compiled into a rules DSL, with a text→DSL compiler carrying most of the load and humans/escape-hatches covering the tail.* Our co-design invariant (generate only what the engine enforces) is strictly easier than Arena's problem (parse whatever design prints).

### Complexity results (why full generality is a trap)

- **Churchill, Biderman & Herrick, "Magic: The Gathering is Turing Complete"** — [arXiv:1904.09828](https://arxiv.org/abs/1904.09828), peer-reviewed at [FUN 2021](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.FUN.2021.9). A tournament-legal two-player game embeds a universal Turing machine with all moves forced; deciding the winner is undecidable, so optimal play is at least as hard as the Halting Problem.
- **Biderman, "Magic: the Gathering is as Hard as Arithmetic"** — [arXiv:2003.05119](https://arxiv.org/pdf/2003.05119): recognizing who wins is as hard as arithmetic truth (beyond the arithmetic hierarchy's decidable fragments).
- **Chatterjee & Ibsen-Jensen, "The Complexity of Deciding Legality of a Single Step of Magic: the Gathering"** (ECAI 2016) — [Liverpool repository PDF](https://livrepository.liverpool.ac.uk/3029568/1/magic.pdf), [ACM DL](https://dl.acm.org/doi/10.3233/978-1-61499-672-9-1432): even checking whether a *single step* is legal is coNP-hard in general.

Engine-feasibility readings: (1) no engine "implements the comprehensive rules" — every engine implements a decidable operational subset, card by card, and that is fine; (2) the pathologies live in unbounded interactions of specific printed cards, not in the turn/stack/priority machinery — a *generated* set can simply be designed (and CI-checked) to stay inside the tractable envelope; (3) legality checking should be structural over our DSL, never oracle-text reasoning.

### LLMs as referees/players (hybrid feasibility evidence)

- **MTG Bench** ([mtgautodeck.com/articles/mtg-bench](https://mtgautodeck.com/articles/mtg-bench/)) tested 15 frontier models simulating full game turns *without* a rules engine: best scores 95.4 (gpt-5.5 medium) and 90.3 (claude-fable-5 medium), collapsing to 12.8 for weaker models. Dominant failure modes: over-eager tool calling, irreversibly corrupting hidden information (draw-then-undo), and forgetting exile bookkeeping. **Conclusion for our hybrid: the LLM must never own game state; it can adjudicate a narrow, framed ruling and hand back a structured decision.**
- **[VIXAL-OS/discord-mtg-bot](https://github.com/VIXAL-OS/discord-mtg-bot)** (0 stars, active 2026-08) is an existence proof of the exact tiered architecture we're weighing: "tiered rules engine (templates → SpellResolver → optional XMage bridge → LLM judge)" with Claude-vs-Claude autoplay. Too immature to adopt; the tier ordering (cheap deterministic paths first, LLM last) is the pattern.
- Rules-QA judges exist as RAG apps ([eliso7/rulebot](https://github.com/eliso7/rulebot), [manski117/magic-judge-rag](https://github.com/manski117/magic-judge-rag)); fine-tuning work exists for MTG comprehension ([JakeBoggs/Large-Language-Models-for-Magic-the-Gathering](https://github.com/JakeBoggs/Large-Language-Models-for-Magic-the-Gathering)). Nothing here changes the design; they confirm rules-text retrieval is a solved commodity layer.

---

## 8. Comparison table & recommendation

| Candidate | Lang | License (verified) | Cards | Custom-mechanic ceiling | Headless mass-sim | TS integration cost | Health (2026-08-09) | Verdict |
|---|---|---|---|---|---|---|---|---|
| [Forge](https://github.com/Card-Forge/forge) | Java | GPL-3.0 (LICENSE) | ~33.6k scripts | High without Java (204 effect APIs, 202 keywords, `T/S/R/SVar` composition); new primitives = Java | Built-in `sim` CLI; AI weak at combo/control; **no published throughput** | Medium (subprocess + log/bridge; GraalVM native proven by Manabrew) | 2.6k★, release 2026-08-08, daily pushes | **Interop** — sim oracle + DSL transpile target |
| [XMage](https://github.com/magefree/mage) | Java | MIT (LICENSE.txt) | 31k+ cards | Unlimited but **Java class per card**, no DSL | Not designed for it (community-attested); test framework only | High (server protocol or custom harness) | 2.3k★, release 2026-07-11, active | **Inspire** — MIT-mineable reference implementations; skip as backend |
| [Argentum](https://github.com/wingedsheep/argentum-engine) | Kotlin | MIT (LICENSE) | Partial (6-ish sets) | Kotlin SDK + engine code per new mechanic; oracle-text→IR tooling | Yes — gym batch stepping, O(1) forking, HTTP gym-server; no numbers | Low-medium (HTTP REST already exists for Python) | 55★, born 2026-01, daily pushes, single lead | **Inspire** (architecture blueprint); future interop for RL |
| [Manabrew](https://github.com/witchesofthehill/manabrew) | Rust | AGPL-3.0-or-later (own code); vendored Forge GPL-3.0 | Forge's corpus via DSL parsing | Bound to Forge DSL semantics | Headless runtime exists; engine pre-release | N/A as engine (AGPL); recipes reusable | 28★, born 2026-05, daily pushes | **Inspire** — parity-harness pattern, DSL grammar docs, GraalVM recipe |
| [Magarena](https://github.com/magarena/magarena) | Java | GPL-3.0 (LICENSE.txt) | ~15k scripts (1.9k Groovy) | Two-tier txt+Groovy | Yes historically; MCTS AI | High; abandoned | 444★, dead since 2019/2023 | **Skip** — unmaintained; keep the two-tier-DSL lesson |
| [Cockatrice](https://github.com/Cockatrice/Cockatrice) | C++ | GPL-2.0 (GitHub API) | n/a (no enforcement) | n/a — XML card DBs | No (no rules) | Low (XML export) | 1.8k★, release 2026-06, active | **Interop** — export target for human tabletop testing |
| TS/JS/Rust/Py engines (§5) | various | various | — | — | — | — | all dead or embryonic | **Skip** — nothing adoptable; graveyard is the cautionary evidence |
| [Arena GRE article](https://magic.wizards.com/en/news/mtg-arena/on-whiteboards-naps-and-living-breakthrough) | — | — | — | — | — | — | — | **Inspire** — text→DSL compiler carries 80% |
| Complexity papers (§7) | — | — | — | — | — | — | — | **Inspire** — scope the DSL to a decidable envelope |
| [MTG Bench](https://mtgautodeck.com/articles/mtg-bench/) / [VIXAL-OS bot](https://github.com/VIXAL-OS/discord-mtg-bot) | — | — | — | — | — | — | — | **Inspire** — LLM referee never owns state; tiered adjudication |

### Recommendation: hybrid, weighted heavily toward build

1. **Build the TypeScript kernel + typed mechanics DSL as the lab's core.** Three independent lines of evidence converge: (a) no adoptable TS engine exists — the field is Java or dead; (b) the co-design invariant ("output space equals enforceable space") is only ownable if we own the DSL and its interpreter — wrapping Forge would make our set generator's expressible space be Forge's ApiType space, gated by Java for every new primitive; (c) mass simulation for balance CI wants a deterministic, seeded, immutable-state kernel with cheap forking (Argentum's gym design, the prior project's `combatLengthSim` pattern) — Forge's AI-driven games with a 120 s clock ceiling are the wrong tool for millions of rollouts. Scope it by the staged-mechanics ruling already locked in the brief; port layer/replacement/dependency-ordering designs from MIT-licensed XMage and Argentum rather than inventing them.
2. **Interop with Forge as the external oracle.** Keep the generated-set DSL mechanically transpilable to Forge card scripts wherever mechanics compose Forge's existing primitives, and adopt Manabrew's parity-harness discipline: same decks, same seed, scripted choices, field-level state diff. This buys 15 years of rules hardening as a CI cross-check plus Forge's full game modes (draft vs its AI, adventure-grade UI) for free human playtesting of exported sets — without vendoring GPL code.
3. **LLM referee, narrowly.** During set iteration, mechanics not yet compiled to the DSL may be adjudicated by an LLM referee that receives a framed decision (state excerpt, question, legal-option schema) and returns a structured ruling — never free-form state simulation (MTG Bench failure modes). Every referee invocation files a bead to compile that mechanic down; the referee is scaffolding, not architecture.
4. **Defer, don't adopt, the RL lane.** When learned bots become the bottleneck, Argentum's HTTP gym (MIT) is the interop candidate; its observation-schema versioning is the pattern to copy into our own kernel's bot API now.

### Spikes this report obligates (before the engine ADR is final)

1. **Forge sim throughput benchmark**: `sim -d <two precons> -n 100 -q` on lab hardware; measure games/hour and log-parse cost. No published numbers exist; the wrap-for-mass-sim option lives or dies here.
2. **Forge custom-set round trip**: export a 10-card toy set to `custom/`, verify play + whether draft boosters work for custom editions (undocumented).
3. **Transpilability probe**: take the brief's first-slice mechanic subset, hand-write both the TS-DSL and Forge-script versions, confirm the mapping is mechanical.

---

## Appendix: primary sources index

- Forge: [repo](https://github.com/Card-Forge/forge) · [LICENSE](https://github.com/Card-Forge/forge/blob/master/LICENSE) · [Card scripting API](https://github.com/Card-Forge/forge/wiki/Card-scripting-API) · [Custom card](https://github.com/Card-Forge/forge/wiki/Creating-a-custom-Card) · [Custom set](https://github.com/Card-Forge/forge/wiki/Creating-a-custom-set) · [AI & sim mode](https://github.com/Card-Forge/forge/wiki/AI) · [SimulateMatch.java](https://github.com/Card-Forge/forge/blob/master/forge-gui-desktop/src/main/java/forge/view/SimulateMatch.java) · [ApiType.java](https://github.com/Card-Forge/forge/blob/master/forge-game/src/main/java/forge/game/ability/ApiType.java) · [site](https://card-forge.github.io/forge/) · [HN thread](https://news.ycombinator.com/item?id=38651346)
- XMage: [repo](https://github.com/magefree/mage) · [LICENSE.txt](https://github.com/magefree/mage/blob/master/LICENSE.txt) · [readme](https://github.com/magefree/mage/blob/master/readme.md) · [test mode wiki](https://github.com/magefree/mage/wiki/Development-Testing-Tools)
- Argentum: [repo](https://github.com/wingedsheep/argentum-engine) · [LICENSE](https://github.com/wingedsheep/argentum-engine/blob/main/LICENSE) · [card SDK reference](https://github.com/wingedsheep/argentum-engine/blob/main/docs/card-sdk-language-reference.md) · [continuous effects](https://github.com/wingedsheep/argentum-engine/blob/main/docs/continuous-effect-dependency-system.md) · [set tracker](https://magic.wingedsheep.com/set-completion)
- Manabrew: [repo](https://github.com/witchesofthehill/manabrew) · [LICENSE.md](https://github.com/witchesofthehill/manabrew/blob/main/LICENSE.md) · [PARITY_AND_IR](https://github.com/witchesofthehill/manabrew/blob/main/docs/PARITY_AND_IR.md) · [native harness](https://github.com/witchesofthehill/manabrew/blob/main/forge-harness/native/README.md)
- Magarena: [repo](https://github.com/magarena/magarena) · [LICENSE.txt](https://github.com/magarena/magarena/blob/master/LICENSE.txt)
- Cockatrice: [repo](https://github.com/Cockatrice/Cockatrice) · [custom cards wiki](https://github.com/Cockatrice/Cockatrice/wiki/Custom-Cards-&-Sets)
- Papers: [arXiv:1904.09828](https://arxiv.org/abs/1904.09828) · [FUN 2021](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.FUN.2021.9) · [arXiv:2003.05119](https://arxiv.org/pdf/2003.05119) · [Chatterjee & Ibsen-Jensen](https://livrepository.liverpool.ac.uk/3029568/1/magic.pdf)
- LLM/hybrid: [MTG Bench](https://mtgautodeck.com/articles/mtg-bench/) · [VIXAL-OS/discord-mtg-bot](https://github.com/VIXAL-OS/discord-mtg-bot) · [Arena GRE article](https://magic.wizards.com/en/news/mtg-arena/on-whiteboards-naps-and-living-breakthrough)
