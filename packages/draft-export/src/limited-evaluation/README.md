# Limited deck evaluation, version 1

This evaluator serves the printed AKH/HOU draft bot, deck suggestions, basic-land suggestions, and constructed bot opponents. It uses authored card judgments and deterministic arithmetic. It has not been calibrated against human picks or match results.

## Sources and provenance

The profiles were authored during the 2026-09-12 bot improvement work by reading the pinned AKH, HOU, and MP2 catalogs in `packages/data/data/akh-hou/`. They cover all 550 physical printing entries in those catalogs. Names share a profile across printings. No Forge rating tables or source code were copied.

`source-bindings.json` binds each printing to a signature of its name, cost, mana value, type, Oracle text, colors, produced mana, and faces. Evaluation refuses unknown or changed printings. Catalog loading separately verifies the catalog's SHA-256. New drafts opt in only for the three pinned catalog hashes in the UI policy selector.

Profile quality is an initial 0–5 Limited judgment, not a measured win probability. Roles describe interaction, card advantage, and fixing. Payoffs name the supporting tag, a capped contribution, and a target count. Tag matching is arithmetic over authored metadata; runtime code does not infer card meaning from Oracle text.

## Tag conventions and cost overrides

- `cycling`: cards with cycling, not every discard enabler.
- `embalm`: cards with embalm or eternalize; both offer a later graveyard creature.
- `zombie`: Zombies or cards that can create Zombies, including embalm.
- `exert`: cards that can exert.
- `counter`: cards that produce -1/-1 counters.
- `desert`: Desert lands.
- `spell`: instants and sorceries; `noncreature` also includes artifacts and enchantments.
- `cartouche`: Cartouche cards.

`planningCost` states an authored useful casting or activation cost for selected X spells, Pact obligations, and cards whose important ability needs an additional color. It is an approximation of the deck's mana requirement, not a modification of the actual card. Conditional mana filters receive conservative source overrides rather than being counted as unconditional five-color lands. Small utility credits allow useful colorless and cycling lands to compete with basics.

## Search and mana model

Construction starts with all mono-color and two-color plans, tries 16–18 total lands, and refines the best three plans with two single-card swap passes. Nonbasic lands replace basics only when they improve the objective. Draft picks compare projections of the observed pool plus each candidate, with a small early quality prior. The bot receives no future packs through this evaluation seam.

The objective combines quality, capped synergies and curve/interaction coverage with mana support. Individual source-draw probabilities use hypergeometric arithmetic. Their product is an approximation: it is not the exact joint probability of casting on curve. Tapped-land timing, ramp sequencing, combat, sideboarding, and full multicolor splash search are not modeled. Land choice is not reconsidered after every spell swap.

## Replay and validation

The policy identifier includes the profile, source-binding, and parameter fingerprint. Bump `DECK_MODEL_VERSION` whenever algorithm changes would alter picks; data changes alter the fingerprint automatically. Saved drafts without an explicit policy retain the original `printed-limited-v1` behavior. Unknown saved policies fail explicitly.

The replay cache belongs to one mounted draft session and contains only observed pick evaluations. Numerical probability memoization has a finite input domain and holds no game state.

Tests cover catalog coverage and drift refusal, authored tag/cost distinctions, coherent color selection, mana allocation, utility lands, physical-copy legality, saved-policy compatibility, and the full draft-to-deck UI flow. These checks establish mechanical behavior; a paired held-out match benchmark is still needed to establish playing strength.
