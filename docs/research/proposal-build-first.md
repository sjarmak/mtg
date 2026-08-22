# Architecture proposal: BUILD-FIRST

Stance: **own the core — a custom TypeScript rules kernel + mechanics DSL co-designed with the set
generator, so that the generator's output space and the engine's enforceable space are the same
artifact.** Adopt data sources, assets, formats, and peripheral tooling wholesale; wrap nothing at
the core. Written 2026-08-09 against the locked design brief (`docs/design-brief.md`) and the six
prior-art lane reports in `docs/research/`.

---

## 1. Thesis: the kernel is not a component, it is the invariant

The brief locks three capabilities that look independent but share one load-bearing requirement:

1. **Custom mechanics** — sets generated from desired mechanics, emitted in an enforceable card DSL.
2. **Staged rules modifiability** — parameterized variants/formats first, deep modification (new
   zones, turn structure, resources) via engine extension points second.
3. **The LLM-referee lane** — hybrid adjudication of not-yet-compiled mechanics.

All three are properties of *whoever owns the enforceable space*. The research shows why no wrapped
engine can carry them:

**Custom mechanics.** Wrapping Forge makes our generator's expressible space be Forge's `ApiType`
space: ~204 effect APIs and ~202 keyword enums, with every genuinely new primitive requiring Java in
a GPL-3.0 codebase we don't control (engines report §1.2). The mechanic-iteration loop — the single
hottest loop in a set-design lab — becomes cross-language, cross-license, and gated on upstream
architecture. In our own kernel, a `parameterized-extension` mechanic is a TypeScript change with
tests, landing in the same PR as its DSL facade — the exact pattern Argentum demonstrates ("new
mechanics require engine code plus a DSL facade in the same change", engines report §4). MTG Arena's
own GRE validates the shape: cards as data compiled into a rules DSL, with a text→rules compiler
carrying ~80% of new cards automatically (engines report §7). Our problem is strictly easier than
Arena's — we generate only what we can enforce, instead of parsing whatever design prints.

**Staged rules modifiability.** Deep modification means new zones, turn-structure hooks, and resource
systems. The set-design report §7.3 documents what those cost even WotC: Companion forced a CR change
two months post-release; Day/Night introduced persistent global state that broke on Clone corner
cases; Mutate needed new rules for merged permanents. These are *engine surgery*, and extension
points for engine surgery can only exist if they are designed in. Forge and XMage hardcode zones and
turn structure across 15 years of Java; nobody stages rules modifiability through a subprocess
boundary into someone else's enum. Owning the kernel converts "staged modifiability" from aspiration
into an API design task: stage 1 is parameterization the DSL already expresses, stage 2 is a
documented extension-point surface (zone registry, turn-structure pipeline, resource ledger) that
`rules-surgery`-class mechanics compile onto.

**The LLM-referee lane.** MTG Bench's finding is decisive: LLMs simulating full games without an
engine corrupt hidden information, forget exile bookkeeping, and collapse entirely below frontier
scale — "the LLM must never own game state; it can adjudicate a narrow, framed ruling and hand back
a structured decision" (engines report §7). A referee that never owns state requires a kernel that
can (a) serialize a framed state excerpt, (b) enumerate the legal-option schema for the question,
and (c) apply a structured ruling as an ordinary event in the deterministic log. Those are kernel API
capabilities. They cannot be retrofitted onto Forge's Java internals from outside a subprocess; they
fall out naturally from an event-sourced TS kernel we design. VIXAL-OS's tiered architecture
(templates → resolver → engine bridge → LLM judge last) confirms the ordering: cheap deterministic
paths first, LLM as the narrow last resort (engines report §7).

Two more research findings make build-first not just preferable but effectively forced:

- **There is nothing to adopt in our stack.** "No credible TypeScript engine exists. The best-known
  attempts [are] all effectively dead or embryonic" (engines report §5). The field is Java (GPL or
  Java-per-card), or dead. Build is the only path to a TS kernel, and the brief locks strict TS for
  engine/sim/agents/UI.
- **Mass simulation wants a kernel shaped like ours, not like Forge.** Balance-as-CI needs seeded,
  deterministic, immutable-state games with cheap forking (Argentum's gym design: O(1) state forking,
  snapshot/restore, batch stepping — engines report §4; the prior project's `combatLengthSim`: seeded RNG,
  1,000 games/strategy, asserted win-rate bands — reuse inventory #5). Forge has **no published
  throughput numbers anywhere**, a 120 s/game worst-case clock, and an AI that is "pretty bad" at
  combo and weak at control (engines report §1.3) — the wrong tool for millions of rollouts, and an
  archetype-asymmetric bias that the metrics lane documents as a first-order confounder (metrics
  report §6.1). Additionally, the metrics lane's key design decision — *our self-play log exporter
  should emit a superset of the 17lands replay schema under the same column names so calibration is
  a join, not a mapping layer* (metrics report §2.4) — is trivial when we own the logger and painful
  when we parse another engine's text logs.

The honest counterweight is the graveyard: dozens of hobby engines "get through turn structure and
the stack, then stall at the layers system (CR 613), replacement effects, and the combinatorics of
targeting/legality" (engines report §5). Build-first is only credible because four mitigations exist
that the graveyard's dead engines did not have — a bounded output space (co-design means we never
need "all of Magic"), MIT-licensed reference implementations of exactly the killer subsystems
(XMage's 31k-card layers/replacement machinery; Argentum's dedicated continuous-effect dependency
design doc), an external oracle to diff against (Forge, via Manabrew's parity-harness discipline),
and the complexity literature's instruction to scope the DSL to a decidable envelope with purely
structural legality checking (engines report §7). Section 8 treats this risk in full.

---

## 2. Engine strategy, concretely

### 2.1 What is BUILT

| Component | Shape | Design sources |
|---|---|---|
| **Rules kernel** (`@mtg/kernel`) | Event-sourced pure reducer over immutable game state; full turn/priority/stack machinery; seeded RNG; O(1) snapshot/fork for rollouts; versioned observation schema for bots | Argentum's gym architecture (MIT — port the design), the prior project pure-reducer sim pattern, Manabrew IR discipline |
| **Mechanics DSL** (`@mtg/dsl`) | Two-tier: (1) declarative typed card records — discriminated-union effect specs with exhaustive-switch narrowing, composing a curated primitive vocabulary; (2) staged extension points for new primitives (keyword actions, zones, turn hooks), each landing as kernel code + DSL facade in one change | the prior project `effectSpec.ts` typing discipline, Magarena's two-tier txt+Groovy lesson (declarative for the 85%, escape hatch for the tail), Arena GRE cards-as-data |
| **DSL compiler + validators** | DSL → kernel handlers; structural legality is a schema/type check over the DSL, never oracle-text reasoning; color-pie table, skeleton conformance, NWO red-flag gates as deterministic validators | Complexity papers (decidable envelope), set-design report deliverables A/B |
| **Layers + replacement effects (staged)** | Not in the thin slice; v1 lands in Phase 2 as a *ported design*: CR 613 layer ordering and replacement-effect machinery translated from XMage's MIT implementations and Argentum's dependency-ordering doc, scoped to what the DSL can express | XMage (MIT, mineable with attribution), Argentum continuous-effect doc |
| **Sim runner + log exporter** (`@mtg/sim`) | Seeded mass sim over worker threads; per-turn log records emitting a **superset of the 17lands replay schema, same column names** | Metrics report §2.4 (the join-not-mapping decision) |
| **Tier-1 bots** (`@mtg/bots`) | Forge-shaped decomposition: per-effect heuristics + shared evaluators + dedicated combat solver + opt-in 1-ply lookahead with a state evaluator; personality via config profiles; a Magarena-style pluggable-AI seam so MCTS (Cowling-style ensemble determinization) can slot in later | MTG-AI report §2.1, §2.3, §2.5 |
| **LLM plumbing** (`@mtg/llm`) | Net-new (the prior project has zero runtime LLM code): structured generation against DSL schemas, critique loops, retrieval-grounded rules context, referee endpoint | MTG-AI report §5.4; Krempl retrieval-grounded referee (65%→90%) |

### 2.2 What is WRAPPED / ADOPTED (periphery only)

- **Draftmancer** (MIT, TS) — adopted as the human-facing draft surface, self-hosted; our set
  generator emits its custom-set format (`[CustomCards]` JSON + sheets/layouts — the only open format
  coupling custom cards with booster collation); our own bot service plugs into its
  `ExternalBotInterface` (tooling report §1.1).
- **`spells`** (MIT, Python) — the entire human-side 17lands ingestion/aggregation harness
  (metrics report §1, §9).
- **statistical-drafting** (MIT) — the pick-model architecture, retrained on self-play picks for
  custom sets (MTG-AI report §3.4).
- **Data**: Scryfall bulk (oracle_cards/default_cards/rulings/oracle_tags), MTGJSON
  CardTypes/Keywords/EnumValues as the DSL's type/keyword vocabulary, CR TXT parsed locally,
  17lands CC BY 4.0 dumps (data report §8).
- **Assets/formats**: mana + keyrune OFL fonts; MTGA decklist text; Cockatrice card-DB XML v4
  emitter; Forge edition/card-script folder emitter; Karsten mana math and the WotC design
  heuristics (NWO, as-fan, skeleton) transcribed as versioned data.

### 2.3 Integration shape: Forge as oracle, never as engine

Forge stays behind a subprocess boundary in exactly one role: **second-opinion rules oracle and
export target** for the DSL subset that transpiles to its card-script format.

- The DSL stays mechanically transpilable to Forge scripts wherever mechanics compose Forge's
  existing primitives (engines report recommendation #2; spike #3 validates the mapping on the
  slice's mechanic subset).
- We adopt Manabrew's parity-harness discipline: same deck pair, same seed, scripted deterministic
  choices, field-level state diff reporting the first divergence (phase, turn, player, object,
  values). Manabrew describes this as "the core development tool for the engine," not a test suite
  (engines report §2) — it is how a young kernel buys 15 years of Forge's rules hardening as a CI
  cross-check without vendoring a line of GPL code.
- Forge's full game modes additionally give human playtesting of *exported* sets (draft vs its AI)
  long before our own play surface matures; Cockatrice XML export does the same for multiplayer
  tabletop (tooling report §3).
- GPL hygiene: subprocess only, no linking, shipped bundles never contain Forge-derived code or data.

### 2.4 The LLM referee, scoped

During set iteration, a mechanic classified `rules-surgery` (set-design report §7.3 classification:
`existing-primitive` / `parameterized-extension` / `rules-surgery`) may be played at low volume
before it is compiled: the kernel executes everything it understands, and at the mechanic's decision
points emits a framed ruling request — state excerpt, question, legal-option schema — to the referee,
which returns a structured ruling recorded as an ordinary event. Grounding is retrieval (CR rules +
DSL semantics), never parametric weights (fine-tuning moved rules quality 1.62→1.79/5; retrieval
took a rules eval from 65%→~90% — MTG-AI report §5.3). Every referee invocation files a bead to
compile that mechanic down. The referee is scaffolding for the staged-modifiability ladder, not
architecture: mechanics graduate DSL-ward, and the referee's call volume is a burn-down metric.

---

## 3. System architecture

### 3.1 Modules

```
mtg/
├── packages/            # strict TypeScript
│   ├── data/            # Scryfall/MTGJSON/CR ingest → SQLite/DuckDB; one schema for real+lab cards
│   ├── dsl/             # card DSL types, Zod schemas, compiler to kernel handlers
│   ├── validators/      # structural gates: skeleton, color pie, NWO, as-fan, parasitism proxy
│   ├── kernel/          # event-sourced rules kernel; decomposed from day one (no 2.2k-LOC stores)
│   ├── bots/            # tier-1 scripted bots + pluggable-AI seam; tier-2 LLM decision adapters
│   ├── sim/             # seeded mass-sim runner, worker pool, 17lands-superset log exporter
│   ├── metrics/         # Tier A–D metric suite, balance CI assertions, correction-table logic
│   ├── llm/             # structured generation, critique loops, referee, retrieval grounding
│   ├── setgen/          # skeleton profiles, mechanic proposal+classification, slot filling
│   ├── decklab/         # criteria schema → retrieval → selection → validators → sim verification
│   ├── draftlab/        # Draftmancer emitter, external-bot service, pick models
│   ├── export/          # Cockatrice XML, Forge folders, MTGA decklists, Draftmancer format
│   ├── render/          # DSL/Scryfall-shaped JSON → HTML/CSS → Playwright → PNG; original frames
│   └── oracle/          # Forge transpiler + subprocess driver + parity harness
├── apps/
│   └── replay/          # web replay viewer over sim logs → grows into the playable board
└── py/                  # Python
    ├── art/             # the prior project port: comfyui client, fal generator, LoRA curation loop
    └── calibration/     # spells-based 17lands ingestion + human-vs-bot comparison
```

### 3.2 Data flow: set-gen → deck → sim → metrics

```
 design intent (mechanics, theme, profile)
        │
        ▼
 setgen: mechanic proposal ──[LLM: propose/critique]──► classification gate
        │                                                (existing-primitive | parameterized-ext | rules-surgery)
        ▼
 skeleton instantiation (versioned profile data: play-booster-2024 / draft-booster-2021)
        │
        ▼
 slot filling ──[LLM: generate card into DSL schema]──► validators (structural, deterministic)
        │              ▲                                      │ fail → retry loop
        │              └──[LLM: semantic critique passes]◄────┘
        ▼
 SET (DSL records in the same oracle_card/printing schema as real cards, source:"lab")
        │
        ├──► export: Draftmancer / Cockatrice / Forge folders / renderer
        ▼
 decklab & draftlab: pools → decks ──[LLM: build decisions at tier-2 points]──► deck records
        │
        ▼
 sim: seeded bot-vs-bot mass runs (tier-1 scripted; kernel enforces all legality)
        │
        ▼
 logs: per-turn records (17lands replay-schema superset, same column names)
        │
        ▼
 metrics: Tier A–C computed from logs + Tier D static checks
        │
        ▼
 balance CI: corrected metrics vs bands ──► pass, or findings feed back to setgen
        │
        ▼
 calibration join (py/calibration): same metrics over 17lands dumps via spells → correction table
```

### 3.3 Where LLM calls live (ZFC discipline)

Semantic judgment is delegated to models; code owns IO, schema validation, state, sim mechanics,
budgets, and policy. Concretely, LLM calls exist at exactly these seams:

| Seam | Call | Grounding |
|---|---|---|
| setgen | mechanic proposal, design critique, slot-fill card generation into typed DSL schemas, flavor | design-canon data (skeleton, color pie, Storm Scale priors), DSL schema |
| validators | the *semantic* halves only: NWO "needs to be read twice", lenticular audit, novelty mix, signpost clarity (set-design report §10 items 13–15) | card DSL + design-canon retrieval |
| decklab | card selection among retrieved candidates, build explanations | data-lab retrieval (tags, synergy via Commander Spellbook, self-play stats) |
| draftlab | initial per-card Limited ratings for day-0 bots; pick explanations; draft-strategy priors from archetype descriptions | set design intent (the one thing only LLMs can read — MTG-AI report §3.7) |
| tier-2 bots | mulligans, draft picks, deck builds, deep-play reviews — choosing among kernel-enumerated legal actions (mage-bench contract) | framed state + legal-option schema |
| referee | structured rulings for uncompiled `rules-surgery` mechanics | CR + DSL semantics retrieval, never weights |

Never in an LLM: legality, state mutation, metric computation, win-rate math, validator thresholds,
the inner sim loop (mage-bench's ~$1/game and blunder-rate data close that door — MTG-AI report §2.2).

### 3.4 Where the prior project ports slot in

| the prior project artifact (reuse-inventory rank) | Slots into |
|---|---|
| `_comfyui_client.py` (#1), `fal-generate.mjs` (#4), LoRA curation loop (#2), post-processing repair (#12) | `py/art` — the art pipeline, near-verbatim |
| illustration schema + composer (#3) | `py/art` spec layer, re-axised for frame / rarity / color identity / creature type |
| `combatLengthSim` + balance test pattern (#5) | `@mtg/sim` + `@mtg/metrics` — the CI skeleton scaled up |
| effect DSL typing discipline (#7) | `@mtg/dsl` — the discriminated-union + exhaustive-switch shape |
| playtester harness + narrative reporter (#6) | `apps/replay` scenario specs + opt-in narrative reports over sim logs |
| prompt style regime (#8), art governance + no-placeholder CI (#9) | `py/art` + repo CI |
| theme indirection `src/theme/` (#10) | `@mtg/export` + flagship bundle — IP-safety layer |
| orchestration conventions (#11) | repo process (persona skills, per-unit retry state) |
| Anti-patterns (static JSON imports, script piles, 2.2k-LOC modules) | enforced against: data-driven registries, shared image-ops lib, decomposed kernel from day one |

---

## 4. Thin end-to-end slice

One loop, all four stages, smallest honest scope. The kernel keeps **full turn/priority/stack
machinery from day one** (the graveyard shows hobby engines get *through* those; the cliff is
layers/replacement, which the slice defers by construction).

**Mechanic subset (DSL v0):** creatures with evergreen keywords (flying, vigilance, haste, trample,
deathtouch, lifelink, menace, reach, first strike); sorceries/instants composing a primitive
vocabulary of ~10 effects (deal damage, destroy, pump until EOT, draw, gain life, counter); basic
lands and mana; combat; a minimal fixed-order P/T-modification layer implemented against Argentum's
CR 613 doc so it grows rather than gets rewritten. **Excluded:** activated/triggered/static
abilities beyond keywords, replacement effects, full layers, targeting restrictions beyond
"any target"/"target creature".

**The loop:**
1. **Set-gen:** a scaled-down skeleton profile (~90 cards: 2 rarities, 5 colors + artifact,
   play-booster-derived curve/creature-share numbers); LLM fills slots into DSL v0; deterministic
   validators (schema, curve, color-pie subset for the ~10 effects, creature-share bands, NWO line
   count); one LLM critique pass; validate-retry loop (MTGAI's validator+retry shape).
2. **Deck build:** deterministic pool→deck builder — 17 lands + 23 spells, curve-mass-at-2-to-4,
   two-color pools (design-canon norms as code; LLM deck lab comes later).
3. **Sim:** tier-1 greedy bots (attack/block heuristics + simple cast policy), seeded RNG,
   1,000 games per color-pair matchup across all 10 pairs, worker-parallel.
4. **Metrics:** game-length distribution, per-pair win-rate band assertion (40–70% the prior project
   precedent), no-dominant-strategy guard, mana-screw rate vs Karsten priors, stall/decisiveness
   guard — asserted CI-style as `npm run test:balance`. Logs emitted in the 17lands-superset schema
   from the first run.

**What it proves:**
- **The co-design invariant holds end-to-end**: nothing was generated that the engine could not run —
  the property every prior generation system lacked (illegal-card failure modes from RoboRosewater
  through modern LLMs, MTG-AI report §5.1/§5.4, eliminated *by construction*).
- **Balance is a CI assertion**: seeded, reproducible, thresholded — the lab's genuinely novel
  contribution (no prior art closes the loop with simulation; MTG-AI report §5.4 lesson 2).
- **The calibration contract is real**: the exporter's 17lands-superset schema is exercised from
  day one, so Phase 3 calibration is a join, not a retrofit.
- **TS mass-sim feasibility is measured, not assumed**: the slice reports games/second and
  fork-cost numbers, giving the brief's "native core only if sim scale demands it" escape hatch an
  evidence base, and giving the Forge-throughput spike (engines report, obligated spike #1) its
  comparison point.

---

## 5. Phased roadmap

### Phase 1 — Proof of loop (the thin slice)
**Goal:** the §4 loop green in CI; kernel v0 (turn/priority/stack, combat, DSL v0 compiler), data
ingest v0 (Scryfall bulk + MTGJSON vocabulary into the one-schema store), sim throughput benchmark
published. Parallel lane: Forge sim-throughput and custom-set round-trip spikes (engines report
obligated spikes #1–2) so oracle plans rest on measured numbers.

### Phase 2 — Rules depth + oracle discipline
**Goal:** the kernel grows the graveyard-killer subsystems as ported designs, guarded by an external
oracle. Activated/triggered/static abilities; replacement effects v1 and CR 613 layers v1 translated
from XMage (MIT) and Argentum's dependency-ordering doc; targeting legality as structural DSL checks.
DSL→Forge transpiler for the composable subset + Manabrew-style parity harness diffing seeded games
field-by-field. Export surfaces land: Draftmancer format + self-hosted instance (draft-vs-bots on
day-0 LLM ratings via SimpleBot), Cockatrice XML for human tabletop. Replay viewer v1 over sim logs
(headless → replay, per the locked interface sequence).

### Phase 3 — Calibrated measurement + the labs
**Goal:** metrics become trustworthy and the labs open. Implement one full calibration set (BLB or
DSK class) in the DSL — the conformance milestone that forces the kernel through real design space —
then run the metrics lane's calibration protocol: `spells`-based human-side suite, Mode P (human
decks, bot play) vs Mode F (full pipeline), skill anchoring against 17lands buckets, frozen versioned
correction table. Full Tier A–D metric suite with corrected bands. Deck lab v1
(criteria → retrieval → LLM selection → validators → sim verification; Commander Spellbook interop).
Draft lab v2: self-play-corrected ratings, statistical-drafting-shaped pick model on self-play picks,
our bot service behind Draftmancer's ExternalBotInterface. Tier-2 LLM bots at mage-bench-contract
decision points (mulligans, picks, builds, reviews).

### Phase 4 — The flagship: full set production
**Goal:** the full pipeline produces the flagship. Set generation at full play-booster scale
(3–6 mechanics layered per canon, all ten archetype pairs, speed/novelty mixes) with `rules-surgery`
proposals either deferred or run through the LLM referee at low volume, each filing its
compile-me-down bead. Art pipeline port goes live (ComfyUI client, fal generator, LoRA style-lock
per set, art-spec validation, governance CI); in-house renderer (HTML/CSS → Playwright → PNG,
original frames, OFL fonts); theme-indirection bundle. Flagship drafted vs bots on Draftmancer,
balance CI green with corrected bands, exports to Cockatrice/Forge for human playtests.

### Phase 5 — Human play + staged rules surgery
**Goal:** the playable board grows out of replay components (the locked sequence's final step):
hotseat + vs-bot play of the flagship in the browser, kernel-driven. Staged modifiability stage 2
lands: documented kernel extension points (zone registry, turn-structure pipeline, resource ledger)
proven by promoting at least one referee-adjudicated flagship mechanic into compiled kernel code,
retiring its referee traffic. Optional ladder items unlocked by the seams already built: MCTS bot
tier if greedy bots distort metrics; Argentum-style HTTP gym over our kernel if an RL lane is wanted.

---

## 6. Reuse manifest

From the lane reports' verified verdicts, grouped by relationship. Licenses as verified in the
reports on 2026-08-09.

**Adopt (use as-is / lightly wrapped):**
Scryfall bulk data + images (fan-content umbrella; bulk-first, attribution) · Comprehensive Rules
TXT (ingested locally, never redistributed) · 17lands public datasets (CC BY 4.0) · `spells` (MIT)
· Draftmancer (MIT) · statistical-drafting (MIT) · mana + keyrune fonts (OFL 1.1) · MTGA decklist
format · Karsten mana math · WotC design heuristics (NWO budget, as-fan formulas, skeleton numbers)
transcribed as versioned data · the prior project: ComfyUI client, fal generator, LoRA curation loop,
illustration schema, balance-sim pattern, playtester harness, theme indirection, art governance.

**Interop (speak its format/API, arm's length):**
Forge (GPL — subprocess oracle, DSL transpile target, custom-set export folders) · Cockatrice
(card-DB XML v4 + `.cod`) · MTGJSON (CardTypes/Keywords/EnumValues as DSL vocabulary;
AllPrintings.sqlite for exploration) · Academy Ruins API (CR diffs/trace; AGPL code not vendored) ·
Commander Spellbook API (MIT; real-card synergy graph) · CubeCobra (Apache-2.0 bot code + CSV
import) · 17lands JSON endpoints (sparingly) · PlaneSculptors export (later, human-playtest reach).

**Inspire (port the pattern, not the code):**
Argentum (MIT: layers/continuous-effect dependency design, O(1) immutable forking, gym
observation-schema versioning) · XMage (MIT: mineable reference implementations of layers,
replacement effects, 31k mechanics — the one "inspire" where code porting is legally clean, with
attribution) · Manabrew (parity-harness methodology, Forge-DSL grammar docs) · Magarena (two-tier
DSL, pluggable AI over one scoring system) · mage-bench (MCP-bridge + puppeteer LLM-pilot contract)
· MTGAI/Coamithra (validator+auto-fixer+council pipeline shape; unlicensed, patterns only) · mtgds
AWR regression · DEq · MtG Health Index composite shape · Ludi drama/decisiveness metrics ·
RuleSmith adaptive game allocation · DeepMTG deck-chain + failure list · RyanSaxe decaying-openness
· Bertram text-feature card representations (the zero-data transfer method) · mtgrender
(HTML/CSS render path proof) · Lore Seeker collation algorithm taxonomy · mtgencode encoding
discipline.

**Skip (documented reasons in the reports):**
Beleren font (WotC-proprietary — OFL stand-ins) · CardConjurer forks (unlicensed + C&D-named WotC
assets) · Proxyshop (Photoshop dependency) · MSE as renderer (GUI C++, IP-encumbered templates) ·
XMage as backend (Java-per-card, no sim CLI) · dr4ft (dominated by Draftmancer) · mtgdraftbots +
Academy Ruins code + Manabrew code (AGPL boundary) · MTGO `.dek` (unmintable proprietary IDs) · all
unlicensed model/bot repos (patterns only).

---

## 7. IP and licensing posture

Inherited from the data report §6 and tooling report §7, restated as the build-first consequences:
everything in the shipped path is ours or OFL/MIT (original frames, original set symbols, OFL text
fonts, our DSL, our kernel); GPL engines stay behind process boundaries; AGPL code never enters the
tree; the flagship ships as a *custom Magic set* under the Fan Content Policy notice with theme
indirection (runtime theme.json), non-commercial locked. The CardConjurer C&D defines the empirical
line: no WotC trademarks, logos, or frame reproductions in anything public. Owning the renderer and
the kernel means no dependency drags encumbered assets into the bundle.

---

## 8. Top risks and mitigations — including where this stance is weakest

**R1. The graveyard risk: custom engines die at CR 613 layers, replacement effects, and targeting
combinatorics.** This is the strongest argument against build-first and it is empirical (engines
report §5). Mitigations, all evidence-backed: (a) *bounded output space* — the co-design invariant
means the kernel implements the generator's emissible space, not printed Magic's; the complexity
papers show pathologies live in unbounded printed-card interactions, not the turn/stack machinery,
and a generated set "can simply be designed (and CI-checked) to stay inside the tractable envelope"
(engines report §7); (b) *ported designs, not invention* — XMage's MIT implementations and
Argentum's dependency-ordering doc are exactly the subsystems the graveyard died on; (c) *oracle
diffing* — the Manabrew parity harness catches semantic drift mechanic-by-mechanic against Forge's
15-year-hardened behavior; (d) the slice defers these subsystems entirely, so the bet is staged, not
front-loaded.

**R2. Rules-correctness debt corrupts everything downstream.** A subtly wrong kernel silently
poisons every metric, calibration, and design conclusion. Mitigations: field-level parity diffs on
seeded games (first-divergence reporting); the Phase 3 conformance milestone (a full real set in the
DSL) forces the kernel through professionally-designed card space with 17lands ground truth on the
other side; seeded determinism makes any metric shift bisectable to a kernel commit; exhaustive
discriminated-union narrowing turns unhandled cases into compile errors; tests ship with every
mechanic.

**R3. The kernel sits on the critical path (schedule risk).** Argentum — one strong lead, daily
pushes since January — has partial coverage of six-ish sets (engines report §4). That is the honest
comparable, and it is the stance's weakest point: we are betting the lab's schedule on in-house
engine velocity. Mitigations: our coverage target is categorically smaller (a staged DSL, not
printed sets); the periphery parallelizes because it is adopted, not built (data ingest, spells
harness, Draftmancer, art pipeline, exports all proceed engine-independently); Forge/Cockatrice
exports deliver full-rules and multiplayer human playtesting of generated sets from Phase 2, so set
iteration is never blocked on kernel completeness; the slice gives an early, cheap abort signal.

**R4. TS sim throughput may not reach mass-sim scale.** No TS engine has ever demonstrated
millions of rollouts. Mitigations: the immutable-fork architecture is the proven shape for cheap
rollouts (Argentum O(1) forking); worker-thread parallelism is embarrassingly available for
game-granularity sims; the brief pre-authorizes a native core if scale demands it, and an
event-sourced reducer is the easiest kernel shape to port hot paths from; RuleSmith's adaptive game
allocation cuts required volume; the slice measures games/second before anything depends on it.

**R5. Real-card enforcement stays out of reach for a long time.** Build-first forgoes 33k
enforceable cards; the deck lab cannot *simulate* arbitrary real-card constructed decks in-lab for
years, and full real-set conformance (Phase 3) is a significant lift for even one set. Mitigations:
the informed deck lab is by design data-grounded (Scryfall, 17lands, Spellbook synergy, oracle
tags), not enforcement-dependent; Forge interop covers full-rules real-card play across the process
boundary; the calibration protocol needs exactly one implemented real set, chosen from the verified
full-triple coverage table, and that implementation doubles as the kernel's conformance suite.

**R6. Calibration transfer.** Corrections measured on real sets may not transfer to novel mechanics
that stress bot weaknesses differently (metrics report §10.1 — the load-bearing assumption of the
whole measurement story, independent of engine choice, but build-first owns the fix surface).
Mitigations: multi-set calibration; the sign-stability demotion rule (metrics that flip correction
sign between calibration sets demote from CI-gating to advisory); Mode P / Mode F separation
isolates play-skill from draft divergence; LLM spot-play on flagged archetypes; bot-skill anchoring
against 17lands win-rate buckets rather than a pretended "average human".

**R7. LLM-referee reliability.** MTG Bench's failure modes (state corruption, bookkeeping loss) cap
what adjudication can be trusted with. Mitigations: the kernel owns all state, always; rulings are
schema-constrained single decisions, retrieval-grounded; referee games are excluded from balance CI
(advisory only) until the mechanic compiles; referee volume is a tracked burn-down, so the
scaffolding provably retires.

**R8. Unlicensed prior art temptation.** Several of the richest references (MTGAI, CardConjurer
forks, CubeCobra weights, mtgrender) carry no license. Mitigation is procedural: the reuse manifest
marks them inspire/skip; nothing unlicensed is vendored; the AGPL boundary (mtgdraftbots, Academy
Ruins, Manabrew) is a named check in review.

---

## 9. Summary

Build the kernel and DSL because the three locked capabilities — custom mechanics, staged rules
modifiability, and the LLM-referee lane — are properties of whoever owns the enforceable space, and
because the research found nothing in our stack to adopt and nothing outside it that can be wrapped
without surrendering the co-design invariant to a GPL Java enum. Adopt aggressively everywhere else:
the data foundation, the draft surface, the human-side calibration harness, the fonts, the formats,
and the entire art pipeline are solved problems with verified licenses. Keep Forge close as an
oracle and far as a dependency. Prove the loop thin, grow the kernel behind a parity harness, and
let the flagship ship on a stack where every shipped pixel and every enforced rule is ours.
