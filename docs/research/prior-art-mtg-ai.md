# Prior art: MTG AI — game-playing, drafting, deck-building, LLM generation

Researched 2026-08-09 for the MTG Set Generation & Playing Lab ([design brief](../design-brief.md)).
Scope: game-playing AI, draft bots, deck-building AI, and LLM/NN card & set generation.
Every license below was read from the repository's license metadata or LICENSE file on the day of research, not from memory. Engine selection itself (Forge vs custom TS kernel vs hybrid) is a separate lane; this report covers engines only as AI substrates.

Verdict legend: **adopt** = use the bundle as-is or lightly wrapped · **interop** = speak its format/API · **inspire** = port the pattern, not the code · **skip** = documented reason.

---

## 1. Why full-rules MTG is hard for AI (the constraints everything below lives under)

- **Undecidability at the limit.** Churchill, Biderman & Herrick embedded a Turing machine in a tournament-legal game such that determining the winner — even with _all moves forced_ — is as hard as the Halting Problem ([arXiv:1904.09828](https://arxiv.org/abs/1904.09828), 2019). No practical bot hits this, but it proves there is no complete evaluation function; every MTG AI is a heuristic over a formally unbounded state space.
- **Hidden information + stochasticity.** The opponent's hand/library are hidden and draws are random; Cowling, Ward & Powley's foundational MCTS work treats MTG explicitly as an imperfect-information game requiring determinization ([IEEE TCIAIG 2012](https://ieeexplore.ieee.org/document/6218176/), [open access](https://eprints.whiterose.ac.uk/id/eprint/75050/)).
- **Enormous, heterogeneous action space.** The 2026 MTG-Causal-RL benchmark needed a 3,077-dimensional partial observation and a 478-action _masked_ discrete action space just for five fixed Standard archetypes ([arXiv:2605.06066](https://arxiv.org/abs/2605.06066)). Real MTG actions compound: mana-payment choices × targets × ordering × stack responses.
- **The stack and priority.** Every spell/ability offers both players response windows; correct play requires reasoning about instant-speed interaction, which is precisely where scripted AIs (Forge, XMage — §2) are documented weakest.
- **Non-stationary rule surface.** Each set adds mechanics; cards _are_ rules. DraftEncoder's authors call out that MTG "has no fixed rule set since cards define gameplay dynamics" ([arXiv:2607.04782](https://arxiv.org/abs/2607.04782)). This is the core reason set-specific trained models don't transfer to custom sets — the central constraint of our lab.

**Design consequence:** rules enforcement must live in the engine, never in the agent. Every successful system below (Forge, XMage/mage-bench, Draftmancer) has the engine own legality and the bot choose among legal actions.

---

## 2. Game-playing AI

### 2.1 Forge's AI — the reference scripted-bot architecture

[Card-Forge/forge](https://github.com/Card-Forge/forge) — Java, **GPL-3.0**, ~2.6k stars, actively developed (pushed 2026-08-09).

Architecture, verified from the source tree ([`forge-ai/src/main/java/forge/ai/`](https://github.com/Card-Forge/forge/tree/master/forge-ai/src/main/java/forge/ai)):

- **`AiController`** is the top-level decision maker; **`PlayerControllerAi`** adapts it to the game's player interface.
- **Per-effect heuristics:** `SpellAbilityAi` subclasses under `ability/`, dispatched by `SpellApiToAi` — one heuristic class per scripted effect API (the same API layer Forge's card scripts target). `SpecialCardAi` / `SpecialAiLogic` hold hard-coded logic for iconic cards.
- **Shared evaluators:** `ComputerUtil*` (combat, mana, cost, card quality), `CreatureEvaluator` — hand-written scoring functions.
- **Combat is specialized:** `AiAttackController` / `AiBlockController` solve attack/block assignment separately from spell casting.
- **A bolt-on lookahead simulation AI:** the [`simulation/`](https://github.com/Card-Forge/forge/tree/master/forge-ai/src/main/java/forge/ai/simulation) package (`GameCopier`, `GameSimulator`, `GameStateEvaluator`, `SpellAbilityPicker`, `SpellAbilityChoicesIterator`, `Plan`) copies the game, tries candidate spell abilities (including multi-target enumeration via `PossibleTargetSelector`), scores resulting states, and picks the best plan. This is opt-in per AI profile (`AiProfileUtil`, `AiProps` — personality profiles are text files).

> **Correction, 2026-08-21 (`mtg-46go`).** This section called that simulation AI "1-ply" and it is not. `javap` against the shipped 2.0.14 jar reads `GameSimulator.DEFAULT_MAX_DEPTH = 3`, and `CreatureEvaluator`'s base value is 80. The rest of the description holds. The correction matters because the tiering argument below compares our proposed bots against Forge's: the reference scripted bot searches deeper than this report assumed, so "match Forge" is a higher bar than the recommendations in §2.5 and §7 were priced against. It does not change the verdict, which rests on the license and the process boundary.

- **Headless mass sim exists:** [`SimulateMatch.java`](https://github.com/Card-Forge/forge/blob/master/forge-gui-desktop/src/main/java/forge/view/SimulateMatch.java) implements a `sim` CLI for GUI-less AI-vs-AI matches and tournaments (Swiss/RoundRobin/Bracket per the [Forge wiki AI page](https://github.com/Card-Forge/forge/wiki/AI)).

Documented strengths/limits (from the [wiki AI page](https://github.com/Card-Forge/forge/wiki/AI)): the AI is **not machine-trained** — "basic rules" and heuristics split between effect APIs and in-game decisions; it plays aggro/midrange best and "struggles significantly with control and combo"; games slow down badly when the AI has heavy calculations; maintainers explicitly invite ML replacements and note per-card hard-coding "isn't ideal."

Two ecosystem notes: [thesilencelies/LearnForge](https://github.com/thesilencelies/LearnForge) (RL on Forge) is dead — no license, last pushed 2021, 7 stars; a [slightlymagic.net forum thread](https://slightlymagic.net/forum/viewtopic.php?f=52&t=18164) proposed genetic-algorithm deck building over Forge's simulator but no maintained artifact came of it.

**Verdict: interop.** GPL-3.0 makes source-level adoption into a TS codebase viral; but the headless `sim` CLI is a process boundary — usable as a calibration oracle / baseline opponent for real-card decks without license contamination. The AI's _shape_ (per-effect heuristics + shared evaluators + specialized combat + opt-in depth-3 sim + personality profiles) is the proven template for our scripted tier.

### 2.2 XMage — MIT engine, minimax-flavored AI, and the mage-bench LLM harness

[magefree/mage](https://github.com/magefree/mage) — Java, **MIT**, ~2.3k stars, active. AI lives in server plugins (verified paths): `Mage.Player.AI` (base `ComputerPlayer`), `Mage.Player.AI.MAD` (`ComputerPlayer6`/`ComputerPlayer7` — the "MAD" AI used in practice), and a dormant `Mage.Player.AIMCTS` plugin (`ComputerPlayerMCTS`, `MCTSExecutor`). Community consensus (e.g. [Draftmancer discussion](https://github.com/Senryoku/Draftmancer/discussions/762), mage-bench's choice to benchmark LLMs _against_ it) is that XMage's AI is weaker than Forge's; its value here is the MIT license and full rules enforcement for 28k+ cards.

**[GregorStocks/mage-bench](https://github.com/GregorStocks/mage-bench)** ([mage-bench.com](https://mage-bench.com/)) — **MIT** (LICENSE read verbatim: "MageBench code and data — MIT License, Copyright (c) 2026 Gregor Stocks"; XMage's MIT license appended), Java + Python, active (pushed 2026-08-08), announced [Show HN Feb 2026](https://news.ycombinator.com/item?id=47049227). The most complete LLM-plays-full-rules-MTG system to date:

- **Three-layer architecture** (from the README): unmodified XMage server (rules enforcement) → Java bridge clients exposing the game as **MCP tools** (board state in, actions out) + an observer client for JavaFX rendering/FFmpeg video → a Python "puppeteer" orchestrating processes, LLM connections, costs, recordings.
- **Player types:** LLM "Pilot", non-LLM "Sleepwalker" auto-player for infra tests, and XMage's built-in `COMPUTER_MAD` as CPU baseline.
- **Results:** Season 2 at research time: 36 models, 214 games; top Elo — Claude Opus 4.6 (1747), GPT-5.2 (1737), GPT-5.3 Codex (1728), Gemini 3 Pro (1722), DeepSeek V3.2 (1696) ([mage-bench.com](https://mage-bench.com/)). Formats: Standard/Modern/Legacy metagame decks from MTGGoldfish, Jumpstart, Commander precons.
- **Documented failure modes** (author's own words in the [HN thread](https://news.ycombinator.com/item?id=47049227)): "even reasonably-expensive models today are making tons of blunders that a tournament grinder wouldn't"; ~**$1+/game** at current harness efficiency; LLMs "don't always understand the strategy of weird decks like Doomsday or Mill"; Commander pilots ignore table politics and treat chat as a monologue. An earlier reviewer of LLM Legacy games judged play level so low the results were barely valid, with models fumbling mulligans ([search corroboration](https://news.ycombinator.com/item?id=47049227)).

> **Correction, 2026-08-21 (`mtg-46go`).** The mage-bench license above was read verbatim at research time and could not be re-read on this date: the repository has no LICENSE file and GitHub reports NOASSERTION. Either it was removed or it was renamed. Treat mage-bench as unlicensed until somebody re-reads it. Nothing here depends on that: the verdict is **inspire**, we port a pattern rather than code, and §2.5 item 2 rules mage-bench out of our mass-sim tier on cost regardless.

**Verdicts:** XMage: **interop** (MIT baseline opponent + the engine mage-bench needs). mage-bench: **inspire** (port the MCP-bridge + puppeteer pattern for our LLM strategy layer over _our_ engine; also runnable as-is to baseline LLM piloting skill on real cards — its XMage binding and real-card pool keep it from being our in-lab harness).

### 2.3 Magarena — MCTS over a scripted engine, proven but unmaintained

[magarena/magarena](https://github.com/magarena/magarena) — Java, **GPL-3.0**, 444 stars, **last pushed 2023-04-24** (unmaintained). Ships multiple swappable AIs (verified in [`src/magic/ai/`](https://github.com/magarena/magarena/tree/master/src/magic/ai)): `MCTSAI`, `MMAB` (minimax alpha-beta), `MTDF`, `VegasAI` (Monte Carlo sampling), over a hand-scripted ~5k-card subset with a shared `ArtificialScoringSystem`. Magarena is the existence proof that **MCTS plays usable MTG when the engine is fast, the card pool is curated, and choices are pre-pruned** — exactly the regime of our custom-set sim (small enforceable DSL, seeded sims).

**Verdict: inspire** (GPL + dead + Java rule out reuse; the "pluggable AI over a scripted kernel with one shared scoring system" design maps directly onto our TS kernel).

### 2.4 Academic game-playing work

| Work                                                                    | What it shows                                                                                                                                                                                                           | Source                                                                                                        |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Cowling, Ward & Powley 2012, _Ensemble Determinization in MCTS for MTG_ | MCTS + multiple perfect-information determinizations + domain-knowledge move pruning yields "significant improvements in playing strength" over basic MCTS on fixed-deck MTG; binary tree decomposition tames branching | [IEEE](https://ieeexplore.ieee.org/document/6218176/), [OA](https://eprints.whiterose.ac.uk/id/eprint/75050/) |
| Cunha, Mian, French & Liu 2026, _MTG-Causal-RL_                         | Gymnasium benchmark, 3,077-dim obs / 478 masked actions / 5 Standard archetypes; masked PPO and causal-PPO beat random but the benchmark exists precisely because credit assignment in MTG defeats vanilla RL           | [arXiv:2605.06066](https://arxiv.org/abs/2605.06066)                                                          |
| Churchill, Biderman & Herrick 2019                                      | Turing-completeness ⇒ no complete evaluator exists                                                                                                                                                                      | [arXiv:1904.09828](https://arxiv.org/abs/1904.09828)                                                          |
| Ferreira et al. 2025, LLM dynamic difficulty adjustment in MTG          | GPT-4o vs GPT-4o with one player as a difficulty-balancing agent — LLMs used as _experience managers_, not just competitors (paywalled abstract)                                                                        | [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1875952125000771)                      |

**Verdicts:** Cowling 2012: **inspire** (ensemble determinization + pruning is the upgrade path if our greedy sim tier proves too weak). MTG-Causal-RL: **inspire** (masked-action Gym wrapper pattern for any future RL tier; its simplified engine and archetype lock make direct use pointless for custom sets).

### 2.5 What this means for our tiered bots

1. **Scripted mass-sim tier:** Forge's decomposition (effect-level heuristics + shared evaluators + separate combat solver + optional depth-3 lookahead with a state evaluator) is the proven baseline; Magarena shows MCTS is reachable on a fast scripted kernel. Start greedy + 1-ply (the prior project `combatLengthSim` pattern scales up), keep an MCTS slot open. **Superseded in part, 2026-08-21:** `prior-art-learned-evaluators.md` measures the two halves of that plan on this kernel and finds the search expensive and the network nearly free — applying every legal option once per decision costs 7.33x a greedy run, while a float64 MLP scoring one option costs 10.3 us, 27x less than the state transition it replaces. So the tier after greedy is a depth-0 action-conditioned Q network scoring each legal option directly, not 1-ply lookahead; `mtg-bw8z` carries it and `mtg-y4gw` carries the lookahead arm it displaces.
2. **LLM strategy tier:** mage-bench validates the exact interface we planned — engine-enforced legality, LLM choosing among presented legal actions via tools — and quantifies why LLMs cannot be the mass-sim tier (~$1/game, frequent blunders). Use LLMs where mage-bench's data says they add judgment: mulligans, deck/draft decisions, post-game review — matching our locked tiering decision.
3. **Full-rules piloting strength is not required for playtesting signal.** Forge's AI is mediocre at control/combo yet Forge remains the community's deck-testing default; our playability metrics (win-rate bands, curve, interaction density) need _consistent_ bots more than _strong_ ones — but archetype-asymmetric bot skill (aggro easy, control hard) is a documented confounder to calibrate against 17lands baselines.

---

## 3. Draft bots

### 3.1 Draftsim / Ward et al. 2020 — the baseline taxonomy

["AI solutions for drafting in Magic: the Gathering"](https://arxiv.org/abs/2009.00655) (Ward, Brooks, Troha, Mills, Khakhalin, 2020) compared, on 100k+ human drafts collected by [Draftsim](https://draftsim.com): a random bot, a rare-drafting bot, Draftsim's expert-tuned heuristic (rating + color-commitment bonuses), a Naive Bayes co-occurrence bot, and a neural net trained on picks. **NNet > Bayes ≈ expert-tuned > simple heuristics.** Companion code: [khakhalin/MTG](https://github.com/khakhalin/MTG) (**no license**, dead 2021); the **draft data is CC BY 4.0** ([draftsim.com/draft-data](https://draftsim.com/draft-data/), license stated in the repo README). Draftsim's practical bootstrap for brand-new sets is the expert-tuned heuristic over hand-assigned ratings — the zero-data path every production system uses (see also Draftsim's [bot comparison writeup](https://draftsim.com/draftsim-bot-drafting-paper/)).

**Verdict: inspire** (agent taxonomy + evaluation protocol; unlicensed code blocks porting; CC BY 4.0 data usable for cross-checks).

### 3.2 RyanSaxe/MagicDraftBot — interpretable archetype model

[RyanSaxe/MagicDraftBot](https://github.com/RyanSaxe/MagicDraftBot) (**no license**, 49 stars): KMeans-clusters drafts into archetypes, learns per-archetype pick orders, then picks via an archetype-bias vector plus a **decaying "stay open" term** simulating early-draft flexibility; author documents the failure mode of runaway color bias and the fix attempts, and that per-card synergy (beyond archetype membership) was the missing piece ([README](https://github.com/RyanSaxe/MagicDraftBot), [math writeup](https://draftsim.com/ryan-saxe-bot-model/)). This work fed the original CubeCobra bot design.

**Verdict: inspire** (the decaying-openness + archetype-bias mechanism is cheap, interpretable, and needs only per-archetype pick orders — derivable from self-play for a custom set).

### 3.3 CubeCobra / CubeArtisan — the production ML draft bots

- [dekkerglen/CubeCobra](https://github.com/dekkerglen/CubeCobra) — **Apache-2.0**, active (pushed 2026-08-09). Current bots verified from source ([`packages/client/src/utils/draftBot.ts`](https://github.com/dekkerglen/CubeCobra/blob/master/packages/client/src/utils/draftBot.ts)): TensorFlow.js in the browser; pools one-hot encoded over oracle IDs → shared **encoder** → **draft_decoder** (pick logits masked to pack), **deck_build_decoder** (seeds a deck from pool, then iteratively fills via the draft decoder), and a lazily-loaded **cube_decoder** recommender head; ~70 MB model bundle served from CDN; server mirrors the same logic ([`packages/server/.../draftbots/`](https://github.com/dekkerglen/CubeCobra/tree/master/packages/server/src/router/routes/api/draftbots)). Trained on CubeCobra's own human cube-draft picks (the [DraftBot primer](https://cubecobra.com/content/article/5f946f71e8f97310047fe794) describes the design; page is an SPA and resists scraping — architecture above is from code, which is authoritative). Model _weights_ carry no visible license (CDN-served); training pipeline repo [dekkerglen/CubeCobraML](https://github.com/dekkerglen/CubeCobraML) has **no license**.
- [CubeArtisan/mtgdraftbots](https://github.com/CubeArtisan/mtgdraftbots) — C++, **AGPL-3.0**, 3 stars, last pushed 2024-01; the older CubeCobra-lineage bot service Draftmancer still queries as a fallback. Companion [draftbot-model](https://github.com/CubeArtisan/draftbot-model) has **no license**.

**Verdicts:** CubeCobra: **interop** (Apache-2.0 client/server bot code is portable and its bot API is already a Draftmancer backend; but models are trained on _existing-card_ human picks — unusable for custom sets, and weight licensing is unclear). mtgdraftbots: **skip** (AGPL, dormant, superseded by CubeCobra's in-repo bots).

### 3.4 Statistical Drafting — the cleanest open 17lands pick model

[danieljbrooks/statistical-drafting](https://github.com/danieljbrooks/statistical-drafting) — **MIT**, Python/PyTorch, active (pushed 2026-07-09), by a co-author of the Draftsim paper. Per [statisticaldrafting.com/about](https://statisticaldrafting.com/about): a small MLP taking (collection vector, pack vector) → card ratings; BatchNorm + dropout; ~20 min CPU training per set; trained on 17lands public data filtered to high-win-rate players; **~70% agreement with top-player picks**; weights exported to ONNX and run client-side ([site repo](https://github.com/danieljbrooks/statistical-drafting-website)).

**Verdict: adopt** (MIT, tiny, reproducible: this is our 17lands-calibration pick model _and_ the architecture to retrain on self-play picks for custom sets — same shape, different data source).

### 3.5 Draftmancer — the draft simulator and its bots

[Senryoku/Draftmancer](https://github.com/Senryoku/Draftmancer) — TypeScript, **MIT**, active. Bot design verified from [`src/Bot.ts`](https://github.com/Senryoku/Draftmancer/blob/master/src/Bot.ts):

- **`SimpleBot` fallback:** `score = card.rating + 0.35 × (count of already-picked cards in each of the card's colors)`, argmax with random tie-break. That's the whole algorithm — it needs only a per-card `rating`.
- **External bot chain** ([`src/bots/`](https://github.com/Senryoku/Draftmancer/tree/master/src/bots)): DraftmancerAI service (per-set models) → CubeCobra bots → CubeArtisan mtgdraftbots API, behind a common `ExternalBotInterface`.
- **The custom-card cliff, in code:** `fallbackToSimpleBots()` returns true — no ML bot at all — whenever any custom card lacks an oracle ID. **Every existing ML draft bot service dead-ends on custom sets; the fallback for custom content is ratings + color affinity.**

**Verdict: adopt** (MIT TS draft engine with pluggable bots — our draft lab can adopt Draftmancer outright or lift its draft-state machinery; and its `ExternalBotInterface` is the natural seam to plug our own bot service into).

### 3.6 Academic drafting

- **Bertram, Fürnkranz & Müller 2024, [_Learning With Generalised Card Representations_](https://arxiv.org/abs/2407.05879)** (IEEE CoG 2024, best-paper nominee): compares numerical/categorical/text/image card representations for pick prediction; representation choice barely matters on _known_ cards but a generalized model predicts **55% of human choices on completely unseen cards**. This is the single most important academic result for our zero-data problem: feature/text-based card representations transfer across card pools.
- **Bertram et al. 2024, [Contextual InfoNCE](https://arxiv.org/abs/2407.05898):** CLIP-style contrastive loss adapted to "picked one over a set" preference data; beats triplet-loss approaches for card/pool embeddings.
- **Bertram 2025, [UrzaGPT](https://arxiv.org/abs/2508.08382):** LLMs as draft bots — untuned Llama-3-8B "completely unable to draft"; **GPT-4o zero-shot 43%** pick agreement; LoRA-tuned open model **66.2%**, still below specialized models (~70%, §3.4), but set-agnostic and update-friendly.
- **Vieira, Tavares & Chaimowicz 2023, [drafting RL in CCGs](https://doi.org/10.1016/j.entcom.2022.100526)** (Entertainment Computing; earlier [SBGames 2020](https://doi.org/10.1109/sbgames51465.2020.00018)): RL drafting on the research CCG _Legends of Code and Magic_ — evidence that draft policies can be learned from win-signal alone (self-play), no human picks, when the game loop is cheap.
- **Rigaux & Kashima 2026, [DraftEncoder](https://arxiv.org/abs/2607.04782)** (IEEE CoG 2026): set-contextualized card embeddings predicting _drafted deck strength_ from large-scale draft data; first learned benchmark for draft-outcome prediction; consistent gains over linear baselines.
- **17lands' own bot experiments:** [Simulating Draft Strategies](https://blog.17lands.com/posts/simulating-draft-strategies/) — bot personalities (stay-the-course / signal-reader / color-preference) simulated over real packs to compare strategies; conclusion: strategy payoff depends on table composition. A pattern worth copying for draft-lab experiments.

### 3.7 What transfers to a set with ZERO human pick data

Layered answer, each layer verified above:

1. **Day 0 — ratings-driven heuristic bots** (Draftmancer SimpleBot / Draftsim expert-heuristic shape). Requires only per-card ratings + color identity, which our set generator already produces as design-time power estimates. This is what every production system falls back to.
2. **Day 1 — self-play-corrected ratings.** Run mass bot-vs-bot games (our tier-1 sim), update ratings from win-rate/games-in-hand statistics (GIH WR is exactly the 17lands metric our brief plans to compute in-lab). Vieira et al. show draft policy can be learned from win signal alone.
3. **Optional — cross-set generalized model.** Train a Bertram-style model on 17lands data across many real sets using _text/feature_ card representations (not card IDs), then apply zero-shot to the custom set (~55% ceiling on unseen cards per the paper — decent bot, not expert).
4. **LLM zero-shot as the archetype-aware layer.** 43% (GPT-4o, UrzaGPT) is mediocre for pick-by-pick play but LLMs can read our set's _design intent_ (archetype descriptions from the generator) — no other approach can. Use for draft-strategy priors and pick-explanations, with layers 1–2 doing the bulk picking.

---

## 4. Deck-building AI

### 4.1 What exists

- **DeepMTG** — [GilesStrong/deep_mtg](https://github.com/GilesStrong/deep_mtg) (**Apache-2.0**, superseded) and in-production successor [deep_mtg_2](https://github.com/GilesStrong/deep_mtg_2) (**Apache-2.0**, Next+Django agentic app, pushed 2026-05); design documented in [Making Magic with LLMs](https://gilesstrong.github.io/website/ai/llms/nlp/fun/2025/02/17/Making-Magic.html) ([Show HN](https://news.ycombinator.com/item?id=43011175)). LLM chain: mana-base init → deck analysis → "what card type do I need" → embedding search over ~3,500 Standard-legal cards (each card carries an **LLM-written "summary in isolation"** to bridge structured data and semantic queries) → LLM selects from top-5 → mana-base refinement. Documented limits: "limited understanding of the game, unable to think through complex interactions"; sample deck was on-theme but ran too many colors, lacked instant-speed interaction, missed key synergies; ~10 min/deck locally.
- **CubeCobra's deck_build_decoder + cube recommender** (§3.3, Apache-2.0): the only _learned_ deck builder in production — builds a 40-card deck from a draft pool via the same encoder/decoder stack, and recommends cube additions/cuts. Trained on human cube data; existing cards only.
- **Commander Spellbook** — [SpaceCowMedia/commander-spellbook-backend](https://github.com/SpaceCowMedia/commander-spellbook-backend), **MIT** (per [About](https://commanderspellbook.com/about/): "completely free and open source under the MIT license"); PostgreSQL + Django REST + React; 30k+ curated combos; powers EDHRec's combo feature; API takes a decklist and returns contained/near-miss combos. The largest machine-readable _synergy graph_ for real cards. EDHRec itself (co-occurrence recommendations from millions of decklists) has no open data/API — usable as a mental model only.
- **Forge's deck generation:** deck-from-draft-pool heuristics and format deck generators exist inside Forge (GPL; e.g. the AI drafts and builds two-color decks — [ancient but accurate description](https://articles.starcitygames.com/articles/play-magic-against-the-computer-or-better-than-apprentice/)); community GA-over-sim proposals never shipped ([forum thread](https://slightlymagic.net/forum/viewtopic.php?f=52&t=18164)).
- **Bertram 2024** (§3.6) frames constructed deck building as preference learning and is the only academic work predicting human _construction_ choices across card pools.

### 4.2 Assessment for our "informed deck lab"

Nothing existing does "build a constructed deck from structured criteria, grounded in data." DeepMTG is the closest architectural match and its documented failure modes are the requirements list for doing it right: (a) retrieval must be paired with a **synergy source** (Commander Spellbook API for combos; co-occurrence statistics; our sim), (b) the builder needs **structural validators** (curve, color count, interaction density — cheap ZFC-compliant checks), and (c) claims must be **closed-loop tested** — our bot-vs-bot sim is precisely the missing verifier every prior deck builder lacks. CubeCobra proves pool→deck is learnable when pick data exists (post-draft deck building for our custom sets can reuse the §3.4 model shape trained on self-play).

**Verdicts:** DeepMTG: **inspire** (chain + card-summary-embedding pattern; Apache-2.0 permits code lifting but it's OpenAI-stack Python glue). Commander Spellbook: **interop** (MIT API = real-card synergy ground truth for the deck lab and for calibrating any learned synergy metric). EDHRec: **skip** (no open data/API; Spellbook covers the combo axis with a license).

---

## 5. LLM / NN card & set generation

### 5.1 The RNN era — RoboRosewater & mtgencode (2015)

Reed Milewicz ("Talcos") trained a 3×600-LSTM on MTGJSON card text; the [@RoboRosewater](https://x.com/roborosewater) account popularized the output; the [MTG Salvation thread](https://www.mtgsalvation.com/forums/magic-fundamentals/custom-card-creation/612057-generating-magic-cards-using-deep-recurrent-neural) is the primary failure-mode document. Tooling: [billzorn/mtgencode](https://github.com/billzorn/mtgencode) (**MIT**, card↔text encodings designed for NN training) and [billzorn/mtg-rnn](https://github.com/billzorn/mtg-rnn) (**no license**).

**Documented failure modes** (from the thread — these are the canonical ones and all still appear in modern LLM output):

- **Invented/illegal keywords:** "Equipped creature has fuseback"; rules-contradictory text ("Counter target spell with five toughness").
- **Incomplete mechanic implementations:** kicker costs with no "if kicked" clause; {X} costs with no X in effect.
- **Power-level absurdity:** e.g. a 4/2 flyer with upside for a single blue mana.
- **Color-pie violations:** red mana elves, white unconditional removal.
- **Type-system confusion:** planeswalker loyalty mixed with creature level-up.
- **"Superstitious" local patterns:** duration clauses appended to permanent effects.

The thread also anticipated our lab's thesis: layering a **design skeleton** (curve, rarity, mechanic distribution) over per-card generation is what set-level coherence requires, and rating-feedback loops risk reinforcing pathologies without grounded evaluation.

**Verdicts:** mtgencode: **inspire** (MIT, but its unary-number/field-symbol encodings target character-level RNNs; our DSL supersedes it — its _field-permutation and reserved-symbol discipline_ is the useful residue). mtg-rnn: **skip** (no license, obsolete).

### 5.2 The GPT-2 era — minimaxir (2019–2021)

[minimaxir/mtg-gpt-2-cloud-run](https://github.com/minimaxir/mtg-gpt-2-cloud-run) (**MIT**), [ai-generated-magic-cards](https://github.com/minimaxir/ai-generated-magic-cards) (**MIT**), [HF model card](https://huggingface.co/minimaxir/magic-the-gathering). Key documented lessons: structured card text makes GPT-2 **overfit quickly**; the fix was **randomized field-order encodings** (10 permutations per card, ~22k cards, 8h on a V100) so the model conditions on any field subset — i.e., field-conditional generation via data augmentation. Temperature sweep is documented: ≤1.0 mostly-plausible cards, 1.2 invents mechanics, ≥1.5 word salad; color pie "mostly correct" ([app page](https://minimaxir.com/apps/gpt2-mtg/)).

**Verdict: inspire** (historical; the field-conditioning insight survives as "generate against a typed schema with optional fields," which our DSL + structured output does natively).

### 5.3 The LLM era — full set pipelines and papers

- **[Coamithra/MTGAI](https://github.com/Coamithra/MTGAI)** — **no license** (all rights reserved), Python, active (pushed 2026-07-03), 1 star but the README documents the most complete set-generation pipeline yet built: setting-prose → theme/mechanic extraction with **council-reviewed mechanic design** (A/B-tested 9 review strategies) → **set skeleton generator with slot allocation matrix** → card generation (Claude Opus) through a **validation library of 8 validators + 18 auto-fixers** with validation-retry → **tiered AI review council** + balance analysis (CMC curve, removal density) → ComfyUI/Flux art with vision-based art selection → M15-frame rendering → print files. Independent convergence on our exact architecture (skeleton → DSL-validated generation → critique loops → balance analysis), including the prior project-style per-phase learnings docs.
- **Pfau & Vrettis 2026, [LLM-driven Pokémon TCG generation](https://arxiv.org/abs/2604.27972):** co-creative pipeline (local LLMs + diffusion + fine-tuned embeddings), 49-participant study, 196 cards, high user satisfaction — **but no formal balance/power evaluation at all**; players rated aesthetics/representativeness. Confirms the field-wide evaluation gap.
- **LLM rules competence (the "LLM referee" question):** fine-tuning Llama-3-8B (QLoRA) on 80k QA pairs from MTGJSON + Commander Spellbook moved GPT-4-judged rules-answer quality only from 1.62→1.79 / 5 ([Jake Boggs](https://boggs.tech/posts/large-language-models-for-magic-the-gathering/), [repo](https://github.com/JakeBoggs/Large-Language-Models-for-Magic-the-Gathering), no license) — parametric rules knowledge is weak. But a **retrieval-grounded multi-agent system** (GPT-4.1 + CR/rulings/StackExchange tools) answered ~**90%** of a 45-question rules eval vs 65% for GPT-4o without tools ([Krempl](https://medium.com/@fkrempl/evaluating-a-multi-agent-system-for-magic-the-gathering-rules-questions-d206044deef1)). Lesson for any LLM-referee component: ground it in retrieved rules text, never in weights.

**Verdicts:** MTGAI: **inspire** (no license blocks any reuse; treat its documented pipeline shape — validators+auto-fixers count, council review, skeleton slot matrix — as independent validation of our design and a checklist source). Pokémon paper: **inspire** (co-creation UX; its missing balance eval is our differentiator). Boggs / Krempl: **inspire** (dataset-construction recipe; retrieval-grounded referee pattern).

### 5.4 Consolidated LLM set-generation lessons for our lab

1. **Generate into an enforceable DSL, validate structurally, then critique semantically** — every generation of tech (RNN → GPT-2 → LLM) failed first on rules-legality; MTGAI's validator+auto-fixer+retry loop and the prior project's spec-validate-before-accept are the same answer. Our co-design invariant (output space = engine's enforceable space) eliminates the illegal-text class _by construction_.
2. **Power level cannot be judged by the generator.** Documented miscalibration from RoboRosewater through today; no prior system closes the loop with simulation. Our balance-as-CI (seeded sims, win-rate bands) is the genuinely novel contribution — nothing in the prior art does sim-grounded power calibration of generated cards.
3. **Set-level coherence needs a skeleton, not sampling.** Anticipated in 2015, implemented by MTGAI (slot allocation matrix); per-card generation alone produces incoherent as-fan and parasitic mechanic clusters. Generate skeleton → fill slots → check set-level stats (curve, as-fan, archetype support density).
4. **Parasitism and color-pie drift need explicit checks.** Color-pie violation is a persistent documented failure; encode pie constraints as validators (effect-type × color allowlists) and archetype-payoff ratios as set-level lint.
5. **Rules text ≠ rules knowledge.** Fine-tuning on card text barely improves rules competence; any LLM judge/referee/critic must be retrieval-grounded in the Comprehensive Rules and our DSL semantics.

---

## 6. Verdict table (all artifacts)

| Artifact                                                                                                                                    | License (verified)                                          | Status       | Verdict     | One-line reason                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Forge](https://github.com/Card-Forge/forge)                                                                                                | GPL-3.0                                                     | active       | **interop** | Headless `sim` CLI as calibration oracle/baseline across a process boundary; GPL bars source adoption into our TS code |
| [XMage](https://github.com/magefree/mage)                                                                                                   | MIT                                                         | active       | **interop** | MIT full-rules engine; the substrate mage-bench already speaks                                                         |
| [mage-bench](https://github.com/GregorStocks/mage-bench)                                                                                    | MIT at research time, NOASSERTION as read 2026-08-21 (§2.2) | active       | **inspire** | Port the MCP-bridge + puppeteer LLM-pilot pattern to our engine; run as-is only for real-card LLM baselines            |
| [Magarena](https://github.com/magarena/magarena)                                                                                            | GPL-3.0                                                     | dead 2023    | **inspire** | Pluggable MCTS/minimax over scripted kernel + one shared scoring system                                                |
| [Cowling et al. 2012](https://ieeexplore.ieee.org/document/6218176/)                                                                        | paper                                                       | —            | **inspire** | Ensemble determinization + move pruning = our MCTS upgrade path                                                        |
| [MTG-Causal-RL](https://arxiv.org/abs/2605.06066)                                                                                           | paper                                                       | 2026         | **inspire** | Masked-action Gym wrapper pattern for a future RL tier                                                                 |
| [LearnForge](https://github.com/thesilencelies/LearnForge)                                                                                  | none                                                        | dead 2021    | **skip**    | Unlicensed, abandoned, no results                                                                                      |
| [Draftsim data](https://draftsim.com/draft-data/) / [Ward et al.](https://arxiv.org/abs/2009.00655)                                         | data CC BY 4.0; code none                                   | code dead    | **inspire** | Agent taxonomy + eval protocol; data usable, code unlicensed                                                           |
| [MagicDraftBot](https://github.com/RyanSaxe/MagicDraftBot)                                                                                  | none                                                        | dormant      | **inspire** | Archetype-bias + decaying-openness mechanism, self-play-derivable                                                      |
| [CubeCobra](https://github.com/dekkerglen/CubeCobra) (bots)                                                                                 | Apache-2.0 (weights unlicensed)                             | active       | **interop** | Apache bot code + live bot API; models are existing-card-only                                                          |
| [mtgdraftbots](https://github.com/CubeArtisan/mtgdraftbots) (CubeArtisan)                                                                   | AGPL-3.0                                                    | dormant 2024 | **skip**    | AGPL + stale + superseded by CubeCobra in-repo bots                                                                    |
| [statistical-drafting](https://github.com/danieljbrooks/statistical-drafting)                                                               | MIT                                                         | active       | **adopt**   | MIT MLP pick model (~70% top-player agreement); retrain shape on self-play for custom sets                             |
| [Draftmancer](https://github.com/Senryoku/Draftmancer)                                                                                      | MIT                                                         | active       | **adopt**   | MIT TS draft engine, pluggable bots, custom-card support; SimpleBot is the zero-data fallback formula                  |
| [Bertram 2024 reps](https://arxiv.org/abs/2407.05879) / [InfoNCE](https://arxiv.org/abs/2407.05898)                                         | papers                                                      | —            | **inspire** | Text/feature card representations → 55% pick accuracy on unseen cards; the zero-data transfer method                   |
| [UrzaGPT](https://arxiv.org/abs/2508.08382)                                                                                                 | paper                                                       | 2025         | **inspire** | LLM drafting ceiling data (43% zero-shot / 66.2% LoRA) + set-agnostic fine-tune recipe                                 |
| [DraftEncoder](https://arxiv.org/abs/2607.04782)                                                                                            | paper (code license unverified)                             | 2026         | **inspire** | Set-contextualized embeddings predicting deck strength — a playability-metric candidate                                |
| [Vieira et al. 2023](https://doi.org/10.1016/j.entcom.2022.100526)                                                                          | paper                                                       | —            | **inspire** | Draft policy learnable from self-play win signal alone (LOCM)                                                          |
| [DeepMTG](https://github.com/GilesStrong/deep_mtg) / [deep_mtg_2](https://github.com/GilesStrong/deep_mtg_2)                                | Apache-2.0                                                  | active       | **inspire** | LLM deck-chain + card-summary embeddings; its failure list = our requirements list                                     |
| [Commander Spellbook backend](https://github.com/SpaceCowMedia/commander-spellbook-backend)                                                 | MIT                                                         | active       | **interop** | 30k+ combo synergy graph via REST for the deck lab                                                                     |
| EDHRec                                                                                                                                      | closed data                                                 | active       | **skip**    | No open data/API; Spellbook covers the combo axis with a license                                                       |
| [mtgencode](https://github.com/billzorn/mtgencode)                                                                                          | MIT                                                         | dormant      | **inspire** | Encoding discipline; superseded by typed DSL + structured output                                                       |
| [mtg-rnn](https://github.com/billzorn/mtg-rnn)                                                                                              | none                                                        | dead         | **skip**    | Unlicensed, obsolete tech                                                                                              |
| [minimaxir mtg-gpt-2](https://github.com/minimaxir/mtg-gpt-2-cloud-run) (+[encoder](https://github.com/minimaxir/ai-generated-magic-cards)) | MIT                                                         | dormant      | **inspire** | Field-permutation conditioning lesson; GPT-2 tech obsolete                                                             |
| [MTGAI](https://github.com/Coamithra/MTGAI) (Coamithra)                                                                                     | **none**                                                    | active       | **inspire** | Fullest set-gen pipeline on record (validators/auto-fixers/council/skeleton); no license = patterns only               |
| [Pfau & Vrettis 2026](https://arxiv.org/abs/2604.27972)                                                                                     | paper                                                       | —            | **inspire** | Co-creation UX; confirms no one does formal balance eval                                                               |
| [Boggs LLM-MTG](https://github.com/JakeBoggs/Large-Language-Models-for-Magic-the-Gathering)                                                 | none                                                        | dormant      | **inspire** | QA-dataset recipe from MTGJSON+Spellbook; shows fine-tuning ≠ rules competence                                         |
| [Krempl rules agents](https://medium.com/@fkrempl/evaluating-a-multi-agent-system-for-magic-the-gathering-rules-questions-d206044deef1)     | article                                                     | —            | **inspire** | Retrieval-grounded referee: 65%→~90% on rules eval                                                                     |

---

## 7. Recommendations

**For the tiered bot architecture (locked decision, now evidence-backed):**

1. **Tier 1 (scripted mass-sim):** Forge-shaped decomposition on our TS kernel — per-effect heuristics + shared evaluators + dedicated combat solver + optional depth-3 `GameStateEvaluator` lookahead; personality via config profiles (Forge `AiProps` pattern). Keep a Magarena-style pluggable-AI seam so MCTS (with Cowling-style determinization) can slot in if greedy bots distort playability metrics.
2. **Tier 2 (LLM strategy):** mage-bench's contract — engine owns legality, LLM picks among presented legal actions via tools — applied only at high-leverage decision points (mulligans, draft picks, deck builds, game reviews). Budget expectation from mage-bench: ~$1/full-game piloting; do not put LLMs in the inner sim loop.
3. **Draft lab:** adopt/interop Draftmancer (MIT, TS, custom-card aware); bots per the zero-data ladder in §3.7 — ratings heuristic → self-play-corrected ratings → statistical-drafting-shaped MLP on self-play picks → optional Bertram-style cross-set text-feature model calibrated on 17lands.
4. **Deck lab:** DeepMTG-style criteria→retrieval→selection chain, plus Commander Spellbook interop for real-card synergy, plus structural validators, with our sim as the closed-loop verifier no prior deck builder had.

**For LLM set generation:** the five lessons in §5.4 — DSL-constrained generation, sim-grounded power calibration (our novel contribution), skeleton-first set structure, explicit color-pie/parasitism lint, retrieval-grounded rules judgment.

**Risks:** GPL/AGPL contamination if engine-side code crosses into our TS tree (keep Forge behind a process boundary); 17lands-trained anything degrades on novel mechanics (self-play distribution ≠ human play — calibrate deltas on real sets first); LLM pilot weakness (mage-bench blunder rate) caps the reliability of "deep-play review" outputs; several key references (MTGAI, RyanSaxe, khakhalin, CubeCobraML, draftbot-model) are unlicensed — patterns only, no code.

**Open questions handed to other lanes / future experiments:**

- Engine lane: does Forge's headless `sim` accept custom card scripts cheaply enough to serve as a second-opinion oracle for our generated sets?
- Experiment: train a Bertram-style text-feature pick model on multiple 17lands sets, evaluate zero-shot on a held-out _unseen_ real set — measures how much of the 55% transfers before we bet the draft lab's bot quality on it.
- CubeCobra model weights carry no visible license; if we ever want their trained bots (not just code), that needs upstream clarification.
- mage-bench cost curve: whether local models via its OpenRouter path make LLM-tier game review affordable at playtest scale.
