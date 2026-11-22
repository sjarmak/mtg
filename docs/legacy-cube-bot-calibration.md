# Legacy Cube bot calibration

The offline experiment compares draft policies, not LLM agents. The draft advisor
remains deterministic and local. No benchmark result changes its weights automatically.

## Running it

Preview a reproducible draft/deck plan without launching Forge:

```sh
npm run calibrate:legacy-cube -- --out out/cube-plan --seed cube-study-v1 --split tuning --policies power,current,flexible --plan-only
```

Run the same experiment with autonomous competence probes and actual bot games:

```sh
npm run calibrate:legacy-cube -- --out out/cube-games --seed cube-study-v1 --split tuning --policies power,current,flexible
```

The output directory must not already exist. `--forge-home` overrides the existing
Forge installation lookup; the actual run requires Java, `javac`, and `xvfb-run`.
`--pods`, `--opponents`, and `--games-per-order` increase the experiment. The
per-game `--timeout-ms` defaults to 120000; a timeout is an incomplete result,
never a loss. The CLI caps a campaign at 10000 games and does not spend on an API.

Each run writes `plan.json`, physical `.dck` files, fresh two-seed competence
artifacts, individual game logs, and `report.json`. There is deliberately no
option to import a JSON file claiming that the bot passed its probes. Probe seeds
42 and 43 are fixed in advance, not selected after observing success. Every
implemented probe variant runs on every campaign; additional required but unsupported
packages are reported as unproven. Every game has a fresh JVM and writable Forge
profile; the user's installed decks and settings are untouched.

Use a separate `--split holdout` run only after freezing any proposed changes.
Do not tune on the holdout artifacts. A one-pod smoke run checks the pipeline;
it does not provide enough evidence to adjust card or archetype strength.

## Architecture and experiment boundary

`@mtg/metrics` owns the experiment. It reuses the pinned 600-card printed catalog,
the physical cube draft engine, the advisor's observable transcript, and
`@mtg/limited`'s physical ownership and deck validation. It never translates this
cube into a reduced DSL set: that would test a different format.

Each independent pod seed is drafted with the same opponents under `power`,
`current`, `flexible`, `pivot`, or `pin:<archetype-id>` policies. `power` deliberately
means the application's existing curve-based printed-card heuristic, not a claim
of expert card strength. Unavailable current/pivot recommendations fall back to
the flexible recommendation; the trace records both the requested and used mode.
Only packs actually observed by the candidate seat enter the advisor.

The shared deck builder enumerates one- and two-color plans, preserves available
pieces of minimally functional authored packages, then fills to 23 spells and
17 lands. Physical ownership is checked before named Forge decks are emitted.
Package presence is not a claim of full deck completeness. Off-plan spells are
reported. This baseline still underrepresents deliberate splashes, special land
counts, off-color cheat targets, and sideboarding; changes to it require a new
builder version and another controlled comparison.

Opponents are frozen from the baseline pod and reused across every policy arm.
Game seeds do not contain the candidate policy. Each matchup is run in both seat
orders. Seating is controlled; this alone does not prove balanced play/draw, since
Forge can decide who starts. Tuning and holdout seeds have separate namespaces.
The artifact pins catalog contents, authored model, scoring source, builder, draft
bots, Node version, and the gameplay implementation fingerprint.

The gameplay fingerprint includes the installed Forge jar, relevant card/token/AI
resources, Java runtime/compiler, both companion sources, compiled classes, and
the immutable fixture snapshot. Forge-linked Java remains in the explicit
subprocess-companion boundary; no Forge implementation enters the browser or
TypeScript runtime. Fixture names are validated against this exact Cube and
nonbasic singleton ownership is checked in tests.

## Gameplay competence is a prerequisite

An installed Forge rules implementation and a successful scripted-human test do
not establish AI competence. A bot must independently choose its actions and
targets in a controlled starting position, and the probe must check the resulting
zones or other concrete game state. A card name appearing in a log proves neither
successful resolution nor useful execution.

Before enabling observation, each probe checks exact starting hands, libraries,
battlefields, graveyards, life, active player, phase, and untapped permanents.
Forge's asynchronous public state-loading wrapper is not used from the controlled
match callback: setup must finish before validation or any AI action. Probes
observe typed resolution, damage, token, tap, and zone events. Combo copies must
occur in the same turn; one ordinary copy on each of two turns is not a loop.

Every drafted deck requires a fundamentals probe. Narrow package cards add
requirements for reanimation, blink, cheat effects, artifact engines, spells
payoffs, sacrifice, ramp, graveyard value, tokens, Opposition, equipment, Natural
Order, creature toolboxes, Twin, Kiki, land recursion, or Upheaval. Untested
requirements remain explicit. A pass must refer to fresh probe artifacts for the
same exact bot implementation and configuration, with at least two distinct seeds.
Evidence is supplied by the installed-runner adapter, not imported unchecked from
user-authored success claims.

A failed or unproven interaction does **not** mean that the archetype is bad.
Its game results remain diagnostic and cannot calibrate draft advice. Probe
coverage establishes competence only in the tested situations, not all card uses,
responses, matchups, or interaction combinations.

## Reading results

Raw games retain incomplete outcomes and missing competence requirements. They
are not converted into losses. For a comparative estimate, all policy arms must
have a complete, competent result for the same matchup and seat; otherwise that
entire matched cohort is excluded. Incomplete and excluded counts can overlap.

Summary intervals concern independent pod-level match-point means (win 1, draw
0.5, loss 0), using a conservative 95% Hoeffding bound. They are not binomial
intervals over correlated games from one draft. One pod has no interval; zero
eligible games have no win rate. An interval from a few pods should be broad.
Neither these intervals nor raw bot win rates estimate human win probability.

Calibration should combine these diagnostic results with held-out human drafts
and expert comparisons. The bot suite is particularly useful for finding missing
enablers, fragile mana, unusable picks, and policies whose explanations promise a
package their final decks fail to assemble. It is not an independent oracle of
card quality or proof that every supported archetype is competitively balanced.

## Measured smoke run: 2026-09-10

`out/legacy-cube-bot-final-20260910` contains the reproducible `smoke-20260910`
tuning run: one pod, `power` and `flexible`, one frozen opponent, both seat orders.
It is a pipeline diagnostic, not a policy-strength estimate.

| Probe | Required autonomous result | Seeds 42 and 43 |
| --- | --- | --- |
| Fundamentals | Pay for Bolt and deal lethal damage to the opponent | Passed |
| Reanimation | Reanimate resolves and moves Griselbrand from own graveyard to battlefield | Passed |
| Blink | Restoration Angel blinks Wall of Omens, whose ETB draws a card | Passed |
| Natural Order | Sacrifice a green creature and put Craterhoof from library onto battlefield | Passed |
| Ramp | Cultivate puts one basic onto the battlefield and another into hand | Passed |
| Twin | Splinter Twin/Exarch makes multiple tokens with an engine untap in one turn | Passed |
| Kiki | Kiki/Pestermite repeats its copy/untap loop in one turn | Unproven |
| Sacrifice | Yawgmoth sacrifices Gravecrawler, gains a benefit, and recasts it using another Zombie | Unproven |
| Artifact payoff | Daretti sacrifices Mind Stone to destroy opposing Griselbrand | Passed |

The artifact probe proves artifact-fodder removal, **not** artifact search or
recursion. Likewise Cultivate is not proof of every ramp line, and Bolt is not
proof of all combat/targeting decisions. More variants are needed before treating
these family-level checks as broad competence. Kiki made ordinary copies across
turns but did not establish the loop; Yawgmoth was cast without demonstrating the
recursion. Those failures of demonstration must not lower card ratings.

The four smoke matches completed, but all matched results were excluded because
the decks required unproven packages. Raw wins/losses remain visible; eligible
win rates are correctly `null`. No recommendation weights were changed.

## Strongest-play controller checkpoint: 2026-09-13

The installed-Forge controller now handles the two failures above through
general Forge ability and card metadata. A single-target `TapOrUntap` trigger
can select a tapped permanent marked `UntapMe`, while preserving Forge's normal
trigger preparation. A legal `PutCounter` activation with a sacrifice cost and
a downstream draw can use a positive `SacMe` permanent when Forge's ordinary
selection returns no action. The policy contains no card or probe identities and
is created through the same factory for ordinary matches and probes.

Kiki/Pestermite and Yawgmoth/Gravecrawler now pass at seeds 42 and 43. At that
checkpoint, the same run passed all ten installed probes at both seeds, with
`scriptedChoices=false`. This establishes only those initialized interactions;
untested packages remain ineligible for calibration.

The next installed probe covers two distinct cheat engines. Forge's ordinary
`ChangeZoneAi` declined Show and Tell when the opponent's hand was empty because
it treated that player's lack of a valid permanent as a reason not to cast the
optional symmetric spell. The shared controller now falls back only when the
spell is a single-card hand-to-battlefield effect for each player, Forge's own
`NeedsToPlayVar` approves the bot's hand, the spell is legal and payable, and
every opponent has a publicly visible hand size of zero. It does not inspect an
opponent's hidden card identities. Show and Tell/Emrakul and Sneak
Attack/Griselbrand both pass at seeds 42 and 43.

Bot protocol v2 names the fixture variant in both the request and report. The
calibration adapter runs every variant at every fixed seed; it cannot manufacture
a family pass by assigning one seed to each of two different fixtures. The
current installed regression is 56 fresh JVM runs: twenty-eight fixture variants at
two seeds, all passing with autonomous event evidence. Two spells-payoff variants
also pass without a policy exception: the bot casts Ponder with Young Pyromancer
or Monastery Mentor already on the battlefield and creates the corresponding
token. Coverage names both payoff cards and Ponder; it does not certify other
spells payoffs by analogy. Graveyard value is now covered by two different rules
paths: Uro is cast from the graveyard for its escape cost and remains on the
battlefield, while Bloodghast returns only after the bot plays a land from hand.
The coverage is limited to those exact cards and resources. Go-wide evidence now
also covers Lingering Souls under Honor of the Pure and Spectral Procession under
Spear of Heliod: Forge casts each spell and produces the expected group of 2/2
Spirit tokens. Two tap-control variants exercise a different causal chain:
Opposition with Bitterblossom and Glare of Subdual with Ophiomancer each create
or retain a token, use a creature tap cost, target the opposing Griselbrand, and
resolve with that exact target tapped. The shared controller's fallback applies
only after Forge's ordinary chooser returns no action and recognizes legal,
payable targeted tap abilities with a reusable creature-tap cost; it contains no
card or probe identity. Equipment now has two distinct paths: Grafted Wargear is
cast and attached to Llanowar Elves, which ends as a 4/3, and Sword of Fire and
Ice is cast and attached to Wall of Omens, which ends as a 2/6. Forge's ordinary
chooser cast both Equipment but left them unattached. The shared fallback offers
an otherwise legal, payable Equip activation only when its Equipment is currently
unattached, and targets the controller's best legal creature; it contains no card
or probe identity. Both variants pass at seeds 42 and 43 with cast, resolution,
attachment-event, exact-target, and final-stat evidence. Creature-toolbox evidence
now covers the two payoff cards present in the active calibration decks. Primal
Command casts and moves the only creature target from library to hand. Birthing
Pod casts, then autonomously activates its metadata-declared `SacAndUpgrade`
ability: the exact Llanowar Elves is sacrificed, Wall of Blossoms moves from
library to battlefield, and the Pod remains tapped. Forge's ordinary chooser cast
the Pod but never activated it. The shared fallback considers only legal, payable
activated `ChangeZone` abilities whose Forge metadata says `SacAndUpgrade`, whose
destination is the battlefield, and whose cost includes a sacrifice; it contains
no card or probe identity. Both routes pass at seeds 42 and 43. Land recursion now
covers two distinct Crucible of Worlds lines. One replays Wasteland, sacrifices it,
and destroys an opposing Gaea's Cradle that is producing three mana. The other
replays Flooded Strand, sacrifices it, and puts the exact Island from the library
onto the battlefield. Forge handled the fetchland line without intervention but
declined the profitable Wasteland activation. The shared fallback considers only
legal, payable, single-target `Destroy` activations on lands that sacrifice their
own source, delegates target choice and value to Forge's land-removal evaluator,
and acts only when that evaluator assigns at least its high-priority score of 150.
It contains no card or probe identity. Both routes pass at seeds 42 and 43.
Upheaval mana now covers two rebuild lines. In each one, the bot casts a global
permanent reset, floats mana from three reusable mana rocks before it resolves,
then replays the designated rock during the same main phase. One fixture rebuilds
with Grim Monolith and the other with Worn Powerstone. Forge's ordinary chooser
did not select the reset in one fixture, so the shared fallback considers only a
legal, payable battlefield-to-hand reset for all permanents and applies Forge's
own permanent evaluator; it proceeds only when the opposing battlefield is worth
more than the bot's. Once selected, the controller retains that reset while it
activates untapped, non-sacrificing permanent mana abilities. The policy contains
no card or probe identity. Both variants pass at seeds 42 and 43 with exact zone
transitions, retained floating mana, and same-turn, same-main-phase evidence.
Every interaction currently modeled by the Legacy Cube package map now has an
autonomous probe at both fixed seeds. This proves those initialized interactions,
not general match strength or interactions outside the fixtures.

The opt-in installed-Forge regression test is:

```sh
MTG_REQUIRE_FORGE_BOTS=1 npx vitest run packages/forge-export/test/bot-benchmark.integration.test.ts
```

It actually runs both fixed seeds for every installed fixture variant. The default
suite uses deterministic unit/integration fixtures and does not require Forge.
Native V8 coverage of the seven calibration modules measured 145/145 functions
and 229/257 blocks (89.1%); this is function/block coverage, not a claim of Java
or whole-workspace statement coverage. Evaluation-design guidance informed the
matched cohorts, independent splits, and explicit competence exclusions.

Highest-value follow-ups: improve splash/cheat-target mana and deck construction,
then compare against held-out human drafts and expert pick/deck judgments. The
calibration feature does not replace those independent sources of evidence.

## Initial pipeline verification

The final focused suite passed 128 tests; the opt-in installed-Forge test also
passed, running four actual autonomous probes. Typecheck, lint, UI production
build, and diff whitespace checks passed. The full workspace run completed
with 21 failed files, primarily load timeouts plus wiring defects subsequently
fixed. Every failed file passed its rerun. This is not a claim of one clean
uninterrupted workspace run: the last two-file rerun passed all seven tests
but logged a reporting-channel timeout. The repository's existing reporter
confirmed every module settled and every collected test reported before
returning exit zero. No test assertion was suppressed.

The workspace formatting check also found two unrelated pre-existing modified
LLM files (`packages/llm/src/schema.ts` and `packages/llm/test/fixture.test.ts`);
those edits were preserved. The new package-surface entry was formatted.

## Subsequent learning-first calibration boundary

The smoke artifact above predates the exact-card coverage helper and is a
historical result, not fresh validation of the current implementation fingerprint.
Current eligibility requires one matching probe to jointly cover all relevant
deck cards for each non-fundamental package; separate probe fixtures cannot be
combined into evidence of an untested interaction. A new installed campaign must
produce fresh evidence before its games can qualify.

Versioned scoring multipliers, a read-only human-source admission tool, and a
tuning-only candidate proposal stage now exist. Frozen two-arm pick review and
a persistent, exclusive holdout-use journal also exist as local APIs and offline
commands. Proposal sealing and held-out review pin source/dependency identities
and refuse artifact overwrite or holdout reuse. The checked-in human corpus
admits zero cases. Multidimensional quality review and gated local adoption are
now implemented and integration-tested through the mixed-evidence workflow.
The completed OAuth tuning pilot retained the baseline; this is not empirical
calibration or independent human validation. No weights have been adopted.
All advisor paths remain available and carry the label "Not yet bot-validated."
See `docs/legacy-cube-calibration-evidence.md` for the current source audit,
test results, and remaining evidence requirements tracked under `mtg-6yfe`.
