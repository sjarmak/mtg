# Engine-strategy decision synthesis

Deciding-judge synthesis, 2026-08-09. Inputs: `docs/design-brief.md` (goal-of-record),
`the prior-project reuse audit`, the six prior-art lane reports
(`prior-art-{engines,data-sources,mtg-ai,playability-metrics,set-design,tooling}.md`), and the two
architecture proposals (`proposal-reuse-maximal.md`, `proposal-build-first.md`). All files were read
in full; none were missing. Every score below cites lane evidence, not preference.

---

## 1. Decision

**BUILD-FIRST, as a hybrid: custom strict-TypeScript rules kernel + typed mechanics DSL as the
lab's core, with Forge held at arm's length as a parity oracle, export target, and early human play
surface — and with reuse-maximal's periphery adopted wholesale (Draftmancer, `spells`,
statistical-drafting, the data stack, the the prior project art pipeline).**

This is materially the engines lane's own independent recommendation ("hybrid, weighted heavily
toward build", engines §8), reached before either proposal was written, and the criterion scoring
below confirms it. Three grafts from reuse-maximal are adopted into the winning plan (§4).

---

## 2. Criterion scoring

Scale 1–5 per criterion. Evidence citations are to the lane reports.

| # | Criterion | Reuse-maximal | Build-first | Evidence |
|---|---|---|---|---|
| 1 | Custom-mechanic enforceability ceiling | **3** | **4** | see 2.1 |
| 2 | Staged rules modifiability | **2** | **5** | see 2.2 |
| 3 | Mass-playtest throughput | **3** | **4** | see 2.3 |
| 4 | Time-to-thin-slice | **5** | **3** | see 2.4 |
| 5 | TS-stack fit & long-term maintenance | **2** | **5** | see 2.5 |
| 6 | License/IP safety | **4** | **5** | see 2.6 |
|   | **Total** | **19** | **26** | |

### 2.1 Custom-mechanic enforceability ceiling — build 4, reuse 3

Reuse starts enormous: Forge's ~204 effect APIs × ~202 keywords with free `A/T/S/R/SVar`
composition means "a very large space of custom cards and many custom mechanics need zero Java"
(engines §1.2), versus a custom kernel that starts near zero. But the *ceiling* — the load-bearing
word in this criterion — is different from the starting inventory. Under wrap, every genuinely new
primitive (keyword action, zone, resource, turn hook) is Java in a GPL fork whose enums we don't
control, and the wiki itself documents oddball keywords that are hardcoded rather than scriptable
(engines §1.2). Under build, the ceiling is whatever we design extension points for, and the
co-design invariant ("output space equals enforceable space", brief) is only *ownable* when we own
the DSL and its interpreter — the engines lane makes this argument (b) of its recommendation.
Arena's GRE validates the cards-as-data-compiled-to-DSL shape at production scale (engines §7),
and our problem is strictly easier than Arena's because we generate only what we can enforce.
Reuse keeps a real advantage in month-3 breadth (its §7 table is honest about this), hence 3 not 2.

### 2.2 Staged rules modifiability — build 5, reuse 2

The brief stages modifiability: parameterized variants now, deep modification (new zones, turn
structure, resources) later. Stage 1 is a wash — both substrates parameterize. Stage 2 is where
reuse breaks: Forge and XMage hardcode zones and turn structure across 15 years of Java; the
set-design lane's rules-surgery receipts (Companion forced a CR change two months post-release;
Day/Night's persistent global state broke on Clone corner cases; Mutate needed merged-permanent
rules — set-design §7.3) show that these are engine surgery even for WotC, and extension points for
surgery only exist if designed in. Reuse-maximal's own R2 concedes stage 2 means "Java in a GPL
fork, not TS". Build-first converts stage 2 into an API-design task (zone registry, turn-structure
pipeline, resource ledger) with Argentum's engine-code-plus-DSL-facade-in-one-change pattern as the
working model (engines §4). The LLM-referee lane also lands here: a referee that never owns state
needs a kernel that can serialize framed excerpts, enumerate legal options, and apply a structured
ruling as an event — kernel API capabilities that cannot be retrofitted through a subprocess
boundary onto Forge's internals (MTG Bench failure modes, engines §7).

### 2.3 Mass-playtest throughput — build 4, reuse 3, both unproven

The honest state of evidence: **neither side has a measured number.** Forge has no published
throughput anywhere, a 120 s/game worst-case clock, and "almost unbearably long" AI turns on
complex boards (engines §1.3); no TS engine has ever demonstrated mass rollouts either
(build-first R4 concedes this). Reuse's sizing argument is legitimate — the brief's playability
metrics need 10³–10⁴ seeded games per revision (the prior project `combatLengthSim` at 1,000
games/strategy, reuse doc #5; community Forge workflow of 50–100 parsed games, metrics §6.1), not
MCTS-scale millions. Build edges ahead on three structural grounds: (a) seeded determinism is
native to an event-sourced reducer and *unverified* through Forge (reuse's own R3; Manabrew's
parity harness is an existence proof, not a shipped facility); (b) the metrics lane's key design
decision — emit a superset of the 17lands replay schema under the same column names so calibration
is a join (metrics §2.4) — is trivial when we own the logger and a parsing project when we scrape
another engine's logs; (c) the immutable-fork architecture (Argentum gym, engines §4) is the
proven shape for cheap rollouts if a learned-bot tier ever arrives. Both proposals correctly make
throughput a week-one measured spike; the beads below keep both measurements.

### 2.4 Time-to-thin-slice — reuse 5, build 3

Reuse's clearest win. Its slice wraps the existing `sim` CLI and writes no turn/priority/stack/
combat code at all; build's slice must stand up kernel v0 before the first green loop. Reuse also
gets human play of exported sets on day one (Forge GUI) and the calibration schedule asymmetry is
real: under wrap, every real set is already enforceable, so Mode P calibration (replay human deck
lists with bots, metrics §8) could run in Phase 2, versus build's Phase-3 conformance milestone
(one full real set implemented in the DSL). Two caveats shrink but don't erase the gap: the
metrics lane freezes correction tables **per engine+bot version** (metrics §8 step 6), so
corrections measured under Forge's AI calibrate *Forge's* sims, not our kernel's — under
build-first, early Forge calibration is a methodology dry-run and human-side harness shakedown,
not a reusable correction table; and build's slice deliberately excludes the graveyard-killer
subsystems (layers, replacement effects), keeping kernel v0 inside the machinery hobby engines
demonstrably get through (engines §5).

### 2.5 TS-stack fit & long-term maintenance — build 5, reuse 2

The brief locks strict TypeScript for engine/sim/agents/UI. Reuse's answer is a permanently
maintained ~1–2k LOC Java GPL bridge module plus JVM worker orchestration plus a text-log/JSON
contract against an upstream that ships releases weekly and could drift script semantics (reuse's
own R5), with the engine of record permanently outside the stack, the toolchain, and the test
runner. The engines lane's graveyard survey also closes the adoption door from the other side:
"No credible TypeScript engine exists… all effectively dead or embryonic" (engines §5) — build is
the only path to a TS core, and the field being Java-or-dead is precisely why the lane's
recommendation is build-weighted. Build's maintenance burden (rules-correctness debt, forever) is
real but sits inside the stack, guarded by exhaustive discriminated-union narrowing, the parity
harness, and seeded bisectability (build-first R2). Reuse gets 2 not 1 because the subprocess
relationship itself is clean engineering — its cost is permanence, not fragility.

### 2.6 License/IP safety — build 5, reuse 4

Both proposals have the hygiene right: GPL engines behind process boundaries, AGPL never vendored
(Manabrew, mtgdraftbots, Academy Ruins code), unlicensed repos patterns-only, OFL fonts, original
frames, theme indirection, FCP notice, non-commercial locked (data §6, tooling §7). The delta:
under build, every enforced rule and shipped pixel in the lab's own path is ours or MIT/OFL, and
XMage's MIT license makes the two graveyard-killer subsystems legally portable *into* the kernel
with attribution (engines §3) — the one place where "inspire" includes code. Under reuse, the
rules engine of record and the interactive board's adjudication path are GPL-3.0 forever; that is
compliant at arm's length but means the lab's core capability can never ship as part of any bundle,
and one careless vendoring event contaminates the tree (reuse's own R4 needs a standing CI grep).

---

## 3. Steelman of the loser (reuse-maximal)

Its three strongest arguments, stated at full strength:

1. **The graveyard is empirical, not rhetorical.** Dozens of custom engines died at the same
   documented cliff — CR 613 layers, replacement effects, targeting combinatorics (engines §5).
   Argentum, the best-case comparable (strong single lead, daily pushes since January), has partial
   coverage of ~6 sets after 7 months (engines §4). Betting the lab's schedule on being engine #41's
   first survivor is the single riskiest thing either proposal does, and reuse-maximal is right to
   hammer it.
2. **Opportunity cost points at the novelty budget.** The mtg-ai lane is flat: "no prior system
   closes the loop with simulation… sim-grounded power calibration of generated cards is the
   genuinely novel contribution" (mtg-ai §5.4). The tooling lane's novelty check agrees: everything
   downstream of "the set exists as data" is solved and adoptable (tooling §5). Every month spent
   re-deriving the layers system is a month not spent on the only parts nobody has built.
3. **Calibration and human play arrive years earlier.** Under wrap, all 33k real cards are
   enforceable on day one, so the metrics lane's calibration protocol (whose Step 2 requires the
   calibration set enforceable in the engine of record) runs in Phase 2, and humans can play
   exported sets in Forge's GUI immediately. Under build, full real-set enforcement is the Phase-3
   conformance milestone and reuse's §7 table is right to call the asymmetry large.

Why these do not flip the decision: (1) is mitigated by four advantages no graveyard engine had —
bounded co-designed output space, MIT reference implementations of exactly the killer subsystems
(XMage, Argentum's dependency-ordering doc), a 15-year-hardened oracle to diff against
mechanic-by-mechanic (Manabrew's parity discipline), and the complexity literature's instruction to
scope a decidable envelope with structural-only legality (engines §7) — plus a staged bet where the
slice defers the cliff entirely and gives a cheap abort signal. (2) cuts both ways: the three
locked capabilities that *are* the novelty (custom mechanics, staged modifiability, the referee
lane) are all properties of whoever owns the enforceable space; spending the budget on a wrap
means renting the core and owning only the periphery. (3) is partially rescued by grafting (§4.3):
Forge gives human play of exported sets and a calibration dry-run early under build-first too —
what it cannot give build-first is a reusable correction table, because correction tables are
engine+bot-versioned (metrics §8 step 6).

---

## 4. Grafts from reuse-maximal into the winning plan

1. **Forge oracle pulled forward into the thin slice.** Build-first deferred the DSL→Forge
   transpiler to Phase 2; reuse-maximal's slice compiles to Forge on day one. Adopt reuse's
   ordering: the slice's mechanic subset (evergreen keywords + ~10 effects) maps to `SP$
   DealDamage/Draw/Pump/Destroy`-class scripts almost mechanically, which *is* the engines lane's
   obligated spike #3. Every generated card must boot in headless Forge from the first slice —
   the co-design invariant gets a second, 15-year-hardened opinion from week one, and the
   conformance gate ("every card boots, a smoke game runs") becomes a standing CI step.
2. **Pre-committed, symmetric kill-tests.** Reuse-maximal pre-committed a fallback if Forge
   throughput failed; the same discipline is adopted in mirror image. The slice publishes measured
   TS-kernel games/sec and fork-cost numbers alongside the Forge games/hour spike. If kernel
   throughput cannot support 10⁴ seeded games per set revision on lab hardware, the brief's
   pre-authorized native-core escape hatch triggers; if kernel *velocity* stalls at the Phase-2
   cliff (layers/replacement), the pre-committed fallback is reuse-maximal's shape — Forge as sim
   substrate behind a bridge — with the DSL and validators surviving unchanged because they already
   compile to Forge scripts. The decision degrades gracefully in both directions instead of failing.
3. **Forge and Cockatrice as immediate human surfaces + early calibration dry-run.** Exported sets
   are playable in Forge's GUI (vs its AI, sealed) and on Cockatrice tables as soon as the exporters
   exist — no lab UI on the critical path for human playtesting. Additionally, run the metrics
   lane's Mode P protocol once over Forge-simmed real-set games early (Phase 2) as a *methodology
   dry-run*: it exercises `spells`, the join contract, skill anchoring, and the correction-table
   tooling before the kernel's own Phase-3 calibration — clearly labeled advisory, never a
   correction table for kernel sims.

Grafts already common to both proposals and kept: Draftmancer adopted (MIT, custom-set + collation
format, `ExternalBotInterface`, SimpleBot rating seam — tooling §1.1); `spells` adopted for the
human-side 17lands harness (metrics §9); statistical-drafting's MLP shape for self-play pick models
(mtg-ai §3.4); Scryfall/MTGJSON/CR ingestion per the data lane §8; skeleton profiles and the
Mechanical Color Pie as versioned data (set-design §13); the the prior project art pipeline, effectSpec
typing discipline, balance-sim CI pattern, and theme indirection (reuse doc #1–#12); the LLM
referee scoped to framed, schema-constrained rulings with a compile-me-down bead per invocation
(engines §7, mtg-ai §5.3).

---

## 5. Thin end-to-end slice (under the decision)

One loop, all stages, smallest honest scope — build-first §4 plus graft #1:

- **DSL v0**: creatures with evergreen keywords (flying, vigilance, haste, trample, deathtouch,
  lifelink, menace, reach, first strike); ~10 spell-effect primitives (deal damage, destroy, pump
  EOT, draw, gain life, counter); basic lands/mana; targeting limited to "any target"/"target
  creature". Excluded: activated/triggered/static abilities beyond keywords, replacement effects,
  full layers (only a minimal fixed-order P/T layer built against Argentum's CR 613 doc so it grows
  rather than gets rewritten).
- **Kernel v0**: event-sourced pure reducer; full turn/priority/stack machinery and combat from day
  one (the graveyard shows engines get through these; the cliff is deferred by construction);
  seeded RNG; snapshot/fork.
- **Set-gen v0**: skeleton-lite profile (~90 cards, 2 rarities, 5 colors + artifact,
  play-booster-derived curve/creature-share numbers); LLM slot-fill into DSL v0; deterministic
  validators (schema, curve, color-pie subset, creature-share bands, NWO line count); one LLM
  critique pass with validate-retry.
- **Deck build v0**: deterministic pool→deck builder (17 lands + 23 spells, curve mass at 2–4,
  two-color pools).
- **Sim + metrics v0**: tier-1 greedy bots, 1,000 seeded games per color-pair matchup × 10 pairs,
  worker-parallel; logs emitted in the 17lands replay-schema superset from the first run; game-length
  distribution, per-pair win-rate band (40–70%), no-dominant-strategy guard, mana-screw rate vs
  Karsten priors, stall/decisiveness guard — asserted as `npm run test:balance`.
- **Oracle gate (graft)**: DSL→Forge transpiler for the slice subset; the generated set exports to a
  Forge custom edition, every card boots headlessly, one scripted smoke game runs.
- **Measurements published**: TS-kernel games/sec + fork cost; Forge games/hour + log-parse cost
  (spike A); Forge custom-set round-trip findings incl. the undocumented draft-booster question
  (spike B).

Exit = the loop runs unattended from mechanics prompt to CI verdict; both throughput numbers exist;
a go/no-go memo confirms or revises the engine bet on evidence.

**Amendment, 2026-08-10 (mtg-bc2.4).** "CI verdict" above is read as "an unattended verdict on a
fixed seed", satisfiable by a local run, rather than as "a run observed inside GitHub Actions". The
reason is specific and expiring: this repository has no git remote, so no job can be watched from
the machine the work happens on, and holding the slice open on an observation that is structurally
impossible here would leave a P0 open for a missing remote rather than for missing work. The
substance was demonstrated locally on 2026-08-10: `npm run slice` green end to end in 24.1 s on seed
`slice/v0` with the fixture provider, 90 of 90 slots printed and legal, format health PASS at 23 of
23 gates, and the Forge boot gate PASSED with all 90 cards mapped to Forge scripts, no rejections,
and Forge 2.0.14 loading all 90 and playing two smoke games under Xvfb.

Two things this amendment does **not** relax. The oracle gate stays a real gate rather than an
advisory one: `ci.yml` provisions Xvfb and runs it blocking, which mtg-bc2.31 verified, and a gate
that reports SKIPPED still fails to satisfy this criterion wherever it runs. And the published
throughput numbers must come from an unloaded machine; the 2026-08-10 run measured 232.0 games/sec
workload and 292.6 raw kernel against 336.9 and 373.2 recorded earlier, because three agent lanes
were running concurrently. The criterion asks that the run emit those inputs, not that any
particular run's values be quotable.

When a remote exists, the first green CI run on the regenerated set supersedes this amendment and
nothing here needs revisiting.

---

## 6. Proposed phase-1 bead breakdown

Priorities: 0 = highest. Each bead is independently workable; dependencies noted in descriptions
are orderings, not blockers to filing.

| # | Title | Type | Pri |
|---|---|---|---|
| 1 | ADR-0001: engine strategy = custom TS kernel + DSL, Forge as oracle | task | 0 |
| 2 | DSL v0: typed card records, Zod schemas, structural validators | feature | 0 |
| 3 | Kernel v0: event-sourced reducer — turn/priority/stack, combat, seeded RNG | feature | 0 |
| 4 | Thin-slice integration: unattended loop green in CI | task | 0 |
| 5 | Data ingest v0: Scryfall bulk + MTGJSON vocab → local store | feature | 1 |
| 6 | Tier-1 greedy bots + worker-parallel sim runner with throughput benchmark | feature | 1 |
| 7 | Log exporter: 17lands replay-schema superset | feature | 1 |
| 8 | Metrics v0 + balance CI (`test:balance`) | feature | 1 |
| 9 | Set-gen v0: skeleton-lite profile + LLM slot-fill + critique loop | feature | 1 |
| 10 | Forge spike A: headless sim throughput benchmark | task | 1 |
| 11 | DSL→Forge transpiler v0 + conformance boot gate | feature | 2 |
| 12 | Deterministic deck builder v0 (17/23, curve mass) | task | 2 |
| 13 | Forge spike B: custom-set round trip + draft-booster question | task | 2 |
| 14 | Skeleton profile data: play-booster-2024 transcription | task | 2 |
| 15 | Color-pie table v0: slice-vocabulary subset as versioned JSON | task | 3 |

Full descriptions with acceptance criteria are in the structured output accompanying this synthesis
(and should be filed verbatim as beads).

---

## 7. Honestly-deferred questions

1. **Kernel velocity at the cliff.** The slice cannot de-risk layers/replacement effects; Phase 2
   does, behind the parity harness. The pre-committed fallback (§4.2) is the answer to "what if it
   stalls", but the probability itself is unknowable until XMage/Argentum design porting starts.
2. **Forge seeded determinism.** Manabrew proves deterministically-driven Forge games are possible;
   whether the `sim` CLI (vs a purpose-built bridge) can be seeded reproducibly is unverified —
   spike A should probe it, and the parity harness depends on the answer.
3. **Throughput sufficiency thresholds.** What TS games/sec triggers the native-core escape hatch,
   and what Forge games/hour would have changed this decision — both get real numbers from the
   slice; the thresholds themselves (10⁴ games/revision assumed sufficient per the metrics
   workload) deserve a written gate before the go/no-go memo.
4. **Calibration transfer, twice over.** (a) The metrics lane's load-bearing assumption: corrections
   measured on real sets may not transfer to novel mechanics (metrics §10.1). (b) Build-specific:
   which real set (BLB/DSK/ECL, per the verified coverage table) becomes the Phase-3 DSL
   conformance milestone, and how much of the early Forge-based Mode P dry-run carries over.
5. **LLM referee economics and validity.** Per-ruling cost, acceptable call volume before a
   mechanic must compile down, and whether refereed games can ever count toward advisory metrics
   (currently: excluded from balance CI entirely).
6. **Draftmancer rating scale.** What rating mapping makes SimpleBot draft custom sets sanely
   (tooling §8.1) — answered by ADR-0003, which maps `evaluateCard`'s score onto the format's 0-5
   band and argues the width against SimpleBot's 0.35 color step; still open is whether that
   ordinal scale can be calibrated against 17lands pick orders, and the self-hosted external-bot
   registration spike (tooling §8.2).
7. **Design-canon tuning.** NWO 20% red-flag budget as default-with-override vs empirically fitted
   from complexity-vs-GIH-WR curves; skeleton conformance tolerance bands (real WotC sets deviate
   from their own skeleton — needs the ~10-real-set empirical pass, set-design §14).
8. **MTG-Causal-RL env**: is the code actually released, under what license, and fast enough to be
   a stronger-bot tier (metrics §11.1)?
9. **Deep-play review calibration signal.** 17lands replay data is per-turn aggregates, not
   per-action; where does ground truth for LLM deep-play review quality come from (metrics §11.4)?
