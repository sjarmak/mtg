# Bot capability audit — September 12, 2026

The highest-leverage capability improvement is to connect drafting and deckbuilding
around the quality of the finished, castable deck. Start with the printed Limited
path: its current evaluator ignores card abilities, and the same weak structural score
feeds both draft picks and the opponent's deck. Improving that path benefits the
opponent before changing a single gameplay decision.

Gameplay needs a separate improvement lane, with separate implementations for the
native kernel and Forge. Share card/deck facts and measurement contracts where
useful; do not assume one policy or trained model can run in both engines.

This is an audit of the working tree at HEAD
`2c2baaa10e3593b8dd1654ffc5cf1b1228401ba5`, including substantial existing uncommitted
work. It is not a certification of the running preview or a clean committed tree.
Tracked as `mtg-hn9v0`. No application code or runtime defaults were changed.

## What exists today

| Surface | Active implementation | Capability and principal limit |
| --- | --- | --- |
| Native generated/DSL gameplay | Browser-safe greedy bot; greedy is also the default simulation opponent | Broad decision handling, deterministic play, combat and target policies. Several decision types still choose the first option or a fixed response. |
| Native optional search | One-ply refinement of greedy | Evaluates alternatives of the same action type; assumes responses pass during stack settling. Historical evidence shows near parity at higher cost. |
| Printed gameplay | Forge Default AI through the bridge | Real printed-card rules and native AI. AKH/HOU uses hybrid simulation after full search exhausted its heap; strategic competence varies by interaction. |
| Generated-set drafting | Static DSL rating plus accumulated color affinity | Understands more card properties through the rating, but the pick policy has no evolving deck plan, observed-signal model, or explicit missing-role objective. |
| Printed-set drafting | Structural mana-value/type score plus accumulated color affinity | Does not evaluate printed abilities, removal quality, synergy, or fixing quality. |
| Legacy Cube advisor | Authored card/package metadata, observable draft memory, openness, current/flexible/pivot paths | Substantially richer advice, but authored weights and openness priors remain empirically uncalibrated. Ordinary bot seats use a simpler baseline. |
| Native deckbuilding | Color-pair comparison, curve selection, creature floor, contextual second pass, mana allocation | Useful deterministic baseline; optimizes heuristic structure, not measured game performance. |
| Printed Limited opponent construction | Top-ranked pool cards plus basic-land allocation | No joint spell/mana search, deck-level color-plan selection, or package objective in the generic suggestion. |
| Cube calibration construction | One/two-color plans, package preservation, 23 spells/17 lands | Better than the generic printed suggestion, but still limited for splashes, special land counts, and off-color cheat targets. |
| Decklab | Offline model land planning and card selection; deterministic verification/assembly | Repairs legality, budget, and selection problems. Its current selection loop has no gameplay feedback. |

Runtime evidence: [native default](../../packages/ui/src/routes/play/deal.ts),
[bot registry](../../packages/sim/src/bots.ts),
[printed match construction](../../packages/ui/src/routes/printed/printed-match.ts),
[Forge AI selection](../../packages/forge-export/bridge/ForgeBridge.java),
[draft policy](../../packages/draft-export/src/simple-bot.ts),
[Cube advisor](../../packages/draft-export/src/advisor/evaluate.ts),
[native builder](../../packages/deckbuild/src/build.ts),
[Cube builder](../../packages/metrics/src/legacy-cube-calibration/deck.ts),
[Decklab orchestration](../../packages/decklab/src/build.ts).

## The clearest capability gaps

### Printed draft and deck choices do not read what a card does

`printedStructuralScore` is `10 × max(0, 8 − |manaValue − 3|)`, plus 8 for a
creature or 5 for a nonbasic land. The draft policy divides that by 20 and adds
0.35 for each previously picked card in each matching color.

A direct execution over the pinned HOU catalog produced:

| Card | Structural score | Draft score with an empty pool |
| --- | --- | --- |
| Moaning Wall | 88 | 4.4 |
| The Scarab God | 68 | 3.4 |

This is a reproduced scoring comparison, not a claim that a particular recorded
pack contained both cards. The rank follows mana value and creature type; the
abilities cannot affect it. Accumulating color counts can change later picks but
cannot supply the missing card understanding.

The printed opponent then uses `suggestLimitedDeck`: take the highest-scoring
`minimumDeckSize − suggestedBasicLands` pool cards and apportion basics from their
color counts. It does not choose a coherent color plan first. Color membership is
not colored-pip demand or the probability of casting a spell on its useful turn.
Drafted nonbasic lands also occupy selected pool slots; the configured basic count
does not become an optimized total-land target.

Evidence: [structural score](../../packages/ui/src/routes/printed/limited-facts.ts),
[printed bot](../../packages/ui/src/routes/printed/draft-bot.ts),
[generic suggestion](../../packages/limited/src/physical-deck.ts),
[opponent wiring](../../packages/ui/src/routes/printed/printed-match.ts).

### Native play still leaves valuable choices to fixed responses

The greedy bot keeps every scry card on top and takes the first available library
search hit. Entry colors, some entry choices, and other decisions also use first
options. These are concrete policy gaps, although their frequency and contribution
to losses have not been measured in this audit. A search finding any legal card
is different from finding the land color, answer, or payoff the position needs.

The optional search bot does not solve these generally. Its candidate set retains
greedy's action and alternatives of the same action type. When greedy passes,
search does not reopen cast-versus-pass. Its leaf value emphasizes life, cards in
hand, and battlefield value; it lacks explicit future resource and opponent-response
valuation. Historical head-to-head evidence records 50.3% for search versus a
48.3% greedy seat-control reading, at 4.34 times the cost. That benchmark was not
rerun here and does not establish current superiority.

Evidence: [fixed-choice branches](../../packages/sim/src/greedy-bot.ts),
[candidate and horizon rules](../../packages/sim/src/search-bot.ts),
[state evaluator](../../packages/sim/src/evaluate-state.ts),
[comparison tool](../../packages/sim/tools/search-head-to-head.ts).

There is also an information-boundary prerequisite for stronger native agents.
`AgentView` contains the full `GameState`, and the simulation passes it directly;
both hands and exact library identities/order are reachable. Search simulates
from that state. This audit did not demonstrate deliberate hidden-card use by the
current policies, but a future learned or deeper-search agent could exploit it.
The UI's seat-redacted backend projection does not protect this separate agent
interface. Establish an observation-safe policy input and an explicit hidden-state
sampling contract for search before interpreting new strength results.

Evidence: [agent input](../../packages/kernel/src/agent.ts),
[simulation driver](../../packages/sim/src/driver.ts), and
[kernel game loop](../../packages/kernel/src/game.ts).

### Forge execution and strategic competence are separate claims

The bridge selects Forge's Default AI. AKH/HOU explicitly requests hybrid
simulation because full depth-three search exhausted a 4 GB heap in an existing
fixture. Increasing depth without a bounded resource policy is not an established
improvement path.

The retained September 10 Cube smoke report contains four completed games and
zero eligible comparisons. The documented probes demonstrated specific reanimation,
blink, Natural Order, ramp, Twin, and artifact-removal lines; Kiki repetition and
sacrifice recursion remained unproven. These are historical, narrowly scoped
results. Current competence checks require the same bot identity, multiple seeds,
and joint coverage of the relevant cards; separate fixtures cannot establish an
untested combination.

The retained AKH/HOU observed sweep v19 opened 20 sessions and finished 15, exposing
366/550 catalog printings in pools and 209/550 in decks. Its five failures concern
Doomfall, Bontu, Hope Tender, Cartouche of Ambition, and Unquenchable Thirst bridge
choices. It pairs an exploration policy with Forge and is callback-discovery
evidence, not a strategic-strength benchmark. The report itself says qualification
is unproven. These artifacts do not certify source changes made after their runs.

Evidence: [Cube experiment](../legacy-cube-bot-calibration.md),
[competence contract](../../packages/metrics/src/legacy-cube-calibration/competence.ts),
`out/legacy-cube-bot-final-20260910/report.json`, and
`out/validation-pilot/akh-hou-observed-sweep-v19-full/report.json`.

### The learning infrastructure needs evidence more than another framework

The Cube workflow already supports matched policy arms, frozen opponent decks,
separate tuning/holdout seeds, independent-session accounting, model review,
proposal sealing, and gated adoption. The strict-human audit currently admits
zero tuning cases, zero holdout cases, and zero independent sessions. The existing
transfer example remains useful in its separate evidence category. The documented
model pilot retained the baseline; no advisor weights have been adopted.

Neither tests of this machinery nor bot game completion establish strategic
quality. Model judgments, human observations, and competence-qualified bot results
must keep their different meanings. Do not wait for perfect human coverage before
fixing a directly reproduced accounting or policy defect.

Evidence: [current evidence status](../legacy-cube-calibration-evidence.md),
[paired campaigns](../../packages/metrics/src/legacy-cube-calibration/campaign.ts),
[human admission CLI](../../packages/metrics/tools/legacy-cube-evidence.ts).

## Investment order

### 1. Give draft and construction a shared finished-deck objective

Begin with versioned, format-aware card facts: card quality, interaction role,
mana sources and colored costs, enablers/payoffs, and alternate casting plans.
Reuse the Cube advisor's separation of metadata from runtime arithmetic, without
pretending its Cube-specific package definitions describe AKH/HOU.

Use those facts to compare complete candidate decks from the same pool. Start with
color plans and useful spell/land alternatives, then bounded swaps or beam search.
Score mana reliability, curve, interaction, and whether selected packages actually
function together. Land count, fixing, and spell selection must be considered
together. Explicitly represent a cheat target differently from a spell the deck
expects to hard-cast.

The draft policy should ask how much a pick improves the best plausible deck from
its observed pool, while retaining flexibility early. This connects draft picks to
the deck that reaches play. It also makes fixing and a missing enabler valuable for
the right reason. Keep stage-specific policies; a shared set of facts is not one
universal scalar card rating.

Acceptance: compare builders on identical held-out pools with the gameplay bot
fixed; compare draft policies with builder and opponent policies fixed. Report
castability, missing roles/packages, sideboard-to-main improvements, and qualified
match outcomes. Test the actual printed opponent route as well as the library.
Expose changes by policy/version so a draft replay remains reproducible.

### 2. Improve gameplay decisions at the observed failure points

For native play, start with scry, tutor selection, resource sequencing, and other
fixed-choice branches. Record offers, choices, public position, and outcomes;
rank failure families by observed frequency and consequence before choosing the
next slice. Extend position valuation to the resources those decisions affect.

For Forge, finish the exercised bridge gaps and broaden autonomous competence
tests for deck plans that matter in the actual formats. Fix strategic choices in
the AI/controller layer; keep rules and scripted probe decisions out of the fix.
Use the same implementation in probes, matches, and the user-facing route.

Acceptance: autonomous multi-seed situations with multiple meaningful choices,
negative controls, and actual state assertions; then fixed-deck, seat-balanced
comparisons against more than one frozen opponent. A bridge callback pass is not
a win-rate gain. A strength gain against one weak opponent is not broad skill.

Existing work: `mtg-81tk` covers missing Cube interaction competence;
`mtg-596p.15` covers observed bridge sweeps. Keep their evidence scopes distinct.

### 3. Resume learned evaluation after establishing the baseline and data seam

The earlier learned-evaluator direction remains a useful native-engine experiment.
`mtg-bw8z` is still open; a learned scorer is not present in the current bot registry.
Its notes claiming the proposed scorer is stronger are predictions, not results.

Start with the observation boundary above, decision features, and reproducible training examples,
then compare a small action-conditioned scorer against the existing policies.
Use frozen model artifacts and deterministic inference for replay. Training
against only greedy risks learning its weaknesses; the opponent-diversity work
in `mtg-5ar0` remains relevant. Split evaluation by seeds, decks, and card/strategy
families so memorizing a set is visible.

Action-conditioned learning has a concrete reference in
[DouZero](https://github.com/kwai/DouZero/blob/main/README.md), which uses action
encoding and parallel actors. That supports an implementation approach, not a
claim that its results transfer to Magic. Human draft data can come from
[17Lands public datasets](https://www.17lands.com/public_datasets); data from other
sets remains transfer evidence, not exact AKH/HOU or Cube validation.

Do not lead with deeper MCTS, a runtime language model, or a new review platform.
The immediate missing inputs and deck objective are already identifiable. A native
learned scorer will also need an explicit observation/action adapter and fresh
evaluation before it can improve Forge-backed printed play.

## Validation performed for this audit

- Traced active UI defaults and policy/building boundaries, with two independent
  read-only code reviews covering gameplay and Limited construction.
- Executed the real printed scoring functions against the pinned HOU cards shown
  above; executed the strict-human evidence audit and confirmed zero admitted cases.
- Passed 28 calibration, tuning, and quality-gate tests across three files.
- Passed all nine existing search-bot tests in the independent gameplay review.
- Passed all five spelling-gate tests; checked all 25 local document links.
- Read retained bot/sweep reports directly. No fresh Forge sweep, head-to-head
  strength campaign, training job, or deployment verification was performed.

The 37 passing tests validate selected software contracts. They do not measure
human-level skill, certify all formats, or constitute a full-workspace gate.
