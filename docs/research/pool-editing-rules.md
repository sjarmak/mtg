# Three rules for editing a finished pool, priced

Measured 2026-08-21 against this worktree at `dafd5f14`. Every number below came from a walk over
the committed 371-card flagship set fixture and over the checksum-pinned MTGJSON reference corpus
in `packages/data/data/reference-sets-v1.json`. Nothing is estimated. Where a number carried in the
issue tracker disagreed with the tree, the tree won, and §2 says by how much.

This lane measured. It edited no card, and by design it names none: the aggregate figures are here,
the per-rule card lists went to the set owner directly.

**Verdict (argued in §6): rule (c), the per-color cap, and the number that decides it is a color the
issue did not name.** Blue is already the least counters-and-bodies color in the set, 18.6% against
15.1% in five real core sets, and its interaction rate is within one point of theirs. Black is
20.6 points above the real core-set counters-and-bodies share and 22.8 points below the real
core-set interaction share, the only color far out of pie in both directions at once. A rule that
does not read the per-color baseline first picks the wrong color to fix.

**Corrected 2026-08-21 by the committed census tool** (`packages/setgen/tools/pool-census.ts`, and
the readers under it in `packages/setgen/src/validate/mechanics.ts`). This report's own
`statBonus` reader visited a static ability's `modification` field and nothing else, so it missed
the six equip clauses and two Aura clauses that print the same modification somewhere else on the
card. Every figure below that depends on it moved: `statBonus` 26 to 34, the headline 155 of 371
(41.8%) to **163 of 371 (43.9%)**, and colorless 51.6% to 71.0%. §§1-3 are restated at the
corrected reading and every other number in them reproduces to the digit. §§4-6 are not: their
populations were derived under the static-only reader, and §4's opening says what that does and
does not change. The disagreement §2.2 could not close is closed at the same time, in favor of the
number this report doubted.

---

## 1. The instrument

**Subject.** The committed flagship set fixture, the 253-slot one under
`packages/setgen/fixtures/sets/`. 371 cards, no lands.

**The walk.** `printedEffectKinds` in `packages/setgen/src/validate/mechanics.ts`, which is the
argued walk in this repository: a card's own effect list, every mode of a modal card rather than
whichever one a game would choose, the effects of every printed ability, and the effects on the
abilities of every token the card creates. `packages/deckbuild/src/deck-context.ts` was fixed on
2026-08-21 for not descending into the last of those, so the descent is a live question and §2.4
answers it for this census specifically.

**The second vocabulary the effect walk does not reach, and the three places it is printed.**
`statBonus` is one of the four verbs the complaint names, and it is a `StaticModification`, not an
`Effect` — there is no `statBonus` member of `Effect['kind']` at all, so a walk over effect kinds
does not read this verb as absent, it has no expression for it. The set prints the `statBonus`
**effect** kind zero times and the `statBonus` **modification** kind **34** times.

Those 34 sit in three different fields, and a reader that visits one of them is what produced the
disagreement §2.2 was written to record. A static ability carries the modification in
`modification`, which is the field every walk finds: 26 cards. An Equipment carries it in the equip
ability's `attach.modifications` (CR 702.6b): 6 cards. An Aura carries it in the card's own
`aura.modifications`: 2 cards. `printedModificationKinds` reads all three, and `statBonusPer` is a
separate modification kind on one card, excluded from the headline; including it adds exactly one
card.

**Counting.** Once per card. A card is counted for the family if any of the four verbs appears
anywhere the walk reaches.

**The four verbs.** Effect kinds `putCounters`, `createToken`, `pumpUntilEndOfTurn`; modification
kind `statBonus`.

**Interaction.** A card is opponent-facing when any clause the walk reaches either names a target
kind that can only be the other player's (`anyTarget`, `targetPlayer`, `targetOpponent`,
`targetCreatureYouDontControl`, `targetCreatureDefendingPlayerControls`, `targetPlayerOrPlaneswalker`),
or prints one of seventeen verbs that answer something regardless of the target spelling
(`counterSpell`, `destroyPermanent`, `exileTarget`, `tapPermanent`, `returnToHand`, `fight`,
`putOnLibrary`, `millCards`, `discardCards`, `chooseDiscard`, `revealHand`, `exileGraveyard`,
`loseLife`, `dealDamage`, `attacksYouThisTurnIfAble`, `preventCombatDamage`,
`preventAllDamageToTarget`), or prints `pumpUntilEndOfTurn` with a negative power or toughness,
which is a removal spell wearing a pump's clothes. Instant-speed interaction is an opponent-facing
card that is an instant, or one whose opponent-facing clause sits on an activated ability. The set
prints zero cards with flash, so those are the only two windows.

---

## 2. The 58.4% reproduces exactly, and it is still not a share of the set

The census this work was commissioned from reads: 215 of 368 cards, 58.4%, use one of the four
verbs. Its 215 is right to the card and its 58.4% is right to the digit; what is wrong is the word
"cards". On the committed fixture the figure is **163 of 371 cards, 43.9%**.

### 2.1 The numerator is card-uses and the denominator is cards

The prior figure is the sum of four per-verb card counts divided by the card count. It is not a
share of anything. A card that prints two of the four verbs is counted twice on top and once on the
bottom, and 52 cards do exactly that: 163 cards produce 215 card-verb pairs. The prior instrument's
own issue body describes its sum as "card-uses" and the derived percentage then reads as a share of
cards in every place it is quoted since.

Both readings, computed the same way on the current pool:

| Reading                                                   | Value                 |
| --------------------------------------------------------- | --------------------- |
| Cards printing at least one of the four verbs             | 163 of 371, **43.9%** |
| Sum of the four per-verb card counts, over the card count | 215 of 371, 58.0%     |

The second row is what "58.4%" was; the first is what it was taken to mean. The complaint the number
was raised to describe is about how much of the set does one thing, so the first row is the one the
rules below are priced against.

### 2.2 The prior numerator reproduces to the card, and the three lines this report doubted were this report's

This section previously recorded that the prior census's `statBonus` line could not be reproduced by
any walk over the committed bytes, and that its numerator was consequently six to eight cards too
high. That was wrong in the reader, not in the census. Three lines disagreed and all three
disagreements were on this side of the comparison.

`statBonus` 34, not 26. The reader used here visited a static ability's `modification` field only,
and the set prints eight more of the same modification in the two fields §1 now names: six equip
clauses and two Aura clauses. Adding them costs eight cards on the family and closes the whole gap
this section was written about.

`dealDamage` 38 and `returnToHand` 8, not 37 and 7. Those two were off by exactly one because the
reader used here walked a card's `effects` and its `abilities` and stopped. Three cards in the pool
are modal, and a modal card's `effects` and `abilities` are both empty: its whole text is under
`modes`. `printedEffectKinds` does descend into them — the shipped helper was never the problem, an
ad-hoc walk beside it was — and with the descent both lines land on the prior census's numbers.
`untapPermanent` and `grantKeywordUntilEndOfTurn` move for the same reason.

What remains after the corrected reader is one line and one build. At 352 cards the census reads
`createToken` 70, `putCounters` 81, `dealDamage` 38, `returnToHand` 8 and `statBonus` **34**; the
prior table records the first four and `statBonus` 32. 32 is a real reading of this fixture — it is
what the census returns at the 344-card build, ten cards before the rest of that table — so the
prior `statBonus` line is one build stale rather than unreproducible, which is the same failure mode
§2.3 finds in its denominator.

**The prior numerator itself is exact.** At the 368-card build the census reads 215 card-verb pairs
over the four verbs, and 215 of 368 is 58.4%. Every card in it is a card printing one of the four
verbs. The defect is entirely §2.1's: 215 counts card-verb pairs and 368 counts cards, so the
quotient is not a share of anything, and the 163 cards behind those 215 pairs are 43.9% of the set.

### 2.3 The denominator moved after the figure was taken

368 was the card count at the commit that appended sixteen authored cards. Three more commons
landed on 2026-08-21, all of them instants that answer a creature only while it is attacking or
blocking. The pool is 371. Every share carried at a denominator of 368 is stale by three cards.

### 2.4 Token descent moves the per-verb tallies by a factor of two and moves the card set not at all

`putCounters` reads 43 cards without the descent and 83 with it. That is the largest single effect
of the walk choice anywhere in this census, and it is why §2.2 can pin the prior instrument as
descending.

It does not move the headline. The count of cards printing at least one of the four verbs is 163
either way, at 368 and at 371. The reason is structural rather than lucky: a card that
places a counter inside a token's printed ability must first print `createToken` to get the token
onto the battlefield, so it was already in the family. **Any census over the four verbs as a set is
immune to the descent question; any census over `putCounters` alone is off by 40 cards without it.**

---

## 3. What the color pie is doing, against real core sets

This is the load-bearing measurement, and the one rule (c) stands or falls on.

**The baseline is real and offline.** `packages/data/data/reference-sets-v1.json` is the pinned
MTGJSON corpus this repository already ships for the reference-set lane. It carries complete card
lists for Magic 2011, Magic 2013, Magic 2015, Core Set 2020 and Magic Origins. Restricted to
main-set nonland cards and deduplicated by name, that is **1,165 cards** across five core sets, which
is what the flagship should be compared against: a core set is the product this set is shaped like.

**The instruments are not the same and that is stated rather than hidden.** The flagship is measured
by a walk over typed structure. A real printing has no typed structure here, so the baseline is
measured by regular expressions over oracle text: a counter placement is a stat counter, a charge or
level counter, or the phrase "counter on"; a token is "create ... token"; a pump is a stat change
carrying "until end of turn"; a static stat bonus is a stat change that does not. Interaction is
matched on destroy, exile target, counter target, return to hand, tap target, damage to a target,
a negative stat change, discard, fight, life loss, a combat restriction, or mill. The regex reads
English and the walk reads structure, so the two disagree at the margin. They do not disagree by
twenty points, which is the size of the finding below.

**Card counts per color are near-identical between the two populations** (each real color 203 to 205
of 1,165; each flagship color 64 to 70 of 371), so the shares are directly comparable.

### 3.1 The two tables

Flagship, share of that color's cards, by the walk in §1:

|            |   n | putCounters | createToken |  pump | statBonus | any of the four | opponent-facing | instant-speed |
| ---------- | --: | ----------: | ----------: | ----: | --------: | --------------: | --------------: | ------------: |
| W          |  64 |        9.4% |       12.5% |  9.4% |     14.1% |       **42.2%** |           25.0% |         12.5% |
| U          |  70 |        1.4% |       10.0% |  2.9% |      5.7% |       **18.6%** |           44.3% |         31.4% |
| B          |  69 |       40.6% |       23.2% |  7.2% |      2.9% |       **55.1%** |           34.8% |         11.6% |
| R          |  64 |       26.6% |       26.6% |  6.3% |      4.7% |       **42.2%** |           45.3% |         18.8% |
| G          |  69 |       34.8% |       24.6% |  7.2% |      2.9% |       **49.3%** |           26.1% |          5.8% |
| colorless  |  31 |       19.4% |       25.8% |  3.2% |     41.9% |       **71.0%** |           19.4% |          6.5% |
| multicolor |   4 |       25.0% |       25.0% | 25.0% |     25.0% |           50.0% |           50.0% |         25.0% |
| all        | 371 |       22.4% |       19.9% |  6.5% |      9.2% |       **43.9%** |           34.0% |         15.4% |

The equip and Aura clauses of §1 land almost entirely in one row. Six of the eight are Equipment,
which this set prints colorless, so colorless `statBonus` is 41.9% against 22.6% under the
static-only reader and colorless as a whole moves 19.4 points. The baseline table below never had
this problem: its instrument is a regular expression over oracle text, and "equipped creature gets
+2/+0" is a stat change with no "until end of turn" in it, so real Equipment was already being
counted. The correction removes an asymmetry between the two instruments rather than adding one.

Five real core sets, 1,165 nonland cards, by the text proxy:

|           |     n | putCounters | createToken |  pump | statBonus | any of the four | interaction |
| --------- | ----: | ----------: | ----------: | ----: | --------: | --------------: | ----------: |
| W         |   205 |        9.3% |       10.2% | 13.7% |     10.7% |       **39.5%** |       28.3% |
| U         |   205 |        1.0% |        4.4% |  6.3% |      4.4% |       **15.1%** |       43.4% |
| B         |   203 |        8.9% |        4.9% | 13.3% |      7.9% |       **34.5%** |       57.6% |
| R         |   203 |        4.4% |        6.9% | 15.8% |      8.4% |       **33.0%** |       46.3% |
| G         |   205 |       11.7% |        8.3% | 10.2% |      8.3% |       **36.1%** |       19.5% |
| colorless |   116 |       10.3% |        1.7% |  1.7% |     14.7% |       **27.6%** |       25.9% |
| all       | 1,165 |        7.4% |        6.6% | 10.7% |      8.7% |       **31.3%** |       37.4% |

The interaction column is restricted to verbs this DSL can express. Unrestricted it reads 38.5%
overall and 60.1% in black; the difference is one shape, "target player sacrifices a creature",
which no effect kind in `packages/dsl/src/effects.ts` spells. Black's gap survives the restriction,
so the gap is not an artifact of the vocabulary.

Per set, so the spread is visible: Magic 2011 18.9%, Magic 2013 33.6%, Magic 2015 31.8%, Core Set
2020 32.8%, Magic Origins 38.7%. **The flagship's 43.9% is above all five**, and 5.2 points above
the highest.

### 3.2 The distances

|           | counters-and-bodies, flagship minus real | interaction, flagship minus real |
| --------- | ---------------------------------------: | -------------------------------: |
| W         |                                     +2.7 |                             -3.3 |
| U         |                                     +3.5 |                             +0.9 |
| B         |                                **+20.6** |                        **-22.8** |
| R         |                                     +9.2 |                             -1.0 |
| G         |                                    +13.2 |                             +6.6 |
| colorless |                                **+43.4** |                             -6.5 |
| all       |                                    +12.6 |                             -3.4 |

Three things fall out of this table and all three matter to the choice.

**Blue is not the problem.** The candidate rule that reads "green stays a counters color and blue
stops being one" is aimed at a color that is already 3.5 points from pie on one axis and 0.9 points
on the other, and is already the set's most interactive color by instant-speed count. There is no
work for a rule to do in blue.

**Black is the problem, on both axes at once.** Colorless is further out on the family axis alone,
but black is the only color far out in both directions: too much of the one family, far too little
of the other.
Real core-set black is the most interactive color printed; flagship black is the least interactive
of the five and the most counters-and-bodies.

**Most of black's excess is one mechanic, and the set means it.** Twenty of black's 28
counter-placing cards mint the set's own named counter, which is a black keyword-granting counter
and a stated mechanic of the brief. Fourteen of those twenty are commons. So black's number is not
an accident to be corrected wholesale; it is a design that a cap has to be set around rather than
through, and any rule that takes black's commons is taking the mechanic's coverage with it (§5.3).

**Colorless is the largest single-axis gap and is the cheapest to close.** It is 43.4 points above
pie on a base of 31 cards: 22 of those 31 print one of the four verbs against a real core-set 27.6%,
so the gap is thirteen cards wide, and thirteen cards of thirty-one is a rewrite of the artifact
slot rather than a trim. Its interaction rate is already below pie, so the replacements have
somewhere to go. This is the finding the static-only reader most understated — it read the gap at
24 points and six cards.

---

## 4. The three rules

**Every counters-and-bodies figure from here to the end of the report is at the static-only reading
corrected in §1**, so the baseline each rule is priced against is 155 of 371 rather than 163, and
the eight cards §1 recovers are absent from every population below. They were not re-run through the
rules, and the reason is that re-running them is a design question rather than an arithmetic one:
all eight are Equipment or Auras, which rule (a) has to decide about before it can count them (an
Equipment prints an equip cost, an activated ability and a stat bonus, and whether that is "one
thing and only one thing" is exactly what rule (a) is a rule about). The direction is knowable
without the rerun. Eight more cards in the family makes every "counters-and-bodies, cards" row
larger by up to eight and makes no rule's _reduction_ smaller, since none of the three rules removes
a card from the family. §6's ordering rests on §3.2, which is restated at the corrected reading, and
the corrected reading widens the gap the winning rule is aimed at rather than narrowing it.

### 4.1 Rule (a): cap the pure ones, add a clause rather than replace

**The population.** A card is _pure_ counters-and-bodies when it prints at least one of the four
verbs and no other clause at all. Printed keywords do not count as clauses; a 2/2 flier whose only
line makes a token is pure. There are **117 such cards, 31.5% of the set**:

|            | common | uncommon | rare | mythic |   total |
| ---------- | -----: | -------: | ---: | -----: | ------: |
| W          |      7 |        7 |    6 |      1 |      21 |
| U          |      5 |        3 |    2 |      0 |      10 |
| B          |     19 |        6 |    2 |      0 |      27 |
| R          |      9 |        6 |    5 |      0 |      20 |
| G          |     18 |        7 |    4 |      0 |      29 |
| colorless  |      6 |        3 |    1 |      0 |      10 |
| multicolor |      0 |        0 |    0 |      0 |       0 |
| **total**  |     64 |       32 |   20 |      1 | **117** |

**A parameterization that is a rule rather than a number.** "No card above common may be pure
counters-and-bodies." That selects **53 cards**: 1 mythic, 20 rare, 32 uncommon; by color W 14,
G 11, R 11, B 8, U 5, colorless 4; by type 32 creatures, 7 instants, 6 enchantments, 5 sorceries,
2 artifacts, 1 planeswalker.

Numeric caps on the same population, ordered rarity first and then mana value, for comparison:

| cap on pure cards | cards touched | rarities reached        |
| ----------------: | ------------: | ----------------------- |
|               100 |            17 | mythic and rare only    |
|                90 |            27 | + 6 uncommon            |
|                80 |            37 | + 16 uncommon           |
|                70 |            47 | + 26 uncommon           |
|                64 |            53 | every card above common |

**Where the census lands.** This is the finding that decides the whole comparison.

|                            |        now | after rule (a), 53 cards touched |
| -------------------------- | ---------: | -------------------------------: |
| counters-and-bodies, cards | 155, 41.8% |                   **155, 41.8%** |
| pure counters-and-bodies   | 117, 31.5% |                        64, 17.3% |
| opponent-facing            | 126, 34.0% |                       176, 47.4% |
| instant-speed interaction  |  57, 15.4% |                        63, 17.0% |

**Rule (a) moves the counters-and-bodies share by 0.0 percentage points, at any cap, for any number
of cards touched.** It cannot do otherwise: it adds clauses and removes none, so no card leaves the
family. It is the largest of the three passes, 53 cards against 21 and 24, and on the metric the
work was commissioned to move it does nothing. What it does move is real and is the second-largest
gain of the three on interaction: 34.0% to 47.4% opponent-facing, and it does that without deleting
a single authored card.

The instant-speed line assumes the added clause is an instant's clause or a trigger. Pushing it
higher means giving the edited permanents activated abilities, and §5.2 prices that.

### 4.2 Rule (b): a quota of pure answers, replaced wholesale

**Where it starts.** A card is a _pure answer_ when it prints at least one clause, none of the four
verbs, and every clause it prints is opponent-facing. There are **79 today**: R 24, U 18, G 14, W 10,
B 8, colorless 4, multicolor 1.

**The parameterization.** State a quota M and replace M minus 79 cards drawn from the pure
counters-and-bodies population, allocated across colors in proportion to each color's excess over
its real core-set share, commons first and lowest mana value first.

Allocation is by largest remainder over each color's excess in points, capped at the pure cards that
color actually has. The multicolor slot is the same structural shortfall rule (c) hits in §4.3: that
color is 14.3 points over its real share and has zero pure cards, so its slots redistribute.

| quota M | cards replaced | allocation                            |
| ------: | -------------: | ------------------------------------- |
|      92 |             13 | B 4, colorless 4, G 2, W 1, U 1, R 1  |
|     100 |             21 | colorless 7, B 6, G 4, R 2, W 1, U 1  |
|     110 |             31 | colorless 10, B 9, G 6, R 3, U 2, W 1 |

M = 92 is the quota that brings the set's opponent-facing share to the real core-set figure exactly.
M = 100 is priced below.

**Where the census lands, at M = 100, 21 cards replaced, 20 of them commons:**

|                            |        now |           after |
| -------------------------- | ---------: | --------------: |
| counters-and-bodies, cards | 155, 41.8% |      134, 36.1% |
| pure counters-and-bodies   | 117, 31.5% |       96, 25.9% |
| opponent-facing            | 126, 34.0% |      144, 38.8% |
| instant-speed interaction  |  57, 15.4% | up to 76, 20.5% |

The last row is an upper bound and assumes every replacement is an instant. If half the replacements
are permanents, it lands near 67.

**Twenty of the twenty-one cards this rule selects are commons.** That is the allocation formula's
doing rather than an accident: it sorts by rarity ascending and then by mana value within each color,
and the over-weighted colors have enough pure commons to fill the quota almost without reaching an
uncommon. Commons are the highest frequency slots in a sealed pool, so this is the largest real
perturbation of the three even though it touches the fewest cards. §5 prices that.

### 4.3 Rule (c): a per-color cap

**The parameterization, and the only one of the three whose parameter is measured rather than
chosen.** Cap each color's counters-and-bodies share at its real core-set share plus five points of
slack, from §3.1's second table. Rewrite the excess, taking the highest rarity in that color first.

|            |   n |   cap | cards allowed | cards today |       touched |
| ---------- | --: | ----: | ------------: | ----------: | ------------: |
| W          |  64 | 44.5% |          28.5 |          27 |             0 |
| U          |  70 | 20.1% |          14.1 |          13 |             0 |
| B          |  69 | 39.5% |          27.3 |          37 |        **10** |
| R          |  64 | 38.0% |          24.3 |          26 |             2 |
| G          |  69 | 41.1% |          28.4 |          34 |         **6** |
| colorless  |  31 | 32.6% |          10.1 |          16 |         **6** |
| multicolor |   4 | 40.7% |           1.6 |           2 | 1, unfillable |
| **total**  |     |       |               |             |        **24** |

The multicolor row is a real limit rather than a rounding note: neither multicolor card over the cap
is _pure_ counters-and-bodies, so a rule that rewrites from the pure population cannot reach them.
The rule touches 24 cards, not 25, and the shortfall is structural.

**Rarity distribution: 9 rare, 11 uncommon, 4 common.** That is the inverse of rule (b) and it
follows from taking the highest rarity first, which is the choice that keeps the common sheet still.

**Where the census lands:**

|                            |        now |           after |
| -------------------------- | ---------: | --------------: |
| counters-and-bodies, cards | 155, 41.8% |      131, 35.3% |
| pure counters-and-bodies   | 117, 31.5% |       93, 25.1% |
| opponent-facing            | 126, 34.0% |      146, 39.4% |
| instant-speed interaction  |  57, 15.4% | up to 80, 21.6% |

Per color afterward: B 39.1%, G 40.6%, colorless 32.3%, R 37.5%, W and U untouched. Every color
lands inside its cap and the set's spread across colors narrows from 35.0 points (18.6% to 53.6%) to
22.0 points (18.6% to 40.6%).

### 4.4 The three side by side

|                                     | cards touched | counters-and-bodies after |    movement | per card touched | opponent-facing after | commons touched |
| ----------------------------------- | ------------: | ------------------------: | ----------: | ---------------: | --------------------: | --------------: |
| (a) cap the pure ones, add a clause |            53 |                     41.8% |  **0.0 pp** |         0.000 pp |                 47.4% |               0 |
| (b) quota of pure answers, replace  |            21 |                     36.1% |     -5.7 pp |         0.270 pp |                 38.8% |    **20 of 21** |
| (c) per-color cap                   |            24 |                     35.3% | **-6.5 pp** |         0.269 pp |                 39.4% |         4 of 24 |

Rules (b) and (c) are the same efficiency per card touched to three decimal places, which is not a
coincidence: both remove one card from the family and add one to the answers, so the arithmetic is
identical and only the selection differs. The selection is therefore the entire decision between
them, and §5 is where it is decided.

---

## 5. What each rule costs in balance risk

**The gate was not run.** `npm run test:balance` is a long blocking gate reserved to the set owner
and this lane did not run it. What follows is a read of what it asserts, in
`packages/metrics/src/gates.ts` and `packages/metrics/test/balance/`, against what each rule does to
the pool.

**What is asserted.** Twenty-five gates: a win rate inside 40% to 70% for each of the ten color
pairs that clear the sample floor, a spread across pairs at or under 30 points, no dominant strategy
(no pair above 60% winning more than half its games by the fast round), four decisiveness bounds
(stall at or under 5%, deck-out at or under 10%, decided by the round at or over 90%, inert turns at
or under 35%), game-length and mana bands, the on-the-play band, and two ability-usage floors.

**Three things are true of all three rules and are the fixed cost of editing at all.** The pool
digest `THE_FLAGSHIP_SET_253_POOL_SHA256` fails `subjects.test.ts` on an edit of any size, so it
re-pins. The subject's waiver list is **empty**, which means every one of the twenty-five gates has
to pass with no slack, and there is no entry to loosen. And `spread.measured` is pinned at 0.134
with a drift tolerance of 0.02, so a pool edit that moves the spread by more than two points is a
re-pin that has to arrive with a written reason.

### 5.1 Which gate each rule leans on

**Rule (b) puts the most pressure on `balance.pair.*` and it is not close.** It replaces 20 commons
out of 214, which is 9.3% of the common sheet, and the replacements are answers rather than bodies.
Commons are what a sealed deck is mostly made of, so this is the largest change to what a game
actually sees of the three, despite touching the fewest cards. Its concentration is seven colorless
cards, six of them common, and six black cards, all six common. Colorless commons are drafted and
played by every pair, so the colorless half of the change lands on all ten measured pairs at once,
and the black half lands on the four pairs that include black.

**Rule (b) also leans on `decisiveness.decided` and `decisiveness.stall` in the same direction.**
Removing 21 common bodies and adding 21 answers takes creatures off the table and adds ways to
remove them. Both effects lengthen games. `decided by round` has to stay at or over 90% and `stall`
at or under 5%, and both move the wrong way under a body-for-answer trade at common.

**Rule (c) leans on the same gates and less hard**, because only 4 of its 24 cards are commons. Its
concentration risk is different: 6 of 24 are colorless, which is 19% of the 31 colorless cards, and
a colorless card is drafted and played by every color pair rather than by two of them. So rule (c)'s
perturbation is smaller but spread across all ten pairs instead of four, which is the shape that
moves `balance.spread` least and the shape a single pair is least likely to absorb badly.

**Rule (a) leans on `abilities.usage`, and it is the only rule that does.** The floor is derived
rather than fixed: it is 0.05 times the share of the pool carrying an activated ability, so growing
that share raises the bar the sweep has to clear. Thirty-nine of 371 cards carry an activated
ability today, 10.5%. If rule (a)'s 53 added clauses are printed as activated abilities the share
goes to roughly 92 of 371, 24.8%, and **the floor more than doubles** while the bots' willingness to
activate does not. If they are printed as triggers instead, the pressure moves to
`abilities.triggers`, whose measured rate sits about twelve times its floor and has room. So rule
(a) has a safe form and an unsafe one, and which it is depends on a choice made card by card, which
is the property a stated rule is supposed to remove.

**Rule (a) is the only rule that raises no structural risk at all** on the demand-and-supply side,
because it removes nothing. That is a real advantage and §6 weighs it against the zero in §4.4.

### 5.2 The interaction ceiling rule (a) cannot pass safely

Rule (a) reaches 63 instant-speed interaction cards, +1.6 points, which is barely more than the
sixteen-card appending pass it was supposed to improve on. Reaching further means the added clauses
have to be castable on the opponent's turn, which for a permanent means an activated ability, which
is exactly the `abilities.usage` pressure above. The set prints zero cards with flash, so there is
no third window.

### 5.3 Two structural gates that fail before the balance gate ever runs

These are in `packages/setgen/src/validate/`, they are cheap to run, and they refuse a set outright.

**Sacrifice supply.** Thirteen cards in the set carry an activation cost that eats another permanent
of a named subtype. Eleven of those name one subtype and 51 cards supply it. Rule (b) removes 7 of
the 51 and rule (c) removes 12, leaving 44 and 39, and each removes exactly one of the eleven
spenders. Both leave supply far above demand, so `checkSacrificeSupply` holds. Rule (a) removes
none.

**Mechanic coverage at common is the tight one.** The set's brief states two mechanics. The
colorless one names `createToken` and `putCounters` as its vocabulary, and of the twelve colorless
commons **exactly two print each verb, and one card is in both pairs**. Rule (b)'s M = 100 selection
takes one card from each pair, and they are the two distinct ones, so the whole colorless mechanic
at common falls back onto the single card that carries both verbs. Rule (c) takes two colorless
commons and neither prints either verb, so both pairs stay intact. The margin under rule (b) is one
card and `checkMechanicCoverage` is the gate that reads it.

**The black mechanic's coverage is the same shape one color over.** Fourteen of its twenty minters
are commons. Rule (b) takes 4 of those 14 and no card above common; rule (c) takes 1 of the 14 and 4
above common. Neither breaks coverage at common, and the difference at common is a factor of four in
the same direction as everything else in this section.

### 5.4 The color signature gate constrains what a replacement may say

The brief states a per-color absent list and the flagship's color-signature test under
`packages/setgen/test/` asserts the set has
zero cards off it. This is not advisory: the last authoring pass had a white card drafted as a
destroy and the gate refused it. It restricts every replacement rule (b) and (c) writes.

| color | answer verbs it may not print       | answer verbs left, with the count already printed                                                                             |
| ----- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| W     | destroy, bounce, mill               | exile (8), damage (4), tap (2), counter (0), fight (0), discard (0), prevent (1), and eight more at zero                      |
| U     | destroy, damage                     | counter (10), bounce (9), tap (9), put on library (2), exile (0), mill (0), and ten more at zero                              |
| B     | damage, tap, bounce                 | destroy (4), life loss (4), mill (2), discard (2), forced discard (2), exile graveyard (1), exile (1), and eight more at zero |
| R     | counter, destroy, bounce, tap, mill | damage (25), exile (0), fight (0), prevent (2), and nine more at zero                                                         |
| G     | counter, destroy, bounce, tap, mill | fight (6), damage (6), exile (3), and ten more at zero                                                                        |

Green is the tightest, with 13 allowed verbs of which only three are printed at all, and it is the
color rule (c) takes six cards from. Black is comfortable: it forbids the three verbs black should
not have anyway and leaves destroy, exile, discard, mill and life loss, four of which are printed
four times or fewer in a 69-card color. **There is more room for black answers than black has
answers**, which is the same finding §3.2 reached from the other side.

---

## 6. Recommendation

**Rule (c), the per-color cap, at each color's real core-set share plus five points.**

The number that decides it is in §3.2 and it is about a color the framing did not name. The rule as
proposed was "green stays a counters color and blue stops being one"; blue is 18.6% against a real
core-set 15.1% and is already the most interactive color in the set, so a per-color rule pointed at
blue rewrites nothing that is wrong. Black is +20.6 points on the family and -22.8 points on
interaction, the only color that is far out of pie in both directions at once; colorless is further
out on the family axis alone and §3.2 says what that costs to close. A cap set from the measured baseline finds that automatically and puts ten
of its twenty-four cards there; a cap set from an intuition about which colors feel counters-heavy
does not.

Rule (a) is eliminated by arithmetic rather than by judgment: it touches the most cards, 53 against
24, and moves the headline share by exactly zero, because adding clauses cannot take a card out of a
family it is already in. It remains the right rule for a different, narrower complaint, which is
that 31.5% of the set does one thing and only one thing; if that is the complaint, (a) answers it
for 53 cards and no card is deleted.

Rule (b) and rule (c) move the headline identically per card touched, 0.270 against 0.269 points,
so efficiency does not separate them and the selection does. Rule (b) puts 20 of its 21 cards on the
common sheet, takes one card from each of the two colorless-common pairs that carry a stated
mechanic's whole vocabulary at common, and takes four commons out of a fourteen-common mechanic;
rule (c) puts 20 of its 24 above common and takes neither mechanic-critical colorless common. Against an **empty waiver list**,
where every one of twenty-five gates must pass with no slack, the pass that leaves the common sheet
alone is the pass more likely to survive the sweep. And rule (c)'s parameter is the only one of the
three that is measured rather than chosen, which is what makes the pass reviewable at the level of
the rule instead of the card, which is the whole reason to have a rule.

One caveat that belongs to the recommendation rather than to a footnote: black's excess is mostly a
stated mechanic, twenty cards on the set's own named counter, fourteen of them common. The cap
should be set around it, not through it. Taking black's ten from rarity down, as §4.3 does, takes
one common and nine cards above common, which is the version of the cap that leaves the mechanic
where the brief put it.

---

## 7. Reproduction, and what was not measured

**Reproducing §2 and §4.** The instrument is fully specified in §1: `printedEffectKinds` from
`packages/setgen/src/validate/mechanics.ts` over the committed set file, unioned with the
`modification.kind` of every static ability on the card and on the abilities of every token it
creates, deduplicated per card. No tool was committed for it; a census this load-bearing should have
one, and that is a follow-up rather than part of this lane.

**Reproducing §3.** `packages/data/data/reference-sets-v1.json`, restricted to entries whose `roles`
contain `main-set`, whose `types` exclude `Land`, deduplicated by name, for the five set codes named.
The regular expressions are printed in §3 in full.

**What was not measured.** No game was simulated and no gate was run, so every projection in §4 is
an arithmetic consequence of the selection rather than an observation. The instant-speed rows for
rules (b) and (c) are upper bounds that assume every replacement is an instant. The real core-set
baseline is a text proxy against a structural walk and the two are not the same instrument, which is
stated in §3 and is why the finding rests on a twenty-point gap rather than a three-point one.
Whether a rewritten card may change its name and flavor, which reopens the art question for those
cards, is a separate decision this lane did not price.
