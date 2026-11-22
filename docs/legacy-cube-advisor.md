# Legacy Cube draft advisor

## Existing architecture and chosen boundaries

The pinned input is `packages/data/data/legacy-cube-2021-card-catalog-v1.json`:
600 official August 2021 positions, with corrected names, physical identities,
Oracle text, mana, colors, faces, and art. `@mtg/printed-card` owns its checked
portable schema. No second card representation or runtime card fetch is needed.

`@mtg/draft-export/physical-cube-draft` deals a singleton population and replays
human picks from a seed. `ui/routes/legacy-cube/model` adapts the catalog into
that loop. URL picks and the existing local session store already preserve the
transcript. The draft currently orders bot choices by mana curve and card type;
this is not a source of expert card quality or expected pick positions.

The loop now retains human pack observations while replaying. The advisor's
input is a separate value containing only those observations and chosen ids.
It has no seed, bot seats, initial packs, undealt tail, or future state. Wheel
identity is inferred from round and pick modulo pod size, something a human
can track without knowing which seat originally opened a pack.

Expert card judgments live as authored metadata in `draft-export/src/advisor`.
Runtime evaluation is pure local arithmetic over that metadata. This is an
explicit product requirement, not an LLM orchestration pipeline. It neither
parses Oracle prose to infer semantics nor calls a model during drafting.

`DraftPackSurface` already supports hover/focus preview, explicit selection,
and a separate commit button. Advice extends its existing context rail; card
art and pick behavior remain the shared presentation's responsibility. The
player is reading a pack at their normal desktop or phone, so the advisor uses
the existing warm-paper/cool-slate themes and restrained controls.

## Research and reuse

Repository inspection found all necessary data and draft/presentation primitives.
GitHub searches for cube draft bots and Cube Cobra's published draftbot material
informed the separation of quality and synergy, but no external implementation
or dependency is imported. React's [useMemo documentation](https://react.dev/reference/react/useMemo)
supports caching the pure evaluation at the transcript boundary, rather than
re-evaluating it on every hover. No npm utility or runtime service is needed.

## Evaluation model

Keep pool fit, completeness, quality, synergy, mana feasibility, observed signals,
and pivot cost separate. Recommendations compare each card under current-plan,
flexible, observed-pivot, and explicitly pinned objectives. Evidence identifies
the card, role or package, observed round/pick, and the sign of its contribution.
UI labels are qualitative; counts describe actual drafted pieces.

Signal strength grows with lateness and authored specificity, with a wheel
bonus only for a previously seen physical card. Repeated observations of one
card replace its old evidence instead of accumulating fictitious votes.
Per-pack contribution caps and distinct-pack confidence keep a single late
anomaly from establishing a lane. Round two passes the other direction and
is identified separately; recent observations can weaken an old estimate.

Missing components and overstocked roles are reported even when a card has a
high baseline rating. Mana estimates use drafted sources, color commitments,
and pip requirements, with ordinary basics assumed available. Public cube
examples describe possible components, never where unseen cards are located.

## Taxonomy derived from the imported list

The 17 overlapping paths are Aggro, Spells Tempo, Control, Reanimator, Ramp,
Blink Value, Artifacts, Sacrifice, Midrange, Graveyard Value, Cheat,
Tokens / Go Wide, Twin Combo, Equipment, Natural Order, Opposition Tokens,
and Multicolor Control. Colors describe usual options within a family, not a
requirement to play every listed color. Aggro includes mono-white, mono-red,
and black-based curves; it is not a prescribed three-color deck.

These distinctions follow actual cards: Natural Order has green sacrifices and
green targets; Opposition and Glare have creature-density needs; Stoneforge has
equipment; Upheaval has replayable mana; Crucible has sacrificial lands. The list
does not contain Tinker or Goblin Welder, so neither is invented as an artifact
anchor. Twin and Kiki-Jiki have alternative recipes: Restoration Angel supports
Kiki-Jiki, not Splinter Twin. Reanimation targets exclude the shuffle-back Eldrazi
as ordinary targets; cheat packages retain them. Cast-trigger caveats remain in
the package descriptions.

All 600 identities have profiles; 75 are explicitly archetype-neutral, including
flexible fixing and utility cards. Structural facts come from the existing
catalog's front face. Authored groups add roles without replacing those facts or
other memberships. Seventeen package recipes express complementary components,
density thresholds, and alternative combinations. Validation checks the pinned
catalog fingerprint, exact names, membership and package references, examples,
role thresholds, color capabilities, and sufficient cube supply for every need.
A stale catalog disables advice with an explanation, not the draft itself.

## Heuristics and UI choices

Pool fit sums authored membership strength. Completeness caps each need at its
target; quality and synergy density remain separate. Established requires eight
contributors and no critical shortage; Emerging requires three contributors.
Pivot cost counts off-color cards that do not contribute to the destination.
Mana risk considers current color commitments, drafted source colors, repeated
colored pips, and multicolor costs. Single-color utility lands can supply a splash
but do not satisfy multicolor fixing requirements. Fetch-land reach is conservative:
the model names their printed land-type colors, not every dual they might find.

The pool-level mana label also checks the colors actually present among cards
eligible for the path. The two most represented colors are treated as basic-land
colors; additional colors need at least two drafted sources each. This prevents
unrelated dual lands from making a fragmented pool look comfortable, without
requiring all of a broad family's usual colors. Shortages carry affected card IDs
and a structured `unsupported-mana-colors` reason. This remains a coarse pool
warning, not a guarantee that a particular 40-card deck can cast its spells.

Early picks favor standalone quality and flexibility. Once a path has support,
membership, complementary package pieces, and missing critical roles matter more.
Extra top-end cards, unsupported costs, and incomplete narrow packages incur
penalties. Current-plan, flexible, pivot, and pinned recommendations compare
different objectives. A shared winner is shown once with its applicable modes.
Every result retains machine-readable reasons, card identities, package links,
liabilities, path effects, and alternatives; numeric internals are inspectable in
the returned object, not shown as pseudo-precise UI percentages.

Signals start weak at pick two, grow with lateness and card specificity, receive
a wheel bonus, and are capped per card and pack. Distinct packs determine
confidence. Earlier rounds decay; four recent late packs without narrow support
can mark a formerly supported lane Cooling. Absence is weak evidence, not proof
that a neighbor drafted a card. Generic bombs carry low lane specificity. Fixing
adds only weak color evidence, explicitly distinguished from a narrow engine.

Advice occupies the existing card/context rail. Hover and keyboard focus preview;
selection and confirmation still draft the card. A Review advice button brings
the rail into view on small screens. Paths can be pinned in the URL and survive
picks/reloads. The dashboard separates pool support from observed signals and
shows contributors, shortages, excess roles, public package examples, and pivot
cost. Package prose is filtered to the selected path; the full evidence remains
available for debugging.

## Validation and limitations

Tests cover synthetic openness, anomalous late cards, wheels, pivots, missing
enablers/payoffs, fixing, early flexibility, established synergy, explanation
scope, front-face normalization, transcript integrity, and hidden-state
invariance. Real-card tests guard Order, reanimation, Twin/Kiki, and mana-source
semantics. Three seeded 45-pick simulations exercise flexible, current-plan, and
pinned Reanimator drafting. UI tests cover pinning and all 45 picks; Chrome checks
keyboard selection, explicit confirmation, native touch, and overflow at 1440,
768, and 375 pixels.

This is an authored heuristic advisor, not a calibrated prediction of human
draft behavior or win rate. The existing bots do not draft expert synergy decks.
Family-level color and source estimates are not a 40-card mana-base optimizer;
conditional mana, exact fetch/dual reach, alternate-face choices, companion deck
restrictions, and every possible hate-card conflict are not simulated. A profile
is explicitly accounted for even when its standalone rating is the neutral
baseline, rather than implying 600 independently measured power ratings.

Highest-value follow-ups are expert-reviewed pick calibration against saved
human transcripts, explicit candidate 40-card decks with source/curve planning,
and broader interaction/conflict recipes with targeted real-card fixtures.
These follow-ups are tracked as `mtg-e891`, `mtg-lqv1`, and `mtg-jwnc`.

Native V8 measurement of the focused tests reached 232/238 functions and 456/544
blocks in `draft-export/src/advisor` (97.5% / 83.8%); the advisor UI reached
45/45 functions and 112/118 blocks (100% / 94.9%). These are executed JavaScript
function/block measurements, not a source-mapped TypeScript line report. The
repository does not install Vitest's coverage provider. Measurement used
`NODE_V8_COVERAGE` with `node:v8`'s `takeCoverage()` in a temporary `afterAll`
harness, removed afterward; no dependency was added. An opening-pack evaluation
averaged 5.6 ms over 20 repetitions on the loaded development machine, with an
immutable model-level name index eliminating repeated scans of 600 profiles.

### Initial verification handoff (September 10, 2026)

Type checking, ESLint, and the production Vite build pass. Changed-file formatting
and whitespace checks pass. The final focused advisor checks pass: 31 evaluator,
observation, real-card, and metadata tests; seven UI tests; three complete draft
simulations; and the responsive keyboard/touch browser test. The public-boundary,
spelling, workspace-roster, and metadata rerun passes all 49 tests after registering
the new official-card names and UI labels in the export census.

The broader `draft-export` and Legacy Cube UI suite reports 234 passes and eight
timeouts in existing `route` and `deck-edit` full-draft journeys. Its load reporter
records outside contention above twice the machine's 16 cores. Two attempts at
the complete root suite also encountered load-related timeouts and were stopped;
neither constitutes a completed green gate. No test timeout was increased. A
quiet-machine rerun was still required at that initial checkpoint. Subsequent
reruns passed the route/deck-edit files and the initially failing full-suite
files after wiring fixes; feature bead `mtg-1d7q` is now closed. Those reruns are
not the same claim as a single green full-suite run. Learning-first calibration
and automatic weight adoption remain separate work under `mtg-6yfe`; see
`docs/legacy-cube-calibration-evidence.md` for the current evidence boundary.

Logs are `/tmp/mtg-advisor-relevant-suite.log`,
`/tmp/mtg-advisor-final-cross-gates.log`, `/tmp/mtg-advisor-full-test.log`, and
`/tmp/mtg-advisor-full-test-low-load.log`. Root formatting additionally reports
pre-existing changes in `packages/llm/src/schema.ts` and
`packages/llm/test/fixture.test.ts`; those unrelated edits were preserved.
