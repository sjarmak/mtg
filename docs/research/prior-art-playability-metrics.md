# Prior art: playability metrics & 17lands

Lane report for the MTG set-generation lab. Researched 2026-08-09. Method: primary sources only; 17lands site content was extracted from the site's own JS bundle (the site is an SPA that serves an empty shell to fetchers), dataset coverage was probed empirically against the public S3 bucket, and CSV schemas were read from the actual file headers. Licenses were verified from LICENSE files via the GitHub API, not from memory.

Companion docs: `docs/design-brief.md` (goal-of-record), `the prior-project reuse audit` (sibling-project reuse).

---

## 1. Executive summary

- 17lands publishes three public dataset types per set/event (draft, game, replay) under **CC BY 4.0**, downloadable from a public S3 bucket. Coverage runs from KHM (Feb 2021, game data) / STX (Apr 2021, draft+replay) through the newest Arena sets (ECL verified present). Replay data is per-turn with end-of-turn board state, which is nearly a superset of what our self-play logs will contain. This is the calibration baseline the design brief locked in, and it is better than expected: the replay schema contains direct analogues for interaction density, board development, life swings, and mana development.
- The 17lands aggregate metrics (ALSA, ATA, GP WR, OH WR, GD WR, GIH WR, GNS WR, IIH) have precise published definitions with documented caveats and a changelog. All of the in-game ones are computable from our self-play logs with identical semantics. The in-draft ones (ALSA/ATA) are computable from our draft-lab logs.
- Known biases are well documented by 17lands themselves and by the community: game-length bias in GIH/IIH, archetype/deck-context bias, skill-population shift (17lands users average ~56% vs the 50% population baseline), missing P1P1 in draft logs, and metric redefinitions over time. Community corrections exist (mtgds' regression-adjusted win rate, MagicFlea's DEq) and are portable patterns.
- Set/format health quantification exists piecemeal: 17lands' own format-speed data (game-length histograms + on-play win rate per set, available as JSON), Sierkovitz's format-speed methodology, a constructed-format composite health index, WotC's computable design heuristics (New World Order complexity budget, as-fan, design-skeleton curve norms), and academic self-play balance work (Ludi's drama/uncertainty metrics, Hearthstone meta balancing, RuleSmith). No one has published an integrated "set health CI" for custom MTG sets; assembling one from these parts is genuinely net-new.
- Bot-vs-human gap is real and documented (Forge's own wiki: AI fine for aggro/midrange, poor for control/combo). The calibration protocol in §8 turns this from a threat into a measured, versioned correction table.
- Highest-leverage adoption: the **`spells`** Python package (MIT, actively maintained) already handles download, caching, parquet conversion, and correct computation of all standard 17lands aggregates from the public data, with MTGJSON integration. Use it as the human-side half of the calibration harness instead of writing our own 17lands ingestion.

---

## 2. 17lands public datasets (verified first-hand)

### 2.1 What is downloadable

Three file types per set and event type, as CSV.gz on a public S3 bucket. Verbatim descriptions from the public datasets page ([https://www.17lands.com/public_datasets](https://www.17lands.com/public_datasets), extracted from the site bundle 2026-08-09):

> "Game-level data includes one row per game. It lists cards that were in the deck, in the opening hand (i.e. the one that was kept), or drawn later in the game. Cards that were drawn do not include cards that were in the opening hand."
>
> "Draft-level data includes one row per pick, with information about what they had picked previously, how the matches went, and the user's overall win rate. P1P1 data may be missing in some sets due to it not being in the Arena logs."
>
> "Replay data includes one row per turn. It includes cards drawn, cards cast, creatures attacked with, damage dealt, etc. along with some game summary information."

The page also lists **Helper Files** ("You may find these files useful in starting your analysis") and **Card Lists** ("These map from the internal MTGA id used in replay data to more useful data").

**URL pattern** (verified working):

```
https://17lands-public.s3.amazonaws.com/analysis_data/{draft_data|game_data|replay_data}/{draft|game|replay}_data_public.{SET}.{EventType}.csv.gz
```

EventType ∈ `PremierDraft`, `TradDraft`, `Sealed`, `TradSealed`, `QuickDraft`. The same pattern is documented by the community R package mtgr ([mr_download_17lands_file](https://joelnitta.github.io/mtgr/reference/mr_download_17lands_file.html)), which also notes "Not all sets or combinations of data types are available" and that Quick Draft existed "for one set at the time of writing".

### 2.2 License and terms for research use

**License, verbatim from the public datasets page:**

> "Unless otherwise noted, these data sets are licensed under a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/). We'd love it if you'd also share your results with the community."

**Usage Guidelines** ([https://www.17lands.com/usage_guidelines](https://www.17lands.com/usage_guidelines), extracted from the site bundle; applies to *curated site data*, with public datasets explicitly out of scope):

- Scope exclusion, verbatim: "Data that is **not** in scope for these guidelines includes (1) the data on our Public Datasets page (which is typically released under a CC BY 4.0 license), nor (2) data that is specific to an individual user".
- Attribution: "If you're using our data, you must make it clear that the data comes from 17Lands. However, this citation must not imply that 17Lands endorses your product or findings. Please note that our name is stylized as 17Lands (capital L)."
- Embargo for third-party tools re-visualizing curated site data: not before "the 12th day it has been released on MTG Arena" (7 days for short-term specialty sets). Does not apply to citing individual numbers.
- API: "we discourage automated scraping of our API ... we provide no guarantees that any part of the API will remain consistent over any period of time." They explicitly prefer people use the public data dumps.
- Publication schedule, verbatim: "Draft data: 2 weeks into a set ... Game data: 3 weeks into a set ... Replay data: 6 weeks into a set".
- Reservation: "we reserve the right to request anyone stop using our data for any reason".

**Privacy caveat** (from the privacy policy, in the same bundle): "We make every attempt to anonymize this data before publishing, but we cannot guarantee that each line item is impossible to be traced back to an individual user." Player skill appears only as buckets (`user_n_games_bucket`, `user_game_win_rate_bucket` in 2% increments; see [Joel Nitta's walkthrough](https://www.joelnitta.com/posts/2023-12-31_17lands-intro/)).

**Fan-content framing** (site footer text, same bundle): "17Lands is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. ... See [https://company.wizards.com/fancontentpolicy](https://company.wizards.com/fancontentpolicy)". Our lab is already committed to Fan Content Policy compliance (design brief, IP safety).

### 2.3 Coverage (probed against S3, 2026-08-09)

HEAD-request probe results (HTTP 200 = file exists, 403 = absent; S3 returns 403 for missing keys):

| Data type | Earliest present (of probed) | Notes from probe |
|---|---|---|
| `game_data` | **KHM** (Feb 2021) | Present for KHM, STX, AFR, MID, VOW, NEO, SNC, HBG, DMU, BRO, ONE, SIR, MOM, LTR, WOE, LCI, KTK, MKM, OTJ, MH3, BLB, DSK, FDN, PIO, DFT, TDM, FIN, EOE, TLA, ECL. Absent: everything pre-KHM (ELD, THB, IKO, M21, AKR, ZNR, KLR), plus MAT, SPM, INR, Alchemy (Y22/Y23). |
| `draft_data` | **STX** (Apr 2021) | Present STX through ECL for PremierDraft (all probed sets). KHM absent. |
| `replay_data` | **STX** | Patchy early: present STX, AFR, DMU, MOM, WOE, LCI, and every probed set DSK onward (DSK, FDN, DFT, TDM, FIN, EOE, TLA, ECL); absent MID, VOW, NEO, ONE. |
| `QuickDraft` | VOW only (of probed) | Matches mtgr's "Quick Draft is only available for one set" note. |

Event types verified present for modern sets (LTR/BLB/ECL): PremierDraft, TradDraft, Sealed, TradSealed for game and replay; PremierDraft + TradDraft for draft data.

Representative gzipped sizes (from S3 Content-Length): LTR PremierDraft: draft 235 MB, game 74 MB, replay 547 MB. BLB: 202 / 69 / 525 MB. ECL (Jan 2026): 128 / 43 / 307 MB. Scale reference: LCI PremierDraft game data is 823,614 rows x 1,475 columns ([Joel Nitta](https://www.joelnitta.com/posts/2023-12-31_17lands-intro/)).

The newest sets are "updated regularly for a few months after initial set release" ([Data Mage EDA notes](https://mage.meehl.org/notebooks/10-eda/02-draft-data/01-premier-play/00-intro.html)).

### 2.4 Schemas (read from actual file headers)

**Game data** (`game_data_public.ECL.TradSealed.csv.gz`, 1,565 columns): 18 metadata columns, then 5 columns per card name.

```
expansion, event_type, draft_id, draft_time, game_time, build_index, match_number,
game_number, rank, opp_rank, main_colors, splash_colors, on_play, num_mulligans,
opp_num_mulligans, opp_colors, num_turns, won,
then per card: opening_hand_<name>, drawn_<name>, tutored_<name>, deck_<name>, sideboard_<name>
```

**Draft data** (`draft_data_public.ECL.TradDraft.csv.gz`, 633 columns): one row per pick.

```
expansion, event_type, draft_id, draft_time, rank, event_match_wins, event_match_losses,
pack_number, pick_number, pick, pick_2, pick_maindeck_rate, pick_sideboard_in_rate,
then per card: pack_card_<name> (293 cols, what was in the pack), pool_<name> (277 cols, what was already drafted)
```

(`pick_2` exists for pick-two draft variants; `pick_maindeck_rate`/`pick_sideboard_in_rate` give per-pick deck-inclusion follow-through, the standard mitigation for rare-draft/pick-for-collection noise.)

**Replay data** (`replay_data_public.ECL.TradSealed.csv.gz`, 2,555 columns): the same 18 game-metadata columns, plus `candidate_hand_1..7` and `opening_hand`, per-game totals for both players (`user_total_cards_drawn`, `..._tutored`, `..._discarded`, `user_total_lands_played`, `..._creatures_cast`, `..._non_creatures_cast`, `..._instants_sorceries_cast`, `user_total_mana_spent`, and `oppo_` mirrors), one `deck_<name>` column per card, and **1,890 per-turn columns**: for each of `user_turn_N` / `oppo_turn_N` (N up to 30):

```
cards_drawn, cards_tutored, cards_discarded, lands_played, creatures_cast,
non_creatures_cast, user/oppo_instants_sorceries_cast, user/oppo_abilities,
creatures_attacked, creatures_blocked, creatures_unblocked, creatures_blocking,
user/oppo_combat_damage_taken, user/oppo_creatures_killed_combat,
user/oppo_creatures_killed_non_combat, user/oppo_mana_spent,
eot_user/oppo_cards_in_hand, eot_user/oppo_lands_in_play,
eot_user/oppo_creatures_in_play, eot_user/oppo_non_creatures_in_play,
eot_user/oppo_life
```

This is the single most important schema in this lane: it is a per-turn board-state trace, which means every health metric we compute from self-play logs (interaction density, lead changes, mana development, board stalls) has a directly comparable human-data counterpart. **Design decision this implies: our self-play log exporter should emit a superset of these columns under the same names** so calibration is a join, not a mapping layer.

### 2.5 Aggregate JSON APIs (unofficial, use sparingly)

Verified working (but covered by the "we discourage automated scraping" guideline and explicitly unstable):

- `https://www.17lands.com/card_ratings/data?expansion={SET}&format={EVENT}&start_date=...&end_date=...` returns per-card JSON with exactly the aggregate fields from the metrics page: `seen_count, avg_seen (ALSA), pick_count, avg_pick (ATA), game_count, pool_count, play_rate, win_rate (GP WR), opening_hand_game_count, opening_hand_win_rate, drawn_game_count, drawn_win_rate, ever_drawn_game_count, ever_drawn_win_rate (GIH WR), never_drawn_game_count, never_drawn_win_rate (GNS WR), drawn_improvement_win_rate (IIH)`, plus `mtga_id`, color, rarity, Scryfall image URL. Low-sample fields come back `null` (they null out under-sampled stats rather than reporting noise). This endpoint is what the MIT-licensed Arena overlay [MTGA_Draft_17Lands](https://github.com/bstaple1/MTGA_Draft_17Lands) consumes.
- `https://www.17lands.com/data/play_draw` returns, for every set+event: `average_game_length` (in turns), `win_rate_on_play`, `sample_size`, and a `turns` array (histogram of games ending on turn 1..20+). Example record fetched 2026-08-09: AFR TradDraft `average_game_length: 8.787`, `win_rate_on_play: 0.5261`, `sample_size: 69,795`. This endpoint is the ready-made human baseline for game-length distribution and play/draw advantage per format.

For batch/CI work, prefer the CC BY 4.0 public dumps; treat these JSON endpoints as spot-check conveniences.

---

## 3. 17lands metric definitions (verbatim) and biases

Source: [https://www.17lands.com/metrics_definitions](https://www.17lands.com/metrics_definitions) (full text extracted from the site bundle 2026-08-09). Abbreviated here; definitional sentences are verbatim.

### 3.1 In-draft metrics

| Metric | Definition (verbatim core) | Caveat (verbatim core) |
|---|---|---|
| **# Seen** | "The number of packs in which a card was seen. Cards that come back around when we see them again on the wheel are only counted once." | No dedup if Arena ever packs duplicates. |
| **ALSA** (Avg Last Seen At) | "The average pick number where this card was last seen in packs. When a card comes back around on the wheel, only the second time around counts toward the average." | "When P1P1 contents are missing, ALSA is slightly elevated for cards that often do not wheel because cards are missing the data from pick 1." |
| **# Picked** | "The number of instances of this card picked by 17Lands drafters." | |
| **ATA** (Avg Taken At) | "The average pick number at which this card was taken by 17Lands drafters." | |

Drafts are treated as independent: "we treat each person's draft as entirely independent of any other information we have about the same draft pod."

### 3.2 In-game metrics

Granularity note, verbatim: statistics are "at the granularity of a game (not a match, even for Bo3) because players can and do change their decks between games". Inconsistent games (e.g., "had a card in hand that wasn't in the deck / sideboard") are dropped entirely.

| Metric | Definition (verbatim core) |
|---|---|
| **# GP / GP WR** | Games "with this card in the maindeck, multiplied by the number of copies" / "The win rate of decks with at least one copy of this card in the maindeck, weighted by the number of copies in the deck." |
| **% GP** (Play Rate) | "The rate at which this card was included in the deck (when available in the card pool)", weighted by games and copies. Caveat: includes Bo3 games 2/3, so conditional sideboard cards differ between Bo1 and Bo3. |
| **# OH / OH WR** | "The win rate of games where an instance of this card was in the opening hand", instance-weighted. Opening hand = "the full hand that was kept after any mulligan decisions", including cards bottomed afterward (definition changed 2024-11-12, see changelog). Caveat, verbatim: "This metric is biased by the fact that some cards—usually expensive or otherwise hard-to-cast ones—are more likely to contribute to a hand being mulliganed." |
| **# GD / GD WR** | Drawn "from the deck into hand, not counting the opening hand"; excludes bounce/graveyard returns and tutors; tutoring is "any effect where the player chooses from cards in their library" including top-N selection. |
| **# GIH / GIH WR** | "The win rate of games where an instance of this card was drawn into hand, either in the opening hand or later", instance-weighted (a game with 3 copies seen counts 3x). |
| **# GNS / GNS WR** | Maindeck copies "minus the number of copies that were drawn or tutored"; win rate of games where copies were in deck but never seen. |
| **IIH** (Improvement In Hand, formerly IWD) | "The difference between Games in Hand Win Rate and Games Not Seen Win Rate." Caveat, verbatim: "This metric is a simple difference and does not weight by the number of games in each situation, which may overvalue powerful late-game cards." |

Outlier convention: arrows on ALSA/GIH WR/IIH mark "any value that is at least 1.5 standard deviations away from the mean"; hover popups expose rank, z-score, column mean and SD. (Adopt this exact convention for our set-health reports.)

Changelog highlights (same page): 2025-08-01 "We renamed Improvement When Drawn to Improvement In Hand ... The definition remains the same." 2024-11-12 opening-hand redefinition (kept-hand semantics). Implication: when comparing across eras of 17lands data, pin the definition version.

User skill groups (same page): Top/Middle/Bottom groups defined by win rate "in at least 2 of the last 3 sets", per format, with rank-adjusted thresholds; "Most users don't fall into any of the groups."

### 3.3 Documented biases (with sources)

1. **Population skill shift.** 17lands users average "56%, which is a pretty big step up from 50%" game win rate ([MTG Arena Zone, "In Defense of the Data"](https://mtgazone.com/17lands-in-defense-of-the-data/)). All 17lands-derived baselines are drawn from an above-average, self-selected population. Our calibration must compare bots to *this* population, not to "average humans".
2. **Game-length bias in GIH/IIH.** Long games see more cards, so cards in decks that win long games look better; "in games lost, those cards are much less likely to have been drawn because they were way shorter" ([17lands blog, "Using Win Rate Data", Sierkovitz](https://blog.17lands.com/posts/using-win-rate-data/)). The IIH caveat above is the official acknowledgment.
3. **Deck/archetype context.** GP WR credits cards for their deck: the Strixhaven example of Arrogant Poet at 62.4% GP WR "just along for the ride in a WB Silverquill deck" ([mtgds, "Knowledge and Power"](https://mtgds.wordpress.com/2022/02/28/knowledge-and-power-estimating-adjusted-win-rate-in-magic-the-gathering-limited/)). Multicolor cards only appear in decks that fit them; mono-color cards get dragged into bad fits ([Sierkovitz](https://blog.17lands.com/posts/using-win-rate-data/)).
4. **GP WR dilution.** In GP WR, games where the card was never drawn contribute nothing but noise; Sierkovitz: "half the data the metric is computed over is actually complete noise" ([same post](https://blog.17lands.com/posts/using-win-rate-data/)).
5. **Missing P1P1** in Arena logs biases ALSA upward for non-wheeling cards (official caveat, §3.1); the public datasets page repeats "P1P1 data may be missing in some sets".
6. **Pick-intent noise (rare-drafting).** Picks made for collection value rather than deck value distort ATA/ALSA and pool composition. The dataset's own mitigation is per-pick `pick_maindeck_rate` / `pick_sideboard_in_rate` (verified columns, §2.4): picks that never get maindecked can be down-weighted. DEq (below) additionally corrects card quality for pick position.
7. **Covariate magnitudes** to control for (estimated by [mtgds' regression](https://mtgds.wordpress.com/2022/02/28/knowledge-and-power-estimating-adjusted-win-rate-in-magic-the-gathering-limited/) on 17lands data): being on the play ~ +4.0% win rate; one mulligan ~ -14.4% (opponent mulligan ~ +13.9%). "A single mulligan effect (~14%) dwarfs any individual card's impact."

### 3.4 Community-derived corrected metrics (portable patterns)

- **AWR (Adjusted Win Rate), mtgds.** Logistic-regression per-card strength with covariates (player overall WR, on-play, own/opponent mulligans) plus pairwise synergy terms; predicted deck WR correlates with actual at 0.24 vs 0.15 for summed GP WR. Signpost uncommons show low isolated strength but high synergy coefficients, validating the model against design intent. ([source](https://mtgds.wordpress.com/2022/02/28/knowledge-and-power-estimating-adjusted-win-rate-in-magic-the-gathering-limited/)). Verdict: **inspire** (port the regression as our card-quality estimator over self-play logs; our logs have all covariates).
- **DEq (Estimated Draft Equity), MagicFlea.** Pick-order metric: `GP%(c) x [GP WR(c) - mu_ATA(c) + pick-equity]`, where pick equity is a quadratic in pick position ("P1 being worth 3%"), correcting GP WR for pick position and deck-quality bias ([DEq: The Math](https://magic-flea.com/on-draft/deq-math.html), [overview](https://magic-flea.com/on-draft/deq.html)). Verdict: **inspire** (relevant when our draft-lab bots need a human-comparable pick-order target).

---

## 4. Format/set health quantification: prior art

### 4.1 17lands format speed (primary data)

The `/data/play_draw` endpoint (§2.5) provides per set+event: average game length in turns, on-play win rate, sample size, and the full distribution of game-ending turns. Example (fetched 2026-08-09): AFR TradDraft 8.79 avg turns, 52.6% on play, n=69,795; ZNR Sealed 9.25 turns, 50.9% on play. Sierkovitz's format-speed methodology adds: turn-end histograms ("most games end on turn 8 (17.9%) and 7 (17.6%)" in ONE), cumulative games-finished-by-turn curves (55% of ONE games done by turn 8 vs 40% in BRO), win/loss-segmented speed, and the observation that on-play advantage normally tracks format speed ([MTG Arena Zone, "Speed of Phyrexia"](https://mtgazone.com/speed-of-phyrexia-all-will-be-one-limited/); ONE averaged 8.4 turns vs BRO's 8.9-10.2). All of these are directly computable from our self-play logs.

### 4.2 Composite format-health indices

The [MtG Health Index Project](https://mtghealth.org/algorithm-details) (constructed formats) computes a weighted composite: archetype distribution 15% (Bray-Curtis dissimilarity against historical/90-day/conceptual 33-33-33 aggro-control-combo baselines), metagame diversity 20% (Shannon index on decks + HHI on cards), event growth 15%, player growth 15%, winner dominance 15% (`100 x (1 - sum(months_at_#1)^2 / 144)`), price 10%, B&R sentiment 10%. Verdict: **inspire**. The portable part for us is the *shape*: normalized sub-scores with explicit weights, diversity via Shannon/HHI, dominance via concentration. The constructed-specific inputs (price, event growth) do not apply.

### 4.3 Removal density conventions

Sierkovitz's per-set removal guides categorize removal as unconditional / damage-based / conditional / sweepers / tempo, count it per color, and compare density against past formats and against the format's creature suite ([MKM guide](https://mtgazone.com/murders-at-karlov-manor-mkm-limited-removal-guide/), [MOM unconditional](https://mtgazone.com/march-of-the-machine-removal-guide-for-limited-unconditional-removal/), [author index](https://mtgazone.com/author/sierkovitz/)). Verdict: **inspire**: encode the taxonomy as card-DSL tags so removal as-fan per color is a static CI check, and removal *casts per game* is a dynamic one.

### 4.4 Mana-base math (screw/flood baselines)

Frank Karsten's hypergeometric framework (originally "How Many Colored Mana Sources Do You Need to Consistently Cast Your Spells?", ChannelFireball) sets the standard: ~90% on-curve castability as the reliability threshold, tables of required colored sources per cost; 17 lands is the 40-card default, 16 for very low curves ([Draftsim summary for 40-card decks](https://draftsim.com/mtg-40-card-deck-number-of-lands/), [community-maintained update of the tables](https://gist.github.com/teryror/881d60e08480a56043895d3bbb83c374)). Verdict: **adopt the math** (deterministic formulas, no code needed; use as the analytic prior that self-play screw rates are validated against).

### 4.5 Academic self-play balance work

- **Ludi / Evolutionary Game Design (Cameron Browne).** The origin of measuring game quality from self-play: computable criteria including **drama** ("the chance a player has to recover from bad positions"), **uncertainty** (of outcome), lead changes, decisiveness, duration; used as fitness to evolve games, one of which was commercially published ([Evolutionary Game Design](https://www.researchgate.net/publication/224111054_Evolutionary_Game_Design); [Springer review](https://link.springer.com/article/10.1007/s10710-012-9165-6)). Verdict: **inspire**; our comeback-frequency and decisiveness metrics below are Ludi metrics instantiated on MTG state traces.
- **Evolving the Hearthstone Meta** (de Mesentier Silva, Canaan, Lee, Fontaine, Togelius, Hoover; IEEE CoG 2019). Balance = matchup win-rate matrix approaching 50%, fitness additionally minimizing the number/size of card changes ([arXiv 1907.01623](https://arxiv.org/abs/1907.01623)). Verdict: **inspire** (the "minimal nerf that rebalances" search is a natural future lab feature on top of our sim).
- **Metagame Autobalancing for Competitive Multiplayer Games** ([arXiv 2006.04419](https://arxiv.org/pdf/2006.04419)): automated parameter tuning against metagame balance objectives. **Inspire.**
- **RuleSmith: Multi-Agent LLMs for Automated Game Balancing** ([arXiv 2602.06232](https://arxiv.org/abs/2602.06232)): LLM agents self-play from textual rulebooks; Bayesian optimization over rule space against win-rate-disparity metrics, with adaptive sampling (more games for promising candidates). Demonstrated on a civ-like game, not MTG; no code-release statement found. Verdict: **inspire** (closest published analogue to our "LLM agents + balance CI" loop; the adaptive game-allocation trick is worth porting to keep sim budgets down).
- **Causal Reinforcement Learning for Complex Card Games: A Magic The Gathering Benchmark** (da Costa Cunha, Mian, French, Liu; [arXiv 2605.06066](https://arxiv.org/abs/2605.06066)): Gymnasium MTG environment, 5 Standard archetypes, masked 478-action space, reference baselines incl. masked PPO; authors state they "release the benchmark, reference-baseline results, and full evaluation protocol openly" (paper CC BY 4.0; code license not yet verified). Verdict: **investigate/inspire**; if the env is genuinely open it is a candidate stronger-bot tier for constructed sim, but it covers a fixed Standard slice, not custom sets.
- **Different Forms of Imbalance in Strongly Playable Discrete Games** ([arXiv 2511.00374](https://arxiv.org/pdf/2511.00374)): formal taxonomy of imbalance in RPS-like metagames; background for interpreting archetype matrices. **Inspire.**

---

## 5. WotC's computable design heuristics

### 5.1 New World Order (complexity budget at common)

Primary source: Mark Rosewater, ["New World Order"](https://magic.wizards.com/en/news/making-magic/new-world-order-2011-12-05) (Making Magic, 2011-12-05). Three complexity types: **comprehension** (can you parse the card), **board** ("not about what cards can do but rather about how they interact with one another while they are on the battlefield"), **strategic** (finding the optimal line; deliberately preserved, "requires a certain amount of game knowledge before it's visible"). Governing principle: "complexity as a limited resource at common"; also "If your theme is not at common, it's not your theme."

The numeric budget is not in the 2011 article itself; it is documented from R&D practice by the community: "in any given set, approximately 20% of the Commons violate New World Order in some way or another" with red flags including "more than 4 lines of rules text", "affects other cards in play", "creates a 2-for-1 on the board", "forces you to track information that normally is irrelevant" ([Writer Adept summary of Rosewater's article + Drive to Work podcast](http://writeradept.blogspot.com/2014/06/common-design-part-1-new-world-order.html); corroborated by the [MTG Salvation NWO+Redflagging primer](https://www.mtgsalvation.com/forums/magic-fundamentals/custom-card-creation/578926-primer-nwo-redflagging)). See also Rosewater's follow-up ["New New World Order"](https://magic.wizards.com/en/news/making-magic/new-new-world-order-2013-04-01).

**Computable CI checks:** red-flag classifier over the card DSL (line count is mechanical; "affects other permanents", "board 2-for-1", "memory requirement" are DSL-taggable or LLM-judged per ZFC), assert red-flagged commons <= 20% of commons.

### 5.2 As-fan

Definition ([MTG Wiki, "As-fan"](https://mtg.fandom.com/wiki/As-fan)): R&D term, short for "as-fanned": how much of a characteristic shows up in an average booster; as-fan 1.0 = one card with the quality per booster on average. It is a function of card counts per rarity and the pack's rarity slots; Rosewater's Nuts & Bolts columns work examples ([N&B #12 part 2, Limited themes](https://magic.wizards.com/en/news/making-magic/nuts-bolts-12-part-2-limited-themes-2020-03-16); [N&B #16, Play Boosters](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-16-play-boosters) for the current 14-card play-booster structure that changes the denominators). **Computable check:** as-fan of any DSL tag (mechanic, removal, fixing) = sum over slots of P(card with tag in slot); assert per-theme targets.

### 5.3 Design skeleton (curve and composition norms)

Primary source: Rosewater, ["Nuts & Bolts #13: Design Skeleton Revisited"](https://magic.wizards.com/en/news/making-magic/nuts-bolts-13-design-skeleton-revisited-2021-03-22) (2021):

- Large-set default: **101 commons** (19 per color + 6 artifact), **80 uncommons** (13 per color + 10-card multicolor cycle + 5 artifact).
- Creature share at common, verbatim: "White – 62%, Blue – 50%, Black – 56%, Red – 53%, Green – 59%" (≈ 12/9/11/10/11 creatures of 19, +3 artifact creatures).
- Per color at common: ~12 creature slots laid out on a curve (e.g., white CW01 at 1 MV up through 5-6 MV) and 7 non-creature slots.
- Uncommon structure: 8 creatures + 5 non-creature spells per color.

**Computable checks:** color balance (equal card counts per color per rarity), creature ratios within ±1 slot of the norms, curve histogram per color at common vs skeleton, rarity distribution.

These are norms for *retail-style* sets; the CI should treat them as warnings with per-set overrides (MH-style or cube-like sets deliberately deviate).

---

## 6. Self-play balance stats in existing simulators, and the bot-skill gap

### 6.1 Forge (the documented precedent)

Forge's headless sim mode ([Card-Forge/forge wiki, "ai"](https://github.com/Card-Forge/forge/wiki/ai); repo license **GPL-3.0**, verified from LICENSE via GitHub API):

```
sim -d <deck1[.dck]> ... <deckX[.dck]> -D [path] -n [N] -f [F] -t [T] -p [P] -q
```

with `-n` games, `-m` best-of-M, tournament modes (Bracket/RoundRobin/Swiss), `-c` clock limit (default 120s before draw), quiet mode. Output is winner announcements + logs; the community workflow is "parse log files from 50-100 head-to-head battles ... using Python" ([slightlymagic.net forum](https://slightlymagic.net/forum/viewtopic.php?f=26&t=10641), [Draftsim's Forge guide](https://draftsim.com/forge-mtg/)).

**Documented AI bias, from Forge's own wiki:** AI is "best with Aggro and midrange decks, poor to ok in control decks, and pretty bad for most combo decks"; it is heuristic, "not 'trained'", "crafted around basic rules and can be easy to overcome knowing its weaknesses"; complex board states make games "almost unbearably long". This is the clearest published statement of the exact bot-skill bias our calibration protocol must measure: heuristic bots systematically under-realize reactive/synergy strategies, which *inflates* aggro win rates and *deflates* control/combo archetype health in self-play stats.

### 6.2 In-house precedent (the prior project)

`src/balance/combatLengthSim.ts` + `greedyShardSimulation.test.ts` (see `the prior-project reuse audit`): seeded RNG, greedy policy, synthetic decks per strategy, 1,000 games/strategy, asserted win-rate band (40-70%), no-dominant-strategy guard, median game-length windows, run as `npm run test:balance`. This is the CI skeleton to scale up; nothing in the external prior art contradicts its shape.

### 6.3 Draft bots (for the draft-lab half of calibration)

- **Ward et al., "AI solutions for drafting in Magic: the Gathering"** ([arXiv 2009.00655](https://arxiv.org/abs/2009.00655), IEEE CoG): four agent tiers (naive heuristic, expert-tuned heuristic, Naive Bayes, deep NN) trained/evaluated on 100,000+ human drafts from Draftsim, scored on *agreement with human picks* across the draft timeline; the NN wins, heuristics lose. Two lessons: (a) pick-agreement-with-humans is the established evaluation for draft bots, (b) heuristic draft bots measurably diverge from human pick order, so bot-drafted decks are not human decks; calibrate the two stages separately (§8).
- **[CubeArtisan/mtgdraftbots](https://github.com/CubeArtisan/mtgdraftbots)**: ML draft bots for sets and cubes; license **AGPL-3.0** (verified). Verdict: **inspire only**; do not link or port code into our strict-TS codebase (AGPL contamination), but the approach (train pick model on 17lands draft CSVs) is exactly reproducible from the public data.
- **[danieljbrooks/statistical-drafting](https://github.com/danieljbrooks/statistical-drafting)**: MIT (verified, "Copyright (c) 2024 Daniel Brooks"), actively updated (2026-07), trains drafting networks on 17lands draft data. Verdict: **interop/adopt** as a reference implementation for a human-calibrated pick model.
- **[Senryoku/Draftmancer](https://github.com/Senryoku/Draftmancer)**: MIT (verified), multiplayer limited simulator with bots and custom-set support; primarily the draft-lab lane's concern, noted here because its bots + custom card format make it the fastest path to human-vs-bot draft comparisons on custom sets.

### 6.4 Known bot-vs-human gaps to expect (all sourced above)

1. Archetype realization bias: aggro/midrange over-perform under heuristic bots (Forge wiki).
2. Game-length distortion: bot stalls and missed lethal lines lengthen games; conversely missing control lines can shorten them; measure per archetype (Forge "unbearably long" note; Sierkovitz's win/loss-segmented speed shows length is skill-sensitive in humans too).
3. Draft-pick divergence: heuristic bots diverge from human pick order, propagating into deck composition (Ward et al.).
4. Baseline population: the human comparison set is itself skill-shifted (56% average, MTGAZone), and 17lands buckets users by win rate, which lets us locate our bots on the human skill spectrum rather than pretending to match "average".

---

## 7. Candidate metric suite (computable from OUR self-play logs alone)

Every metric below is computable from headless self-play logs with no human data; the "human counterpart" column is what it calibrates against on a real set. Notation: per-game log must record per-turn actions and end-of-turn state (design the exporter as a superset of the 17lands replay schema, §2.4).

### Tier A: game-shape metrics (format speed and feel)

| # | Metric | Definition from our logs | Human counterpart (calibration) | Source |
|---|---|---|---|---|
| A1 | Game length distribution | Histogram + mean/median of `num_turns`; cumulative %-finished-by-turn curve | `/data/play_draw` `turns` histogram and `average_game_length` per set/event; replay `num_turns` | [17lands play_draw endpoint](https://www.17lands.com/) (verified §2.5); [Sierkovitz methodology](https://mtgazone.com/speed-of-phyrexia-all-will-be-one-limited/) |
| A2 | On-play win rate | P(win \| on_play) - 0.5 | `win_rate_on_play` per set/event (e.g., AFR 52.6%); mtgds regression +4.0% | [play_draw](https://www.17lands.com/); [mtgds](https://mtgds.wordpress.com/2022/02/28/knowledge-and-power-estimating-adjusted-win-rate-in-magic-the-gathering-limited/) |
| A3 | Mulligan rate & penalty | % games with >=1 mulligan; delta WR per mulligan (regression-controlled) | game data `num_mulligans`; mtgds -14.4%/mulligan | [mtgds](https://mtgds.wordpress.com/2022/02/28/knowledge-and-power-estimating-adjusted-win-rate-in-magic-the-gathering-limited/); schema §2.4 |
| A4 | Mana screw rate | % games below L lands in play at end of turn T (e.g., <3 by T4, <4 by T6), and screw-conditional WR; flood: lands in play minus mana spent trend | replay `eot_*_lands_in_play`, `*_mana_spent` per turn; Karsten hypergeometric priors (17 lands / 40 cards, 90% on-curve target) | schema §2.4; [Karsten via Draftsim](https://draftsim.com/mtg-40-card-deck-number-of-lands/), [tables](https://gist.github.com/teryror/881d60e08480a56043895d3bbb83c374) |
| A5 | Decisiveness / stall rate | % games hitting turn cap or ending in draws; % turns with no state-advancing action | Forge clock-to-draw precedent; Browne's decisiveness/duration criteria | [Forge wiki](https://github.com/Card-Forge/forge/wiki/ai); [Browne](https://www.researchgate.net/publication/224111054_Evolutionary_Game_Design) |

### Tier B: interaction and drama

| # | Metric | Definition from our logs | Human counterpart | Source |
|---|---|---|---|---|
| B1 | Interaction density | Per game: removal spells cast, creatures killed (combat vs non-combat), instants/sorceries cast on opponents' turns | replay `*_creatures_killed_combat`, `*_creatures_killed_non_combat`, `*_instants_sorceries_cast` per turn | schema §2.4; taxonomy from [Sierkovitz removal guides](https://mtgazone.com/murders-at-karlov-manor-mkm-limited-removal-guide/) |
| B2 | Comeback frequency ("drama") | P(win \| life deficit >= X at turn T); count of life-total lead changes per game; board-advantage lead changes (creature count delta sign flips) | replay `eot_user_life` / `eot_oppo_life`, `eot_*_creatures_in_play` per turn | schema §2.4; drama/uncertainty from [Browne, Evolutionary Game Design](https://www.researchgate.net/publication/224111054_Evolutionary_Game_Design) |
| B3 | Board development curve | Mean creatures/non-creatures in play per turn, per archetype; divergence turn (when the winner's board pulls ahead) | replay `eot_*_creatures_in_play`, `eot_*_non_creatures_in_play` | schema §2.4 |
| B4 | Combat participation | Attacks/blocks per turn; % creatures that ever attack/block; unblocked-attack share | replay `creatures_attacked/blocked/unblocked/blocking` | schema §2.4 |

### Tier C: balance and card-quality metrics

| # | Metric | Definition from our logs | Human counterpart | Source |
|---|---|---|---|---|
| C1 | Archetype/color-pair WR spread | For each 2-color archetype: WR vs field; assert max-min spread <= band; no-dominant-strategy guard (the prior project 40-70% precedent) | game data `main_colors` WR; 17lands color/deck data pages; MtG Health archetype-distribution scoring | the prior-project reuse audit; [MtG Health Index](https://mtghealth.org/algorithm-details); [Hearthstone 50% target](https://arxiv.org/abs/1907.01623) |
| C2 | Card-level GIH WR / OH WR / GD WR / GNS WR / IIH | Implement 17lands definitions verbatim (§3.2), instance-weighted, kept-hand semantics | same metrics from public game data; `card_ratings` API for spot checks | [metrics_definitions](https://www.17lands.com/metrics_definitions) (§3.2) |
| C3 | Common-quality spread | SD of GIH WR across commons; count of >=1.5-sigma outliers (17lands outlier convention); floor check (no common below X% GIH WR = unplayable slot) | same statistic over public data for the calibration set | [metrics_definitions outlier convention](https://www.17lands.com/metrics_definitions) |
| C4 | Rarity lift (bomb dominance) | Mean GIH WR by rarity; assert rare-over-common lift within band; per-card cap on IIH at rare | same from public data | [metrics_definitions](https://www.17lands.com/metrics_definitions); game-length bias caveat §3.3 |
| C5 | Adjusted card strength (AWR-style) | Logistic regression of game result on card presence + covariates (on-play, mulligans, archetype), synergy terms optional | mtgds AWR coefficients methodology | [mtgds](https://mtgds.wordpress.com/2022/02/28/estimating-adjusted-win-rate-in-magic-the-gathering-limited/) |

### Tier D: static design-conformance checks (no simulation needed, same CI)

| # | Check | Assertion | Source |
|---|---|---|---|
| D1 | NWO complexity budget | red-flagged commons <= 20% of commons (red flags: >4 lines rules text, affects other permanents in play, board 2-for-1, hidden-info tracking); semantic flags LLM-judged per ZFC | [Rosewater 2011](https://magic.wizards.com/en/news/making-magic/new-world-order-2011-12-05); [Writer Adept](http://writeradept.blogspot.com/2014/06/common-design-part-1-new-world-order.html) |
| D2 | Design-skeleton conformance | color balance per rarity; creature % at common near W62/U50/B56/R53/G59; curve histogram per color vs skeleton; 101C/80U large-set shape | [N&B #13](https://magic.wizards.com/en/news/making-magic/nuts-bolts-13-design-skeleton-revisited-2021-03-22) |
| D3 | As-fan targets | as-fan of removal, fixing, and each named mechanic within per-set targets, computed from booster slot structure | [MTG Wiki as-fan](https://mtg.fandom.com/wiki/As-fan); [N&B #16](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-16-play-boosters) |
| D4 | Removal taxonomy density | counts of unconditional/damage/conditional/sweeper/tempo removal per color vs comparable real sets | [Sierkovitz removal guides](https://mtgazone.com/murders-at-karlov-manor-mkm-limited-removal-guide/) |
| D5 | Mana-base feasibility | every archetype's gold/splash requirements satisfiable at Karsten 90% thresholds given the set's fixing | [Karsten tables](https://gist.github.com/teryror/881d60e08480a56043895d3bbb83c374) |

---

## 8. Calibration protocol (bots on a real set vs 17lands)

Goal: measure, per metric, the transfer function from our-bots-on-a-real-set to humans-on-the-same-set, then apply those corrections (with widened tolerances) when asserting health of novel sets that have zero human data.

**Step 0: Pick calibration sets.** Require all three data types present (probe table §2.3). Recommended: one modern mid-speed set (**DSK** or **BLB**: draft 202 MB + game 69 MB + replay 525 MB, huge samples), one fast set (**ONE** has no replay data; use **MKM/OTJ**-era or check probe), and the most recent full-triple set (**ECL**) for current Arena-era play patterns. Using two or three sets guards against overfitting corrections to one format's quirks.

**Step 1: Human-side metric suite.** Ingest the public CSVs with [`spells`](https://github.com/oelarnes/spells) (MIT; converts to parquet, computes ALSA/GIH WR etc. out of the box, supports custom Polars extensions and MTGJSON card data). Compute every Tier A-C metric from the game+replay files. Attribute 17Lands per CC BY 4.0.

**Step 2: Implement the set in our engine.** The calibration set must be fully enforceable in our DSL (this is also the engine lane's conformance milestone). Same card pool, same booster structure (from MTGJSON, which `spells` already models).

**Step 3: Two calibration modes, run separately.**
- **Mode P (play-skill only):** replay *human deck compositions* with our game bots. Sample decks from the game data `deck_*` columns (each row carries its full 40-card deck), replay bot-vs-bot with matched deck pairings. Any metric deviation is attributable to play skill, not deck construction. This isolates the Forge-documented bias (aggro over-realization etc.).
- **Mode F (full pipeline):** bot drafts (draft lab) then bot play. The delta between Mode F and Mode P isolates draft/deckbuild divergence; evaluate draft bots separately on pick agreement with the 17lands draft CSVs (established methodology: [Ward et al.](https://arxiv.org/abs/2009.00655); MIT reference implementation: [statistical-drafting](https://github.com/danieljbrooks/statistical-drafting)).

**Step 4: Compare distributions, not points.**
- A1: KS distance / EMD between our game-length histogram and the play_draw histogram; compare medians and tail mass (T12+ games).
- A2-A5: absolute deltas with bootstrap CIs.
- B1-B4: ratio of bot to human per-game rates (e.g., creatures killed per game); these are the metrics most likely to show systematic bot offsets.
- C1: spread-ratio (bot archetype spread / human archetype spread) and rank correlation of archetype ordering.
- C2-C4: **Spearman rank correlation of per-card GIH WR (bots) vs GIH WR (humans)** at common/uncommon, plus mean absolute deviation. Rank correlation is the headline number; the lab's set-generation loop needs ordering fidelity more than level fidelity.
- Control covariates as in mtgds (on-play, mulligans) before comparing card-level stats.

**Step 5: Skill anchoring.** Recompute human-side metrics stratified by `user_game_win_rate_bucket` (2% buckets, in the data) and find the bucket whose metric vector is nearest our bots'. Report "our heuristic bots play like a ~X% 17lands user" and calibrate against that stratum, not the full population (which itself averages ~56%, [MTGAZone](https://mtgazone.com/17lands-in-defense-of-the-data/)).

**Step 6: Freeze a versioned correction table.** Per metric: expected bot-vs-human offset (additive or multiplicative), tolerance band, and the engine+bot version hash it was measured under. CI for novel sets asserts *corrected* metrics within bands. Re-run the whole protocol on any bot or engine change that could shift play strength (treat the correction table like a model checkpoint, not a constant).

**Step 7: Standing validity checks.**
- Directional expectations to verify each run (from §6.4): bots inflate aggro archetype WR, deflate control/combo, distort game length in a measurable direction. If a correction's sign flips between calibration sets, the metric does not transfer and must be demoted from CI-gating to advisory.
- Definitions pinned to the 17lands changelog (kept-hand OH semantics post-2024-11-12; IIH naming post-2025-08-01).
- Sample-size floors: null out card-level stats under N games as 17lands does (their API returns null for under-sampled cards); use seeded sims and report N everywhere.

**What zero-human-data sets inherit:** Tier D checks apply unchanged (static). Tier A/B/C metrics apply with corrections and widened bands; the no-dominant-strategy guard (C1) and screw/stall guards (A4/A5) are the most transferable because they compare bots to bots within the same sim regime; per-card level calibration (C2 exact levels) is the least transferable and should gate only on distribution shape and outlier counts.

---

## 9. Artifact verdicts

| Artifact | What it is | License (verified) | Verdict | One-line reason |
|---|---|---|---|---|
| [17lands public datasets](https://www.17lands.com/public_datasets) | Draft/game/replay CSVs per set on S3 | CC BY 4.0 (verbatim on page) | **adopt** | The human calibration baseline; attribution required, granularity verified sufficient. |
| [spells](https://github.com/oelarnes/spells) | Python/Polars analysis package for 17lands public data | MIT ("Copyright (c) 2024 Joel Barnes") | **adopt** | Downloads, caches, parquet-izes, and computes all standard aggregates correctly; maintained (updated 2026-08-09); saves us the whole human-side harness. |
| [17lands metric definitions](https://www.17lands.com/metrics_definitions) | ALSA/ATA/GP/OH/GD/GIH/GNS/IIH semantics | n/a (definitions) | **interop** | Implement identical semantics over our logs so numbers are directly comparable. |
| 17lands replay-data schema (§2.4) | Per-turn board-state column layout | CC BY 4.0 (data) | **interop** | Make our self-play log exporter emit a superset with the same column names; calibration becomes a join. |
| 17lands JSON APIs (`card_ratings/data`, `data/play_draw`) | Live aggregate endpoints | Unofficial; scraping discouraged in [usage guidelines](https://www.17lands.com/usage_guidelines) | **interop (sparingly)** | Spot-check convenience only; unstable by their own statement; batch work uses the dumps. |
| [MTGA_Draft_17Lands](https://github.com/bstaple1/MTGA_Draft_17Lands) | Arena draft overlay consuming 17lands API | MIT ("Copyright (c) 2022 bstaple1") | **inspire** | Documents API usage patterns and rating presentation; we are not building an Arena overlay. |
| [limited-grades](https://github.com/youssefm/limited-grades) | Tier-list visualization of 17lands win rates | MIT ("Copyright (c) 2022 Youssef Moussaoui") | **inspire** | Grade-curve presentation convention for card-quality reports in the lab UI. |
| [statistical-drafting](https://github.com/danieljbrooks/statistical-drafting) | Pick networks trained on 17lands draft data | MIT ("Copyright (c) 2024 Daniel Brooks") | **interop** | Reference implementation for a human-calibrated draft-pick model; evaluation target for our draft bots. |
| [mtgdraftbots](https://github.com/CubeArtisan/mtgdraftbots) | ML draft bots (CubeArtisan) | AGPL-3.0 | **inspire only** | AGPL contamination risk for our codebase; the training approach is reproducible from public data. |
| [Draftmancer](https://github.com/Senryoku/Draftmancer) | Multiplayer limited simulator with bots, custom sets | MIT ("Copyright (c) 2020 Yoann Maret-Verdant") | **interop** | (Draft-lab lane's call) speaks custom-set formats and has bots; useful for human-vs-bot draft comparisons. |
| [Forge sim mode](https://github.com/Card-Forge/forge/wiki/ai) | Headless AI-vs-AI match runner | GPL-3.0 | **inspire** | Precedent + documented bot-bias evidence; GPL and Java keep it out of our TS core (engine lane decides any headless wrapping). |
| [mtgds AWR](https://mtgds.wordpress.com/2022/02/28/knowledge-and-power-estimating-adjusted-win-rate-in-magic-the-gathering-limited/) | Regression-adjusted card win rate + synergy | Blog methodology | **inspire** | Port the covariate-controlled regression as our card-strength estimator (C5). |
| [DEq](https://magic-flea.com/on-draft/deq-math.html) | Pick-order metric correcting GP WR by pick equity | Site methodology | **inspire** | Target function shape for draft-bot pick order. |
| [MtG Health Index](https://mtghealth.org/algorithm-details) | Weighted composite format-health score | Site methodology | **inspire** | Composite-score shape (Shannon/HHI diversity, dominance concentration); constructed-specific inputs dropped. |
| [Ludi / Evolutionary Game Design](https://www.researchgate.net/publication/224111054_Evolutionary_Game_Design) | Self-play game-quality criteria (drama, uncertainty, decisiveness) | Academic | **inspire** | The intellectual basis for Tier B metrics. |
| [Evolving the Hearthstone Meta](https://arxiv.org/abs/1907.01623) | Evolutionary rebalancing to 50% matchups, minimal changes | Academic | **inspire** | Future "minimal nerf" search on top of our sim. |
| [RuleSmith](https://arxiv.org/abs/2602.06232) | Multi-agent LLM self-play + Bayesian opt for balancing | CC BY 4.0 paper; no code found | **inspire** | Closest analogue to our LLM-agent balance loop; steal adaptive game allocation. |
| [MTG-Causal-RL benchmark](https://arxiv.org/abs/2605.06066) | Gymnasium MTG env, 5 Standard archetypes, PPO baselines | CC BY 4.0 paper; code license unverified | **inspire (investigate)** | Possible stronger-bot tier if the env is truly open; fixed Standard slice, not custom sets. |
| WotC NWO / as-fan / design skeleton ([1](https://magic.wizards.com/en/news/making-magic/new-world-order-2011-12-05), [2](https://mtg.fandom.com/wiki/As-fan), [3](https://magic.wizards.com/en/news/making-magic/nuts-bolts-13-design-skeleton-revisited-2021-03-22)) | Published design heuristics | Articles | **adopt (as rules)** | Directly computable Tier D CI checks; numbers quoted in §5. |
| [Karsten mana math](https://draftsim.com/mtg-40-card-deck-number-of-lands/) | Hypergeometric castability thresholds | Articles/tables | **adopt (as math)** | Analytic prior for A4/D5; no code dependency. |
| [mtgr](https://joelnitta.github.io/mtgr/reference/mr_download_17lands_file.html) | R package for 17lands data | R package (MIT per repo docs; superseded for us by spells) | **skip** | We are not an R shop; `spells` covers the same ground better for Python-side analysis. |
| [17lands-helper](https://github.com/JasonYe4273/17lands-helper), misc analysis repos | One-off scrapers/analyses | Various/none | **skip** | Unmaintained or unlicensed; nothing they do that spells + our suite doesn't. |

---

## 10. Risks

1. **Correction transfer is the load-bearing assumption.** Corrections measured on real sets may not transfer to novel mechanics that stress bot weaknesses differently (a novel stax-like mechanic will break heuristic bots in ways no calibration set predicted). Mitigation: multi-set calibration, sign-stability demotion rule (§8 step 7), and LLM-agent spot-play on flagged archetypes.
2. **Human baseline is Arena Bo1-heavy and skill-shifted** (56% average user WR; Bo1 hand-smoothing algorithm on Arena also shifts mulligan/screw baselines vs paper). Calibrate per event type and only against matching event types.
3. **17lands definitions drift** (2024-11 opening-hand redefinition; 2025-08 IIH rename). Pin dataset vintages and definition versions in the correction table.
4. **Coverage gaps**: no replay data for MID/VOW/NEO/ONE; no public data before KHM; QuickDraft essentially absent. Set choice for calibration is constrained to the verified table (§2.3).
5. **API instability and goodwill**: the aggregate endpoints are explicitly unstable and scraping is discouraged; 17lands "reserve the right to request anyone stop using our data". Keep all heavy use on the CC BY 4.0 dumps, attribute clearly, and honor the embargo if we ever publish set analyses.
6. **AGPL contamination** if anyone shortcuts draft-bot work by vendoring mtgdraftbots code.
7. **Sample-size illusions in self-play**: bot determinism means N games are not N independent human-like samples; seeded variation (decks, mulligan policy, RNG) must be part of the sim design or CIs will be spuriously tight.

## 11. Open questions

1. Is the MTG-Causal-RL benchmark's code actually released, under what license, and is the env efficient enough to serve as a stronger-bot tier? (Paper is CC BY 4.0; repo not yet located/verified.)
2. Which 17lands skill bucket will our heuristic bots land in, and is it stable across formats? (Needs the pilot calibration run; determines whether "bottom-bucket humans" is a usable proxy population.)
3. Are Tier B replay-derived metrics (interaction density, lead changes) stable across real sets, or so format-specific that bands must be set per set archetype profile? (Needs a multi-set baseline study over the replay files, cheap once spells ingestion is up.)
4. 17lands replay data is per-turn aggregates, not per-action replays. Sufficient for every Tier A-C metric proposed; not sufficient for calibrating LLM deep-play review quality. Where does that calibration signal come from (human expert review? Arena VODs)?
5. The NWO 20% red-flag budget is community-documented R&D practice, not a formal WotC spec. Adopt as default with per-set override, or tune our own budget empirically from complexity-vs-GIH-WR curves at common?
6. Draft-data `pick_2` (pick-two variants) and future event-type proliferation: does our draft lab need to model these, or restrict calibration to classic 15-card PremierDraft?
