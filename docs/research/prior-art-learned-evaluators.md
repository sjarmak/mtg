# Prior art: learned state evaluators, and the local-model arm

Researched 2026-08-21 for the MTG Set Generation & Playing Lab ([design brief](../design-brief.md)), bead `mtg-46go`.
Scope: what a learned position evaluator would replace in this codebase, what the field has actually shipped for imperfect-information card games, how a variable-length typed board gets encoded, what bit-exact inference costs, whether a local model on one 32 GB card belongs anywhere in this loop, and which of this codebase's claimed advantages survive contact with the code.

This report starts where [`prior-art-mtg-ai.md`](prior-art-mtg-ai.md) §2.5 stops and does not re-derive it. The tiered-bot decision — greedy plus 1-ply first, an MCTS slot kept open, LLMs out of the inner loop at roughly $1 per game, playability metrics needing _consistent_ bots more than _strong_ ones — is settled there. What is new here is the shape of the evaluator inside any of those tiers, and a set of measurements taken in this checkout that change which tier is worth building first.

Verdict legend: **adopt** = use as-is or lightly wrapped · **interop** = speak its format across a boundary · **inspire** = port the pattern, not the code · **skip** = documented reason.

Provenance rule, matching the other six reports: every license below was read from the repository's license metadata or LICENSE file on the day of research. Every figure attributed to this repository was measured in the lane worktree on 2026-08-21 and the command that produced it is named. Every figure attributed to a paper carries its arXiv id or DOI. Claims that no test in this checkout can settle are marked **GUESS** inline and collected in §10.

---

## 0. Executive summary

1. **No shipping Magic engine uses a learned evaluator.** Forge, XMage and Magarena all score a position with a hand-written additive function over life totals, card counts and per-permanent creature value. Verified here against Forge's shipped bytecode rather than from memory (§1). The one exception is an alpha single-author project, and its results are unreplicated.
2. **Search and evaluator are orthogonal, and one repository proves it.** Magarena runs MCTS, minimax alpha-beta and MTD(f) over a single shared `ArtificialScoringSystem`. "Should we search?" and "should the leaf be learned?" are independent questions, answerable here in either order (§1.6).
3. **In this engine the search is the expensive half and the network is nearly free.** Measured: applying every legal option once at each decision costs **7.33x** a plain greedy run — 11,785 ms rising to 86,390 ms over 200 games, 278.5 µs per option application — because `reduce` settles the game forward to the next decision rather than taking one step. A pure-TypeScript float64 MLP at 256 inputs and 64 hidden units costs **10.3 µs** per evaluation. The evaluator is 27x cheaper than the state transition it would have been scoring (§7).
4. **That inverts the usual recommendation.** The cheap thing here is not "1-ply lookahead plus a value network". It is **a depth-0 action-conditioned Q network in DouZero's regime**: score each legal option directly from the pair (state, option), with no state transition at all. One network evaluation per option is about **13.4M evaluations** for the pinned 10,035-game sweep, roughly **9 seconds across 16 workers**, against 51-73 s for the 1-ply arm and a hand-tuned leaf on top of it. Build the evaluator, not the search (§7.3, §11).
5. **Determinism rules the GPU out of anything on the gate path.** The balance gate's waiver ratchet assumes byte-exact re-runs, and CI is not the machine a model was trained on. Every GPU runtime surveyed is either documented as varying across machines (TF32, TensorRT tactic selection, CUDA atomics) or carries no written contract at all (ONNX Runtime's CPU execution provider). The recommendation is inference in **pure TypeScript float64 with a fixed summation order and hand-rolled transcendentals** — bit-exact by construction on any IEEE-754 host, and affordable at the throughput measured above (§4).
6. **The local-LLM arm is refused for the play loop, the sweep and mulligans.** A 7-9B model at about 0.7 s per decision against this sweep's ~3.7M decisions is **30 days**; a 30B model at 3.0 s is **128 days**. The sweep today takes 7-10 seconds. And no local runtime ships a bit-exactness guarantee: 1,000 identical temperature-0 vLLM requests produced 80 distinct completions in a published 2025 measurement, and llama.cpp's deterministic CUDA mode is still an open pull request. Spot-check drafting is the only surviving use (§5).
7. **Typed effects are the real edge, and worth close to what it sounds like — with one caveat.** Every system surveyed here has to infer what a card does from English. This one does not: 36 effect kinds, 25 trigger conditions, 14 target kinds, 13 static modification kinds, 10 counter kinds, 9 keywords and 3 ability kinds, all enumerated and snapshot-tested. The nearest published evidence points the same way — 16 structured meta-features generalized to unseen sets at 42.14% accuracy where 1,306 text-inclusive features managed 33.57% ([arXiv:2407.05879](https://arxiv.org/abs/2407.05879)). The caveat is that no published ablation compares a _parsed effect vocabulary_ against a _text embedding_ on the same task, so the size of the win is inferred, not measured (§6.5).
8. **Two of the five candidate edges named in `mtg-46go` are wrong as stated**, and this report says so with the measurement that shows it: rollback is not free, and the 17lands-schema log is not training data in the right shape (§6.2, §6.6). A third needs a qualification (§6.3). The remaining two hold and one of them is stronger than the bead claims.

---

## 1. What the strong Magic bots actually evaluate

The question in `mtg-46go` is what a _learned_ evaluator would replace. The answer across every shipping engine is the same object: a hand-written additive score over a small number of board features, with per-creature value dominating the sum.

### 1.1 Forge — verified from the shipped distribution

[Card-Forge/forge](https://github.com/Card-Forge/forge), Java, **GPL-3.0**, ~2.6k stars, active. This repository already keeps a 2.0.14 desktop distribution behind a subprocess boundary, so the structural claims below were read out of that binary with `javap` rather than trusted to a source browser; the numeric weights were read from the master-branch source on GitHub on 2026-08-21.

- `forge.ai.simulation.GameStateEvaluator` produces a `GameStateEvaluator$Score`, a pair of `(value, availableValue)` — the second component is the score reachable with mana still untapped, which is how a scripted bot avoids valuing a tapped-out board like an open one.
- Board terms: life differential, cards in hand, an opponent-hand penalty per unknown card, a mana-base term, and per-permanent value. Creature value comes from `forge.ai.CreatureEvaluator`, an `int evaluateCreature(Card)` with a base of **80** and additive keyword bonuses; `bipush 80` and `bipush 70` (the indestructible bonus) are both present in the shipped `forge.ai.CreatureEvaluator` bytecode, and the constant pool otherwise consists of small integers — 5, 6, 9, 10, 15, 20, 25, 30, 40, 50. There is no matrix, no table lookup, no learned parameter anywhere in the class.
- Auras score 0 directly and are counted only through the creature they modify — a documented gap in Forge's own source comments, and a useful reminder that the hand-written evaluator's blind spots are structural, not numeric.
- **Depth is three, not one.** `forge.ai.simulation.SimulationController` in the shipped 2.0.14 jar declares `private static final int DEFAULT_MAX_DEPTH = 3` alongside a `currentStack`, a `scoreStack`, a `simulatorStack` and `shouldRecurse()`. Forge's simulation AI is a depth-limited recursive best-first plan search over spell abilities and their target choices, not the "1-ply" this repository's earlier report called it in [`prior-art-mtg-ai.md`](prior-art-mtg-ai.md) §2.1. That correction matters for §7: the strongest scripted Magic bot in existence already searches deeper than the arm `mtg-y4gw` proposes, and still loses to competent humans, which is evidence about the leaf rather than about the depth.

**Verdict: inspire.** The decomposition is already the template this repo followed (`packages/sim/src/evaluate.ts` names the `ComputerUtil*` / `CreatureEvaluator` split in its own docblock). What is worth taking additionally is `Score`'s two-component shape — a single scalar cannot express "good board, no mana up".

### 1.2 XMage — a second independent hand-tuned evaluator

[magefree/mage](https://github.com/magefree/mage), Java, **MIT**, ~2.3k stars, active. `Mage.Player.AI`'s `GameStateEvaluator2` scores with a nonlinear `LIFE_SCORES` table (life is worth progressively less as it rises), 5 points per card in hand, creature value as `power * 300 + toughness * 200`, and a **-1000** penalty for a detrimental aura on one's own permanent. `Mage.Player.AIMCTS` (`ComputerPlayerMCTS`, `MCTSExecutor`) is a real, wired-in UCT implementation with random rollouts — and no neural network anywhere in the plugin.

**Verdict: inspire.** The nonlinear life table is the one idea here a linear learned model would not discover on its own from a low-variance self-play distribution, because games that reach 1 life are rare in the sweep; it is a prior worth encoding as an input feature rather than learning.

### 1.3 Magarena — three searches, one evaluator

[magarena/magarena](https://github.com/magarena/magarena), Java, **GPL-3.0**, 444 stars, unmaintained since 2023-04-24. `src/magic/ai/` ships `MCTSAI`, `MMAB` (minimax alpha-beta), `MTDF` and `VegasAI` over a single shared `ArtificialScoringSystem` — whose `LIFE_SCORES` table is identical to XMage's, indicating shared lineage rather than independent derivation, so the two should be counted as roughly one data point on evaluator design and two on search design.

**Verdict: inspire, and it is the load-bearing precedent for the whole report.** Four search algorithms over one scoring function is the cleanest available demonstration that the leaf evaluator is a separable component. Whatever this repo builds as an evaluator survives a later decision to add search, and vice versa.

### 1.4 Cockatrice — no bots at all

[Cockatrice/Cockatrice](https://github.com/Cockatrice/Cockatrice), C++, **GPL-2.0**, active. Confirmed to contain no rules engine and no AI: it is a networked table that trusts its players. Included here only so the survey's negative space is explicit — a play surface without rules enforcement cannot host a bot, which is the same argument `@mtg/engine`'s contract makes from the other direction.

**Verdict: skip.**

### 1.5 MageZero — the one learned Magic evaluator, and why it is not evidence yet

[WillWroble/MageZero](https://github.com/WillWroble/MageZero), **MIT**, 45 stars, last pushed 2026-06-19. A Transformer policy/value network with PUCT MCTS and self-play, built over XMage. The README claims a rise from 16% to 66% win rate against a minimax baseline, and roughly 13 percentage points below human play. Single author, alpha, no paper, no independent replication, no reported compute budget.

**Verdict: inspire, with the result treated as unverified.** It is the existence proof that an AlphaZero-shaped stack can be pointed at a full-rules Magic engine at all. It is not evidence about what such a stack costs or achieves. **GUESS:** nothing in this checkout can validate or refute the 66% figure.

### 1.6 What the four have in common

Every one of them evaluates: life (nonlinearly, in three of four), cards in hand, cards in the opponent's hand as a penalty, available mana, and a sum of per-permanent creature values built from power, toughness and a fixed keyword bonus table. None of them evaluates the _interaction_ between two permanents except through combat, and none of them has any learned parameter.

That is exactly the surface this repository already reimplemented by hand, and it can be measured. `packages/sim/src/config.ts` carries **88 free numeric parameters** — 54 scalar fields, 6 booleans, a 9-entry `keywordValue` table (flying 1.5, deathtouch 1.6, first strike 1.2, lifelink 1.0, menace 0.9, vigilance 0.8, trample 0.7, haste 0.6, reach 0.5) and a 25-entry `triggerValue` table. `packages/deckbuild/src/config.ts` adds 35 more scalars and 7 record tables. Its own docblock states the position plainly: _"The order matters more than the magnitudes, and no balance run has measured either yet"_, and the phrases "No sweep has measured it", "Unmeasured" and "neither has been measured" recur through the file.

**A learned evaluator's job here is to replace 88 unmeasured constants with parameters fitted to the outcome the sweep already computes.** That is a sharper statement of value than "make the bots stronger", and it is the one this report recommends acting on.

---

## 2. Learned evaluators in imperfect-information card games

### 2.1 The poker family, and why it does not transfer

DeepStack ([Science 356:508, 2017](https://www.science.org/doi/10.1126/science.aam6960)) trains a value network on **21M** CFR-solved situations at a cost of roughly **175 core-years**, and then still re-solves a depth-limited subgame at every decision — the network is a leaf oracle for a solver, not a policy. Libratus ([Science 359:418, 2018](https://www.science.org/doi/10.1126/science.aao1733)) and Pluribus ([Science 365:885, 2019](https://www.science.org/doi/10.1126/science.aay2400)) contain no neural network at all. ReBeL ([facebookresearch/rebel](https://github.com/facebookresearch/rebel), **Apache-2.0**, [arXiv:2007.13544](https://arxiv.org/abs/2007.13544)) unifies the two with a 6-layer, 1536-wide network over public belief states, trained on **720 V100s**. Player of Games ([arXiv:2112.03178](https://arxiv.org/abs/2112.03178)) generalizes the recipe and keeps the search.

The transfer failure is structural, not budgetary. All of these depend on a **public belief state** — a distribution over the opponent's private information that both players can compute from the public history. Magic does not have one that is small enough to represent: the opponent's hidden information is a subset of a 60-card deck whose composition is itself partly unknown, and every card in it has different rules text. There is no counterpart to "the opponent holds one of 1,326 hole-card combinations".

**Verdict: skip for the algorithm, inspire for one idea.** The idea worth keeping is DeepStack's separation of _who computes the label_ from _who consumes it_: labels came from a solver, the network only had to approximate them. Here, the sweep computes labels (game outcomes) and the network approximates them — same separation, cheaper oracle.

### 2.2 DouZero — the load-bearing precedent

[kwai/DouZero](https://github.com/kwai/DouZero), **Apache-2.0**, [ICML 2021, arXiv:2106.06135](https://arxiv.org/abs/2106.06135). Dou Dizhu is a three-player imperfect-information card game with a combinatorial action space (**27,472** distinct legal move types), non-fixed action sets per turn, and both cooperation and competition. DouZero reached #1 of 344 entries on the Botzone leaderboard.

Its design is the one this report recommends copying, and the reasons are each a match for a property this codebase already has:

- **Action-conditioned Q, not state value.** The network takes (state encoding, _one candidate action_ encoding) and returns a scalar; the agent evaluates each legal action and takes the argmax. A variable-length, position-dependent action set therefore needs no fixed output head and no action-index mapping at all. This repo's decision surface is exactly that shape — `Enumerated<Action>` lists, whose length and meaning both vary per decision.
- **Deep Monte-Carlo, not search.** Training is plain Monte-Carlo: play a game to the end, label every (state, action) pair with the final return, regress. **No search at training time and no search at inference time.** The whole cost model is "simulate many games", which is the thing this repo is already built to do fast.
- **Modest architecture and modest hardware.** 4x15 card matrices, an LSTM over the last 15 moves, and a 6-layer MLP with 512 hidden units. A single server, 48 CPU cores and 4x GTX 1080 Ti; it beats a supervised baseline at roughly 5x10^8 timesteps (about two days) and a stronger opponent at ten days, with a 30-day full run.
- PerfectDou ([NeurIPS 2022, arXiv:2203.16406](https://arxiv.org/abs/2203.16406)) reports the same result at an order of magnitude fewer samples by using perfect-information features during training only — a technique available here for free, because the simulator has the whole state and the agent's view is a deliberate projection.

**Verdict: adopt the regime.** Not the code (its encodings are Dou Dizhu-specific and its 4x15 matrix depends on a 15-rank fungible card universe, which §3.2 explains does not generalize). The regime: action-conditioned scoring, Monte-Carlo labels from completed games, no search at inference.

### 2.3 Hearthstone — value nets only as search accelerants

Świechowski et al. (2018) trained a value network for Hearthstone MCTS: 750-dimensional input, three dense layers of 256/128/64, 3.5M training samples, 0.76 validation accuracy — and used it strictly as a leaf evaluator inside a search. A survey of the published Hearthstone AI work turns up **no competitive search-free learned evaluator**. Hearthstone is the closest published analogue to Magic in card heterogeneity, so this is the most relevant negative result in the survey, and §7 argues it does not bind here because Hearthstone's engines do not fork in 1.7 ns.

**Verdict: inspire.** The input size (750) and layer widths (256/128/64) are a useful prior for a first architecture on a comparably complex board.

### 2.4 Hanabi — the self-play brittleness warning

The Hanabi Learning Environment ([arXiv:1902.00506](https://arxiv.org/abs/1902.00506), **Apache-2.0**) is where the failure mode this repo should fear was first quantified. ACHA reached 22.73/25 after **10 billion** steps; Simplified Action Decoder reached 24.08 self-play, rising to 24.53-24.61 with search; Other-Play, which deliberately breaks arbitrary conventions, scores lower in self-play (20.92) and higher with strangers.

The lesson for a set-generation lab is direct and uncomfortable: **a self-play-trained evaluator learns conventions of its own training distribution, and a playability metric computed with it measures the convention as much as the set.** `prior-art-mtg-ai.md` §2.5 already flags archetype-asymmetric bot skill as a confounder; a learned evaluator makes that confounder trainable, which makes it worse, not better. §11 turns this into a build requirement: the learned arm must be gated against the scripted arm on the same seeds, and a divergence in verdict is a finding to investigate, not a win to bank.

**Verdict: inspire (as a hazard, not a method).**

### 2.5 Bridge, and the determinization trap

Competitive computer bridge remains PIMC over double-dummy solvers; no published belief-state value network is competitive. Long's analysis of when PIMC works ([AAAI 2010](https://ojs.aaai.org/index.php/AAAI/article/view/7562)) names the two properties that make determinization survivable — low disambiguation factor and low bias — and Frank & Basin's **strategy fusion** result names the failure: a determinizing search assumes it will know the hidden state at every future node, so it never plays the information-gathering or information-hiding move. Magic's bluffing surface (an untapped blue mana that may or may not be a counterspell) sits exactly in that failure region.

**Verdict: inspire.** If an MCTS tier is ever built here, it should carry explicit belief features rather than determinize — which is §2.6's method.

### 2.6 DeepNash — belief features instead of belief solving

DeepNash ([Science 378:990, 2022](https://www.science.org/doi/10.1126/science.add4679)) reached 84% against ranked human Stratego players using Regularized Nash Dynamics with **no search at training or test time**. Its state encoding is the transferable part: an 82-channel tensor in which the opponent's hidden pieces are represented by a belief distribution built _from the legality constraints and move history_ by cheap arithmetic, not by solving for a posterior.

This is the cheapest available answer to "how does an evaluator here see the opponent's hand?". The kernel knows the deck list, the cards already seen, and the cards in every public zone; the implied distribution over the opponent's hand is a subtraction, not an inference. **Verdict: adopt the technique** — hidden-zone features as arithmetic over known-deck minus known-public.

### 2.7 The reference points on cost

| System                | Search at inference     | Training volume                                  | Hardware                       | Source                                                                  |
| --------------------- | ----------------------- | ------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------- |
| TD-Gammon             | none                    | 1.5M self-play games, 80 hidden units            | 1992 workstation               | Tesauro 1995                                                            |
| DouZero               | none                    | ~5x10^8 steps for the first win; 30-day full run | 1 server, 48 cores, 4x 1080 Ti | [arXiv:2106.06135](https://arxiv.org/abs/2106.06135)                    |
| DeepNash              | none                    | R-NaD, undisclosed step count                    | undisclosed, large             | [Science 378:990](https://www.science.org/doi/10.1126/science.add4679)  |
| DeepStack             | re-solve every decision | 21M solved situations                            | ~175 core-years of labeling    | [Science 356:508](https://www.science.org/doi/10.1126/science.aam6960)  |
| ReBeL                 | re-solve every decision | undisclosed                                      | 720 V100s                      | [arXiv:2007.13544](https://arxiv.org/abs/2007.13544)                    |
| AlphaZero             | MCTS                    | 44M self-play games                              | TPU fleet                      | [Science 362:1140](https://www.science.org/doi/10.1126/science.aar6404) |
| AlphaStar             | none (policy net)       | 12 agents x 32 TPUv3 x 44 days                   | as stated                      | [Nature 575:350](https://www.nature.com/articles/s41586-019-1724-z)     |
| Hearthstone value net | MCTS leaf only          | 3.5M samples                                     | single machine                 | Świechowski et al. 2018                                                 |

The two systems that need no search at inference (TD-Gammon, DouZero) are also the two whose training volume is reachable on one machine. This repository measures **98 games/sec single-threaded** (`npx tsx packages/kernel/bench/fork-bench.ts`, 2026-08-21), which is within a factor of 10 of AlphaZero's reported ~1,000 games/sec and about 8.5M games per day at 16 workers. DouZero's first-win budget is therefore days, not weeks, on hardware already present. **GUESS:** that extrapolation assumes the learning problem here is of comparable difficulty to Dou Dizhu's, which nothing in this checkout establishes.

---

## 3. Encoding a variable-length, typed, relational board

### 3.1 Flat fixed-length vectors — what the one Magic benchmark did

MTG-Causal-RL ([arXiv:2605.06066](https://arxiv.org/abs/2605.06066)) uses a 3,077-dimensional flat observation and a 478-action masked discrete head organized as 16 fixed slot categories, over five fixed Standard archetypes, with an MLP of [512, 256]. No compute figures are reported. The fixed-slot action head is exactly the design that does not survive contact with a generated set: the slot semantics are pinned to a known card pool.

### 3.2 Card matrices — why DouZero's encoding does not port

DouZero's 4x15 matrix works because Dou Dizhu has 15 fungible ranks and four suits with no rules text. The nearest Magic analogue would be a matrix over the set's card ids, which for the flagship set here is 371 columns that change every time the set changes, and whose columns carry no shared structure. **This is the single most important negative transfer in the survey**, and it is what makes §3.6 the interesting section: the substitute for "card identity" has to be "what the card does", and this codebase can produce that directly.

### 3.3 Sets and permutation invariance — the one controlled comparison, and it is a null result

A battlefield is a set, not a sequence: two boards that differ only in the order permanents entered are the same position. DeepSets ([arXiv:1703.06114](https://arxiv.org/abs/1703.06114)) and Set Transformers ([arXiv:1810.00825](https://arxiv.org/abs/1810.00825)) are the standard answers.

The only controlled comparison found in a card game is Vieira et al. on LOCM ([gym-locm](https://github.com/ronaldosvieira/gym-locm), **MIT**; [doi:10.1016/j.entcom.2022.100526](https://doi.org/10.1016/j.entcom.2022.100526)), which put a Set Transformer and a flat MLP under identical PPO training and reported **"unexpectedly similar win rates"**. At LOCM's board size — six lanes a side — attention buys nothing over a flat encoding with sorted slots.

**Verdict: inspire, and start flat.** A masked, canonically-sorted fixed-slot encoding of at most ~20 permanents per side is the cheap first move, and the one published comparison says the sophisticated alternative did not win at this scale. Permutation invariance can be bought instead by sorting the slots deterministically, which also serves §4's bit-exactness requirement.

### 3.4 Graph networks — refuse, with a reason

No published graph neural network over any card-game board state was found. The intuition behind wanting one is that Magic's board is relational — auras attach, equipment attaches, tokens are created by a source. But in this codebase those relations are already **symbolically resolved**: the kernel's layer system computes a permanent's characteristics, and `packages/sim/src/evaluate.ts` deliberately provides `boardCreatureValue` reading through that layer system alongside `printedCreatureValue` reading the printed card. Attachment depth is at most 2 in practice. A message-passing network would be re-deriving, from scratch and approximately, a computation the engine has already done exactly.

**Verdict: skip.** This is one of the places where the typed-effect edge (§6.5) pays off as a _removal_ of machinery rather than an addition.

### 3.5 Sequence models over history

DouZero's LSTM over the last 15 moves and AlphaStar's transformer over ≤512 entities ([Nature 575:350](https://www.nature.com/articles/s41586-019-1724-z); 139M parameters, 55M at inference, 12 agents x 32 TPUv3 x 44 days) both encode history explicitly. For a depth-0 evaluator here, most of what a history encoder would recover is already in the state: the graveyard is the move history of everything that died, and the kernel's event log is addressable. **GUESS:** whether a history channel adds anything above graveyard-plus-exile features is not settleable in this checkout.

### 3.6 Text embeddings versus structured features — the measured deltas

This is the section that decides §6.5, so the numbers are given exactly as published.

Bertram et al. ([arXiv:2407.05879](https://arxiv.org/abs/2407.05879)) compared card representations for draft-pick prediction on 17lands data:

| Representation                        | Dimensions | Accuracy, known sets | Accuracy, **unseen** sets |
| ------------------------------------- | ---------- | -------------------- | ------------------------- |
| One-hot card identity                 | 302        | 67.80%               | not applicable            |
| Handcrafted features + text embedding | 1,306      | 67.76%               | **33.57%**                |
| Metagame statistics only              | 16         | 64.73%               | **42.14%**                |
| Best hybrid                           | —          | 68.00%               | **42.87%**                |

The shape of that result is the whole argument: on known sets, everything ties; on **unseen** sets, a 16-dimensional structured representation beats a 1,306-dimensional text-inclusive one by **8.6 percentage points**. Text embeddings encode which cards were good in the training sets; structure encodes what a card does.

DraftEncoder ([arXiv:2607.04782](https://arxiv.org/abs/2607.04782)) points the same way from the other end: text-only representations correlate with deck strength at ρ = 0.0879, and adding structured features raises that to ρ = 0.1529, a 73.9% relative improvement. UrzaGPT ([arXiv:2508.08382](https://arxiv.org/abs/2508.08382)) puts a ceiling on the pure-text approach at 43% zero-shot, 66.2% after LoRA fine-tuning.

**Every one of those systems is trying to recover, from English, a structure that this codebase has as data.** The generated-set case is the unseen-set column by construction: a set generated tomorrow was in nobody's training distribution.

### 3.7 Encoding the action, not indexing it

For the DouZero regime the action encoding matters as much as the state encoding, and here it is unusually easy. A `Decision` in this kernel is one of 16 discriminated kinds (`priority`, `declareAttackers`, `declareBlockers`, `orderBlockers`, `scry`, `searchLibrary`, `graveyardChoice`, `permanentSacrifice`, `mulligan`, `discard`, `handDiscard`, `triggerTargets`, `optionalTrigger`, `may`, `unless`, `legendRule` — `packages/kernel/src/legal.ts`), and each option within it is typed data, not a string. A candidate action encodes as: the decision kind one-hot, plus the typed effect fingerprint of whatever card or ability the option names, plus the slot features of its targets.

Measured, in the decision census of §7.1, only **7 of the 16 kinds ever occur** across 73,494 decisions of ordinary play. A first implementation covering `priority`, `declareAttackers`, `declareBlockers`, `triggerTargets`, `mulligan`, `orderBlockers` and `discard` covers all of it.

### 3.8 The recommended encoding

Concretely, and sized against §7's budget: a per-side masked block of at most 20 permanent slots (each carrying power, toughness, the 9 keyword bits, counter counts over the 10 counter kinds, tapped/attacking/blocking/summoning-sick flags, and the effect-kind fingerprint of its abilities), sorted canonically; plus scalar channels for life, hand size, library size, lands untapped by color, and DeepNash-style hidden-zone arithmetic for the opponent's hand; plus the candidate-action encoding of §3.7. That lands in the 256-512 input range, which is where §7's throughput measurements were taken.

---

## 4. Determinism at inference

### 4.1 What this repository already requires, and why it is not negotiable

`packages/engine/src/determinism.ts` makes reproducibility a **type-level discriminant** rather than a capability flag: `RecordedBackend` carries `reopen` and a `fingerprint`, `ObservedBackend` carries a transcript, and neither carries the other, so a function that needs a reproduction says `RecordedBackend` in its signature and an observed backend fails to typecheck rather than failing at run time. Its own argument is that _seed plus choice list is the entire record of a game_, and it states outright that a mass-simulation substrate must be a recorded backend.

Downstream of that, `packages/metrics/test/balance/baseline.ts` runs a waiver ratchet against a pinned 10,035-game sweep (45 matchups x 223 games, seed `mtg-balance/v0`) with a drift tolerance. **That mechanism assumes byte-exact re-runs.** An evaluator whose output varies by one unit in the last place changes an argmax at some decision in some game, which changes that game's outcome, which moves a win rate, which trips a waiver — nondeterministically, on some machines and not others. There is no tolerance setting that fixes this, because the failure is discrete: the network's error is tiny and the game's is total.

`packages/sim/src/play-index.ts` states the same requirement from the runner's side: _"A game's outcome depends only on (run seed, index, spec) — never on how many games ran before it, or in which thread."_ An evaluator that reads a GPU breaks that sentence.

### 4.2 The cross-machine question decides everything

The distinction that matters is not "deterministic" but **"deterministic on a machine that is not the one where the model was trained"**. CI is not the development workstation. A contributor's laptop is not either. Every option below is evaluated on that axis.

| Runtime                                     | Same machine, same build           | **Different machine or GPU**                                                                             | Cost of forcing it                       |
| ------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Pure TS/Node float64, fixed summation order | yes, by IEEE-754                   | **yes**, except transcendentals (§4.4)                                                                   | none                                     |
| WASM (SIMD off)                             | yes                                | yes — the spec bans FMA contraction and non-default rounding modes                                       | ~0; SIMD would cost the guarantee        |
| ONNX Runtime, CPU EP                        | observed deterministic             | **no written contract**                                                                                  | unknown                                  |
| ONNX Runtime, CUDA EP                       | no                                 | no — [microsoft/onnxruntime#4611](https://github.com/microsoft/onnxruntime/issues/4611), open since 2020 | not available                            |
| PyTorch CUDA, deterministic flags           | yes                                | **no** — TF32 differs across GPU generations                                                             | measured 7x in one published anecdote    |
| TensorRT                                    | yes for a frozen engine at batch 1 | no — build-time tactic autotuning; engines are GPU- and version-specific                                 | rebuild per machine, still not identical |

The PyTorch settings, named as `mtg-46go` asks: `torch.use_deterministic_algorithms(True)`, `CUBLAS_WORKSPACE_CONFIG=:4096:8`, `torch.backends.cudnn.deterministic = True`, `torch.backends.cudnn.benchmark = False`, TF32 disabled (`NVIDIA_TF32_OVERRIDE=0`, `torch.backends.cuda.matmul.allow_tf32 = False`), fixed seeds on every generator, and no sampling anywhere in the decision path — argmax only. Even with all of them, scatter and index operations that reduce through atomics remain a residual source of run-to-run variation, and TF32 remains the reason a model that is bit-exact on this workstation is not bit-exact on a different NVIDIA generation. The throughput cost is real but secondary; the correctness gap is what disqualifies the path.

### 4.3 The recommendation, and what it costs

**Run inference in the same process, in TypeScript, in float64, with a fixed summation order.** Measured on this machine (Node v22.22.2, 2026-08-21, hand-rolled MLP with an explicit loop order and ReLU activations):

| Input x hidden | float64                 | float32 (Float32Array) | MACs/eval |
| -------------- | ----------------------- | ---------------------- | --------- |
| 256 x 64       | 10,275 ns (97k evals/s) | 21,953 ns              | 20,544    |
| 256 x 128      | 42,076 ns (24k evals/s) | 45,449 ns              | 49,280    |
| 512 x 256      | 152,316 ns (7k evals/s) | 198,231 ns             | 196,864   |

Two things in that table are worth stating because they are counterintuitive. **float64 is faster than float32 in this runtime** — V8's numbers are doubles, so a `Float32Array` costs a rounding step per store and buys nothing. And the 256x64 case runs at about 4 GFLOP/s single-threaded, which is poor against a GPU and entirely sufficient against §7's budget.

Training happens offline and may use whatever hardware and nondeterminism it likes; only **inference** is on the gate path. The artifact that crosses the boundary is a weights file, and it should be committed as exact decimal or hex float64 rather than as a serialized tensor format that may round on load.

### 4.4 The one real hazard in the recommended path

`Math.exp`, `Math.tanh` and friends are **not** specified to be correctly rounded in ECMAScript; implementations may and do defer to the host libm, which differs between platforms and between versions of the same platform. V8 moved `Math.tanh` to `std::tanh` in Chrome 148, and these functions are used in the wild for OS fingerprinting precisely because they differ.

The fix is cheap and must be a build requirement, not a note: **use ReLU, and if a bounded activation is needed, implement it from `+ - * /` only** (a rational approximation, or a fixed-degree polynomial), never from `Math.exp`. The same applies to any softmax in the decision path — and the decision path should not have one, because §4.1 forbids sampling anyway.

### 4.5 What this buys

A learned evaluator built this way is a pure function of the weights file and the encoded position, evaluated identically on the workstation, in CI, and on a contributor's machine. It slots into `RecordedBackend` without a new capability flag, `stateFingerprint` still means what it means, and the balance gate's ratchet keeps working. That is a strong enough property that it should be treated as a constraint on the architecture rather than an afterthought: **the network must be small enough and simple enough to run in TypeScript**, which happens to be the same conclusion §7 reaches from the cost side.

---

## 5. The local-model arm, measured

The hardware is one RTX 5090, **32,607 MiB**, driver 595.84, CUDA 13.2, compute capability sm_120 (read from `nvidia-smi` on 2026-08-21). The constraint from `mtg-46go` is absolute: no vendored API, no hosted inference, no key, no per-call bill.

### 5.1 The arithmetic that ends the discussion

The pinned balance sweep is 10,035 games. Measured decision volume (§7.1) is **367.5 decisions per game**, so the sweep is about **3.7M decisions**.

| Model class | VRAM at 4-bit                       | Latency per decision | Sweep runtime |
| ----------- | ----------------------------------- | -------------------- | ------------- |
| 7-9B        | ~5-6 GB                             | ~0.7 s               | **30 days**   |
| 30-32B      | ~18-20 GB                           | ~3.0 s               | **128 days**  |
| 70B         | does not fit at useful quantization | —                    | —             |

The same sweep runs today in **7-10 seconds** (`npm run test:balance`, per the pinned-subject figures in `packages/metrics/test/balance/subjects.ts`). The ratio is between 2.6x10^5 and 1.1x10^6. There is no batching trick, no speculative decoding factor and no quantization level that closes six orders of magnitude.

### 5.2 The low-volume tiers, where the arithmetic is at least survivable

| Task               | Volume                                   | 7-9B   | 30B    |
| ------------------ | ---------------------------------------- | ------ | ------ |
| Draft picks        | 8 seats x 45 picks x 100 drafts = 36,000 | ~7 h   | ~30 h  |
| Mulligan decisions | 10,035 games x ~2.4 = ~24,000            | ~4.7 h | ~20 h  |
| Post-game review   | 100 games x ~100 summarized decisions    | ~2 h   | ~8.4 h |

Mulligans are the tier `prior-art-mtg-ai.md` §2.5 specifically nominated for LLM judgment. At 4.7 hours against a 7-10 second sweep, **the mulligan tier is refused too** — not because the number is impossible, but because it converts a gate that runs on every commit into one that runs overnight, and §4.1 says the result would not be reproducible anyway.

### 5.3 Determinism kills what latency leaves

Even where the runtime is affordable, no local LLM runtime ships a bit-exactness guarantee:

- Thinking Machines' September 2025 analysis of batch-invariance sent **1,000 identical temperature-0 requests** to a vLLM server and received **80 distinct completions**, with the first divergence at token 103. The cause is that kernel reduction order depends on batch composition, which depends on what else is in flight. Batch-invariant kernels fix it at a **1.6-2.1x** throughput cost, with the matmul alone about 20% slower.
- llama.cpp's deterministic CUDA mode is [PR #16016](https://github.com/ggml-org/llama.cpp/pull/16016), still open. There is no shipped bit-exact local inference path today.

Temperature 0 is not determinism. It removes the sampler and leaves the kernel.

### 5.4 Verdict, stated plainly as `mtg-46go` asks

**A small purpose-trained network beats a general local model at every task in this loop, and the local-model arm should be refused rather than scoped down.** The comparison is not close on any axis:

|                                  | Local 7B LLM              | Purpose-trained MLP (§3.8, §4.3) |
| -------------------------------- | ------------------------- | -------------------------------- |
| Latency per decision             | ~700,000 µs               | **10 µs**                        |
| Bit-reproducible across machines | no shipped path           | yes, by construction             |
| Trained on this set's cards      | no                        | yes, from the sweep              |
| Runs inside the vitest process   | no (server, VRAM, driver) | yes                              |
| Runs in CI                       | no                        | yes                              |
| Marginal cost per sweep          | one GPU-month             | ~9 s                             |

The one surviving use is **spot-checking**: a human-scale sample of draft picks or post-game reviews, run by hand, off the gate path, where a slow non-reproducible second opinion is still worth reading. That is a tool, not a tier, and it should never acquire a caller inside `packages/sim`.

**Verdict: skip for the loop; inspire (as an offline review tool) for drafting.**

---

## 6. How this codebase can improve on them

`mtg-46go` lists five properties this codebase has that the surveyed systems do not. This section tests each against the code rather than repeating it. Two are wrong as stated, one needs a qualification, and two hold — one of them more strongly than the bead claims.

### 6.1 Method

Every claim below was checked in the lane worktree on 2026-08-21 by reading the implementation and, where a cost is asserted, by running it. Where a bead sentence and the code disagree, the code wins and the disagreement is stated.

### 6.2 "Event-sourced state makes rollback free" — **wrong as stated, and the true version is better**

`packages/kernel/src/undo.ts` implements `undoTo` as `replaySession(setup, session.seats, session.choices.slice(0, target))`. Rewinding replays the game from the beginning up to the target choice. That is **O(n) in decisions taken so far**, not free, and a search that rewound after every branch would be quadratic in the length of the game.

What is actually true is stronger and differently shaped. `packages/kernel/src/reduce.ts` is a pure reducer whose docblock states the property: _"the returned state is a new object graph that structurally shares everything the action did not touch … that is the whole basis of O(1) forking."_ A search here **never needs to undo at all** — it holds the parent state in a local variable, applies an option to get a child, scores it, and drops the child on the floor. The garbage collector is the rollback.

Measured (`npx tsx packages/kernel/bench/fork-bench.ts`, 2026-08-21, at a turn-6 position with 80 objects, 7 permanents, 44,038 bytes of JSON):

```
fork(state)                  1.7 ns/op
deepCopy(state)              65,405.5 ns/op
fork is 38,550x cheaper than a detached deep copy
first reduce on a branch     9,324.9 ns/op
throughput: 98 games/sec single-threaded, 16.0 turns/game, 1424 events/game
```

**This is a genuine edge over every engine surveyed.** Forge branches by `GameCopier`, which deep-copies the game object graph; XMage's MCTS plugin does the same. A 38,550x difference in branch cost is the difference between "search is a research project" and "search is a loop". The bead should be reworded: the edge is immutability with structural sharing, not event sourcing, and `undoTo` is the wrong function to point at.

### 6.3 "Complete legal action enumeration" — **true, with a qualification that matters for training**

`packages/kernel/src/enumerate.ts` returns `Enumerated<T> { items, complete }` and caps at `DEFAULT_ENUMERATION_CAP = 512`. The honesty of the `complete` flag is real and unusual — most engines silently truncate. But the truncation is a **lattice-order prefix**, not a sample: as `mtg-dwd` records, on twelve eligible attackers the 512 retained options name nine creatures and the other three appear in no option at all. A learned evaluator trained on truncated decisions would learn that those three creatures never attack.

Measured incidence, over 200 games (see §7.1): **4 incomplete enumerations in 73,494 decisions**, 0.005%, with 6 decisions at or over the cap. That is small enough to handle by exclusion rather than by redesign.

**Build requirement:** drop positions with `complete === false` from the training set, and count them. A rare truncation that is silently learned is worse than a rare truncation that is skipped.

### 6.4 "Seed plus choices is a total game record" — **true, and stronger than the bead states**

`packages/engine/src/determinism.ts` argues it as a design principle; `packages/sim/src/play-index.ts` makes it operational: _"A game's outcome depends only on (run seed, index, spec) — never on how many games ran before it, or in which thread — which is what makes the sharded run reproduce the serial one."_

The consequence for a training pipeline is the one the bead misses. **Training positions do not need to be stored.** A position is addressable as the triple (spec, game index, decision number), and re-deriving it is a replay at 98 games/sec. A 10-million-position dataset is a few hundred bytes of specification plus CPU time, versus tens of gigabytes of serialized states. Re-labeling the same positions under a changed reward, a changed feature set or a changed encoding costs a re-run, not a re-collection — which is exactly the loop that makes feature engineering cheap.

No surveyed system has this. DouZero writes out its trajectories; DeepStack stored 21M solved situations; the Hearthstone value net stored 3.5M samples.

### 6.5 "DSL cards with typed effects rather than parsed oracle text" — **the real edge**

This is the one the bead flags as possibly the actual advantage, and the survey supports that reading.

What the codebase has, measured from `packages/dsl/data/vocabulary-snapshot.json` on 2026-08-21 (44 enumerations in total, the load-bearing ones listed):

| Enumeration                        | Count |
| ---------------------------------- | ----- |
| `ALL_EFFECT_KINDS`                 | 36    |
| `CARD_SHAPES`                      | 25    |
| `TRIGGER_CONDITIONS`               | 25    |
| `UNPRICED_EFFECT_KINDS`            | 22    |
| `EFFECT_KINDS`                     | 14    |
| `TARGET_KINDS`                     | 14    |
| `STATIC_MODIFICATION_KINDS`        | 13    |
| `ZONE_REACHING_MODEL_EFFECT_KINDS` | 13    |
| `COUNTER_KINDS`                    | 10    |
| `MODEL_EFFECT_KINDS`               | 10    |
| `KEYWORDS`                         | 9     |
| `ABILITY_KINDS`                    | 3     |

Every card in a generated set is a point in that finite typed space, and the space is snapshot-tested, so an encoding built on it fails loudly when the vocabulary grows rather than silently mis-encoding. **A card's behavior is available as a fixed-width structured vector with no parser, no embedding model, and no inference step.**

Is that worth what it sounds like? Three arguments say mostly yes, and one says be careful about how the win is claimed.

1. **The generated-set case is the unseen-set case, always.** §3.6's table shows the text-inclusive representation losing 8.6 points to a 16-dimensional structured one exactly on unseen sets. A set generated tomorrow is unseen by construction, so the column where structure wins is the only column this project ever operates in.
2. **It removes a whole class of failure that every surveyed system carries.** Forge hard-codes per-card AI logic in `SpecialCardAi`; its maintainers say in their own wiki that this "isn't ideal". Magic-playing LLM harnesses re-read the oracle text every decision at roughly $1 per game. Here the effect kinds are the primitives, so the evaluator generalizes across cards that share an effect kind without ever having seen the card.
3. **It makes the containment invariant pay off twice.** The design brief's load-bearing invariant is that the generator's output space stays inside the engine's enforceable space. The same containment means the evaluator's input space is closed: there is no card the evaluator can meet whose behavior it cannot represent. No surveyed system has a closed input space.

The caution: **no published experiment ablates a parsed effect vocabulary against a text embedding on the same task**, so the size of the advantage is an inference from adjacent results (§3.6), not a measurement. The honest claim is directional — structure beats text on transfer, and this codebase has more structure than anyone whose numbers we can cite. The magnitude is a **GUESS**.

There is also a real limit worth stating so it does not get discovered later: the typed vocabulary describes what a card _does_, not what it is _worth_. `packages/dsl` carries `UNPRICED_EFFECT_KINDS` with 22 entries — effect kinds the pricing model does not value. A learned evaluator is a way to price them from outcomes, which is the point; but it means the edge is "better features", not "the answer is already in the data".

### 6.6 "The 17lands-schema log superset means the training data is already in the right shape" — **wrong**

`packages/sim/src/log/schema.ts` and `row.ts` produce a wide row per **game**, with per-turn columns of the form `{owner}_turn_{N}_{field}`, written one JSONL line per game, a superset of the 17lands replay schema with only `cards_tutored` missing. That is a match for 17lands because 17lands is a per-game draft-and-result dataset.

A value or Q network needs **(position, action, outcome) triples at every decision**. The log has none of those: it has aggregates. Nothing in the current logging path emits a per-decision record, and the wide per-turn columns cannot be inverted into one.

The edge is real but it is a different edge, and §6.4 already named it: positions are **re-derivable** from (spec, index, decision number), so the missing per-decision log is not a gap to fill by writing more data — it is a gap to fill by writing a replay-time feature extractor. `packages/sim/src/driver.ts`'s `GameOutcome` already carries `decisions`, `winner`, `turns`, `events` and the trigger and activation censuses per game, which is the label side of the pair; the feature side comes from a replay.

**What the 17lands superset is genuinely good for is calibration**, which is what `AGENTS.md` claims for it and what this report leaves untouched: joining simulated aggregates against human aggregates on identical column names. That is a validity check on the trained evaluator, not its training set.

### 6.7 The advantage nobody surveyed has: a labeled-outcome oracle that already runs

Combine the pieces and the training loop is unusually cheap here:

- **98 games/sec single-threaded**, ~8.5M games/day at 16 workers (measured, §6.2). DouZero's first-win budget of ~5x10^8 steps is days on this hardware, not a cluster-month.
- **Labels are free.** The sweep already plays games to completion and records the winner. Deep Monte-Carlo needs nothing else.
- **Positions cost storage of zero** (§6.4).
- **The metric that decides whether the evaluator helped already exists** and is already a blocking CI gate: `npm run test:balance`, 10,035 games, seeded, with a waiver ratchet.

That last one is the property this report finds most valuable and least obvious. Every surveyed system had to invent an evaluation protocol. This one has a blocking, seeded, pre-registered metric with a committed baseline, sitting in CI, built for a different purpose and directly reusable.

### 6.8 What this codebase does not have, stated so it is not discovered late

- **No per-decision feature extraction.** It has to be written (§8).
- **No training runtime.** Nothing in the workspace trains anything; that arm is offline by design (§4.3) and out of the twenty-three-package roster.
- **No opponent diversity.** `packages/sim/src/bots.ts` offers `greedy` and `random`. A Deep Monte-Carlo loop trained only against greedy learns to beat greedy — §2.4's warning with the names changed.
- **No search tier to fall back on.** The MCTS slot `prior-art-mtg-ai.md` §2.5 kept open is still empty, so a learned evaluator would be shipping without the component the poker and Hearthstone literature pairs it with.

---

## 7. The measured cost of a search here, and why it changes the recommendation

### 7.1 The decision census

Reproduced independently of `mtg-46go`'s figures, at a different seed: 200 games of the committed flagship fixture, a two-color pair against another, seed `w54-census`, greedy agents in both seats, counting every decision the kernel presented and the width of its enumerated option list.

```
priority               69359   mean  3.20   max 499   forced 43.4%
declareAttackers        1741   mean 12.57   max 512   forced  3.3%
declareBlockers          994   mean 15.37   max 448   forced 27.7%
triggerTargets           869   mean  5.93   max  19   forced  2.6%
mulligan                 482   mean  3.49   max  22   forced  0.0%
orderBlockers             40   mean  1.93   max  12   forced 32.5%
discard                    9   mean 14.22   max  36   forced  0.0%

decisions 73494   per_game 367.5
mean_width 3.621  median 2  p90 7  p99 24  max 512
forced_pct 41.4   ten_or_more_pct 3.9
incomplete_enumerations 4   at_or_over_cap 6
total_state_evaluations_for_1ply 266141
```

This confirms `mtg-46go`'s census at a different seed (its figures: 67,710 decisions, 338.6 per game, mean width 3.51, median 2, p90 7, p99 25, 42.9% forced, 4.1% ten-or-more). **The bead is right on this point.** Two facts from it drive everything below: **41.4% of decisions are forced** (one option, no evaluator needed), and the width distribution is short-tailed — median 2, p90 7 — so per-decision evaluator cost multiplies by about 3.6, not by hundreds.

Only 7 of the kernel's 16 decision kinds ever occur. The other 9 (`scry`, `searchLibrary`, `graveyardChoice`, `permanentSacrifice`, `handDiscard`, `optionalTrigger`, `may`, `unless`, `legendRule`) never came up in 200 games of this matchup, which bounds the scope of a first encoder (§3.7).

### 7.2 What 1-ply actually costs

Same decks, same seed, same 200 games, applying `reduce(view.state, option)` for every legal option at every decision and discarding the result:

```
greedy (depth 0)                 11,785 ms    17.0 games/s
greedy + apply-every-option      86,390 ms     2.3 games/s
overhead_ratio                   7.33x
applications 267,879   per_game 1,339.4   rejected 0
us_per_application               278.50
added_ms_per_game                373.02
projected serial seconds for 10,035 games:  base 591.3   1-ply 4,334.6
```

The 278.5 µs per application is about **30x** the fork bench's 9.3 µs "first reduce on a branch", and the reason is in `reduce`'s contract: it does not take one step, it **settles** — state-based actions run and every step that needs no decision advances, so it returns only when somebody owes a decision. Applying an option is therefore "advance the game until the next choice", which is the right primitive for a bot and an expensive one for a search.

`mtg-y4gw` estimated this cost from a per-decision model and undercounts it. Its conclusion nevertheless survives: 7.33x on a pinned sweep that runs in 7-10 seconds is **51-73 seconds**, which is still tens of seconds and still affordable. The bead's recommendation stands; its arithmetic should be replaced with the measurement above.

### 7.3 The inversion

Put the two costs side by side for the pinned 10,035-game sweep:

| Arm                              | Work                           | Cost                   |
| -------------------------------- | ------------------------------ | ---------------------- |
| Greedy, hand-tuned score         | —                              | 7-10 s (current)       |
| 1-ply + hand-tuned leaf          | 13.4M `reduce` applications    | **51-73 s**            |
| 1-ply + learned leaf (256x64)    | 13.4M `reduce` + 13.4M evals   | 51-73 s + ~9 s         |
| **Depth-0 action-conditioned Q** | **13.4M evals, zero `reduce`** | **~9 s at 16 workers** |

A network evaluation at 10.3 µs is **27x cheaper than the state transition** it would be scoring. That single ratio is the finding of this report: in this engine, the expensive part of lookahead is the engine, not the network.

So the standard recipe — search, with a learned function at the leaf — is the wrong first build here. DouZero's regime is the right one: **score each legal option directly from (state, option), take the argmax, never call `reduce` speculatively at all.** It costs about 9 seconds on the pinned sweep, it needs no search infrastructure, it needs no MCTS tier, and §2.2 shows it reaching first place in a large imperfect-information card game without search at inference.

The 1-ply arm remains worth having as a **baseline to beat**, not as the destination. If a depth-0 learned scorer cannot beat 1-ply with a hand-tuned leaf on identical seeds, the encoding is wrong and that is worth knowing for 60 seconds of compute.

---

## 8. The build this evidence supports

Sketched at the level `mtg-bw8z` needs to be scoped, and no further. Package placement follows the existing layering; nothing here adds a dependency to `@mtg/kernel` or `@mtg/engine`.

1. **A feature extractor over `AgentView`.** Pure function, `AgentView -> Float64Array`, in `@mtg/sim`. Encoding per §3.8: ≤20 canonically-sorted masked permanent slots per side, scalar channels, DeepNash-style hidden-zone arithmetic, plus the candidate-action block of §3.7. It reads the typed DSL vocabulary (§6.5), and it fails loudly when the vocabulary snapshot changes.
2. **A replay-time dataset emitter.** Consumes (spec, index) triples, replays with `replaySession`, emits (features, action features, final outcome) per decision, skipping `complete === false` (§6.3) and skipping forced decisions (41.4% of the total, and no gradient in any of them).
3. **An offline trainer, outside the workspace.** Any language, any hardware, any nondeterminism. Deep Monte-Carlo per §2.2: label every (state, action) with the game's final result, regress, iterate against a frozen opponent pool.
4. **A weights artifact committed as exact float64**, and a TypeScript forward pass with a fixed summation order, ReLU only, no `Math.exp` anywhere on the decision path (§4.4).
5. **A `BotSpec` variant.** `packages/sim/src/bots.ts` already types `AgentFactory = (spec, seed, seat) => PlayerAgent` with `BotSpec` as plain data, and `RunOptions.agentFactory` in `packages/sim/src/runner.ts` is documented as _"the seam an MCTS tier or an LLM pilot plugs into"_. The learned agent is a third `BotSpec` kind. No seam needs building.
6. **A gate that compares arms rather than replacing one.** Run the balance sweep with the learned bot and the greedy bot on identical seeds and report both. §2.4 is the reason: an evaluator trained by self-play can move a playability verdict by changing the players rather than by measuring the set, and the only defense is to keep both readings visible.

Opponent diversity (§6.8) is the risk that most needs a decision before step 3, and it is the one thing in this list that has no cheap answer.

---

## 9. Sources

| Artifact                                                                                                                                             | License / type (verified 2026-08-21)                 | Status         | Verdict                   | Why it is here                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Forge](https://github.com/Card-Forge/forge)                                                                                                         | GPL-3.0                                              | active         | **inspire**               | The reference hand-tuned evaluator; `DEFAULT_MAX_DEPTH = 3` and `CreatureEvaluator`'s base 80 read from the shipped 2.0.14 jar with `javap` |
| [XMage](https://github.com/magefree/mage)                                                                                                            | MIT                                                  | active         | **inspire**               | Second independent hand-tuned evaluator; nonlinear life table; a real UCT plugin with no network                                            |
| [Magarena](https://github.com/magarena/magarena)                                                                                                     | GPL-3.0                                              | dead 2023      | **inspire**               | Four searches over one scoring system — the orthogonality proof                                                                             |
| [Cockatrice](https://github.com/Cockatrice/Cockatrice)                                                                                               | GPL-2.0                                              | active         | **skip**                  | No rules engine, no bots; the survey's negative space                                                                                       |
| [MageZero](https://github.com/WillWroble/MageZero)                                                                                                   | MIT                                                  | alpha, 2026-06 | **inspire**               | The only learned Magic evaluator found; results unreplicated                                                                                |
| [mage-bench](https://github.com/GregorStocks/mage-bench)                                                                                             | **NOASSERTION** (no LICENSE file at time of reading) | active         | **inspire**               | LLM-pilot cost data; license flagged because it is not what the earlier report recorded                                                     |
| [DouZero](https://github.com/kwai/DouZero) ([arXiv:2106.06135](https://arxiv.org/abs/2106.06135))                                                    | Apache-2.0 / ICML 2021                               | active         | **adopt (regime)**        | Action-conditioned Q, Deep Monte-Carlo, no search at inference                                                                              |
| [PerfectDou](https://arxiv.org/abs/2203.16406)                                                                                                       | paper, NeurIPS 2022                                  | —              | **inspire**               | Perfect-information features at training time only                                                                                          |
| [DeepStack](https://www.science.org/doi/10.1126/science.aam6960)                                                                                     | paper, Science 2017                                  | —              | **inspire**               | Separation of label oracle from network; 21M situations, ~175 core-years                                                                    |
| [Libratus](https://www.science.org/doi/10.1126/science.aao1733) / [Pluribus](https://www.science.org/doi/10.1126/science.aay2400)                    | papers, Science                                      | —              | **skip**                  | No neural network; the counterexample to "you need a net"                                                                                   |
| [ReBeL](https://github.com/facebookresearch/rebel) ([arXiv:2007.13544](https://arxiv.org/abs/2007.13544))                                            | Apache-2.0 / paper                                   | —              | **skip**                  | Public belief states have no Magic counterpart; 720 V100s                                                                                   |
| [Player of Games](https://arxiv.org/abs/2112.03178)                                                                                                  | paper                                                | —              | **skip**                  | Same belief-state dependence                                                                                                                |
| [DeepNash](https://www.science.org/doi/10.1126/science.add4679)                                                                                      | paper, Science 2022                                  | —              | **adopt (technique)**     | Belief channels as arithmetic over legality, not as a solved posterior                                                                      |
| [Hanabi Learning Environment](https://github.com/google-deepmind/hanabi-learning-environment) ([arXiv:1902.00506](https://arxiv.org/abs/1902.00506)) | Apache-2.0 / paper                                   | active         | **inspire (hazard)**      | Self-play convention brittleness, quantified                                                                                                |
| Świechowski et al. 2018, Hearthstone value net                                                                                                       | paper                                                | —              | **inspire**               | 750-dim input, 256/128/64, 3.5M samples, 0.76 val accuracy                                                                                  |
| Long et al., [when PIMC works](https://ojs.aaai.org/index.php/AAAI/article/view/7562)                                                                | paper, AAAI 2010                                     | —              | **inspire**               | Disambiguation factor and bias; the determinization trap                                                                                    |
| [AlphaZero](https://www.science.org/doi/10.1126/science.aar6404)                                                                                     | paper, Science 2018                                  | —              | **inspire**               | 44M self-play games as the scale reference                                                                                                  |
| [AlphaStar](https://www.nature.com/articles/s41586-019-1724-z)                                                                                       | paper, Nature 2019                                   | —              | **inspire**               | Entity transformer + pointer network; 139M params, 12 x 32 TPUv3 x 44 days                                                                  |
| [gym-locm](https://github.com/ronaldosvieira/gym-locm) ([doi:10.1016/j.entcom.2022.100526](https://doi.org/10.1016/j.entcom.2022.100526))            | MIT / paper                                          | active         | **inspire**               | Set Transformer vs flat MLP: "unexpectedly similar win rates"                                                                               |
| [DeepSets](https://arxiv.org/abs/1703.06114) / [Set Transformer](https://arxiv.org/abs/1810.00825)                                                   | papers                                               | —              | **inspire**               | Permutation invariance, if sorted slots stop being enough                                                                                   |
| [MTG-Causal-RL](https://arxiv.org/abs/2605.06066)                                                                                                    | paper, 2026                                          | —              | **inspire**               | The one published Magic observation/action encoding: 3,077-dim, 478 masked actions                                                          |
| [Bertram et al. 2024](https://arxiv.org/abs/2407.05879)                                                                                              | paper                                                | —              | **adopt (finding)**       | 16 structured features 42.14% on unseen sets vs 33.57% for 1,306 text-inclusive                                                             |
| [DraftEncoder](https://arxiv.org/abs/2607.04782)                                                                                                     | paper, 2026                                          | —              | **inspire**               | ρ 0.0879 text-only to 0.1529 with structured features                                                                                       |
| [UrzaGPT](https://arxiv.org/abs/2508.08382)                                                                                                          | paper, 2025                                          | —              | **inspire**               | Pure-text ceiling: 43% zero-shot, 66.2% LoRA                                                                                                |
| [onnxruntime#4611](https://github.com/microsoft/onnxruntime/issues/4611)                                                                             | issue, open since 2020                               | open           | **skip**                  | CUDA EP nondeterminism, unresolved                                                                                                          |
| [llama.cpp#16016](https://github.com/ggml-org/llama.cpp/pull/16016)                                                                                  | PR                                                   | **open**       | **skip**                  | Deterministic CUDA mode is not shipped                                                                                                      |
| Thinking Machines, "Defeating Nondeterminism in LLM Inference" (Sept 2025)                                                                           | article                                              | —              | **inspire (as evidence)** | 1,000 identical temp-0 requests, 80 distinct completions; batch-invariant kernels cost 1.6-2.1x                                             |
| [PyTorch reproducibility notes](https://pytorch.org/docs/stable/notes/randomness.html)                                                               | docs                                                 | —              | **interop**               | The flag list in §4.2, and the statement that results are not guaranteed across hardware                                                    |
| [WebAssembly core spec](https://webassembly.github.io/spec/core/)                                                                                    | spec                                                 | —              | **interop**               | No FMA contraction, no non-default rounding — the fallback if TS gets too slow                                                              |

Measurements from this repository, all taken 2026-08-21 in the lane worktree: `npx tsx packages/kernel/bench/fork-bench.ts` (§6.2); a 200-game census and a 200-game apply-every-option run over the committed flagship fixture with greedy agents at seed `w54-census` (§7.1, §7.2); a hand-rolled MLP microbenchmark under Node v22.22.2 (§4.3); parameter counts read from `packages/sim/src/config.ts` and `packages/deckbuild/src/config.ts` (§1.6); vocabulary counts read from `packages/dsl/data/vocabulary-snapshot.json` (§6.5); `nvidia-smi` for the GPU inventory (§5).

---

## 10. What no test in this checkout can settle

Marked as `prior-art-tooling.md` and [ADR-0003](../adr/0003-draftmancer-rating-scale.md) mark theirs.

1. **How much a typed effect vocabulary beats a text embedding.** §3.6's numbers are from draft-pick prediction on real sets with 17lands labels, not from position evaluation on generated sets. The direction is well supported; the magnitude here is a guess.
2. **Whether a learned evaluator improves the playability verdict at all.** It could plausibly make bots stronger and the balance signal worse (§2.4). Nothing settles this short of running both arms.
3. **DouZero's sample budget transferring.** ~5x10^8 steps was enough for Dou Dizhu. Magic's branching, hidden information and card heterogeneity are all larger. The extrapolation in §2.7 is arithmetic on throughput, not evidence about learnability.
4. **MageZero's 16%-to-66% claim.** Single author, no paper, no replication.
5. **Whether ≤20 permanent slots per side is enough.** No census of maximum simultaneous permanents was taken in this lane. The 200-game sample reached 512-wide attack enumerations, which implies boards well past 9 creatures at least once.
6. **The local-LLM latencies in §5.1.** They are literature-derived per-token rates applied to an assumed prompt and response length for this decision format, not measured on this machine. The conclusion is robust to being wrong by an order of magnitude in either direction; the specific day counts are not.
7. **Whether ONNX Runtime's CPU execution provider is bit-exact across machines.** Observed to be, documented nowhere. Treated as unusable for that reason rather than because it failed.
8. **Whether a history channel adds anything** above graveyard and exile features (§3.5).

---

## 11. Recommendations

**Build first, in this order.**

1. **The feature extractor and the dataset emitter** (§8.1, §8.2). They are pure functions, they are testable, they need no training runtime, and they are prerequisites for every arm including the 1-ply one. This is the whole of the unblocked scope for `mtg-bw8z`.
2. **A depth-0 action-conditioned Q network in DouZero's regime** (§2.2, §7.3) — not 1-ply with a learned leaf. One evaluation per legal option, argmax, no speculative `reduce`. Measured budget: ~13.4M evaluations for the pinned sweep, about 9 seconds across 16 workers.
3. **Pure-TypeScript float64 inference with a fixed summation order and ReLU only** (§4.3, §4.4). Bit-exactness across machines is a hard requirement of the balance gate, and this is the only surveyed option that has it by construction rather than by observation.
4. **Both-arms reporting on the balance gate** (§8.6) before the learned arm is allowed to move a verdict.

**Refuse.**

- **The local-LLM arm for the play loop, the mass sweep and mulligans** (§5). 30 to 128 days against a 7-10 second gate, and no shipped bit-exact local runtime. A small purpose-trained network wins on latency, reproducibility, set-specificity and cost simultaneously. Keep an offline spot-check for draft picks and nothing else.
- **GPU inference anywhere on the gate path** (§4.2). TF32 varies across GPU generations, TensorRT autotunes at build time, ONNX Runtime's CUDA EP has had an open nondeterminism issue since 2020. Train on the card; do not infer on it.
- **A graph neural network over the board** (§3.4). The relations are already symbolically resolved by the layer system, attachment depth is ≤2, and no published card-game GNN exists to borrow from.
- **A Set Transformer as the first encoder** (§3.3). The one controlled card-game comparison reports it tying a flat MLP. Sorted masked slots first; revisit only if slot ordering shows up as an error mode.
- **Belief-state solving in the poker style** (§2.1). Magic has no representable public belief state; use DeepNash-style arithmetic channels instead.
- **Training positions as a stored dataset** (§6.4). Positions are re-derivable from (spec, index, decision number) at 98 games/sec; storing them buys nothing and freezes the encoding.

**Corrections to file against the beads that motivated this lane.**

- `mtg-46go`'s "event-sourced rollback is free" should become "immutable reduce with structural sharing makes forking free" — `undoTo` replays a prefix and is O(n) (§6.2).
- `mtg-46go`'s "the 17lands-schema log means the training data is in the right shape" is wrong; the log is per-game aggregates, and the real property is that positions are re-derivable (§6.6).
- `mtg-46go`'s "complete legal enumeration" needs the 512-cap qualification and the 0.005% measured incidence (§6.3).
- `mtg-y4gw`'s per-decision cost model undercounts; the measured 1-ply overhead is 7.33x, 278.5 µs per option application, because `reduce` settles rather than steps (§7.2). Its verdict is unchanged.
- [`prior-art-mtg-ai.md`](prior-art-mtg-ai.md) §2.1 calls Forge's simulation AI "1-ply"; the shipped 2.0.14 jar declares `DEFAULT_MAX_DEPTH = 3` with a recursion stack (§1.1).
- `prior-art-mtg-ai.md` §6 records mage-bench as MIT. As read on 2026-08-21 the repository carries no LICENSE file and GitHub reports NOASSERTION; the MIT text quoted in the earlier report appears in the README rather than in a license file. Worth re-verifying before anything is taken from it.

**Open questions handed to other lanes.**

- Opponent diversity for self-play (§6.8): training against `greedy` alone reproduces §2.4's failure with different names, and neither a frozen-checkpoint pool nor a population scheme is scoped anywhere yet.
- A census of maximum simultaneous permanents, to size the slot budget in §3.8.
- Whether the 9 never-observed decision kinds (§7.1) are rare or unreachable in the current card pool — the answer changes whether the encoder needs them at all.
