# MTG Set Generation & Playing Lab — Design Brief

Status: goal-of-record, grilled and locked 2026-08-09. Engine strategy decided same day on prior-art evidence — see `docs/research/decision-synthesis.md`.

## Vision

A laboratory for Magic: The Gathering set design and play:

- Generate new sets from desired mechanics that work within existing rule sets, with staged support for modifying the rule sets themselves.
- Build decks and cubes from prompt-driven structured criteria — an *informed* deck builder grounded in real card data, synergy structure, and format statistics, not generic agent guesswork.
- Playtest generated sets with agent players against learned playability criteria, calibrated on real human play data where it exists.
- Draft against bots (custom sets and cubes), with optional human multiplayer or hybrid pods later.
- Play the results as a human: vs bots and local hotseat first.

Flagship validation: a full set with custom art, designed, playtested, drafted, and played end to end in the lab.

## Target capabilities

1. **Data foundation** — all existing card metadata (Scryfall / MTGJSON), Comprehensive Rules, and rulings ingested; rules text mapped to enforceable mechanics.
2. **Informed deck lab** — prompt + structured criteria (archetype, curve, budget, power band, synergy themes, format) → decks and cubes, with explanations grounded in data.
3. **Set generator** — desired mechanics → design skeleton (color pie, curve, rarity distribution, draft archetypes) → full set emitted in an enforceable card DSL.
4. **Playtesting lab** — mass bot-vs-bot simulation; playability metrics (win-rate bands, game length, mana screw rates, interaction density, archetype balance) asserted CI-style; calibrated against 17lands human baselines.
5. **Draft lab** — drafts vs bots over custom sets/cubes; draft-bot pick models.
6. **Play surface** — headless logs → web replay viewer → interactive playable board; hotseat + vs-bot.
7. **Art pipeline** — ported from the prior project: fal.ai + ComfyUI behind one contract, LoRA style-lock per set, typed art-spec validation, deterministic post-processing repair.

## Locked decisions (grill, 2026-08-09)

| Decision | Ruling |
|---|---|
| Rules engine strategy | **Build-first hybrid** (decided 2026-08-09, `docs/research/decision-synthesis.md`): custom strict-TS event-sourced kernel + typed mechanics DSL as the core; Forge at arm's length as parity oracle, DSL transpile/export target, and early human play surface; XMage/Argentum (both MIT) mined as reference designs for layers/replacement subsystems; LLM referee scoped to framed schema-constrained rulings, kernel owns all state; symmetric pre-committed kill-tests (TS throughput threshold → native-core escape hatch; kernel velocity stall at the CR 613 cliff → Forge-bridge fallback with DSL/validators surviving) |
| Rules modifiability | Staged: parameterized variants/formats first; deep modification (new zones, turn structure, resources) via engine extension points second |
| Stack | Strict TypeScript for engine/sim/agents/UI; Python for the image pipeline; native core only if sim scale demands it |
| First vertical slice | Thin end-to-end loop: tiny mechanic subset, set-gen → deck build → bot-vs-bot game → playability metrics |
| Bot players | Tiered: scripted/heuristic bots for mass in-game sim; LLM agents for drafting, deck construction, mulligans, deep-play reviews |
| Playability data | 17lands public data (calibration baseline) + self-play statistics (the only signal custom sets will have) |
| Interface sequence | Headless → replay viewer → playable board (board UI grows out of replay components) |
| Multiplayer | Local hotseat + vs-bots first; networked play deferred |

## Design principles

- **ZFC** — application code is plumbing; reasoning lives in models. Semantic judgment (card quality, flavor, playability interpretation, design tradeoffs) is delegated to LLMs. Code owns IO, schema validation, state, simulation mechanics, budgets, and policy.
- **Co-design invariant** — the set generator's output space stays inside the engine's enforceable space. Cards are emitted in the DSL; nothing is generated that the engine cannot run. Inside, not equal to: the containment is one-directional on purpose, so the engine's vocabulary can grow without the generator's, and it is deliberately strict in places (`putCounters` is expressible by hand and unreachable from the generator). `ModelAbilityIsAbility` and `ModelEffectSchema` prove the containment at compile time. Equality is the direction that fails loudly: every widening of the engine's vocabulary would become a generator change too, and each one lands first as a card a person writes by hand.
- **Spec-validate-before-accept** — generated content passes typed validation plus semantic critique loops before it enters a set (the prior project pattern).
- **Balance is a CI assertion, not a vibe** — seeded sims, win-rate bands, no-dominant-strategy guards as tests.
- **IP posture**: the lab is private, strictly non-commercial, and ships to nobody; the WotC Fan Content Policy notice stands. Theme indirection was retired on 2026-08-11 (`mtg-bc2.150`). The flagship set names its source outright, and no stage of the pipeline maps a name to another name.

## Prior-art research (complete, 2026-08-09)

The six-lane sweep answered the open questions; reports live in `docs/research/`:

- `prior-art-engines.md` — engine landscape, licenses, custom-mechanic ceilings; lane recommendation "hybrid, weighted heavily toward build".
- `prior-art-data-sources.md` — Scryfall/MTGJSON/Comprehensive Rules ingestion strategy, symbol-font licenses, Fan Content Policy envelope.
- `prior-art-mtg-ai.md` — game AI, draft bots, LLM card-generation lessons; sim-grounded power calibration of generated cards is the genuinely novel contribution.
- `prior-art-playability-metrics.md` — 17lands schema, metric suite, calibration protocol (emit a 17lands replay-schema superset so calibration is a join).
- `prior-art-set-design.md` — design skeletons, Mechanical Color Pie, NWO as data; fan-set failure modes.
- `prior-art-tooling.md` — adopt Draftmancer (MIT); interop Cockatrice XML and Forge custom sets; everything downstream of "the set exists as data" is adoptable.
- `proposal-reuse-maximal.md` / `proposal-build-first.md` — the two argued architectures.
- `decision-synthesis.md` — the scored decision, grafts, thin-slice scope, phase-1 breakdown, and honestly-deferred questions.

Remaining open questions are tracked in `decision-synthesis.md` §7 (kernel velocity at the CR 613 cliff, Forge seeded determinism, throughput thresholds, calibration transfer, referee economics, Draftmancer rating scale, canon tuning).
