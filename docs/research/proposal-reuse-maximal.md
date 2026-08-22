# Architecture proposal: REUSE-MAXIMAL

Stance: wrap and adopt existing engines and tools wherever the evidence supports it; build only
the glue and the genuinely novel parts (LLM generation, the informed deck lab, the metrics/
calibration harness). Written 2026-08-09 against the six prior-art lane reports and
`the prior-project reuse audit`. Every claim below cites a lane finding, not a preference.

The one-sentence thesis: **the research shows that everything downstream of "the set exists as
data" is a solved, adoptable problem, and that the single most-failed project in this hobby is
writing a new rules engine — so the lab should spend its entire novelty budget on the three things
nobody has ever built (sim-grounded power calibration of generated cards, an informed deck lab,
a set-health CI), and buy everything else.**

---

## 0. How this stance reads the locked decisions

Every locked ruling in the brief is respected; two need explicit interpretation.

| Locked decision | Reuse-maximal reading |
|---|---|
| Engine strategy deferred to research | This proposal answers it: **wrap Forge headless as the rules engine of record**, one of the three options the brief itself names. |
| Stack: strict TS / Python | The stack ruling governs *code we write*. All lab code is TS; the art pipeline is Python. Forge is an external oracle process — the same relationship the lab would have to Postgres or Chromium. The one Java artifact we maintain is a ~1–2k LOC bridge driver (§2.3), held at arm's length in its own GPL-licensed module, exactly parallel to the brief's own "native core only if sim scale demands it" escape hatch. |
| Thin end-to-end first slice | Defined in §4; it doubles as the kill-test for this stance's biggest risk (Forge throughput). |
| Staged rules modifiability | Stage 1 (parameterized variants) maps to Forge's parameterized keywords + 204-effect composition space with zero Java (engines report §1.2). Stage 2 (new zones/turn structure) maps to extension points in a maintained Forge fork (§6, risk R2). |
| Tiered bots | Tier 1 scripted/heuristic = Forge's AI, the best-documented scripted MTG bot in existence (mtg-ai report §2.1). Tier 2 LLM = mage-bench's engine-owns-legality contract (mtg-ai §2.2) at mulligans/drafts/builds/reviews. |
| Headless-first interface | Bridge logs → replay viewer → playable board; the board talks to the same bridge in interactive-session mode (§3.4). |
| 17lands + self-play metrics | `spells` (MIT) adopted for the human side; the bridge emits a superset of the 17lands replay schema so calibration is a join (metrics report §2.4). |

The co-design invariant ("the set generator's output space equals the engine's enforceable
space") is *enforced*, not weakened, under this stance: our DSL is defined as a typed facade over
the subset of Forge's script vocabulary we admit, the DSL→Forge compiler is total over that
subset, and a conformance gate boots every generated card in Forge before it enters a set. The
build path can only claim the invariant over an enforceable space that starts near zero; this
path claims it over a space hardened for 15 years.

---

## 1. Engine strategy: wrap Forge, concretely

### 1.1 The evidence case

1. **Custom engines die, reliably, at the same cliff.** The engines lane surveyed dozens of
   TS/JS/Rust/Python/Haskell attempts: every one is dead or embryonic, and the documented failure
   point is CR 613 layers, replacement effects, and targeting-legality combinatorics (engines
   report §5). Argentum — MIT, an unusually capable single lead, daily pushes since January —
   is still at roughly six implemented sets (engines §4). A bespoke TS kernel is engine #41 in
   that graveyard, and the brief's flagship does not need us to be the first survivor.
2. **Forge is the incumbent for exactly our workload.** ~33,614 card scripts; a plain-text card
   DSL (`A:`/`T:`/`S:`/`R:`/`K:`/`SVar:` over ~204 effect APIs and ~202 keywords) where "a very
   large space of custom cards and many custom mechanics need zero Java"; custom sets as
   first-class user content with a practiced MSE→Forge community pipeline; a built-in headless
   `sim` CLI with tournament modes; releases within the last week (engines §1). The industry
   validates the shape: Arena's production engine is card-text compiled into a rules DSL
   (engines §7) — Forge's DSL *is* that artifact, already existing, already debugged.
3. **The wrap mechanics are proven, not hypothetical.** Manabrew parses Forge's DSL into a typed
   IR, wrote down its grammar and semantics, and compiled a Forge harness into a native shared
   library callable without a JVM (engines §2, §1.4). Their parity harness ("same deck pair,
   seed, and deterministic choices," field-level state diff) is an existence proof that seeded,
   deterministically-driven Forge games are achievable — which is what our sim host needs.
4. **Calibration comes free.** The metrics lane's protocol (metrics §8) requires the calibration
   set to be "fully enforceable in our engine" (Step 2). Under wrap, *every real set already is*.
   Mode P calibration (replay human deck compositions from the 17lands `deck_*` columns with our
   bots) can run in Phase 2. Under build, calibration waits until a custom kernel implements an
   entire real Arena set — realistically a year away. This is the single largest schedule
   asymmetry between the stances and it sits directly under the brief's "calibrated against
   17lands human baselines" capability.
5. **The mass-sim objection is sized wrong.** "Millions of cheap rollouts" is an MCTS-training
   requirement, not a playability-metrics requirement. The brief's metrics — win-rate bands,
   game length, screw rates, interaction density — are the the prior project `combatLengthSim`
   pattern at 1,000 games/strategy (reuse doc #5), and the community's Forge workflow is already
   "parse log files from 50–100 head-to-head battles" (metrics §6.1). Ten archetype pairs ×
   1,000 seeded games is 10⁴ games per set revision; games are embarrassingly parallel across
   JVM workers. If a learned-bot tier ever genuinely needs O(1) state forking, the reuse answer
   is Argentum's MIT HTTP gym (engines §4) — another wrap, not a kernel.
6. **Opportunity cost is the decisive argument.** The mtg-ai lane's flat finding: "no prior
   system closes the loop with simulation... sim-grounded power calibration of generated cards
   is the genuinely novel contribution" (mtg-ai §5.4). Every engineering month spent re-deriving
   the layers system is a month not spent on the only part of this lab nobody has built.

### 1.2 What is wrapped, what is adopted, what is built

**Wrapped (external processes, spoken to over files/stdio/HTTP):**

- **Forge headless** (GPL-3.0, subprocess): rules engine of record, tier-1 scripted bots, sealed/
  draft-vs-AI playtesting of exported sets, and — via its full GUI — an immediate human play
  surface for exported sets before any lab UI exists.
- **Draftmancer** (MIT, TS, self-hosted): the draft lab. Custom-set + collation format is the
  only open format coupling card definitions to booster collation (tooling §1.1); bots pluggable
  via `ExternalBotInterface`; MTGA deck export built in.
- **Cockatrice** (GPL-2.0, export target): networked human tabletop for playtest groups, via a
  mechanical card-DB XML emitter (tooling §3.1).
- **Argentum HTTP gym** (MIT, deferred): the RL/cheap-rollout option if and when a learned bot
  tier demands it (engines §4).

**Adopted (libraries/data used as-is or lightly wrapped):**

- **`spells`** (MIT, Python): 17lands ingestion, parquet conversion, and correct aggregate
  computation — "saves us the whole human-side harness" (metrics §9).
- **statistical-drafting** (MIT): the pick-model architecture (~70% top-player agreement),
  retrained on self-play picks for custom sets (mtg-ai §3.4).
- **Scryfall bulk + rulings + oracle tags** (primary card truth), **MTGJSON CardTypes/Keywords/
  EnumValues** (DSL vocabulary enums), **CR TXT** parsed in an afternoon against its regular
  line grammar (data §1–3, §8).
- **17lands public dumps** (CC BY 4.0) as the calibration baseline; **Karsten mana math** and the
  **NWO / design-skeleton / as-fan numbers as data** (metrics §5, set-design §9).
- **mana + keyrune fonts** (OFL 1.1) for lab-internal symbols (data §5).
- **Commander Spellbook API** (MIT): real-card synergy ground truth for the deck lab (mtg-ai §4).
- **The prior project ports** (in-house): ComfyUI client near-verbatim, fal.ai batch generator with
  the regex fix, LoRA curation loop, typed illustration spec, theme-indirection loader, balance-
  sim test pattern, playtester harness conventions, art-governance CI (reuse doc #1–#12).

**Built (the novelty budget, all TS unless noted):**

1. **Card DSL + compilers** — typed discriminated-union card spec (the prior project `effectSpec`
   discipline, reuse doc #7) whose semantics are *defined by* its compilation targets: DSL→Forge
   card scripts + edition files, DSL→Draftmancer `[CustomCards]`, DSL→Cockatrice XML, DSL→render
   JSON. A compiler frontend, not an interpreter — no rules kernel anywhere in the lab.
2. **LLM set-generation pipeline** — skeleton profiles as versioned data, slot filling, validator
   gates (set-design §10's 16 checks), semantic critique loops, sim-feedback power calibration.
3. **Informed deck lab** — criteria schema → retrieval → LLM selection → structural validators →
   closed-loop sim verification (the verifier every prior deck builder lacked, mtg-ai §4.2).
4. **Forge bridge** (Java, GPL-3.0, own module, ~1–2k LOC): a thin driver over the GUI-free
   `forge-game` Maven module speaking JSON over stdio — run seeded matches, drive scripted or AI
   choices, and emit per-turn state snapshots as a superset of the 17lands replay schema. This is
   the engines report's proven integration path #2 and the load-bearing build item of the stance.
5. **Metrics + calibration harness** — log ingestion to DuckDB, Tier A–D metrics, the §8
   calibration protocol, versioned correction tables, CI assertions.
6. **Renderer** — Scryfall-shaped JSON → HTML/CSS → headless Chromium (Playwright) → PNG, with
   original frame art from the ported art pipeline; the mtgrender-proven pattern (tooling §2.7).
7. **Replay viewer → playable board** — web UI over bridge logs, growing into interactive play
   against the bridge's session mode.

### 1.3 License hygiene (the arm's-length rules)

GPL-3.0 obligations trigger on distribution; the lab consumes Forge and Cockatrice as external
programs and never vendors their code into the TS tree (engines §1.4, tooling §7). The Java
bridge links `forge-game`, so the bridge module itself is licensed GPL-3.0 and lives in its own
directory with its own LICENSE; it exchanges JSON with the TS lab over stdio. Card scripts we
*emit* are our own text. Shipped bundles (flagship set, web UI) contain only our code, our
frames, OFL fonts, and theme-indirected strings — the CardConjurer C&D line (tooling §7) and the
Fan Content Policy envelope (data §6) stay satisfied. AGPL artifacts (mtgdraftbots, Academy Ruins
code, Manabrew) are patterns-only, never code.

---

## 2. System architecture

### 2.1 Modules

```
mtg/
  data/          TS   ingest: Scryfall bulk (oracle/printing/ruling/tags), MTGJSON vocab,
                      CR parser; SQLite/DuckDB store; custom cards share the oracle_card
                      schema with source:"lab" (data report §8)
  dsl/           TS   card + set-skeleton types, structural validators (set-design §10),
                      compilers: →forge, →draftmancer, →cockatrice, →render-json
  setgen/        TS   LLM pipeline: mechanics → skeleton → slot fill → validate → critique
                      → (after sim) recalibrate   [LLM calls live here]
  decklab/       TS   criteria schema → retrieval → LLM build → validators → sim verify
                      [LLM calls live here]
  simhost/       TS   Forge worker-pool orchestration: seeds, pairings, budgets, retries,
                      log collection (policy code only, zero game logic)
  forge-bridge/  Java GPL module: JSON-over-stdio driver on forge-game; seeded matches;
                      per-turn snapshots in 17lands-replay-superset columns
  metrics/       TS   log → DuckDB; Tier A–D metrics; calibration tables; CI assertions
  calib/         Py   spells-based 17lands human-side harness; joins with metrics output
  draftlab/      TS   self-hosted Draftmancer + our bot service behind ExternalBotInterface;
                      draft-log ingestion   [LLM rating passes live here]
  agents/        TS   tier-2 LLM decision points via bridge tools (mage-bench MCP pattern):
                      mulligans, deep-play review   [LLM calls live here]
  render/        TS   HTML/CSS card templates + Playwright batch renderer
  art/           Py   the prior project ports: comfyui client, fal batch, LoRA curation,
                      post-processing repair, art-spec validation
  ui/            TS   replay viewer → playable board (components shared per the locked
                      interface sequence)
  theme/         TS   theme.json indirection loader (the prior project pattern)
```

### 2.2 Data flow: set-gen → deck → sim → metrics

```
mechanics prompt
   │  setgen: LLM skeleton + slot fill          (LLM: design reasoning)
   ▼
DSL set bundle ── dsl validators ── LLM critique loop   (code: schema/pie/NWO gates;
   │                                                     LLM: quality/flavor/lenticular)
   ├─ compile → Forge custom edition + card scripts
   ├─ compile → Draftmancer set file (sheets, layouts, ratings)
   ├─ compile → Cockatrice XML          ├─ compile → render JSON → PNGs
   ▼
conformance gate: every card boots in Forge, smoke game passes   (co-design invariant, enforced)
   ▼
decklab builds archetype decks ──────┐        draftlab bot-drafts pools ──┐
   ▼                                 ▼                                    ▼
simhost: N seeded Forge games via forge-bridge workers (constructed + drafted decks)
   ▼
per-turn JSON logs (17lands replay superset)
   ▼
metrics: Tier A–D + correction tables → CI verdict (bands, no-dominant-strategy, NWO, as-fan)
   ▼
verdict + per-card stats feed back into setgen critique  →  next set revision
```

### 2.3 Where LLM calls live (ZFC discipline)

Reasoning delegated to models: mechanic/theme design, card generation, semantic critique
(lenticular, novelty, signpost clarity — set-design §10 items 13–15), NWO semantic red flags,
Limited ratings for draft bots, deck-construction judgment, mulligan decisions, deep-play
reviews, and the narrow **LLM referee** for mechanics not yet compiled to Forge scripts during
design iteration — framed decision in, structured ruling out, never owning state (MTG Bench
failure modes, engines §7), and every invocation files a bead to compile the mechanic down.

Code owns: IO, schema validation, compilers, seeds/budgets/retries, metrics arithmetic, CI
assertions, worker lifecycle. No heuristic scoring or keyword-matching "judgment" in code.

### 2.4 Where the prior project ports slot in

| Port | Slot |
|---|---|
| `_comfyui_client.py`, `fal-generate.mjs` (+regex fix) | `art/` verbatim-ish |
| LoRA curation loop + trigger-token pattern | `art/` — per-set style lock, frames included |
| `illustration/schema.ts` + composer | `art/` spec re-axised to frame/rarity/color/type |
| `effectSpec.ts` typing discipline | `dsl/` — the shape of the card DSL |
| `combatLengthSim` + balance test pattern | `metrics/` CI assertions (bands, dominance guard) |
| playtester harness + narrative reporter | `agents/` deep-play review output shape |
| theme `generic.ts`/`loader.ts` | `theme/` IP indirection |
| art-governance + no-placeholder CI | render/art pipelines |
| Anti-patterns (static imports, script pile, giant modules) | data-driven registries, shared image-ops lib, small modules from day one |

---

## 3. Interface sequence (headless-first, as locked)

1. **Headless**: bridge JSON logs are the only surface; everything in Phases 1–2 runs from CLI.
2. **Replay viewer**: web UI renders bridge logs turn-by-turn (board state is in the snapshots).
3. **Playable board**: the same components against the bridge's interactive session mode — one
   seat driven by UI input, the other by Forge's AI (vs-bot) or a second human seat (hotseat).
   The lab never writes rules adjudication for the board; Forge enforces via the bridge.
4. **Escape hatches that exist from Phase 1**: Forge's own GUI plays exported sets vs its AI
   immediately; Cockatrice gives networked human tables; Draftmancer gives human draft pods.

---

## 4. Thin end-to-end slice

Scope (one working loop, tiny mechanic subset):

1. **DSL v0**: vanilla + french-vanilla creatures (evergreen keywords: flying, vigilance,
   deathtouch, trample, haste) + four spell effects mapping to Forge `SP$ DealDamage`, `Draw`,
   `Pump`, `Destroy`. This *is* the engines report's transpilability probe (spike 3).
2. **Set-gen v0**: LLM generates a ~30-card two-color mini-set into DSL v0 against a skeleton-lite
   profile; structural validators + one critique pass.
3. **Compile + conformance**: emit a Forge custom edition; every card loads; a scripted smoke
   game runs via the bridge (v0 bridge = wrap the `sim` CLI and parse `-q` output; per-turn JSON
   snapshots land in Phase 2).
4. **Deck build v0**: LLM builds two 17/23 decks from the mini-set; curve/land validators.
5. **Sim + metrics v0**: 200 games across 8 JVM workers; game-length distribution, win-rate band
   (40–70% the prior project guard), mulligan/screw rate from logs; assertions run as `npm test`.

What it proves (and what it kills if it fails):

- **DSL→Forge round trip is mechanical** — the stance's load-bearing bet (engines spike 3).
- **Custom editions actually load and play headlessly** (engines spike 2).
- **Throughput reality**: the slice produces the games/hour number the engines lane says nobody
  has published (spike 1). Gate: if sustained throughput across workers cannot reach ~1k
  games/hour on lab hardware, the stance's mass-sim story is wrong and the fallback (§6 R1)
  triggers *before* any deeper investment.
- **The full loop runs unattended** — generation to CI verdict with no human in the loop.

---

## 5. Phased roadmap

### Phase 1 — Oracle online (thin slice + spikes)
Data ingest (Scryfall/MTGJSON/CR), DSL v0, Forge CLI wrap, the §4 slice, and the three engine
spikes as first-class deliverables (throughput benchmark, custom-set round trip incl. the
undocumented draft-booster question, transpilability probe). Exit: CI-green thin slice + a
measured games/hour number + a go/no-go memo on the wrap bet.

### Phase 2 — Full Limited pipeline + free calibration
Bridge v1 (JSON stdio, seeded matches, per-turn 17lands-superset snapshots — Manabrew's parity
discipline as the bridge's own test suite). Skeleton profiles (`play-booster-2024`,
`draft-booster-2021`) and the Mechanical Color Pie transcribed as data (set-design §13). Full
validator gates (16 checks). Set-scale generation (~250 cards). Metrics Tiers A–D. **Calibration
Mode P on two real sets (BLB + ECL)** — human decks from 17lands `deck_*` columns replayed
bot-vs-bot, corrections frozen into a versioned table; `spells` on the human side. Exit: a full
custom set passes set-health CI with calibrated bands; correction table v1 exists.

### Phase 3 — Draft lab + informed deck lab + LLM tier
Self-hosted Draftmancer; sets emitted with LLM-assigned ratings (day-0 SimpleBot quality is
exactly our ratings, tooling §1.1); self-play-corrected ratings; statistical-drafting-shaped MLP
on self-play picks; our bot service behind `ExternalBotInterface`; Mode F calibration (draft +
play) against 17lands draft CSVs. Deck lab v1: full criteria schema (archetype, curve, budget,
power band, synergy, format), Spellbook interop for real cards, sim-verified explanations.
Tier-2 agents via bridge tools (mage-bench pattern): mulligans, deep-play reviews. Exit: drafts
vs bots on a custom set produce decks whose sim stats feed the set CI; deck lab answers
criteria prompts with sim-backed receipts.

### Phase 4 — Play surfaces
Replay viewer over bridge logs; interactive session mode in the bridge; playable web board
(vs-bot and local hotseat) grown from replay components; Cockatrice XML + image export for
networked human playtests; TTS sheets optional. Exit: a human drafts a custom set against bots
in Draftmancer, then plays the deck on the lab's board against a Forge-backed bot.

### Phase 5 — Seraphine flagship
Art pipeline ports online (ComfyUI/fal contract, per-set LoRA style lock incl. frame family,
typed art specs, deterministic repair); renderer at set scale with original frames + OFL fonts;
full flagship set designed → validated → mass-simmed → CI-passed → drafted vs bots → played
(board, hotseat, Cockatrice); theme.json indirection so the shipped bundle is generic;
FCP notice, no WotC marks, strictly non-commercial. Exit: the brief's flagship validation,
end to end in the lab.

---

## 6. Reuse manifest and top risks

### 6.1 Reuse manifest (research verdicts, consolidated)

| Artifact | License | Role | Verdict source |
|---|---|---|---|
| Forge (headless + custom sets + AI + GUI) | GPL-3.0 | rules engine of record, tier-1 bots, sealed/draft vs AI, immediate human surface | engines §1 (interop→promoted to primary under this stance) |
| Draftmancer (self-hosted) | MIT | draft lab, custom-set+collation format, bot seam, MTGA export | tooling §1.1 adopt; mtg-ai §3.5 adopt |
| spells | MIT | 17lands ingestion + aggregates | metrics §9 adopt |
| statistical-drafting | MIT | pick-model architecture for self-play retraining | mtg-ai §3.4 adopt |
| Scryfall bulk / MTGJSON vocab / CR TXT | see data lane | data foundation, DSL enums | data §1–3 adopt/interop |
| 17lands public dumps | CC BY 4.0 | calibration baseline | metrics §2 adopt |
| Karsten math; NWO/skeleton/as-fan/color-pie as data | facts/articles | analytic priors + Tier D gates | metrics §9; set-design §13 |
| mana + keyrune fonts | OFL 1.1 | symbols (lab-internal; redrawn for public bundles) | data §5 adopt |
| Commander Spellbook API | MIT | real-card synergy for deck lab | mtg-ai §4 interop |
| Cockatrice (XML export) | GPL-2.0 | human networked tabletop | tooling §3.1 interop |
| Argentum HTTP gym | MIT | future RL/cheap-rollout tier | engines §4 (deferred interop) |
| mage-bench pattern | MIT | tier-2 LLM contract over our bridge | mtg-ai §2.2 inspire |
| Manabrew parity harness + DSL grammar docs | AGPL (patterns only) | bridge test discipline; DSL semantics reference | engines §2 inspire |
| mtgrender pattern; MTGA/.cod/.dec formats; CubeCobra CSV | various | renderer proof; deck interop | tooling §2.4, §4 |
| The prior project: art pipeline, effectSpec, balance sim, harness, theme indirection, governance | in-house | §2.4 table | reuse doc #1–#12 |
| XMage mechanic implementations | MIT | reference logic when writing fork extensions (stage 2) | engines §3 inspire |

### 6.2 Top risks, with mitigations — including where this stance is weakest

**R1 — Forge mass-sim throughput is unpublished (the stance's weakest point).** No games/hour
number exists anywhere; the wiki warns of "almost unbearably long" AI turns; the 120 s clock is a
ceiling, not a promise (engines §1.3). *Mitigation:* the thin slice measures it in week one on a
mechanically simple set (which is also the regime our early sets occupy); games parallelize
across JVM workers; the metrics workload is 10³–10⁴ games per revision, not millions (§1.1.5).
*Fallback, pre-committed:* if sustained throughput misses the gate, adopt the engines lane's
hybrid — a minimal TS kernel scoped to the slice's mechanic subset for mass sim, with Forge
retained as parity oracle and full-rules surface. The stance degrades gracefully into the lane
recommendation instead of failing.

**R2 — Stage-2 rules surgery means Java in a GPL fork, not TS.** New zones/turn structure
require extending Forge's enums and effect classes (engines §1.2), sacrificing engine-layer TS
purity. *Mitigation:* the brief already stages deep modification second; the set-design lane's
mechanic classifier (existing-primitive / parameterized-extension / rules-surgery) gates
generation to the first two classes until fork extension points exist — the identical policy the
build path needs, on a different substrate; MIT XMage implementations serve as reference logic;
and the composition space *without* Java (204 effect APIs × parameterized keywords × `T/S/R/SVar`)
is far larger than a young custom kernel's total space, so stage 2 arrives later and smaller
than it would on the build path.

**R3 — Seeded determinism through Forge is unverified.** Our CI needs reproducible games; the
`sim` CLI documents no seed control. *Mitigation:* the bridge owns `forge-game` object
construction and can inject RNG; Manabrew's parity harness ran Java Forge with "the same deck
pair, seed, and deterministic choices" — an existence proof (engines §2). Verified as part of
bridge v1; if per-game determinism proves brittle, statistical CI over fixed seed *sets* still
satisfies the balance-band assertions (metrics §10.7 warns about bot-determinism sample
illusions in the other direction — seeded variation is required anyway).

**R4 — GPL/AGPL boundary discipline.** One careless vendoring event contaminates the TS tree.
*Mitigation:* bridge isolated as its own GPL module speaking stdio JSON; no Forge code, assets,
or card *data* in shipped bundles; AGPL repos are read-only references; a CI check greps the TS
tree for vendored engine paths. Non-commercial, non-distributed engine use is unproblematic
(engines §1.4).

**R5 — Upstream drift and single-project dependency.** Forge could change script semantics or
stall. *Mitigation:* pin and vendor a frozen release per lab version (a subprocess, so upgrades
are opt-in); the script format has 33k files of inertia and Manabrew's independent grammar
documentation; Forge has 15+ years of continuous releases including 2026-08-08 — the healthiest
project in the entire survey. Residual risk accepted.

**R6 — Forge AI bias distorts playability metrics.** Documented: strong aggro/midrange, poor
control/combo (metrics §6.1) — self-play stats will inflate aggro archetype health.
*Mitigation:* this is precisely what the metrics lane's calibration protocol measures and
corrects (§8: Mode P isolation, skill anchoring to a 17lands bucket, sign-stability demotion) —
and the protocol is *cheaper* under wrap because real calibration sets are already enforceable
(§1.1.4). Forge's biases being publicly documented for a decade makes them the best-understood
confounder available; a custom kernel's greedy bots would have the same class of bias with zero
documentation. Tier-2 LLM spot-play reviews flagged archetypes (mtg-ai §7).

**R7 — Custom-edition draft boosters in Forge are undocumented** (engines spike 2). *Mitigation:*
drafting happens in Draftmancer (adopted, custom-set native); Forge only needs to *play* the
resulting decks, which the custom-edition path documents. The spike resolves whether Forge-side
sealed/draft is a bonus or absent; nothing on the critical path depends on it.

---

## 7. What this stance buys, in one table

| Capability | Build-heavy path | Reuse-maximal path |
|---|---|---|
| Enforceable card space at month 3 | slice subset (~dozens of effects) | slice subset **plus** Forge's 204 APIs / 202 keywords for everything the compiler admits |
| Real-set calibration (metrics §8 Step 2) | after a full custom-kernel set implementation | Phase 2 — every real set already enforceable |
| Rules correctness burden | ours, forever, incl. CR 613 | Forge upstream's, diffed via parity discipline |
| Human play of generated sets | after lab UI exists | Phase 1 (Forge GUI), Phase 2 (Cockatrice), Phase 3 (Draftmancer pods) |
| Novelty budget spent on | rebuilding a rules engine | the three things prior art has never built |
| Worst-case failure mode | kernel stalls at the documented cliff | throughput gate fails → pre-committed fallback to the lane's hybrid |
