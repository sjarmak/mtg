# ADR-0001: Engine strategy

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-09 |
| **Bead** | `mtg-bc2.1` |
| **Kill-tests** | Two, pre-committed, in §6 |
| **Amendments** | §9 (2026-08-14, `mtg-bc2.151`): Forge as a play backend. §10 (2026-08-15, `mtg-bc2.152`): the coverage question, measured — amends §9.1 and §3. §11 (2026-08-15, `mtg-bc2.41`): the Forge-bridge parity harness, authorized narrowly — amends neither, clarifies §6.2. §12 (2026-08-16, `mtg-bc2.151`): the second runtime is committed scope — amends §11.4 and §9.2 |
| **Inputs** | `docs/design-brief.md`, `docs/research/decision-synthesis.md`, `docs/research/prior-art-engines.md`, the other five prior-art lane reports, `docs/research/proposal-build-first.md`, `docs/research/proposal-reuse-maximal.md` |

---

## 1. Context

This lab generates Magic sets and then plays them: mechanics prompt to design skeleton to a full
set emitted as data, then deck construction, then mass bot-vs-bot simulation, then playability
metrics asserted as CI gates. Everything in that pipeline depends on one substrate, a rules engine
that can actually run the cards we invent.

Two properties of the lab make the engine choice load-bearing rather than incidental.

The first is the **co-design invariant** from the design brief: the set generator's output space
equals the engine's enforceable space. Cards are emitted in a typed DSL, never as free text that
something downstream has to interpret. Every prior card-generation system failed here; the
mtg-ai lane traced illegal and unrunnable output from RoboRosewater through modern LLMs
(`prior-art-mtg-ai.md` §5.1). We eliminate that failure class by construction, which means the DSL
and the engine that interprets it have to move together. Whoever owns the enforceable space owns
the generator's ceiling.

The second is **staged rules modifiability**, also locked in the brief. Phase one is parameterized
variants and formats. Later stages are deeper: new zones, altered turn structure, new resources.
Extension points for that kind of surgery exist only if somebody designs them in.

Against those requirements sit hard constraints. The stack is strict TypeScript for
engine, sim, agents, and UI. The lab is non-commercial under the WotC Fan Content Policy. Balance
has to be a CI assertion over seeded simulation, which means the engine has to be deterministic
under a seed and fast enough to run roughly 10<sup>4</sup> games per set revision
(`prior-art-playability-metrics.md` §6.1). And the field is mature, which cuts both ways: there
are three healthy open-source engines with a combined thirty-plus years of rules hardening, and
none of them is in our language.

Two full architecture proposals were written and argued (`proposal-reuse-maximal.md`,
`proposal-build-first.md`), scored against six criteria, and adjudicated in
`decision-synthesis.md`. This ADR records the outcome and, more importantly, records the
conditions under which the outcome is wrong.

---

## 2. Decision

**Build-first, as a hybrid.**

A custom strict-TypeScript, event-sourced rules kernel plus a typed mechanics DSL is the lab's
core. Forge is held at arm's length as a parity oracle, a transpile target, and the early human
play surface. XMage and Argentum, both MIT-licensed, are mined as reference designs for the
subsystems that kill hobby engines. An LLM referee exists, scoped to framed, schema-constrained
rulings, and never owns game state.

Four commitments make that concrete.

### 2.1 The kernel and the DSL are ours, and they move together

The kernel is a pure event-sourced reducer: state plus event yields new state, no mutation, seeded
RNG, snapshot and fork as first-class operations. Kernel v0 (`mtg-bc2.3`) implements the full turn
structure, priority, the stack, and combat from day one, because the graveyard survey shows engines
reliably get through exactly that machinery (`prior-art-engines.md` §5). It deliberately does not
implement the CR 613 layer system or replacement effects; those are phase 2 (`mtg-bc2.16`), and the
thin slice is scoped to avoid needing them.

The DSL (`mtg-bc2.2`) is a two-tier design in the Magarena tradition: declarative typed card
records composing a curated primitive vocabulary for the common case, with staged extension points
for genuinely new primitives. Each new primitive lands as kernel code and DSL facade in a single
change, the working pattern Argentum uses (`prior-art-engines.md` §4). The slice vocabulary is
pinned: nine evergreen keywords, ten spell-effect primitives, four targeting modes, five colors
plus colorless artifacts.

The rule that keeps the co-design invariant honest is that the generator can only emit vocabulary
the kernel can execute, and the validators enforce that structurally, over the DSL, never by
reasoning about oracle text.

### 2.2 Forge is an oracle, an export target, and a play surface, and nothing else

Forge is the incumbent: GPL-3.0, Java, roughly 33,600 card scripts, a built-in headless `sim` CLI,
weekly releases (`prior-art-engines.md` §1). We use it three ways.

As a **parity oracle**, adopting Manabrew's discipline: same deck pair, same seed, scripted
choices, diff the state snapshots, report the first field-level divergence by phase, turn, player,
and object (`prior-art-engines.md` §2). Manabrew calls this the core development tool for their
engine rather than a test suite, and that framing is right. It buys us fifteen years of rules
hardening as a cross-check, mechanic by mechanic.

As a **transpile target**. The DSL compiles to Forge card scripts for the slice subset
(`mtg-bc2.11`), and this is pulled forward into phase 1 rather than deferred. The slice's
mechanics map onto `SP$ DealDamage` / `Draw` / `Pump` / `Destroy`-class scripts almost
mechanically. Every generated card must boot in headless Forge from the first slice, and that
becomes a standing CI gate. Pulling the transpiler forward costs a little phase-1 time and buys two
things: a second, independently hardened opinion on whether our cards are actually well-formed, and
the cheap-fallback property that kill-test B in §6.2 depends on.

As the **early human play surface**. Exported sets are playable in Forge's GUI against its AI, and
on Cockatrice tables via XML export, long before the lab has a board UI. No human playtesting sits
behind our own interface work.

What Forge is not: the engine of record, the simulation substrate, or anything we link against. The
license conditions in §5 are binding, not aspirational.

### 2.3 XMage and Argentum are mined, not wrapped

Both are MIT, which makes their implementations legally portable into our tree with attribution.
XMage has 31,000-plus cards with full rules enforcement, including battle-tested layers and
replacement-effect machinery, but it needs a Java class per card and was never designed for mass
simulation (`prior-art-engines.md` §3). Argentum is young and partially covered, but it is
architecturally the closest thing to what we want: CR 613 layers, replacement effects, a dedicated
design document for continuous-effect dependency ordering, immutable state with O(1) forking, batch
stepping, and versioned observation schemas (`prior-art-engines.md` §4).

So we port designs, not products. Argentum's continuous-effect dependency document is the spec we
build the layer system against, and its gym observation-schema versioning is the pattern for our
own bot API. XMage's per-mechanic implementations are reference logic when a specific interaction
gets subtle. Wrapping either as the engine would trade the TS lock and the co-design invariant for
somebody else's partially covered SDK, which is a worse deal than it looks.

### 2.4 The LLM referee is scaffolding with a hard boundary

During set iteration, a mechanic may exist in a designer's head before it exists in the DSL. The
referee handles that gap: it receives a framed decision (a state excerpt, a specific question, and
a schema of legal options) and returns a structured ruling that the kernel applies as an event. It
never simulates, never holds state, never narrates.

This boundary is drawn from measured failure, not caution. MTG Bench tested fifteen frontier models
simulating full turns without a rules engine; the best scored 95.4 and the weakest 12.8, and the
dominant failure modes were over-eager tool calling, irreversible corruption of hidden information
(draw then undo), and forgotten exile bookkeeping (`prior-art-engines.md` §7). A model that owns
state corrupts state. A model that answers one framed question does not.

Every referee invocation files a bead to compile that mechanic down into the DSL. Refereed games
are excluded from balance CI entirely. The referee is a ramp, not a tier.

---

## 3. Evidence

The decision rests on five findings from the lane reports rather than on preference.

**No TypeScript engine exists to adopt.** The engines lane searched GitHub across TS, JS, Rust, and
Python and found a graveyard: `kurokikaze/mtg-engine` dead since 2014, `snebel29/mtg-rules-engine`
dead at zero stars, `AaronFriel/overseer` dead in 2024, plus a handful of repos days or weeks old
(`prior-art-engines.md` §5). The single healthiest non-Java entry, `wanqizhu/mtg-python-engine`, is
sporadic and 69 stars. The field is Java or dead. If the brief locks strict TypeScript for the
engine, building is not one option among several; it is the only path to a TS core. This finding
does double duty, because it is also the cautionary evidence: the recurring cause of death across
dozens of attempts is the same cliff every time, CR 613 layers, replacement effects, and targeting
combinatorics.

**Forge's custom-mechanic ceiling is real and it is Java.** Forge's composition space is genuinely
enormous, roughly 204 effect APIs and 202 keywords with free `A`/`T`/`S`/`R`/`SVar` composition, so
a very large space of custom cards needs zero Java (`prior-art-engines.md` §1.2). But new
primitives, meaning new keyword actions, zones, resources, or turn hooks, mean extending Java enums
inside a GPL fork we do not control, and Forge's own wiki documents oddball keywords that are
hardcoded rather than scriptable. Under a wrap architecture, our generator's expressible space
becomes Forge's `ApiType` space, and the brief's stage-2 modifiability becomes Java surgery on
somebody else's engine. The reuse proposal concedes this in its own R2.

**Arena's GRE validates the shape at production scale.** Wizards' engineering write-up describes a
Game Rules Engine driven by CLIPS rules, fed by a Python parser that compiles raw English card text
into those rules, which "is what allows 80% or so of newly written Magic cards to just work in MTG
Arena automatically" (`prior-art-engines.md` §7). Cards as data compiled into a rules DSL is the
industry's production answer. Our problem is strictly easier than Arena's, because Arena has to
parse whatever design prints and we only generate what we can already enforce.

**The complexity results bound what any engine can do, which is permission rather than a warning.**
Magic is Turing complete, so deciding a winner is undecidable (Churchill, Biderman and Herrick,
arXiv:1904.09828, peer reviewed at FUN 2021); recognizing the winner is as hard as arithmetic truth
(Biderman, arXiv:2003.05119); and checking the legality of a single step is coNP-hard in general
(Chatterjee and Ibsen-Jensen, ECAI 2016). Read correctly, this says no engine implements the
comprehensive rules. Forge does not, XMage does not, Arena does not. Every engine implements a
decidable operational subset card by card, and the pathologies live in unbounded interactions of
specific printed cards rather than in the turn and stack machinery. A generated set can be designed
and CI-checked to stay inside the tractable envelope, which is a luxury an engine that has to
support all of printed Magic does not have.

**MTG Bench's failure modes fix the referee's boundary.** Covered in §2.4. The state-corruption
result is what turns "LLM referee" from an architecture into a narrowly scoped tool.

---

## 4. Alternatives considered

### 4.1 Reuse-maximal (wrap Forge as the engine of record)

This is the serious alternative and it won a criterion outright. Stated at full strength, its case
has three parts.

*The graveyard is empirical, not rhetorical.* Dozens of custom engines died at the same documented
cliff. Argentum, the best-case comparable with a strong single lead pushing daily since January,
reached partial coverage of about six sets in seven months (`prior-art-engines.md` §4). Betting the
lab's schedule on being the first survivor out of forty attempts is the riskiest thing either
proposal does.

*Opportunity cost points at the novelty budget.* The mtg-ai lane is unambiguous that no prior
system closes the loop with simulation, and that sim-grounded power calibration of generated cards
is the genuinely novel contribution (`prior-art-mtg-ai.md` §5.4). The tooling lane agrees that
everything downstream of "the set exists as data" is already solved and adoptable
(`prior-art-tooling.md` §5). Every month spent re-deriving the layers system is a month not spent
on the only part nobody has built.

*Calibration and human play arrive far earlier.* Under a wrap, all 33,000 real cards are
enforceable on day one, so the metrics lane's calibration protocol, whose second step requires the
calibration set to be enforceable in the engine of record, can run in phase 2. Under build, full
real-set enforcement is a phase-3 conformance milestone.

**Why it lost anyway.** It won time-to-thin-slice 5 to 3 and lost the total 19 to 26
(`decision-synthesis.md` §2). The decisive criteria were staged modifiability (build 5, reuse 2)
and TS-stack fit (build 5, reuse 2). Under a wrap, stage-2 rules surgery is Java in a GPL fork by
the reuse proposal's own admission, and the engine of record sits permanently outside our language,
our toolchain, and our test runner, reachable only through a roughly 1 to 2k LOC Java bridge and a
text-or-JSON contract against an upstream that ships weekly. The three capabilities that are the
lab's actual reason to exist, custom mechanics, staged modifiability, and the referee lane, are all
properties of whoever owns the enforceable space. Wrapping means renting the core and owning the
periphery.

Its strongest argument, the graveyard, is answered by four advantages no graveyard engine had: a
bounded, co-designed output space instead of all of printed Magic; MIT reference implementations of
exactly the killer subsystems; a fifteen-year-hardened oracle to diff against mechanic by mechanic;
and the complexity literature's instruction to scope a decidable envelope with structural-only
legality checking. On top of those sits a staged bet where the thin slice defers the cliff entirely
and produces a cheap abort signal, plus the two pre-committed kill-tests in §6.

Three of reuse-maximal's ideas were adopted into the winning plan rather than discarded: the Forge
transpiler pulled forward into the thin slice, symmetric pre-committed kill-tests, and Forge plus
Cockatrice as immediate human surfaces with an early calibration methodology dry-run
(`decision-synthesis.md` §4).

### 4.2 Wrap XMage

MIT, the friendliest license in the survey, and the largest coverage at 31,000-plus cards. Rejected
on shape. Custom cards are one Java class each with no text DSL, so a generated set means
codegen-Java-compile-load on every iteration. The architecture is client/server, and mass
simulation is not a supported mode; community assessment is that running 100 to 1,000 headless
games is unreliable for both stability and statistics (`prior-art-engines.md` §3). It is the best
thing in the survey to read and the worst of the three Java engines to drive.

### 4.3 Wrap Argentum

Architecturally the closest fit, with an HTTP gym server that already lets non-JVM hosts drive it,
which makes the integration cost genuinely low. Rejected because coverage is partial (about six
sets), the project has a single lead, and adopting it would put a Kotlin SDK between our generator
and the enforceable space, which is the exact coupling this decision exists to avoid
(`prior-art-engines.md` §4). Kept as a future interop option: when learned bots become the
bottleneck, its gym is the candidate.

### 4.4 LLM as the engine

Rejected on measured evidence. See §2.4 and MTG Bench's state-corruption failure modes.

---

## 5. License and IP hygiene, as enforceable conditions

These are conditions of the decision, not guidelines. The reason is optionality rather than current
compliance: GPL obligations trigger on distribution, and a non-commercial, non-distributed lab
invoking Forge as a subprocess is unproblematic today. The point of the boundary is that the lab's
core capability stays distributable if we ever want it to be, and one careless vendoring event
takes that option away permanently.

1. **Subprocess only.** Forge is invoked as an external process. It lives under `tools/forge/` as a
   downloaded release artifact, gitignored, never checked in. No linking, no JNI, no in-process
   embedding. Manabrew's GraalVM recipe, which compiles a Forge harness into a native shared
   library exposing a C ABI (`prior-art-engines.md` §1.4), is documented in the survey and is
   explicitly out of bounds for us, because it links GPL code into our process.

2. **No vendoring.** No Forge, Magarena, or Cockatrice source in this tree, in any form, including
   partial copies inside comments. Card scripts we generate and write out are ours; Forge's 33,600
   scripts are not ingested. Our card corpus comes from Scryfall and MTGJSON
   (`prior-art-data-sources.md` §8).

3. **AGPL is never copied at all.** Manabrew and mtgdraftbots are read-only references. Their
   methodology (the parity harness, the DSL-to-typed-IR compilation pattern) is fair to learn from
   and cite; their code and their prose are not to be copied.

4. **A CI grep guards the boundary.** A check in the standard test gate scans tracked files for
   vendored-engine path fragments (`forge-game/`, `forge-gui/`, `Mage.Sets/`, `magarena/`,
   `manabrew/`) and for GPL and AGPL license headers anywhere in our own tree, and fails the build
   on a hit. It also asserts that `tools/forge/` is gitignored. This check is not optional and is
   not to be skipped with an inline suppression; if it fires, the tree is wrong.

5. **MIT ports carry attribution.** Any file containing logic ported from XMage or Argentum opens
   with a header comment naming the upstream repository, the specific upstream file, its license,
   and whether what was taken is a design or actual code. Ports of a *design* still get the header;
   the cost of over-attributing is zero.

6. **Everything else per the lane reports.** Unlicensed repositories are patterns-only, fonts are
   OFL, card frames are original, the Fan Content Policy notice ships, and the lab stays
   non-commercial (`prior-art-data-sources.md` §6, `prior-art-tooling.md` §7).

   _Amended 2026-08-11 (`mtg-bc2.150`)._ This condition also required shipped bundles to use
   theme indirection, with a runtime `theme.json` and generic compiled strings. That half is
   retired: the project is private, nothing ships to anyone, and the flagship set names its
   source outright (the set design document). The rest of the condition stands.

---

## 6. The two kill-tests

This decision is a bet, and a bet without a stated losing condition is a belief. Two conditions are
pre-committed here. Each names what is measured, the threshold that fires it, who owns the
measurement, and the specific fallback that follows. Both fallbacks are designed to preserve the
DSL and the validators, because those encode the co-design invariant and are the most expensive
things in the lab to rebuild.

**All threshold numbers below are provisional.** They are set now so that the thin slice measures
against a written gate rather than a vibe, and they are to be revised once, in the slice-exit
go/no-go memo, in light of what the slice actually measures. Revising them is expected. Quietly
ignoring them is not.

### 6.1 Kill-test A: the TypeScript kernel throughput floor

**What is measured.** Wall-clock time for one full balance sweep on lab hardware, defined as 10
color-pair matchups times 1,000 seeded games, which is 10<sup>4</sup> games, worker-parallel, on
the slice mechanic subset, with the 17lands-superset logger enabled. Separately, snapshot-and-fork
cost per fork at slice-scale board states.

**Why that quantity.** Balance is a CI assertion in this lab, so the number that matters is whether
`npm run test:balance` completes inside a normal test run, and whether a set designer can iterate
without waiting. Raw games per second is derived from that, not the other way round. Fork cost is
measured separately because it, rather than raw throughput, is what forecloses a future
search-based bot tier.

**Thresholds (provisional).**

| Band | Sweep wall time | Meaning |
|---|---|---|
| Pass | 5 minutes or less (roughly 33 games/sec aggregate or better) | Proceed. Balance CI is viable as designed. |
| Watch | 5 to 20 minutes | One profiling and optimization pass inside TypeScript is pre-authorized: allocation reduction, structural sharing in the state representation, event batching, deferred log serialization. Re-measure. Landing under 5 minutes is a pass. |
| **Fire** | over 20 minutes after the watch-band optimization pass (below roughly 8 games/sec aggregate), **or** fork cost above 1 ms per fork | The escape hatch triggers. |

**Anti-gaming conditions.** The number is measured on the slice mechanic subset, because that is
the regime early sets occupy and a harder regime would fire the hatch on evidence that does not
apply. It is measured with logging on, because logging-off numbers are not the numbers CI will see.
It is not measured against an unoptimized build. And the hatch does not fire on the first
measurement in the fire band; it fires on a measurement taken after the pre-authorized optimization
pass, so we do not buy a native core to fix an accidental quadratic.

**Owner.** `mtg-bc2.6` (tier-1 bots plus worker-parallel sim runner with throughput benchmark)
publishes the number. The slice-exit go/no-go memo (`decision-synthesis.md` §5) reads it against
this table and either proceeds, revises the thresholds with stated reasons, or fires.

**Fallback: the native-core escape hatch.** The brief pre-authorizes a native core if sim scale
demands it. The port is of the kernel's hot path only, meaning the state representation and the
event-application reducer, behind the existing TypeScript kernel interface, as a Rust N-API addon
or a WASM module. An event-sourced reducer is the cheapest possible shape to port, because the
boundary is a pure function of state and event with no hidden lifecycle. Unchanged across the
hatch: the DSL, the Zod schemas and validators, set generation, the deck builder, the bots, the log
exporter, the metrics, and the balance CI. This is a performance change, not an architecture
change, which is exactly why it is worth pre-authorizing.

### 6.2 Kill-test B: kernel velocity at the CR 613 layers cliff

**What is measured.** Progress through the phase-2 subsystems the graveyard says kill engines:
the CR 613 layer system, the 613.8 dependency ordering, CR 614 replacement effects, and the CR 616
multiple-replacement choice rule. Progress is scored against a named suite rather than a feeling.

**The layers conformance suite (provisional shape).** Sixty scenario tests derived directly from CR
613, 614, and 616, covering each layer in order, timestamp ordering, dependency-driven reordering,
self-replacement, and multiple applicable replacement effects. Plus a 200-game seeded parity run
against headless Forge on a fixed, deliberately layer-heavy deck pair, scored on unexplained
field-level divergences. Both halves must pass; the scenario tests catch what we got wrong on
purpose, the parity run catches what we did not know to test.

**Thresholds (provisional).** Work on `mtg-bc2.16` is pre-authorized a budget of six weeks as the
primary kernel workstream, with review checkpoints at two, four, and six weeks. The scheduled
milestones are 33%, 66%, and 100% of the conformance suite passing, with the divergence count
trending monotonically to zero. **Missing two consecutive checkpoint milestones fires the
fallback.** A single missed checkpoint does not; subsystem work is lumpy and the layer system in
particular tends to land in one large correct piece after a long stretch of nothing visibly
working.

**Owner.** `mtg-bc2.16`. The checkpoint reviews are the trigger, and skipping a checkpoint counts
as missing it.

**Fallback: the Forge-bridge fallback.** This is reuse-maximal's shape, adopted deliberately rather
than accepted as defeat. Forge becomes the simulation substrate behind a purpose-built Java bridge
speaking JSON over stdio against `forge-game`, which is the GUI-free module (`prior-art-engines.md`
§1.4, path 2; the same path Manabrew uses as its fallback). The bridge is a GPL module isolated
behind the process boundary, and every condition in §5 continues to apply.

What survives unchanged: the DSL, the Zod schemas, every structural validator, set generation, the
deck builder, the log schema, the metrics suite, and the balance CI. They survive because the
DSL already compiles to Forge card scripts, which is the whole reason `mtg-bc2.11` sits in phase 1
instead of phase 2. Pulling the transpiler forward is partly insurance, and this is the policy it
insures.

What changes, stated plainly because it is the real cost: the kernel is demoted to a slice-scoped
fast path or retired outright; correction tables must be re-baselined, because the metrics lane
freezes them per engine and bot version (`prior-art-playability-metrics.md` §8, step 6), so
anything measured against the kernel does not transfer; the LLM referee's kernel-side API,
which needs to serialize framed excerpts, enumerate legal options, and apply a structured ruling as
an event, cannot be retrofitted through a subprocess boundary onto Forge's internals and would have
to be rescoped or dropped; and stage-2 modifiability reverts to Java surgery in a GPL fork, meaning
the brief's deep-modification capability is deferred indefinitely rather than merely delayed.

That last item is the one to weigh. The Forge-bridge fallback keeps the lab running and keeps the
generator honest. It does not keep the capability that motivated building in the first place.

---

## 7. Consequences

**What this buys.** The enforceable space is ours, so the co-design invariant is enforceable by
construction rather than by discipline. Stage-2 rules modifiability becomes an API design task
(zone registry, turn-structure pipeline, resource ledger) instead of a fork-maintenance task.
Seeded determinism is native to an event-sourced reducer rather than something to be verified
through somebody else's CLI. The 17lands-superset log schema is trivial to emit when we own the
logger, which turns phase-3 calibration into a join instead of a parsing project
(`prior-art-playability-metrics.md` §2.4). Immutable state with cheap forking is the proven shape
if a search-based or learned bot tier ever arrives. And every enforced rule in the lab's own path
is ours or MIT, which keeps distribution possible.

**What this costs.** Rules-correctness debt, permanently. The thin slice will not have activated,
triggered, or static abilities beyond keywords, will not have replacement effects, and will have
only a minimal fixed-order power/toughness layer built against Argentum's dependency document so it
grows rather than gets rewritten. Real-card enforcement is far off; the lab cannot simulate
arbitrary real-card constructed decks in-house for a long time, and full conformance on even one
real set is a phase-3 milestone. Calibration against human data arrives later than it would have
under a wrap, and the early Forge-based calibration run is a methodology dry-run only, explicitly
not a reusable correction table, because correction tables are engine-and-bot-versioned. Time to
first green loop is longer, since kernel v0 has to exist before anything runs.

**What is mitigated and how.** Set iteration is never blocked on kernel completeness, because
Forge and Cockatrice exports give full-rules human playtesting from phase 1. The periphery
parallelizes because it is adopted rather than built: Draftmancer, the `spells` harness, the data
stack, statistical-drafting's pick-model shape, and the the prior project art pipeline all proceed
independently of the engine. The parity harness makes correctness debt findable rather than latent.
Seeded determinism makes it bisectable.

**What this constrains going forward.** New mechanics land as kernel code plus DSL facade in one
change; a DSL feature the kernel cannot execute is a bug, not a roadmap item. Generation is gated
to mechanics the DSL already expresses, with the set-design lane's classifier
(existing-primitive, parameterized-extension, rules-surgery) deciding which class a proposal falls
into. Legality checking stays structural over the DSL and never reasons about oracle text.

---

## 8. Open questions

These were deferred on purpose. They are recorded here so that a reader in six months knows they
were seen rather than missed.

1. **Kernel velocity at the cliff.** The thin slice cannot de-risk layers and replacement effects,
   because it excludes them by construction. Kill-test B in §6.2 is the answer to "what if it
   stalls", but the probability itself is unknowable until the XMage and Argentum design porting
   actually starts.

2. **Forge seeded determinism.** Manabrew proves deterministically driven Forge games are possible.
   Whether the stock `sim` CLI, as opposed to a purpose-built bridge, can be seeded reproducibly is
   unverified. Forge spike A (`mtg-bc2.10`) should probe it. The parity harness depends on the
   answer, and so does the fallback in §6.2.

3. **Whether the §6.1 thresholds are the right thresholds.** The 5-minute and 20-minute bands
   assume 10<sup>4</sup> games per set revision is the real workload, which comes from the metrics
   lane's sizing rather than from our own experience. If adaptive game allocation cuts the required
   volume, or if per-revision sweeps turn out to run more often than assumed, the bands move. A
   companion question with no measurement yet: what Forge games-per-hour number would have changed
   this decision, which spike A can answer retrospectively.

4. **Calibration transfer, twice over.** First, the metrics lane's own load-bearing assumption is
   that corrections measured on real sets transfer to novel mechanics, and it may not hold
   (`prior-art-playability-metrics.md` §10.1). Second, and specific to this decision: which real
   set becomes the phase-3 DSL conformance milestone, and how much of the early Forge-based
   methodology dry-run carries over at all.

5. **LLM referee economics and validity.** Per-ruling cost, the acceptable call volume before a
   mechanic must be compiled down rather than refereed, and whether refereed games can ever count
   toward advisory metrics. The current answer to the last one is no, excluded from balance CI
   entirely, and it should stay no until there is a reason to change it.

6. **Draftmancer rating scale.** What rating mapping makes SimpleBot draft custom sets sanely
   (`prior-art-tooling.md` §8.1), plus the self-hosted external-bot registration spike (§8.2).

7. **Design-canon tuning.** Whether the New World Order 20% red-flag budget is a
   default-with-override or should be empirically fitted from complexity-versus-win-rate curves,
   and what the skeleton conformance tolerance bands should be, given that real WotC sets deviate
   from their own skeletons. Both need the roughly ten-real-set empirical pass
   (`prior-art-set-design.md` §14).

8. **MTG-Causal-RL.** Is the environment code actually released, under what license, and is it fast
   enough to serve as a stronger bot tier (`prior-art-playability-metrics.md` §11.1)?

9. **Ground truth for deep-play review.** 17lands replay data is per-turn aggregates rather than
   per-action, so there is no obvious source of truth for judging LLM deep-play review quality
   (`prior-art-playability-metrics.md` §11.4).

---

## 9. Amendment, 2026-08-14: Forge as a play backend (`mtg-bc2.151`)

This section amends §2.2, §5 and §7. It does not replace §2, and the original text above is left
as it was written so the record of what was decided in August remains readable. Where this
section and §2.2 disagree, this section is later and wins; where they do not disagree, §2.2
still says what the project does.

### 9.1 The requirement that changed

The lab is now asked to play content it did not generate: imported historical sets and legacy
cubes. `packages/cube` already runs into the wall from the other side — it builds and measures a
cube cut from the real card store and then says, in `packages/cube/src/availability.ts`, that it
cannot draft it, because `runDraft` drafts DSL cards and a real printing's rules text is not one.
The same sentence is true one layer over: the kernel runs DSL cards, and a legacy cube is
thousands of printed cards spanning decades of layers, replacement effects, alternate costs,
copying, planeswalkers and bespoke one-card mechanics. Nothing in §6 fires on that. It is not the
kernel failing a threshold; it is a new requirement that the kernel was never scoped to meet and
should not be rescoped to meet, because meeting it means implementing all of printed Magic, which
§3 records as the thing no engine has ever done.

> **Superseded in part by §10.1.** The final clause is false: three projects have achieved
> near-complete coverage, one of them past 99%. The refusal survives on different grounds, measured
> in §10.4 and §10.5. Everything before that clause stands.

### 9.2 What is decided

**Forge gains a fourth use: the play backend of record for a single match of content the DSL
cannot express.** §2.2's list was oracle, transpile target, and human play surface, closed with
"and nothing else". That closure is amended. Everything else in §2.2 stands, including the two
sentences that matter most: Forge is not the simulation substrate, and it is not anything we link
against.

Four conditions bound it, and they are the decision rather than commentary on it.

1. **One backend owns an entire match.** Backend selection happens once, per format or per match,
   before the first card is drawn. There is no per-card dispatch, no mid-game handoff, and no
   invisible fallback from one engine to the other. A fallback would mean two rules
   implementations disagreeing inside one game, which is worse than either of them being wrong
   alone.
2. **Selection is capability-driven and stated.** A format declares what it needs; a backend
   declares what it supplies; the mismatch is named. A mixed custom-and-legacy format is eligible
   for Forge only when every custom construct transpiles, all or nothing, and is otherwise
   rejected with the unsupported constructs named. `@mtg/forge-export` already owns that
   judgment for cards and already refuses by name (`rejection.ts`).
3. **Generated sets keep the kernel, and balance CI is untouched.** The default for DSL content
   is the kernel, and the seeded 10,035-game format-health gate keeps running exactly as it does
   today, on the kernel, through `@mtg/sim`. Nothing in this amendment gives Forge a path into
   `npm run test:balance`.
4. **Every condition in §5 continues to apply**, and §9.4 tightens two of them.

### 9.3 The load-bearing invariant is untouched, and a careless reading says otherwise

The invariant is that **the set generator's output space stays inside the engine's enforceable
space**. It is a statement about *generated* cards. A legacy cube is not generated content: no
model wrote those cards, the generator cannot emit them, and no validator in this repository is
being relaxed. `ModelAbilityIsAbility` and `ModelEffectSchema` still prove containment at compile
time, against the kernel, exactly as before.

The misreading to head off is this one: "we can now play cards the DSL cannot express, therefore
the generator may emit cards the DSL cannot express." That inference is false and its falsity is
the whole shape of this amendment. What dual-engine adds is a **second enforceable space, for
content the generator never emits into**. The containment relation is unchanged because both of
its terms are unchanged. A DSL card that only Forge could run would be a bug in the generator
under §7's rule, before this amendment and after it.

One consequence follows, and it is the direction that would actually be dangerous: **Forge's
enforceable space must never become the generator's ceiling.** The moment a generated card is
authored against what Forge can script rather than against what the kernel can execute, the
reuse-maximal architecture rejected in §4.1 has arrived by the back door, and §3's finding about
Forge's custom-mechanic ceiling being real and being Java applies again in full.

### 9.4 GPL containment gets more load-bearing, not less

While Forge was a test oracle, the process boundary was a developer-tooling detail. As a play
path it is a property of what the lab does, so the boundary is now the thing keeping the lab's
core distributable. The obligations in §5 are unchanged in text and heavier in consequence.

**What a play-time subprocess boundary costs that a test-time one did not:**

- **Lifetime.** A test-time boundary is one process per gate run, started and reaped by the test
  that started it. A play-time boundary is a long-lived process held for the length of a human
  match, so it needs an owner, a defined behavior when it dies mid-game, and a close path that
  runs when somebody shuts a browser tab. A leaked JVM per abandoned game is the default outcome
  of not designing this.
- **Latency and asynchrony, per decision rather than per run.** Every human decision crosses the
  boundary and comes back. That is what forces the neutral session contract in §9.5 to be
  promise-returning, which the kernel's own session is not, and it puts a timeout at a trust
  boundary on the path of an ordinary click. The timeout must propagate a real error; a default
  return would be the engine inventing a move.
- **A failure class the kernel does not have.** An in-process reducer cannot desync from itself
  or die halfway through a game. A subprocess can, so the contract carries a `backend-failure`
  arm that exists for no other reason.
- **Pressure toward the exact thing §5.1 forbids.** Every one of the shortcuts that would make
  play convenient is a linking event: bundling a jar into a distributable, Manabrew's GraalVM
  native-image recipe, JNI, an in-process embed to shave the per-decision round trip. §5.1 names
  the GraalVM recipe as out of bounds; the reason to re-read that sentence now is that this
  amendment is what makes somebody want it.

**The guard named in §5.4 did not exist.** §5.4 asserts that "a check in the standard test gate
scans tracked files for vendored-engine path fragments … and for GPL and AGPL license headers
anywhere in our own tree", and that it "is not optional". No such test was in the tree when this
amendment was written; the only mechanical part in place was the `.gitignore` entries for
`tools/forge/dist/`. It exists now, at `packages/slice/test/engine-boundary.test.ts`, and the
condition it enforces is the one §5.4 already stated. A condition of a decision that nothing
checks is a sentence, and this decision is about to lean on it much harder than it has so far.

### 9.5 The seam this is bought with

The play surface talks to a **typed backend-neutral session contract** (`@mtg/engine`), not to a
kernel and not to a Forge bridge. Legal decisions in, projected public state and authoritative
events out, errors and backend capabilities declared as data. The contract's own file docblocks
carry its argument; two of its properties belong here because they are consequences of this
decision rather than of the typing:

- **Determinism is a discriminant, not a flag.** Our kernel is event-sourced and seed plus choice
  list is the entire record; `replaySession` reproduces a game and `stateFingerprint` checks it.
  A foreign engine offers no such guarantee. So the contract does not offer a `replay()` that a
  foreign backend implements by throwing. It splits into a recorded arm and an observed arm, and
  a surface that wants a reproduction has to narrow to the recorded arm to reach one. A surface
  cannot silently assume a guarantee it does not have, because the member it would call is not
  on the type it is holding.
- **The neutral channel is the enumeration.** A surface picks a move out of the list the backend
  offers. Constructing a move and asking whether it is legal — `chooseAction`, the door the
  MTGO-style board uses for a click-built block — requires knowing the engine's action algebra
  and stays kernel-specific.

### 9.6 What is reversible and what is not

**Reversible cheaply.** The Forge backend implementation, which is one package behind an
interface. The choice of which foreign engine sits there. The neutral projection's shape, which
is versioned for exactly this reason. Which formats route where, which is a per-format
declaration and not a code path.

**Reversible at a price.** The contract being asynchronous. Once the play surface awaits every
decision, going back to a synchronous session is a rewrite of that surface rather than a deletion
of a package, and the kernel pays the async cost forever for a backend it does not need it for.
This is charged deliberately and is the largest cost in the amendment.

**Not reversible.** A vendoring or linking event: §5's whole argument is that GPL obligations
trigger on distribution and one careless act removes the option permanently, and no later cleanup
restores it. Nearly as hard to reverse: content that comes to depend on printed-card play. A cube
people actually draft is a commitment to a foreign engine remaining available, runnable and
license-compatible, and unlike a package that dependency lives in what the lab is for rather than
in how it is built.

### 9.7 What this is not

**It is not §6.2's fallback firing.** The kill-test B fallback demotes the kernel to a slice-scoped
fast path or retires it, moves the simulation substrate to Forge, and re-baselines every
correction table. Kill-test B was run and passed. This amendment demotes nothing: the kernel
remains the engine of record for generated content, the simulation substrate, the referee's host
and the thing balance CI measures. A future reader who finds Forge running a match and concludes
that the build-first bet was lost has read this backwards.

**It is not permission to skip the transpiler.** §2.2's export path and the boot gate stay what
they are. A generated set still has to boot in headless Forge, and that gate is a statement about
our cards being well-formed, not about which engine plays them.

---

## 10. Amendment, 2026-08-15: the coverage question, measured (`mtg-bc2.152`)

This section amends §9.1 and §3. It does not amend §9.2, whose decision stands on its own grounds.

§9.1 refused full printed-card coverage on the grounds that it means "implementing all of printed
Magic, which §3 records as the thing no engine has ever done." That claim is false, and this
section replaces it. But the corrected claim does not open the door §9.1 closed. It relocates the
barrier from **authoring** to **verification**, and the measured evidence on verification is worse
than the precedent argument ever was.

Two bodies of measurement drive this section. One is ours, over the ingested card store. One is the
published record on machine-generated formal artifacts. They point in opposite directions, and the
second dominates.

### 10.1 The claim being withdrawn, and why its correction is not good news

Near-complete coverage has been achieved by hand, three times.

| project | coverage | contributors | span |
| --- | --- | --- | --- |
| XMage | 32,127 card classes; claims full enforcement of 31,000+ unique cards | 609 distinct commit authors | since 2012-04-27 |
| Forge | 33,664 card scripts | 369 | since ~2009 |
| **Project Ignis** (Yu-Gi-Oh) | **99.19%** | 53 | ~14.7 years |

Project Ignis is the decisive case. Of 13,593 Yu-Gi-Oh cards genuinely requiring a script, 110 are
unscripted; 101 of those are unreleased, and all 9 released ones are video-game exclusives. There is
no backlog of real printed cards. Steady state is 600 to 700 new scripts a year: a permanent staffed
pipeline rather than a burst.

And Yu-Gi-Oh is the harder game by the same kind of theory §3 cites against Magic. Deciding whether
a computable strategy is winning there is Π¹₁-complete (arXiv:2603.02863), which sits strictly above
the Halting-Problem hardness §3 attributes to Magic. **The game with the harder decision problem is
the one at 99.19% coverage.** Undecidability of optimal play places no bound on per-card
implementability, and §3's complexity paragraph should not be read as though it did.

So §9.1's premise is withdrawn. The labor constraint was real, was surmountable, and was surmounted
by staffing. It follows that "modern tooling removes the labor constraint" is not the argument it
appears to be: the constraint was already removable, and removing it is not what makes an engine
correct.

### 10.2 What we measured, and what it turns out to measure

Over `data/store/mtg.sqlite` (38,623 oracle cards, ingested 2026-08-09), corpus **T** = 31,695
paper-legal non-funny cards. Oracle text was reduced to clauses, and clauses to three candidate
units of extension, with Heaps' law (V = K·n^β) fitted to each:

| unit of extension | V | β | verdict |
| --- | --- | --- | --- |
| verbatim clause | 29,892 | — | hopeless |
| template (one artifact per card) | 16,390 | 0.752 | does not converge |
| **atom + open data slots** | **1,120** | **0.217** | converges strongly |

Coverage of paper-legal Magic by primitive count: 143 → 50%, 304 → 80%, 437 → 90%, 555 → 95%,
816 → 99%, 1,120 → 100%. The curve goes near-vertical between 95% and 99%. Of the 313 cards in the
last 1%, 64.9% are blocked only by database rows (name words, counter kinds, keyword cost variants);
genuinely new mechanics account for 110 cards, 0.351%. Corpus T contains exactly zero ante cards,
zero subgames, zero sideboard-access cards and zero host/augment.

The finding worth keeping is not the number but the choice of unit: **the one-artifact-per-card unit
that every engine in §3 chose is the unit that does not converge**, and the composable unit does.

**This measurement is sound and it answers a question that is not the binding one.** It bounds the
DSL's *vocabulary*. It says nothing about whether a given implementation means what its rules text
says, and §10.4 is why that is the constraint that actually binds.

### 10.3 The cost model in §9.1 is inverted

Primitive count is not the risk. Five structural subsystems are, and their cost is fixed rather than
proportional to the cards using them:

| subsystem | cards in T | share | status here |
| --- | --- | --- | --- |
| CR 613 layers | 1,440 | 4.54% | **built** — eleven sublayers, 613.8 dependency, timestamps |
| replacement effects | 2,398 | 7.57% | **built** — real 616.1 loop, self-replacement, shields |
| mid-resolution player choice | 6,462 | 20.39% | seam exists at the decision level, not threaded into resolution |
| cost modification | 1,350 | 4.26% | absent |
| copy effects | 713 | 2.25% | layer-1 record type exists, no constructor |

The two most expensive are already in `@mtg/kernel`, were built when kill-test B was run, and have
**zero production constructors**. They are reachable only from
`packages/kernel/test/continuous-helpers.ts`. The project paid for the hardest part of coverage and
has not yet spent it. That is why incremental DSL growth is cheap here, and it is the asset
`mtg-bc2.152.7` exists to collect.

### 10.4 The barrier is a semantic oracle, and it is measured

The question mass generation has to answer is not "can a model write 34,000 cards." It is **what
tells you card 19,847 is wrong, before a player does.** The published record on machine-generated
formal artifacts answers that consistently, across domains none of which is Magic:

- **A typecheck carries no information about faithfulness.** Cohen's κ = 0.000 against expert
  judgment, measured on two benchmarks (GTED, arXiv:2507.07399v2). Behavioral equivalence
  correlates with human judgment at Pearson 0.974 over the same data; typechecking at 0.655.
- **The compile-versus-faithful gap is 20 to 60 points** across at least nine independent studies,
  and does not close with scale. Lean Workbook's full funnel: 62.5% compile, of which 27.9% survive
  back-translation faithfulness, 17.4% end to end.
- **The residual errors are directionally biased.** Dropped conjuncts, added weakening hypotheses,
  parameter restriction and sycophantic repair all make the artifact *easier to satisfy* than its
  source. Generate-and-filter selects **for** them, because a weakened artifact compiles better.
- **Four independent groups, two domains, three instruments all plateau at 50–61%**, including
  13,080 executed test cases against 95 production Dutch government decision models
  (51.3–53.1%, arXiv:2604.17153).
- **Structural similarity and behavioral equivalence are near-orthogonal**: 36% of generated models
  with high structural similarity had under 50% outcome agreement. Evaluating generated cards by
  diffing them against a reference implementation measures the wrong thing.

Translated into this codebase: a generated card that drops a restriction clause, widens a targeting
condition or omits a once-each-turn rider will pass `ModelAbilityIsAbility`, pass `ModelEffectSchema`,
pass a single-card smoke test, and be wrong in precisely the direction that makes it easier to run.
**Those proofs are compile gates.** §7's claim that they keep generated cards runnable is correct and
unchanged. They were never evidence about meaning, and this section records that explicitly so a
future reader does not mistake them for it.

### 10.5 Composition fails, and this is no longer an open question

**DafnyCOMP** (arXiv:2509.23061) chains 2 to 5 individually-verifiable functions: 95.67% syntactic
correctness against 3.69% verified. A 3.2× increase in component count produced a 14.4× decrease in
verification success — in a domain with a sound verifier, which Magic does not have.

Magic's own numbers agree. Across three samples of triaged card bugs, the multi-card interaction
share is stable at 20.8%, 11.1% and 20.0%: roughly one card bug in five. XMage's test directory
named `single` averages 4.03 distinct cards per file, and 58.6% of its files reference three or
more, because a single-card assertion frequently cannot be written. Its entire CR 613 layers suite
is seven test methods, with names like `testMycosynthLatticeAndMarchOfTheMachinesAndHumility` and
`testExampleFromReddit2021`; the Mycosynth test carries the comment "Reported bug: This came up in a
recent EDH game and we had no idea how to progress." **Interaction tests in the mature engines are
harvested after the fact. Nothing derives them.**

Two facts about the incumbents' economics belong in the record. XMage *has* a
rules-text-versus-implementation oracle — `VerifyCardDataTest.java`, 3,735 lines, 26 tests over all
32,127 cards — and its deep oracle-text comparison is gated behind a property CI never sets. Forge's
`Oracle:` line is display data compared to nothing, and Forge's own FAQ says "We simply cannot devote
the resources to test every single card, much less the nearly infinite ways the cards can interact."
Two mature projects independently concluded a continuous semantic oracle was not worth running.
Whatever we build has to be cheaper or more discriminating than the thing both of them switched off.

### 10.6 What is decided

1. **§9.1's precedent argument is withdrawn as factually wrong.** Three projects achieved
   near-complete coverage, one of them past 99% on a game with a harder decision problem. Any future
   refusal rests on §10.4 and §10.5, not on precedent, and §9.1's closing clause should be read as
   superseded.

2. **Mass generation of printed-card implementations stays refused, on the semantic-oracle
   evidence.** Not on labor, not on precedent, not on vocabulary size. The refusal is reviewable
   because it turns on a measurement, and §10.7 names what would overturn it.

3. **The unit of extension is fixed regardless, and justifies itself.** Adding one effect primitive
   today costs 9 to 14 files across seven switches and seven `Record` tables in six packages. Adding
   a **counter kind** costs 2 touch points, because counters are data read by the layer system rather
   than cases dispatched on. Inverting effects, keywords and subtypes the same way is authorized as
   its own work (`mtg-bc2.152.1`) and depends on no coverage decision.

4. **Incremental DSL growth continues unchanged** under §7's rule that kernel and facade land
   together. §10.2's curve is a map of where the next primitives buy the most, and §10.3 says the
   expensive subsystems are already bought.

5. **§9.2's dual-backend decision stands, and §10.5 strengthens it.** If per-card correctness does
   not compose, then routing genuinely-printed content to an engine that has already absorbed fifteen
   years of interaction bug reports is worth more than it looked in August, not less.

6. **§9.3's invariant is untouched**, and the sibling misreading is headed off here: "the DSL's
   vocabulary converges, therefore setgen may emit anything" is false for exactly the reason §9.3
   gives. The generator's ceiling is separate and deliberately lower, and every asymmetry §9.3
   protects stays.

### 10.7 What would reopen this

The refusal in §10.6.2 is conditional on a missing artifact, and the evidence names it precisely.
The only intervention measured to move the semantic stratum is **a semantic critic — a second model
judging implementation against rules text, not a checker**: CriticLean, 54.0% → 84.0%
(arXiv:2507.06181). Compiler and elaborator feedback move the *syntactic* stratum by +34 to +36
points and the semantic stratum by approximately zero, while enlarging the compile-pass-but-wrong
population. Resampling cannot cross an imperfect verifier's false-positive rate at any compute budget
(arXiv:2411.17501v3), and test-based repair loops measurably increase overfitting. More sampling and
more type-checking are known not to be the answer.

That is a ZFC-shaped conclusion and it is the one with evidence behind it: semantic judgment goes to
a model, and the code owns the harness. Concretely, reopening requires (a) a semantic critic with a
published κ against human adjudication on a held-out sample (`mtg-bc2.152.9`), (b) a behavioral
comparison substrate — Forge's `.pzl` format plus `GameState.java` is the only board-state
serialization for Magic that exists, and using it means adopting Forge's object model as the de-facto
specification, which should be a conscious trade under §5 rather than a side effect — and (c)
permanent regression fixtures derived from real observed divergences (`mtg-bc2.152.8`), on the
pkmn/engine model of 109 such fixtures rather than XMage's seven harvested ones.

**Three corrections to §3.** First, and most useful: §3 records that legality-checking is "coNP-hard
in general" but not the positive half of the same result. Chatterjee and Ibsen-Jensen prove it
coNP-complete in general **and in P if either of two small sets of cards is excluded**. Combinatorial
hardness in Magic is concentrated in a handful of printed cards rather than spread across the pool,
which turns §3's "stay inside the tractable envelope" from a posture into a named exclusion list.
Second, Biderman (arXiv:2003.05119) is an unpublished preprint that presents key results as
conjecture rather than theorem; §3 cites it at equal strength with the peer-reviewed FUN 2021
Churchill result beside it, and should not. Third, Arena's 80% figure is achieved by a hand-written
deterministic parser — Wizards' Ben Finkel: "Machine learning is not used in our parser." §3 and
`docs/research/prior-art-engines.md:164` both describe it accurately as a Python parser, and the
qualification is worth adding anyway, because the figure is evidence for cards-as-data and is
routinely misread as evidence that models solve the text-to-rules problem.

### 10.8 What this is not

**It is not a finding that coverage is impossible.** Three projects did it, with staff, fifteen years
and a permanent maintenance pipeline. It is a finding that the cheap version does not exist yet, and
that the expensive version is a different project than this one.

**It is not a claim that vocabulary convergence is implementation convergence**, and §10.2 says so
against itself. Blood Moon contributes zero new atoms after object absorption while being among the
hardest cards in Magic to implement, because its difficulty is CR 613 interaction; Humility
contributes one. A future reader quoting the 1,120 figure as a cost estimate has read §10.2 without
§10.4 and §10.5.

---

## 11. Amendment, 2026-08-15: the Forge-bridge parity harness, authorized narrowly (`mtg-bc2.41`)

This section amends neither §9.2 nor §10.6.2. It clarifies §6.2: that building the Forge-bridge
artifact described there is separable from the fallback that names it, and authorizes building it
now, for a different reason than the one §6.2 conditioned it on.

### 11.1 What this decides

A purpose-built Java bridge to `forge-game`, speaking JSON over stdio, may be built now as a parity
oracle for CR 613 layer interactions (`mtg-bc2.41`), without that act constituting the Forge-bridge
fallback firing. Kill-test B (§6.2) passed; its fallback did not trigger and stays unfired. This
section authorizes the same artifact for a narrower purpose than the one the fallback bundled it
with.

### 11.2 Why building the artifact does not import the fallback's consequences

§6.2 pre-committed a trigger (two missed checkpoints on the layers conformance suite) and, bundled
under one "Fallback" heading, both an artifact (the bridge) and a set of consequences (kernel
demoted or retired, correction tables re-baselined, the LLM referee's kernel-side API rescoped or
dropped). The consequences were conditioned on the trigger, not on the artifact's existence — §6.2
never says the bridge is unsafe to build, only that building it was the shape the fallback would
take if the checkpoints were missed. The checkpoints were not missed. Nothing in §6.2 forbids
building the same artifact for a reason unrelated to the trigger, and §9 already establishes the
precedent for splitting artifact from role: Forge is a play backend under §9 while remaining
categorically not the engine of record under §2.2, because §9.2 draws that line on grounds that have
nothing to do with kill-test B. This section draws the equivalent line for the bridge: a parity
oracle under this section, while remaining categorically not evidence that the fallback fired.

Unstated, the bridge's existence would later be misread as evidence the fallback fired. This section
exists so that reading is wrong on its face.

### 11.3 §5.1 already sanctions this shape; nothing new is being decided about licensing

§5.1 forbids linking GPL code into our process and names what that rules out: Manabrew's GraalVM
recipe, which compiles a Forge harness into a native shared library exposing a C ABI. A separate
Java program that links `forge-game` and speaks JSON over stdio across a process boundary is the
same shape §5.1 already permits for Forge generally and §6.2 already named specifically for this
bridge. §5's other conditions apply unchanged: subprocess only, no vendoring, tracked at one
declared path rather than gitignored into unreviewability (condition 4 requires the CI license-grep
to see it, which requires it not be excluded from source control the way `tools/forge/` itself is).

### 11.4 Scope: built to the corpus, not to a general API

The bridge is scoped to construct a corpus of layer-interaction cases programmatically in Java (base
set vs. modify vs. counters vs. switch, timestamp ordering, 613.8 dependency reordering including
loops, CDA sublayer, layer-1 copy, layer-2 control), run each against `forge-game`, and serialize
per-object characteristics as JSON — roughly a dozen constructors and one serializer, not a general
board-state loader. A general API is a large open-ended surface and is explicitly not authorized by
this section; `mtg-bc2.41`'s own acceptance criteria bound the corpus, and widening it past that
corpus is a new decision, not an extension of this one.

Whether the bridge needs a display is not decided here. §6.1's kill-test A and the shipped `-q` CLI
both run against `forge-gui`, which needs Xvfb the way `ci.yml` already provisions it; `forge-game`
is the GUI-free module, and whether it needs a display at all is unverified. `mtg-bc2.41` verifies
this before building the provisioning in, rather than carrying the `forge-gui` requirement forward
by assumption.

### 11.5 This is the trade §10.7(b) asked for, made consciously rather than as a side effect

§10.7 names three things required to reopen §10.6.2's refusal of mass-generated coverage: (a) a
semantic critic with a published κ (`mtg-bc2.152.9`), (b) a behavioral-comparison substrate — noting
that Forge's `.pzl` format plus `GameState.java` is the only board-state serialization for Magic
that exists, and that using it means adopting Forge's object model as the de facto specification,
"which should be a conscious trade under §5 rather than a side effect" — and (c) permanent
regression fixtures derived from real observed divergences (`mtg-bc2.152.8`), on the pkmn/engine
model rather than XMage's seven harvested ones.

This section is that conscious trade for (b), made explicit rather than incurred by accident while
building a test fixture. The corpus this bridge emits is also the fixture source (c) needs: a
divergence the harness catches is exactly the kind of real observed divergence the pkmn/engine model
banks permanently, rather than one more self-consistency check against our own kernel.

### 11.6 What this does not decide

**Not a reopening of §10.6.2.** The refusal of mass-generated printed-card coverage stands.
Building this bridge satisfies none of §10.7's three conditions by itself; (a) and the adjudication
`mtg-bc2.152.9` needs are unchanged by this section, and (c)'s fixture bank does not exist until the
bridge has actually run against divergent cases and banked them.

**Not a decision that Forge's object model is authoritative beyond parity testing.** §9.2's
dual-backend line stands: Forge is an oracle, an export target, and a play surface, never the engine
of record for kernel-authored content.

**Not pre-approval of the CI license-grep's literal diff.** §5's condition 4 already requires the
guard to see a tracked bridge path; the specific exclusion pattern is `mtg-bc2.41` implementation
work, not an ADR decision.

**Not a decision about `mtg-bc2.152.8`'s methodology** beyond confirming it should use this
substrate rather than invent a second one, per `mtg-bc2.41`'s own description. What counts as a
scenario, how many, and how divergence is scored remain that bead's scope.

**It is not permission for the generator to widen.** See §10.6.6.

---

## 12. Amendment, 2026-08-16: the second runtime is committed scope (`mtg-bc2.151`)

This section amends §11.4 and §9.2. It leaves §2.2's kernel primacy, §5's licensing conditions and
§10.6.2's refusal exactly as they are, and §12.6 says so clause by clause because this is the
amendment most likely to be misread as a reversal.

### 12.1 What this decides

**Building the second rules runtime is committed work, not an authorized option, and its purpose is
playing previous formats and sets rather than only tolerating imported content.** §9 decided that a
second backend may exist and bounded it with four conditions. It did not commit to building one, and
one has not been built: `@mtg/engine` is the contract and its argument, `scriptBackend` is a toy on
the observed arm shipped so `checkBackend` has a subject that is not our kernel, and no second real
backend exists in this repository today.

**The general Forge API that §11.4 explicitly withheld is now authorized.** §11.4 scoped the bridge
to a layer-interaction corpus, said a general board-state loader "is explicitly not authorized by
this section", and named the widening as "a new decision, not an extension of this one". This is
that decision. Running a match of a real format is exactly the general case §11.4 declined to
authorize for a parity corpus, and it cannot be reached by adding constructors to the corpus bridge.

### 12.2 Why now, and why this is not a preference

§10 measured how much of real Magic the DSL can express: **1.2% of a real cube list** (95% Wilson
[0.5%, 2.5%], n=516) and **4.3% of a random oracle sample** ([2.5%, 7.3%], n=300). The failure
taxonomy is the load-bearing half. The median untranslatable cube card names three independent gaps
at once, and only 37 of 509 misses have a single blocker, so no ordering of the vocabulary backlog
turns translation into a route to playing a cube. There is no schedule of DSL work that arrives at
"the lab plays Innistrad".

That is the whole argument. A second runtime is not a throughput optimization or a hedge against
kernel risk; it is the only route to a stated product goal, and the measurement that establishes
this was taken after §9 was written. §9 could still be read as an accommodation the project might
never cash. §10 removes that reading.

### 12.3 What it changes about §11.4, and the new bound

§11.4 bounded the bridge to roughly a dozen case constructors and one characteristic serializer. The
match runtime needs a board-state loader, a decision channel, an event stream and a projection per
seat. That is a different artifact, and pretending it is the corpus bridge grown a little would put
an open-ended surface behind a bead whose acceptance criteria bound a corpus.

The replacement bound is **the session contract, not a feature list**. The bridge exposes what
`@mtg/engine` already declares: legal decisions in, projected public state and authoritative events
out, errors and capabilities as data. A Forge capability with no term in the contract is out of
scope until the contract gains the term, and gaining a term is a reviewable change to a package that
depends on nothing. This is a tighter bound than an enumerated feature list, because it is checked by
the type system rather than by a reader's memory of this paragraph.

§11's parity corpus keeps its own narrow scope and its own argument. Two bridges may share a process
model and a build; they do not share a justification.

### 12.4 The expensive consequence, stated rather than discovered later

`@mtg/engine` makes determinism a discriminant rather than a capability flag. Seed plus choice list
is the entire record of a kernel game; a foreign engine promises nothing of the kind. `RecordedBackend`
carries `reopen` and a `fingerprint`, `ObservedBackend` carries a transcript, and neither carries the
other, so a function that requires reproducibility says `RecordedBackend` in its signature and an
observed backend fails to typecheck rather than failing at run time.

A Forge-backed session is on the observed arm. The consequence is that **there will be formats this
lab can play and cannot balance-test**, and that is accepted here rather than treated as a gap to
close. The Replay tab survives, because it reads a frame log rather than re-simulating. Mass
simulation does not survive, and §9.2's third condition already put the 10,035-game gate on the
kernel permanently. A future reader who finds that an imported cube has no format-health verdict has
found this decision working as intended, not a missing feature.

### 12.5 What is now required that §9 did not require

Playing a previous format is more than a runtime. Three things become in-scope work that a
tolerate-imported-content reading did not need:

1. **Real card data reaching a playable deck.** The store is ingested (38,623 oracle cards, 38,623
   printings, 77,961 rulings in `data/store/mtg.sqlite`) and `@mtg/forge-export` already owns the
   judgment of what Forge accepts and refuses by name. What does not exist is the path from a
   selected list to a deck the runtime plays.
2. **Format and deck legality for formats we did not define.** Set legality, banned and restricted
   lists, and deck-construction rules per format are data the store partly carries and nothing in
   this repository reads.
3. **A play surface that talks to the contract rather than to the kernel.** §9.5 named this seam and
   `@mtg/engine` implements it. The surfaces that still reach past it to `@mtg/kernel` are the gap,
   and each one is a place a backend-specific assumption can hide.

### 12.6 What this does not decide

**Not a reversal of §2.2 or §9.2.** The kernel remains the engine of record for generated content,
the simulation substrate, the referee's host and the thing balance CI measures. Forge is not the
engine of record for kernel-authored content and does not become one by running a match of content
we did not author.

**Not §6.2's fallback firing.** Kill-test B was run and passed, its fallback is unfired, and §11.2
already argued at length why building a bridge is not evidence to the contrary. That argument covers
this bridge too.

**Not a licensing change.** §5 applies unchanged and §9.4's tightening still holds: GPL, subprocess
only, no linking, no vendoring, tracked at one declared path so the CI license-grep can see it.
§5.1's specific prohibition on the GraalVM shape is untouched; a larger JSON-over-stdio surface is
still JSON over stdio.

**Not a reopening of §10.6.2.** The refusal of mass-generated printed-card coverage stands, and this
amendment is the reason it can. The coverage problem is not being solved in our DSL at a different
scale; it is being declined in our DSL and bought from an engine that already has it. §10.7's three
conditions are unchanged and unmet.

**Not permission for the generator to widen.** See §9.3 and §10.6.6. Both terms of the containment
invariant are unchanged, and a second enforceable space for content the generator never emits into
does not touch the first.
