# Prior art: Set design theory → computable checks

Researched 2026-08-09 (prior-art lane: design skeletons, color pie, archetypes, composition norms, custom-set community lessons, mechanic constraints). Companion to `docs/design-brief.md` open question #5.

Method note: every number below was pulled from a fetched primary or community source at research time, not from model memory. Wizards articles are copyright Wizards of the Coast; we may restate facts and numbers (and do so here) but must not redistribute article text. Fan-content use is governed by the [WotC Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). MTG Wiki (mtg.wiki) content is licensed CC BY-NC-SA 4.0 (verified in page footer), compatible with this strictly non-commercial project if we attribute and share alike.

---

## 1. The design-skeleton canon (Mark Rosewater, "Nuts & Bolts")

The Nuts & Bolts series is the only published, first-party, slot-level specification of how a Magic set is structured. It has three generations; the newest (Play Booster era) is the one our generator should target, with the older ones kept as alternate profiles.

Key articles (all Making Magic, magic.wizards.com):

- [Nuts & Bolts #2: Design Skeleton](https://magic.wizards.com/en/news/making-magic/nuts-bolts-design-skeleton-2010-02-15) (2010) — introduces the skeleton and the slot-code system (CW01 = Common White slot 01, UZ = uncommon multicolor ("gold"), CA = common artifact, CL = common land).
- [Nuts & Bolts #3: Filling In the Design Skeleton](https://magic.wizards.com/en/news/making-magic/nuts-bolts-filling-design-skeleton-2011-02-28) (2011) — per-color slot roles ("CW01 – creature, small"; "CW02 – creature, small, flying"). Core principle stated here: start at common because "the heart of a set lives in the common cards"; if the theme isn't at common it isn't the theme.
- [Nuts & Bolts #4: Higher Rarities](https://magic.wizards.com/en/news/making-magic/nuts-bolts-higher-rarities-2012-02-27) (2012) — rarity roles (section 3 below).
- [Nuts & Bolts #13: Design Skeleton Revisited](https://magic.wizards.com/en/news/making-magic/nuts-bolts-13-design-skeleton-revisited-2021-03-22) (2021) — full modernized skeleton, draft-booster era.
- [Nuts & Bolts #15: Structural Support](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-15-structural-support) (2023) — the ten two-color archetypes (section 5 below).
- [Nuts & Bolts #16: Play Boosters](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-16-play-boosters) (2024) — current-era skeleton after the Play Booster change.
- [Nuts & Bolts #17: Finding Your Mechanics, Part 1](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-17-finding-your-mechanics-part-1) / [Part 2](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-17-finding-your-mechanics-part-2) (2025) — mechanic selection; Part 2 contains the current as-fan formula.
- [Nuts & Bolts #18: Layering Your Mechanics](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-18-layering-your-mechanics) (2025) — 3–6 mechanics per set, added one at a time, ranked by priority; "the best second mechanics are ones that play in a different space than the first mechanic."

### 1.1 Set-size data, 2021 skeleton (draft-booster era, N&B #13)

Source: [N&B #13](https://magic.wizards.com/en/news/making-magic/nuts-bolts-13-design-skeleton-revisited-2021-03-22).

- Commons: 101 total = 19 per color + 6 artifact.
- Uncommons: 80 total = 13 per color + 10 multicolor signposts (UZ01–UZ10, one per color pair) + 5 artifact.
- Creature share by color (commons/uncommons): White 62% (12 C creatures / 8 U), Green 59% (11/8), Black 56% (10/7), Red 53% (10/7), Blue 50% (9/7). Artifacts contribute 3 creatures at each rarity.
- Common keyword counts (per color): W flying 2–3, lifelink 1, vigilance 1, first strike 1; U flying 3; B deathtouch 1, flying 1, menace 1, lifelink (power ≤3); R haste 1–2, trample 1, menace 1, first strike 1; G trample 1–2, hexproof 0–1, reach 1, vigilance 1.
- Black commons include 4 dedicated removal slots; White commons ~8 spell slots covering removal (combat-conditional + exile), tricks, auras, artifact/enchantment answers; Blue counterspells (hard + soft), draw, bounce; Red direct damage, team pump, cantrips; Green fight, pump, ramp, artifact/enchantment destruction.
- Land options: swap colorless slots for nonbasics, or remove one card per color for a land cycle.

### 1.2 Set-size data, Play Booster skeleton (current era, N&B #16, 2024)

Sources: [N&B #16](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-16-play-boosters) and the community tabulation [Play Booster Design Skeleton Fact Sheet](https://mtgscribe.com/2024/03/06/play-booster-design-skeleton-fact-sheet/) (mtgscribe.com, which extracts the same article's numbers into tables).

Totals: **81 commons, 100 uncommons, 60 rares, 20 mythics = 261 cards.** Play Boosters guarantee at least one rare/mythic and can contain up to four; rares/mythics ≈ 1.4 per booster.

Per-color common creatures (count, curve, share of color's commons, average power):

| Color | Creatures | Curve (MV buckets) | % of commons | Avg power |
|---|---|---|---|---|
| White | 11 | 1×1, 3×2, 3×3, 2×4, 1×5/6, 1×6/7 | 73% (up from 63%) | 3.28 (up from 2.95) |
| Blue | 8 | 2×2, 3×3, 1×4, 1×5/6, 1×6/7 (no one-drop) | 53% (up from 47%) | 3.62 (up from 3.39) |
| Black | 9 | 1×1/2, 2×2, 2×3, 1×4, 1×4/5, 1×5/6, 1×6/7 | 62% (up from 52%) | 3.56 (up from 3.25) |
| Red | 9 | 1×1/2, 2×2, 2×3, 1×3/4, 1×4/5, 1×5, 1×6 | 64% (up from 53%) | 3.39 (up from 3.15) |
| Green | 10 | 1×1/2, 2×2, 2×3, 1×3/4, 1×4/5, 1×5, 1×6, 1×6/7 | 71% (up from 58%) | 3.7 (up from 3.59) |

Common keyword counts (fractions = shared/rotating slots):

- White: 3 flying, 2 vigilance, 1 lifelink, 0.25 first strike, 0.2 double strike
- Blue: 3 flying, 1.5 vigilance, 0.5 ward, 0.5 defender, 0.5 flash
- Black: 2 flying, 1.5 menace, 1.25 deathtouch, 1 lifelink
- Red: 1.5 trample, 1.5 menace, 1.5 haste, 1 reach, 0.25 first strike, 0.2 double strike
- Green: 1.5 vigilance, 1.5 trample, 1.5 reach, 1 deathtouch, 0.5 ward, 0.2 haste

Common spell slots:

- White (4): combat-conditional removal, exile removal, combat trick, artifact/enchantment removal
- Blue (7): protective instant, counterspell, cantrip, draw 2–3, "overwriting" aura, top/bottom-of-library spell, modal spell
- Black (6): small conditional removal, combat trick, card draw, discard, unconditional removal, overcosted removal
- Red (6): 2-damage burn, combat trick, card draw, modal artifact-destruction, ~4-damage burn, 6-damage-for-5 burn
- Green (5): fight, "bite" (one-sided fight), power-pump trick, mana acceleration, card dig

Uncommons: White 10 creature / 4 noncreature; Blue 6–7 / 7–8; Black 7–8 / 7–8; Red 7–8 / 7–8; Green 9 / 5; **multicolor 20 (2 per color pair, split enabler + payoff)**; colorless 4 creature + 3–4 noncreature + 2–3 lands. Commons colorless: 3 creatures + 3 spells (equipment, fixing, mana).

Design implications stated in #16: fewer commons means no deliberately unplayable commons, higher average power, some effects migrate to uncommon, more modal designs.

### 1.3 Community codifications of the skeleton

- [Design Skeleton Basics, @mtgfanset (Tumblr)](https://www.tumblr.com/mtgfanset/156427811082/design-skeleton-basics) — compact mid-2010s community version: 50 common slots (10 per color), standardized submission notation `CW01 [NAME] COST TYPE -- SUBTYPE RULES TEXT P/T`.
- [Set Skeleton Template (MTGNexus)](https://www.mtgnexus.com/viewtopic.php?t=51179) and [\[PRIMER\] Set Skeletons (MTG Salvation)](https://www.mtgsalvation.com/forums/magic-fundamentals/custom-card-creation/597944-primer-set-skeletons) — forum templates derived from N&B.
- No maintained open-source machine-readable skeleton dataset exists (GitHub searches for "mtg design skeleton", "mtg as-fan", "magic set design" return nothing usable; verified via `gh search repos` 2026-08-09). **We would be the first to publish the skeleton as data.**

---

## 2. Color pie as computable data

- [Mechanical Color Pie 2021](https://magic.wizards.com/en/news/making-magic/mechanical-color-pie-2021) — the canonical mechanical reference: ~100+ ability categories, each assigned per color as **primary / secondary / tertiary** (e.g. "destroy target creature": primary black, secondary white; card draw: primary blue, secondary black/green, tertiary white/red; flying: primary white/blue, secondary black/red, tertiary green). This is the single most valuable document in this lane: it is directly transcribable into a `(effect, color) → {primary|secondary|tertiary|off-pie}` lookup table.
- [Mechanical Color Pie 2021 Changes](https://magic.wizards.com/en/news/making-magic/mechanical-color-pie-2021-changes) — the diff vs the [2017 edition](https://magic.wizards.com/en/news/making-magic/mechanical-color-pie-2017-2017-06-05), useful for change-tracking the schema.
- No machine-readable version exists anywhere public (multiple web + GitHub searches, 2026-08-09). Transcription into JSON is net-new work (~100 effect rows × 5 colors).
- **Bend vs break** (Blogatog, primary source): a *bend* pushes within a color's philosophy but outside its normal mechanical implementation; a *break* undermines a weakness core to the color. Breaks are treated far more severely; WotC's current rule is not to introduce existing breaks into formats where they aren't already legal. Sources: [Blogatog on bend vs break](https://markrosewater.tumblr.com/post/823974806354575360/can-you-explain-what-differentiates-a-color-pie), [Blogatog on break justification](https://markrosewater.tumblr.com/post/779110859899338752/whats-the-justification-for-the-colour-pie-breaks), [Draftsim summary](https://draftsim.com/mtg-color-pie-break-rule/).

Computable check: every generated card's effect list maps to color-pie entries; primary/secondary = pass, tertiary = warn (budgeted), off-pie = fail unless explicitly flagged as an intentional bend with a design note; breaks always fail without a human override.

---

## 3. Rarity design roles

Source: [N&B #4: Higher Rarities](https://magic.wizards.com/en/news/making-magic/nuts-bolts-higher-rarities-2012-02-27).

- Uncommons occupy ~66% of common's design space in small sets, 60% in large sets; they "fill in the theme", raise creature/spell size, take the complexity common can't, provide catch-up cards, and shape draft ("uncommons help you win, rares and mythic rares just win").
- Bombs live at rare/mythic to keep Limited sane; über-complex cards live at **rare, not mythic** (mythics should be straightforward and splashy; "every mythic rare has to have the potential to be awesome").
- Rares: at least two rare cycles, one on-theme, one exciting independent of the set's mechanics; rares are less locked to creature percentages.
- Rarity is also the complexity dial (NWO, next section): common ≪ uncommon < rare.

---

## 4. New World Order: the complexity budget

Primary: [New World Order (MaRo, 2011-12-05)](https://magic.wizards.com/en/news/making-magic/new-world-order-2011-12-05). Secondary codifications: [MTG Wiki: New World Order](https://mtg.wiki/page/New_World_Order) (CC BY-NC-SA 4.0), [\[PRIMER\] NWO + Redflagging (MTG Salvation)](https://www.mtgsalvation.com/forums/magic-fundamentals/custom-card-creation/578926-primer-nwo-redflagging), [Writer Adept: Common Design Part 1](http://writeradept.blogspot.com/2014/06/common-design-part-1-new-world-order.html), [SCG: NWO and "Complexity Creep"](https://articles.starcitygames.com/articles/new-world-order-and-complexity-creep/).

- Three complexity types: **comprehension** (understanding the card), **board** (on-battlefield interactions to track), **strategic** (optimal play). Comprehension and board complexity are restricted at common; strategic complexity is explicitly exempt ("invisible" to beginners).
- The community-codified red-flag checklist for commons (Salvation primer): (1) affects other permanents on the battlefield; (2) ≥4 lines of non-reminder rules text; (3) needs to be read twice; (4) generates card advantage; (5) can kill multiple cards at once; (6) can create a loop; (7) problematic in multiples (5+ copies); (8) uses complex terminology (mana value as a variable, X-as-cost, planeswalker, emblem, nonstandard counters).
- Budget: **no more than ~20% of commons red-flagged**, each surviving red-flag must earn its place in theme or Limited function; multi-violation cards move to uncommon.
- Board-complexity rule of thumb (Blogatog via MTG Wiki): common cards don't affect more than one other card while on the battlefield.
- Play Boosters (2024) deliberately raised common complexity again ([MTG Wiki NWO page](https://mtg.wiki/page/New_World_Order), citing MaRo Oct 2023 / Jun 2024), so the 20% budget should be a tunable parameter, not a constant.
- [Lenticular Design (2014)](https://magic.wizards.com/en/news/making-magic/lenticular-design-2014-03-31) — the release valve: cards that read simple but play deep are the preferred way to add depth at common without spending comprehension budget.

Computable checks: rules-text line count, permanent-affecting-permanent detection, card-advantage detection, terminology blacklist at common, red-flag percentage gate per set.

---

## 5. Limited archetype construction

Primary: [N&B #15: Structural Support](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-15-structural-support). Community: [MTGNexus: So You Want to Build a Set — Draft Archetypes](https://www.mtgnexus.com/articles/1091-sywtbas-draft-archetypes), [Goblin Artisans: Signpost Uncommons — A Critique](http://goblinartisans.blogspot.com/2020/11/signpost-uncommons-critique.html).

- Modern sets seed **ten two-color-pair archetypes**. Per pair, the designer must answer: mechanical identity, win condition, speed.
- Speed mix (N&B #15, verbatim guidance): fast/medium/slow with **at least three of each speed and one speed getting a fourth**.
- Novelty mix (N&B #15): ~2 archetypes novel, ~4 familiar-with-a-twist, ~4 traditional ("Too different is alienating. It still has to feel like Magic.").
- Signposts: in the Play Booster skeleton, **2 multicolor uncommons per pair (20 total), split enabler + payoff** ([N&B #16](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-16-play-boosters)). Signposts are above-average power, buildable-around, and advertise the pair's plan ([Dot Esports explainer](https://dotesports.com/mtg/news/all-mtg-draft-signpost-uncommons-in-commander-legends-battle-for-baldurs-gate)).
- Documented failure modes of over-signposting (Goblin Artisans critique): choice collapse (picks become automatic), false balance perception (all ten pairs look equally supported when they aren't), suppressed discovery, and format homogenization ("when every set has the same skeleton, the things that make them unique diminish"). Recommendation there: strong signposting for newer audiences, looser structures for enfranchised ones. For our lab this argues for making archetype-signal strength a generation parameter.

Computable checks: per-pair archetype declaration required; speed histogram in {3,3,3}+1; signpost count per pair; commons-per-archetype support count (each pair needs playable commons in both colors that advance its plan); archetype overlap matrix (each common should serve ≥1 archetype, most serve 2).

---

## 6. As-fan and composition norms

### 6.1 As-fan

- Definition and draft-booster formula: [Volume Control (MaRo, 2014)](https://magic.wizards.com/en/news/making-magic/volume-control-2014-10-06). Weights per draft booster: **10 commons, 3 uncommons, 0.875 rares, 0.125 mythics**. As-fan(theme) = Σ over rarities of (theme cards at rarity / total at rarity) × slots.
- Play Booster formula: [N&B #17 Part 2 (2025)](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-17-finding-your-mechanics-part-2). Simplified Play Booster: **1 land, 9 commons, 3 uncommons, 1 rare-or-mythic (6/7 rare, 1/7 mythic)**. Worked example there: 7/81 commons + 7/100 uncommons + 3/60 rares of a mechanic → as-fan ≈ 1.25.
- Published reference values ([Volume Control](https://magic.wizards.com/en/news/making-magic/volume-control-2014-10-06)): multicolor as-fan 1.85 in Khans of Tarkir vs 3.58 in Return to Ravnica (same theme, different intensity).
- **As-played** (as-fan weighted by expected play rate): [Do the Math (MaRo, 2025)](https://magic.wizards.com/en/news/making-magic/do-the-math); also [MTG Wiki: As-fan](https://mtg.wiki/page/As-fan) (notes creature as-fan by color: white ~60%, blue lowest ~47%; and that guaranteed booster slots are the modern alternative to rarity for making a theme visible, e.g. Innistrad DFC-per-pack, Dominaria legendary-per-pack).
- Historical draft-booster creature-percentage source: [Sam Stoddard, Presidents, Kings, Role of the Leads (2015)](https://magic.wizards.com/en/news/archive) via [MTG Wiki: As-fan](https://mtg.wiki/page/As-fan).

### 6.2 Removal density

- Long-run constant: **~20% of cards per pack are removal (as-fan ≈ 3)**, stable since Invasion, per the Ars Arcanum "History of Removal" analysis (Pure MTGO), discussed with numbers at [Riptide Lab: Removal by the Numbers](https://riptidelab.com/forum/threads/removal-by-the-numbers.830/). Cube designers there measured their own lists at 19.3% and 19.67% removal.
- Deck-level norms (community consensus): 4–6 removal spells normal for a Limited deck; <3 is a weakness ([MTG Salvation: How much removal is problematic](https://www.mtgsalvation.com/forums/the-game/limited-sealed-draft/619833-how-much-removal-is-problematic), [Sealed removal thread](https://www.mtgsalvation.com/forums/the-game/limited-sealed-draft/659576-sealed-deck-construction-how-many-removal-cards-do)).

### 6.3 Deck-construction norms (evaluator targets for bot deckbuilders)

- 40-card Limited deck = **17 lands + 23 spells** as the standard; aggressive mono/2-color decks can run 15–16 ([Draftsim: lands in a 40-card deck](https://draftsim.com/mtg-40-card-deck-number-of-lands/), [MTG Salvation: why 17–18 lands](https://www.mtgsalvation.com/forums/the-game/limited-sealed-draft/610442-40-vs-41-card-decks-and-why-17-18-lands)).
- Creature floor ~12; typical 14–17 ([WizardTower: Back to the Basics](https://www.wizardtower.com/blog/limited/back-to-the-basics/)).
- Curve mass at MV 2–4 with 2–3 cards at 5+ ([Draftsim](https://draftsim.com/mtg-40-card-deck-number-of-lands/)).

### 6.4 Mana-fixing norms

- Common-rarity fixing staples: Evolving Wilds / Terramorphic Expanse class sac-fetch, common tapped dual cycles, and common artifact fixing in the colorless slots ([Draftsim: mana fixing](https://draftsim.com/mtg-mana-fixing/), [Draftsim: land cycles](https://draftsim.com/mtg-land-cycles/)).
- Skeleton allocations: 2021 skeleton reserves colorless-slot swaps or one-card-per-color for a land cycle ([N&B #13](https://magic.wizards.com/en/news/making-magic/nuts-bolts-13-design-skeleton-revisited-2021-03-22)); Play Booster skeleton reserves 2–3 uncommon land slots plus common colorless fixing ([N&B #16](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-16-play-boosters)).
- Multicolor-themed sets replace 4–6 colored common slots with gold/fixing, yielding ~20 gold commons per 100 and gold as-fan ≈ 2 ([MTG Wiki: As-fan](https://mtg.wiki/page/As-fan)).
- Cube norms differ deliberately: much higher fixing density than retail Limited; fixing/removal/countermagic density is a designed dial, not a constant ([Lucky Paper articles index](https://luckypaper.co/articles/), [The First Four Questions Cube Designers Should Ask](https://luckypaper.co/articles/the-first-four-questions-cube-designers-should-ask/)).

---

## 7. Mechanic design constraints: within-rules vs rules surgery

### 7.1 Choosing mechanics (canon)

- Count and layering: **3–6 mechanics**, added one at a time in priority order, complementary rather than overlapping spaces ([N&B #18](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-18-layering-your-mechanics)); selection criteria include complexity, support requirements, synergy potential, color-pie alignment, and design space ([N&B #17 Part 1](https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-17-finding-your-mechanics-part-1)).
- Risk register: MaRo's **Storm Scale** (1 = will return, 10 = never) documents which mechanic shapes proved problematic and why; per-set rating articles, e.g. [Eldraine–Strixhaven Part 1](https://magic.wizards.com/en/news/making-magic/storm-scale-throne-of-eldraine-through-strixhaven-part-1) / [Part 2](https://magic.wizards.com/en/news/making-magic/storm-scale-throne-of-eldraine-through-strixhaven-part-2); index at [MTG Wiki: Storm Scale](https://mtg.wiki/page/Storm_Scale) and fan aggregator [mtgstormscale.com](https://mtgstormscale.com/). Useful as a prior for the generator's mechanic-proposal critic.

### 7.2 Parasitism

- Definition (MaRo): a mechanic that "only works with a subset of cards from the set/block it's in"; a spectrum, not a binary ([MTG Rocks explainer with MaRo quotes](https://mtgrocks.com/magic-the-gathering-head-designer-explains-what-is-and-isnt-a-parasitic-mechanic/), [Draftsim: parasitic cards](https://draftsim.com/mtg-parasitic-cards/), [Goblin Artisans: Parasitism and Linearity](http://goblinartisans.blogspot.com/2011/02/card-knapping-parasitism-and-linearity.html)).
- Canonical high-parasitism examples: Ripple (Coldsnap), Splice onto Arcane (Kamigawa), Recover (Coldsnap), Energy (Kaladesh); Allies more parasitic than Slivers purely by card count ([Draftsim](https://draftsim.com/mtg-parasitic-cards/), [Hipsters: Are Dungeons a Parasitic Mechanic?](https://www.hipstersofthecoast.com/2021/07/are-dungeons-a-parasitic-mechanic/)).
- Design cost: kills deckbuilding breadth outside the set; sometimes accepted deliberately as the cleanest implementation of a desired experience.
- Computable proxy: fraction of a mechanic's cards that reference set-local nouns (subtypes, counters, tokens unique to the set) vs game-generic nouns; payoff/enabler ratio; cross-set playability of each card in isolation.

### 7.3 Works-within-rules vs requires rules surgery (examples with receipts)

A mechanic "works within existing rules" when it compiles to existing rule primitives (triggered/activated/static abilities, keyword actions, existing zones and turn structure). It requires rules surgery when it needs new game state, new zones/objects, new turn-structure hooks, or new special actions. Documented examples of surgery:

- **Companion** (Ikoria 2020): unprecedented power led to a Comprehensive Rules change two months post-release; casting from outside the game was replaced by a paid special action to move the companion to hand ([MTG Wiki: Companion](https://mtg.wiki/page/Companion)).
- **Day/Night** (Midnight Hunt 2021): introduced persistent global game state; corner cases (Clone copying a daybound creature at night) forced a post-release rules modification restricting daybound to transforming DFCs ([MTG Wiki: Day and night](https://mtg.wiki/page/Day_and_night), [CR changes archive](https://mtg.wiki/page/Comprehensive_Rules/Changes)).
- **Mutate** (Ikoria 2020): required new rules for merged permanents and mid-resolution target-illegality fallbacks ([MTG Wiki: Mutate](https://mtg.fandom.com/wiki/Mutate)).
- **Venture into the dungeon** (AFR 2021): new card type living outside the main deck plus new game objects; also a case study in set-local parasitism ([Hipsters](https://www.hipstersofthecoast.com/2021/07/are-dungeons-a-parasitic-mechanic/)).

Engine-relevant consequence (feeds the co-design invariant in the brief): the generator's mechanic proposals must be classified `existing-primitive` (compiles to the DSL as-is), `parameterized-extension` (new keyword over existing primitives), or `rules-surgery` (needs new engine capability), and only the first two are legal until the engine's staged extension points exist.

---

## 8. Custom-set community lessons

### 8.1 Planesculptors and set postmortems

- [PlaneSculptors.net](https://www.planesculptors.net/) — the largest custom-set repository with built-in draft/sealed; sets carry changelogs that function as postmortems.
- **Vastuum** ([set page](https://www.planesculptors.net/set/vastuum)): both original custom mechanics (Salvage, Wound) "played poorly" and were replaced wholesale in a 2018 overhaul; further balance passes came out of hundreds of Custom Standard games. Lesson: mechanics that read well routinely fail on the table; playtest volume is the filter (this is exactly what our bot-sim lab automates).
- **Volori** ([Custom Magazine 7/23 spotlight](https://sites.google.com/view/custom-magazine-jul23/spotlight)): required a "Grand Overhaul" with card-by-card Limited fixes and archetype reorganization. Lesson: archetype structure is the usual first casualty; it needs validation before card-level polish.
- **Tesla** (Goblin Artisans community set, [project index](http://goblinartisans.blogspot.com/2015/06/tesla-forms-future-takes.html), [playtest structure](http://goblinartisans.blogspot.com/2015/12/tesla-playtest-engineering-i-structure.html), [testing cards](http://goblinartisans.blogspot.com/2016/02/tesla-playtest-engineering-iii-testing.html)): documented mid-design findings include an iterate mechanic whose base rates were too weak to draft but broken in multiples, color pairs lacking answers, and a keyword (Crew) demoted because it only supported a vertical cycle. Lessons: multiples-scaling is a first-class balance axis; answer density is per-color-pair, not global; keyword status must be earned by as-fan.
- [So You Want to Build a Set, Part 1: What Should You Respect (MTGNexus)](https://www.mtgnexus.com/articles/1081-so-you-want-to-build-a-set-part-1-what-should-you-respect) — community codification: NWO at common, color-pie deviations are allowed but cost credibility, complexity papers over design mistakes.
- General complexity essay frequently cited in the community: [Zvi Mowshowitz, Complexity Is Bad](https://thezvi.substack.com/p/complexity-is-bad).

### 8.2 Cube design theory (for the cube-construction side of the deck lab)

- [Lucky Paper: The First Four Questions Cube Designers Should Ask](https://luckypaper.co/articles/the-first-four-questions-cube-designers-should-ask/) — context (players, pod size, draft style), restrictions (budget, singleton, legality), power level (defined by included/excluded cards and viable archetypes), and ideal gameplay (mana scarcity tolerance, color count, archetype clarity). Cube sizes 360–450 for typical pods.
- [Lucky Paper articles index](https://luckypaper.co/articles/) — density analyses (removal, countermagic, fixing) and archetype-ecosystem thinking; [Analyzing Your Own Cube Drafts](https://luckypaper.co/articles/tireless-tracker-analyzing-your-own-cube/) is the pattern for our self-play analytics loop.
- Structural note from section 6.2: healthy cubes converge on ~20% removal, matching retail Limited.
- These four questions map directly onto the deck-lab's prompt-driven structured criteria (the brief's target capability #2): context, restrictions, power band, gameplay profile become schema fields.

---

## 9. Deliverable A: computable design-skeleton spec candidate

The skeleton as data. Numbers are the Play Booster profile (N&B #16 / fact sheet, section 1.2); the 2021 draft-booster profile (section 1.1) should ship as a second profile. Fractional counts encode rotating slots and are enforced as set-level sums, not per-card.

```jsonc
{
  "profile": "play-booster-2024",           // alt: "draft-booster-2021"
  "source": [
    "https://magic.wizards.com/en/news/making-magic/nuts-and-bolts-16-play-boosters",
    "https://mtgscribe.com/2024/03/06/play-booster-design-skeleton-fact-sheet/"
  ],
  "set_size": { "common": 81, "uncommon": 100, "rare": 60, "mythic": 20 },
  "booster": { "land": 1, "common": 9, "uncommon": 3, "rare_or_mythic": { "rare": 0.857, "mythic": 0.143 } },
  "colors": {
    "W": {
      "common": {
        "creatures": 11, "creature_share": 0.73, "avg_power": 3.28,
        "curve": { "1": 1, "2": 3, "3": 3, "4": 2, "5-6": 1, "6-7": 1 },
        "keywords": { "flying": 3, "vigilance": 2, "lifelink": 1, "first_strike": 0.25, "double_strike": 0.2 },
        "spells": ["removal_combat_conditional", "removal_exile", "combat_trick", "removal_artifact_enchantment"]
      },
      "uncommon": { "creatures": 10, "noncreatures": 4 }
    },
    "U": {
      "common": {
        "creatures": 8, "creature_share": 0.53, "avg_power": 3.62,
        "curve": { "2": 2, "3": 3, "4": 1, "5-6": 1, "6-7": 1 },
        "keywords": { "flying": 3, "vigilance": 1.5, "ward": 0.5, "defender": 0.5, "flash": 0.5 },
        "spells": ["protective_instant", "counterspell", "cantrip", "draw_2_3", "aura_overwrite", "library_top_bottom", "modal"]
      },
      "uncommon": { "creatures": 6.5, "noncreatures": 7.5 }
    },
    "B": {
      "common": {
        "creatures": 9, "creature_share": 0.62, "avg_power": 3.56,
        "curve": { "1-2": 1, "2": 2, "3": 2, "4": 1, "4-5": 1, "5-6": 1, "6-7": 1 },
        "keywords": { "flying": 2, "menace": 1.5, "deathtouch": 1.25, "lifelink": 1 },
        "spells": ["removal_small_conditional", "combat_trick", "card_draw", "discard", "removal_unconditional", "removal_overcosted"]
      },
      "uncommon": { "creatures": 7.5, "noncreatures": 7.5 }
    },
    "R": {
      "common": {
        "creatures": 9, "creature_share": 0.64, "avg_power": 3.39,
        "curve": { "1-2": 1, "2": 2, "3": 2, "3-4": 1, "4-5": 1, "5": 1, "6": 1 },
        "keywords": { "trample": 1.5, "menace": 1.5, "haste": 1.5, "reach": 1, "first_strike": 0.25, "double_strike": 0.2 },
        "spells": ["burn_2", "combat_trick", "card_draw", "artifact_destruction_modal", "burn_4", "burn_6_cost_5"]
      },
      "uncommon": { "creatures": 7.5, "noncreatures": 7.5 }
    },
    "G": {
      "common": {
        "creatures": 10, "creature_share": 0.71, "avg_power": 3.7,
        "curve": { "1-2": 1, "2": 2, "3": 2, "3-4": 1, "4-5": 1, "5": 1, "6": 1, "6-7": 1 },
        "keywords": { "vigilance": 1.5, "trample": 1.5, "reach": 1.5, "deathtouch": 1, "ward": 0.5, "haste": 0.2 },
        "spells": ["fight", "bite", "combat_trick_pump", "mana_accel", "dig"]
      },
      "uncommon": { "creatures": 9, "noncreatures": 5 }
    }
  },
  "colorless": {
    "common": { "creatures": 3, "spells": 3 },
    "uncommon": { "creatures": 4, "noncreatures": 3.5, "lands": 2.5 }
  },
  "multicolor_uncommon": { "total": 20, "per_pair": 2, "roles": ["enabler", "payoff"] },
  "archetypes": {
    "pairs": ["WU","WB","WR","WG","UB","UR","UG","BR","BG","RG"],
    "speed_mix": { "fast": 3, "medium": 3, "slow": 3, "flex": 1 },
    "novelty_mix": { "novel": 2, "twist": 4, "traditional": 4 }
  },
  "mechanics": { "min": 3, "max": 6, "classification": ["existing-primitive", "parameterized-extension", "rules-surgery"] },
  "complexity": { "nwo_red_flag_budget": 0.20 },
  "as_fan_targets": {
    "removal": 3.0,               // ~20% of pack, stable since Invasion (Ars Arcanum via Riptide Lab)
    "main_mechanic_min": 1.0,     // Sealed usability floor (Volume Control)
    "gold_in_multicolor_set": 2.0 // MTG Wiki as-fan reference
  },
  "rarity_rules": {
    "bombs_min_rarity": "rare",
    "max_complexity_rarity": "rare",   // not mythic (N&B #4)
    "rare_cycles_min": 2
  }
}
```

## 10. Deliverable B: design-rule validation checklist (generator/evaluator gates)

Structural (deterministic code, per the ZFC split):

1. **Skeleton conformance** — card counts per color × rarity × type match the active profile within declared tolerances; per-color common curve histogram matches profile buckets.
2. **Creature-share bands** — per-color creature percentage at common within ±1 card of profile (W73/U53/B62/R64/G71 for Play Booster).
3. **Keyword as-fan** — evergreen keyword counts per color at common within profile fractions; no evergreen keyword on a color where the Mechanical Color Pie lists it off-pie.
4. **Color-pie conformance** — every effect in every card maps to a color-pie table entry: primary/secondary pass, tertiary warns against a per-set tertiary budget, unmapped or off-pie fails; break-class violations (undermining a core weakness) always fail without human override.
5. **NWO complexity gate** — red-flag classifier over commons (≥4 lines, affects other permanents, card advantage, multi-kill, loops, multiples-problematic, banned vocabulary at common); red-flag rate ≤ configured budget (default 20%); commons must not affect more than one other card on the battlefield.
6. **Rarity-role gate** — bombs (evaluator-scored above threshold) not below rare; complexity ceiling per rarity (common < uncommon < rare); mythics splashy-but-straightforward; ≥2 rare cycles.
7. **Archetype coverage** — all ten pairs declared with mechanical identity + win condition + speed; speed histogram = {3,3,3}+1; 2 signposts per pair (enabler + payoff); each pair has ≥N playable on-plan commons in each of its colors; every common tagged with the archetypes it serves (orphan commons flagged).
8. **As-fan assertions** — removal as-fan ≈ 3.0 ± tolerance; each named mechanic's as-fan ≥ declared floor (main ≥ ~1.0); theme present at common ("if the theme isn't at common, it isn't the theme").
9. **Mana-fixing floor** — common fixing present (land cycle or colorless fixing slots); multicolor-themed profiles swap 4–6 colored common slots to gold/fixing.
10. **Mechanic legality** — every mechanic classified existing-primitive / parameterized-extension / rules-surgery against the engine DSL; rules-surgery mechanics rejected until engine extension points exist (co-design invariant).
11. **Parasitism score** — per mechanic: fraction of cards referencing set-local nouns, enabler/payoff ratio, standalone-playability; warn above threshold, with a documented "deliberate parasitism" override.
12. **Mechanic count/layering** — 3–6 mechanics; layered one at a time in priority order in the generation pipeline; mechanic-pair overlap report (mechanics occupying the same space flagged).

Semantic (LLM critic passes, calibrated later by sim data):

13. Lenticular audit at common (reads-simple/plays-deep preferred over reads-complex).
14. "Feels like Magic" novelty audit against the 2/4/4 novelty mix.
15. Signpost clarity audit (does the signpost advertise the plan without collapsing pick decisions).

Sim-level (playtest lab, CI assertions from the brief):

16. Per-pair win-rate bands, answer density per pair (Tesla lesson), multiples-scaling sweeps for any mechanic that scales with copy count (Tesla iterate lesson), game-length windows per speed class.

## 11. Deliverable C: top documented fan-set failure modes

1. **Complexity creep at common (NWO violations)** — the most common critique of custom sets; papering over design problems with text. Sources: [NWO primer](https://www.mtgsalvation.com/forums/magic-fundamentals/custom-card-creation/578926-primer-nwo-redflagging), [SCG](https://articles.starcitygames.com/articles/new-world-order-and-complexity-creep/), [MTGNexus SYWTBAS Pt 1](https://www.mtgnexus.com/articles/1081-so-you-want-to-build-a-set-part-1-what-should-you-respect).
2. **Mechanics that read well but play badly** — Vastuum shipped two custom mechanics and replaced both after play ([Vastuum](https://www.planesculptors.net/set/vastuum)). Only playtest volume catches this; it is the core justification for the bot-sim lab.
3. **Parasitic mechanics** — narrow synergy islands that die outside the set; the historically documented failure of Coldsnap/Kamigawa-class mechanics ([Draftsim](https://draftsim.com/mtg-parasitic-cards/), [Hipsters](https://www.hipstersofthecoast.com/2021/07/are-dungeons-a-parasitic-mechanic/)).
4. **Color-pie breaks** — allowed in principle, punished in reception; breaks (vs bends) draw severe community criticism and are the first thing reviewers check ([SYWTBAS Pt 1](https://www.mtgnexus.com/articles/1081-so-you-want-to-build-a-set-part-1-what-should-you-respect), [Blogatog](https://markrosewater.tumblr.com/post/823974806354575360/can-you-explain-what-differentiates-a-color-pie)).
5. **Broken archetype structure** — pairs without support, plans, or answers; Volori needed a full archetype reorganization ([Custom Magazine spotlight](https://sites.google.com/view/custom-magazine-jul23/spotlight)); Tesla found color pairs lacking answers mid-playtest ([Goblin Artisans](http://goblinartisans.blogspot.com/2015/12/tesla-playtest-engineering-i-structure.html)).
6. **Multiples-scaling blowups** — mechanics balanced for one copy that break (or die) in Limited multiples (Tesla's iterate; NWO red-flag #7) ([Goblin Artisans](http://goblinartisans.blogspot.com/2016/02/tesla-playtest-engineering-iii-testing.html)).
7. **Keyword inflation** — keyword status granted to things that only support a vertical cycle (Tesla demoted Crew) ([Goblin Artisans](http://goblinartisans.blogspot.com/2015/09/tesla-our-refinery.html)); computable via as-fan floors per keyword.
8. **Theme absent at common** — the theme lives at rare where nobody drafts it; canonical MaRo test ([N&B #3](https://magic.wizards.com/en/news/making-magic/nuts-bolts-filling-design-skeleton-2011-02-28), [MTG Wiki: As-fan](https://mtg.wiki/page/As-fan)).
9. **Over-signposting / homogenization** — ten forced pairs with identical scaffolding makes the set feel like every other set and collapses drafting agency ([Goblin Artisans signpost critique](http://goblinartisans.blogspot.com/2020/11/signpost-uncommons-critique.html)).
10. **Composition drift from retail norms** — removal/fixing/curve densities far from the ~20% removal, 17/23, curve-mass-at-2-to-4 norms produce formats that feel wrong; norms in sections 6.2–6.4.

## 12. Reusable artifacts and verdicts

| Artifact | What | License (verified) | Verdict |
|---|---|---|---|
| Nuts & Bolts series (WotC) | Slot-level set spec, rarity roles, archetype and mechanic guidance | © Wizards of the Coast; facts restatable, text not redistributable; [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) | **inspire** — transcribe the numbers into our skeleton-profile data files |
| [Mechanical Color Pie 2021](https://magic.wizards.com/en/news/making-magic/mechanical-color-pie-2021) (+[Changes](https://magic.wizards.com/en/news/making-magic/mechanical-color-pie-2021-changes)) | Canonical effect→color primary/secondary/tertiary taxonomy | © Wizards of the Coast (same as above) | **inspire** — hand-transcribe to JSON; no machine-readable version exists anywhere |
| [Play Booster Design Skeleton Fact Sheet](https://mtgscribe.com/2024/03/06/play-booster-design-skeleton-fact-sheet/) | Community tabulation of N&B #16 numbers | © mtgscribe.com (no license stated) | **inspire** — use as cross-check when transcribing N&B #16 |
| [MTG Wiki (mtg.wiki)](https://mtg.wiki/) pages: As-fan, NWO, Storm Scale, mechanic pages | Curated, cited codifications of R&D practice | **CC BY-NC-SA 4.0** (verbatim footer: "Content is available under CC BY-NC-SA 4.0 unless otherwise noted.") | **adopt** (as documentation source) — reusable with attribution + share-alike in our non-commercial docs |
| [NWO + Redflagging primer (MTG Salvation)](https://www.mtgsalvation.com/forums/magic-fundamentals/custom-card-creation/578926-primer-nwo-redflagging) | The 8-item red-flag checklist + 20% budget | Forum content, no license | **inspire** — reimplement as the complexity-gate rule set |
| [mzabsky/webdrafter](https://github.com/mzabsky/webdrafter) | PlaneSculptors.net source (PHP): set hosting, booster collation, draft/sealed | LICENSE.txt is BSD-3-Clause **but copyright "2005-2015, Zend Technologies USA, Inc."** (inherited from the ZF2 skeleton app; the author's own grant is ambiguous) | **inspire** — mine `collation.md` and collation algorithms; do not vendor code without clarifying license with @mzabsky |
| [Lore Seeker booster-collation spec (fenhl gist)](https://gist.github.com/fenhl/8d163733ab92ed718d89975127aac152) | Five collation algorithms for custom boosters (naïve, color-locked slots, validate-and-reject, simulated print runs, PlaneSculptors) | No license stated | **inspire** — the algorithm taxonomy informs our pack generator; reimplement |
| [Lucky Paper articles](https://luckypaper.co/articles/) | Cube design theory: four questions, density analyses, draft-data analytics | © Lucky Paper | **inspire** — four-questions schema becomes cube-lab prompt criteria |
| As-fan calculators ([mtg-asfan.com](https://mtg-asfan.com/), [yeefbear.com/as-fan](https://yeefbear.com/as-fan/)) | Web as-fan calculators | No source/license found (probed both pages) | **skip** — the formula is three lines; implement from the primary sources |
| [mtgstormscale.com](https://mtgstormscale.com/) | Fan aggregation of Storm Scale ratings | Fan site, no source found | **skip** — cite MaRo's rating articles directly as the ground truth |
| [PlaneSculptors.net](https://www.planesculptors.net/) (the service) | Custom-set hosting + human drafting | Site TOS; code as above | **interop** — export our sets to its format for human playtesting reach (format documented via `?source` pages and webdrafter repo) |
| Goblin Artisans blog ([Tesla series](http://goblinartisans.blogspot.com/2015/12/tesla-playtest-engineering-i-structure.html), [signpost critique](http://goblinartisans.blogspot.com/2020/11/signpost-uncommons-critique.html)) | The best-documented fan-set playtest engineering + design criticism corpus | © authors, no license | **inspire** — failure catalog feeds the evaluator's lesson set |

## 13. Recommendation

Build the skeleton as versioned data, not prose: ship two skeleton profiles (`play-booster-2024`, `draft-booster-2021`) transcribed from N&B #16/#13 with the section 9 schema, hand-transcribe the Mechanical Color Pie 2021 into an effect→color JSON table (nothing machine-readable exists; this is the highest-leverage single transcription in the whole lane, roughly 100 effect rows), and implement the section 10 checklist as three gate tiers (deterministic structural gates in code, LLM critic passes for lenticular/novelty/signpost quality, sim-level CI assertions). Adopt mtg.wiki (CC BY-NC-SA 4.0) as the citable documentation layer, keep everything WotC-derived as restated facts under the Fan Content Policy, and treat PlaneSculptors as an interop target for human playtesting rather than code to vendor (its license provenance is unclear).

## 14. Risks and open questions

Risks:

- Wizards never publishes rare/mythic slot guidance at the same granularity as commons/uncommons; rare-tier composition rules are community inference and will need calibration from real-set data (Scryfall counts) rather than canon.
- The numbers in sections 1.1/1.2 came through summarizing fetches of the articles; before the profiles ship as code, each number should be re-verified against the article text once during transcription (single pass, both articles are public).
- Skeleton norms drift (2010 → 2021 → 2024 changed set sizes, creature shares, and power levels); hardcoding one profile without a version field would repeat the community's stale-template problem.
- NWO red-flag classification is partly semantic ("needs to be read twice"); pushing it fully into deterministic code would violate the project's own ZFC split; keep the semantic half in the critic.
- mtg.wiki share-alike (CC BY-NC-SA) obligations apply to derived documentation we publish; fine for this repo, but flag if any bundle ever moves toward non-NC distribution.

Open questions for later phases:

- Should archetype-signal strength (signpost count/power) be a user-facing generation parameter, given the documented homogenization critique?
- What tolerance bands make skeleton conformance useful rather than strangling (real WotC sets deviate from their own skeleton)? Needs an empirical pass: compute the section 9 metrics over the last ~10 real sets via Scryfall and fit bands (connects to the 17lands/data lane).
- Where does the Storm Scale prior live in the pipeline: as a hard filter on mechanic proposals or as critic context only?
- Does the cube lab enforce retail-Limited composition norms or Lucky Paper-style designed-dial densities per user intent? (Probably the latter with retail norms as a default profile.)
