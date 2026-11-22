# General bot capability program

Working design, 2026-09-12. Program: `mtg-qffvg`. Beads owns implementation status and dependencies.

The user clarified the objective: comprehensive improvements to gameplay, drafting, and deckbuilding first; richer set knowledge and optional personas afterward. The default objective is **strongest play; personas optional**, explicitly confirmed in this conversation. This supersedes the investment scope of the [initial audit](bot-capability-audit-2026-09-12.md). The [AKH/HOU rollout](bot-improvements-2026-09-12.md) remains a useful experimental arm, but does not establish a general improvement.

## Chosen direction

Build one reproducible decision-to-outcome improvement loop across the bot surfaces. Share card facts, observation contracts, evidence provenance, and experiment machinery. Keep policies specific to gameplay, drafting, and construction: the value of a card in a pack, in a candidate deck, and in the current hand is a different quantity.

The missing abstraction is an attributable decision: what the player could know, which choices were available, what the policy chose, and what happened under a pinned environment. Today stronger advice can exist beside a runtime that never uses it, and a favorable game result can conflate three changed policies. Connecting these boundaries makes improvements reusable and measurable.

This program must deliver stronger runtime behavior. A shared interface, a dataset, successful game completion, or better results for one set is an intermediate result.

## Actual surfaces and current gaps

These are findings from the working tree inspected during this session, not promises about every future checkout. Recheck the named call sites before implementation.

| Surface | Current implementation and gap | Required outcome |
| --- | --- | --- |
| Native gameplay | `packages/kernel/src/agent.ts` exposes full `GameState` through `AgentView`; kernel game/session and sim driver pass it to agents. Greedy, random, and optional search policies are registered through `packages/sim/src/bots.ts`. Recent scry/tutor fixes cover only some decisions. | Player-relative information boundary; broad choice competence; a stronger policy evaluated in actual native games. |
| Forge gameplay | Separate subprocess engine and controller path. Native scorer changes do not improve Forge AI. | Versioned observations and reviewed action descriptors; stronger controller behavior compared with pinned Forge AI. Preserve process and license boundaries. |
| Generated/native draft | Ratings reach `simpleBotPick`; the native deck evaluator already reasons over typed abilities, costs, and deck context. Static pick ratings cannot exploit that whole context. | Evolving pool, curve, mana, synergy, and commitment influence actual internal bot picks. Exported Draftmancer ratings remain a separately identified static capability. |
| Printed draft and Limited construction | `packages/draft-export/src/limited-evaluation/` has 550 authored AKH/HOU/MP2 bindings. `packages/ui/src/routes/printed/draft-bot.ts` gates on catalog hashes; the new builder requires complete profile coverage. | A baseline usable without a bespoke set table, wired through actual draft, sealed, and opponent-deck routes; semantic gaps reported. |
| Native Limited construction | `@mtg/deckbuild` already has richer evaluation, used by UI `routes/draft/DraftGame.ts`, `routes/play/sealed.ts`, `routes/play/deal.ts`, netplay `src/room.ts`, and calibration. | Improve and preserve its existing capabilities; reuse common contracts without replacing it with a weaker structural scorer. |
| Legacy Cube | Actual `packages/ui/src/routes/legacy-cube/model.ts` uses the structural builder. Richer advisor and calibration builders exist in other paths. | Bring measured improvements into ordinary bot seats and opponent decks, not only advice or calibration. Existing authored Cube profiles are an explicit knowledge arm. |
| Constructed Decklab | Separate construction and candidate-evaluation workflow through `packages/decklab/src/build.ts` and its callers. Limited planner defaults describe a 40-card deck. | Format legality, deck size, copy limits, mana, strategy, and opposing decks inform candidate selection. Measure constructed outcomes separately from Limited. |

“General” covers every active surface above and held-out formats within each engine's supported space. It does not mean that the native kernel suddenly supports all printed Magic. Admission, rules correctness, and strategic competence remain separate claims. Unsupported cards and decision families remain in coverage reports.

## Information and policy boundaries

Five concepts must remain distinguishable even if their implementation is small:

1. **Rules and card facts.** Costs, types, colors, format legality, and executable typed effects where available. Native DSL semantics are reusable. Printed text is not automatically executable semantics: model-authored interpretations carry provenance and uncertainty, and structural parsing alone does not establish strategic understanding.
2. **Player observations and history.** Own hand, public zones and stack, legally revealed information, and hidden-zone counts. Information revealed by an effect is visible only to entitled players. History tracks what was learned; a shuffle or hidden transfer changes what is still known. Beliefs about hidden cards are distinct from their actual identities.
3. **Strategic priors.** General principles, authored ratings, archetype descriptions, and strategy writing are hypotheses about value. They are not rules facts and do not silently become ground truth through a shared `CardProfile` field.
4. **Empirical estimates.** Learned action values, contextual card contributions, and matchup estimates name their data, engine, opponent population, policy versions, and uncertainty. Values measured under a weak simulator may reflect its blind spots.
5. **Objectives.** Default competitive strength, optional persona preferences, and explicit resource budgets. Skill and available knowledge are separate controls; neither is inferred from a persona label.

Reuse the existing agent registry, builders, replay seams, and campaign runners before adding a framework. Introduce a shared package only where real dependency directions require it; avoid making the lower-level Limited package depend on its export/UI adapters. Share contracts before forcing algorithms to converge.

The observation boundary applies to the whole deployed policy, including search. A safe training projection does not make an agent fair while it still reads full state elsewhere. Existing privileged search can be retained as a labeled diagnostic comparator until migrated, but cannot stand in for a fair baseline. Legal-action payloads and feature extraction also require leakage checks.

Model judgments may be produced offline and loaded as versioned artifacts. Runtime inference remains local and reproducible; ordinary actions must not depend on a hosted model call. Hand-authored semantic keyword rules are not a substitute for the semantic provider. An explicit structural fallback is useful coverage, but is not evidence of improved semantic competence.

## Implementation order and capability targets

The first implementation work has two independent fronts: observation-safe decision recording, and generalized draft/construction adapters in the actual runtimes. Preserve old policy versions as controls. The latter can exercise existing native semantics and generalized providers before training is available; it must not silently fall back to the old AKH-only behavior.

For drafting, prioritize the marginal contribution of a pick to a buildable deck: color commitment and pivots, playable depth, curve, fixing, enablers and payoffs, and the opportunity cost of a speculative pick. Passing history can inform beliefs about availability without exposing other seats' private pools. Evaluate choices in complete drafts as well as frozen decision examples.

For construction, compare whole legal candidate decks. Improve mana reliability, curve and roles, synergy packages, interaction, and alternative color/strategy plans. Constructed candidates additionally need their own legality and opposing-deck context. A sum of isolated card ratings is a baseline, not the objective. Sideboarding is a separate best-of-three capability and must be labeled absent until implemented and measured.

For native gameplay, first measure decision-family frequency, failures, and available counterfactual evidence. Cover combat, sequencing and mana use, targets, modes, activation costs, resource trades, library choices, and specialized choice families. A model cannot select a strong action that enumeration never presents, so record candidate completeness and improve enumeration where it limits strategy.

The existing [learned-evaluator research](prior-art-learned-evaluators.md) recommends action-conditioned value estimation before increasing search depth. Use that as the first learned candidate: safe observation plus legal action, scored by a compact offline-trained model with local inference. Establish a current baseline before choosing model size or promising throughput; the report's older timing measurements are historical. Search is a subsequent experiment under matched information and resource budgets, not an assumed strength improvement.

Forge needs its own substantive controller improvement lane. Use the observed decision interface, retain complete reviewed action descriptions, compare against pinned Forge AI, and exercise ordinary runtime play. Scripted rule probes establish engine behavior; they do not establish strategic competence. Native and Forge outcome reports stay separate, even when their datasets use common envelopes.

Only after broad improvements pass promotion do richer set-knowledge experiments and persona variants become product behavior. Capture provenance now so those experiments will be possible later.

## Reproducible evidence contract

Each decision record must identify its episode and sequence; stage; engine/build; policy/configuration/model/data hashes; player observation and permitted history; candidates or a reconstructible candidate reference; completeness/truncation; chosen action; and errors. Store actual choices and outcomes, not only seeds. Seed replay can diverge when policy choices change the sequence of random draws.

Privileged engine traces, if needed for debugging or outcome labels, remain separate from policy inputs. Training must never accidentally join future reveals or opponent-private state into an earlier observation. For repeatability, pin the runtime and numerical implementation and test supported environments; float64 alone is not a universal cross-machine determinism proof.

Episodes have explicit completion, timeout, illegal-action, engine-failure, and unsupported states. Do not improve apparent win rate by dropping difficult episodes. Report intended population, attempted population, completion, exclusions with reasons, and outcome uncertainty. Current per-game statistics are not already an action-level training dataset.

Split data by complete game, draft/pool, and set where applicable. Related decisions from one episode cannot appear on opposite sides of a train/test split. Preserve lineage for derived decks, shared pools, and model-generated examples. Train on one population, select candidates on another, and reserve a final untouched evaluation population.

## Comparing sources of set knowledge

Rules establish possibilities and legality; strategic value still depends on goals, opponents, and distributions. We should compare sources rather than bless one as truth.

| Evidence arm | What it can supply | Main limitation to test |
| --- | --- | --- |
| R: rules/semantics plus declared general prior | Transferable understanding of what cards do and how resources interact | Rules alone do not imply a pick order; an existing model may already contain memorized strategy. |
| W: dated strategy writing and set analysis | Proposed archetypes, interaction patterns, and explanations | Claims can be stale, contradictory, or tailored to a different population. Store source and date. |
| H: observed human drafts and games | Actual choices and outcomes in played environments | Player strength, deck context, selection, and metagame confound aggregate card statistics. |
| S: deckbuilding simulations and game outcomes | Controlled comparisons and contextual counterfactual experiments | Rules gaps, weak opponents, and self-play conventions can reward brittle strategies. |

Use [17Lands public datasets](https://www.17lands.com/public_datasets) and their [metric definitions](https://www.17lands.com/metrics_definitions) as candidate human evidence, subject to their [usage guidelines](https://www.17lands.com/usage_guidelines). Treat those observations as a distinct source, not as randomized estimates of a card's causal contribution.

Compare R, R+W, R+H, R+S, then promising combinations with the same policy architecture, evaluation workload, and declared resource limits. Pin source snapshots and dates; tune combinations only on development data. Report training and runtime cost separately, and distinguish extra-data gains from architecture changes.

Hold out entire sets, card identities, and selected mechanic/archetype families. Add newly generated cards with enforceable semantics to test transfer. Anonymized names are a useful diagnostic, but do not prove freedom from pretraining contamination; structure can identify a card. A model trained on public Magic material cannot honestly be described as knowing only rules merely because its prompt omits strategy articles.

A source earns inclusion when it improves held-out outcomes and decision quality without an unacceptable robustness or resource regression. Disagreement between sources is useful: preserve the disagreement and test its predictions instead of averaging it away into an unexplained rating.

## Evaluation and promotion

| Experiment | Change | Hold fixed | Decision supported |
| --- | --- | --- | --- |
| Gameplay | Gameplay policy | Decks, engine version, opponent suite, seat schedule | Whether the player makes stronger decisions |
| Limited construction | Builder | Identical pools, gameplay policies, opponent suite | Whether candidate decks are stronger |
| Draft | Draft policy | Pack-generation schedule, other seats' policies, builder, gameplay | Whether picks produce stronger decks |
| Constructed construction | Candidate generator/selector | Legal card pool, format, opponent gauntlet, gameplay, match structure | Whether selected decks improve against the declared population |
| End to end | Crossed combinations of promoted components | Evaluation population and controls | Whether gains combine and survive runtime integration |

Changing picks changes later packs, so a matched draft is paired by initial generation schedule, not by a claim that every later decision sees the same pack. Use frozen decisions for local diagnostics and full episodes for outcomes. Seat swaps and controlled random streams reduce noise; they do not make divergent games identical.

Use diverse frozen opponents, including earlier policies and different strategic approaches, alongside candidate self-play. Do not accept “beats the old greedy bot” as sufficient evidence of general strength. Report per-engine, per-format, archetype, and decision-family results where the sample supports them; a favorable average cannot conceal a serious regression in one active surface.

Before running a promotion campaign, freeze its population, primary outcome, smallest useful effect, regression margin, sample-size/power calculation, and stopping rule. Use paired estimates and intervals clustered by independent pool/draft/game units as appropriate. Thousands of decisions from a few games are not thousands of independent strength observations. Repeated candidate selection uses development data; final holdouts are not a tuning loop.

Promotion requires legal behavior and information-boundary tests, reproducible artifacts, acceptable completion/coverage, a meaningful competitive gain with reported uncertainty, and acceptable latency/resource use. Report ties and inconclusive evidence explicitly. Correctness tests, line coverage, and engine qualification remain necessary software evidence; none substitutes for measured playing strength.

Verify the same policy and model artifact are used in the UI, netplay, and evaluation routes that claim the improvement. Real draft-to-deck-to-game journeys are part of acceptance. Preserve the previous version for comparison and rollback; do not silently rewrite fixtures to erase an unexplained outcome shift.

## Optional personas after competence

The default maximizes competitive performance under the declared information and resource budget. Persona preferences are optional, explicit, and may be blended. Their implementation should reflect motivations rather than a stereotype about card size or a forced archetype.

Wizards describes Timmy/Tammy in terms of experience, Johnny/Jenny in terms of self-expression, and Spike in terms of achievement and demonstrating skill; these are motivations, not skill levels ([The Three Magic Psychographics](https://magic.wizards.com/en/news/making-magic/the-three-magic-psychographics)).

Operational hypotheses for this product:

- Spike emphasizes competitive success and adapting to the field.
- Johnny/Jenny emphasizes expressing an inventive, coherent plan and making it work.
- Timmy/Tammy emphasizes desired play experiences, impactful moments, and variety.

Translate these hypotheses into explicit objectives only after testing them with people. A creative bot should pursue its plan competently; an experience-oriented bot should not become bad at mana or combat. Keep competence, compute budget, risk preference, knowledge access, and persona preferences independently configurable. Risk need not map directly to any psychographic label.

Evaluate persona goal attainment, blinded human recognition of intended behavior, consistency across drafting/building/play, and the competitive tradeoff. Compare against the same competent baseline at the same budget. Bigger creatures or more combos alone are insufficient evidence that the intended experience exists.

## Durable work and completion boundary

| Work | Tracking |
| --- | --- |
| This design and evaluation contract | `mtg-qffvg.1` |
| Generalized evaluation and actual draft/construction runtime integration | `mtg-qffvg.2` |
| Safe observations | Existing `mtg-cqcwm` |
| Reproducible decision/outcome data | `mtg-qffvg.3`, after the observation boundary |
| Native learned action evaluator | Existing `mtg-bw8z`, dependent on decision data |
| Diverse frozen opponents | Existing `mtg-5ar0` |
| Cube interaction competence | Existing `mtg-81tk` |
| Forge strategic controller improvement | `mtg-qffvg.7` |
| Stage-isolated and end-to-end strength promotion | `mtg-qffvg.4` |
| Controlled source-of-knowledge comparison | `mtg-qffvg.5`, after broad promotion |
| Optional persona objectives and behavioral evidence | `mtg-qffvg.6`, after broad promotion |
| Earlier AKH/HOU held-out measurement | Existing `mtg-q0fqa`, retained as a bounded experiment |

The program remains open until every active runtime surface has an explicit disposition and the broad capability claims have held-out outcome evidence. A surface that cannot yet run is an outstanding scope item with a named blocker, not a silent exclusion. Set-specific improvements may coexist with this work, but cannot close it.

This document records the design and evaluation requirements. It does not report a completed general rollout, trained model, downloaded human dataset, or measured broad strength gain.
