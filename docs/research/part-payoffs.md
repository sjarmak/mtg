# Four cards that read a part counter

Measured 2026-08-21 (`mtg-rxc0`), against this worktree at `4e82fdb2`. Every number below was
produced by a run over the committed flagship set fixture under `packages/setgen/fixtures/sets/`
and the shipped evaluator and kernel on this machine. Where the bead's census disagreed with the
tree, the tree won, and section 1 says by how much.

**This report proposes and proves. It prints nothing.** The four cards below validate, resolve on
the kernel and price against the pool, and none of them is in the brief. The set's owner has an
open question about which family gets the remaining authored slots, and the answer to that question
costs a cap raise; what follows is the evidence for answering it, not the answer.

**Verdict (argued in section 4): three of the four are draftable today and the fourth is not, and
the reason is not the one the bead predicted.** The pool-aware pricing that `mtg-ji87` landed does
reach a part payoff: a `withCounter` target restriction is priced through `counterSupply` rather
than through the flat `restrictedTargetFactor`, and `readsTheDeck` is true for it, so the deck
builder pays a `deckUnlock` premium when a minter joins the deck. But the counter census that feeds
that supply reads `printedEffects`, which does not descend into a token's abilities, and **eleven of
this set's thirteen part minters mint only through a token they create**. So the builder sees two
horn sources where the set has thirteen minters across five counters, and a payoff on fang, hide,
talon or wing prices *below* its context-free score rather than above it. That is a one-function
gap, it is measured in section 4, and it should be a bead of its own whether or not these cards
are ever printed.

---

## 1. The census, re-measured

Command (the script is scratch, its body is section 1.1):

```
npx tsx <scratch>/census.ts
```

It walks every node of every card record in the committed flagship fixture (371 cards), counts a
`putCounters` effect as minting the counter it names, and counts `countWithCounter`, `withCounter`
and `anyCreatureHasCounter` as reading one.

```
counter              minted-by read-by
plusOnePlusOne              53       0
gloom                       20       6
hide                         5       0
horn                         4       0
wing                         3       0
fang                         2       0
talon                        2       0
minusOneMinusOne             2       0
```

Thirteen cards mint a part counter. Zero read one. That is the bead's finding and it still holds;
the counts moved because the set did, from 368 cards to 371 and from 121 authored cards to 124.
The minters, by color and rarity, without naming them (section 6.1 says why):

| rarity | count | colors and counters |
| --- | --- | --- |
| common | 2 | R horn, colorless horn |
| uncommon | 7 | B fang x2, R horn, R talon, G hide x2, G talon |
| rare | 1 | R hide+horn |
| mythic | 3 | B hide+wing, G hide+wing, WG wing |

Sources per counter: hide 5, horn 4, wing 3, fang 2, talon 2. That distribution is what picks the
three uncommon colors below: red owns horn (4 sources, 3 of them red), green owns hide (5 sources,
3 of them green), black owns fang (2 sources, both black uncommons). Fang is the thinnest support
in the set and the black card is priced for that, not against it.

**One correction to the bead.** Its census reported gloom minted by 24 cards. It is 20. The
over-count is the shape this report's own instrument had on its first pass: classifying any node
whose kind matches `/counter/i` and that carries a `counter` field as a minter sweeps in the four
`withCounter` restrictions and the two `anyCreatureHasCounter` conditions, which are readers.
Minting is `putCounters` and nothing else; that is checked, and `putCounters` is the only minting
kind in the fixture.

### 1.1 What the instrument does

```ts
if (kind === 'putCounters') {
  const counter = record['counter'];
  if (typeof counter === 'string') note(minted, counter, id);
}
if (kind === 'countWithCounter') {
  const counters = record['counters'];
  if (Array.isArray(counters)) for (const c of counters) if (typeof c === 'string') note(read, c, id);
}
if (kind === 'withCounter' || kind === 'anyCreatureHasCounter') {
  const counter = record['counter'];
  if (typeof counter === 'string') note(read, counter, id);
}
```

---

## 2. The four cards

A cycle: one uncommon in each color that already mints parts, plus one rare build-around. The
design rule the cycle runs on is that **each payoff pairs with the keyword its counter already
grants** (`COUNTER_DECLARATIONS`: fang is menace, hide is trample, horn is first strike, talon is
deathtouch, wing is flying). A part counter is already +1/+1 and a keyword, so a payoff that just
adds more stats is a worse card than one that completes a combination the counter started.

| card | color | rarity | cost | oracle text | chars | score |
| --- | --- | --- | --- | --- | --- | --- |
| Warren Tollkeeper | B | uncommon | {2}{B} 3/3 | Menace // Whenever Warren Tollkeeper attacks, target creature with a fang counter on it gets +1/+1 and gains lifelink until end of turn. | 133 | 1.782 |
| Lower the Horns | R | uncommon | {R} instant | Target creature with a horn counter on it gets +3/+0 until end of turn. | 71 | -0.180 |
| Whet the Tusks | G | uncommon | {G} instant | Target creature with a hide counter on it gets +1/+1 and gains deathtouch until end of turn. | 92 | -0.270 |
| Trophy Colossus | G | rare | {2}{G} 1/1 | Trample // Trophy Colossus gets +1/+1 for each creature you control with a fang, hide, horn, talon, or wing counter on it. | 119 | 3.300 |

`//` is a line break in the printed text. Character counts are `renderOracleText(card).length` on
the exact records below, including the newline; all four are under the 140-character `longText`
flag, and the widest is 133.

### 2.1 Warren Tollkeeper, {2}{B} uncommon

```json
{
  "id": "xmp-warren-tollkeeper",
  "name": "Warren Tollkeeper",
  "rarity": "uncommon",
  "set": {"code": "XMP", "collectorNumber": 372},
  "colors": ["B"],
  "supertypes": [],
  "subtypes": ["Monster"],
  "keywords": ["menace"],
  "effects": [],
  "abilities": [
    {
      "kind": "triggered",
      "condition": "selfAttacks",
      "effects": [
        {
          "kind": "pumpUntilEndOfTurn",
          "power": 1,
          "toughness": 1,
          "keyword": "lifelink",
          "target": {
            "kind": "targetCreature",
            "restriction": {
              "kind": "withCounter",
              "counter": "fang"
            }
          }
        }
      ]
    }
  ],
  "costReduction": null,
  "power": 3,
  "toughness": 3,
  "kind": "creature",
  "manaCost": {"W": 0, "U": 0, "B": 1, "R": 0, "G": 0, "generic": 2},
  "artifact": false,
  "oracleText": "Menace\nWhenever Warren Tollkeeper attacks, target creature with a fang counter on it gets +1/+1 and gains lifelink until end of turn."
}
```

A fang counter grants menace, so the creature this trigger aims at is already hard to block; giving
it lifelink turns an unanswered attack into a swing of eight rather than four. Menace is printed on
the Tollkeeper itself so the two bodies attack the same way, which is the flavor of the card and
also the reason it is a creature rather than the obvious instant: black's part support is two
uncommons, so a card that has to find a fang bearer the turn it is cast would be dead more often
than not, while a body that asks every combat gets more chances at a thin population.

The obvious black card here is a removal spell keyed to a counter. It is not printable: every part
minter in the set puts its counter on a creature **you control**, so a `withCounter` restriction on
a removal effect would aim at your own board.

### 2.2 Lower the Horns, {R} uncommon

```json
{
  "id": "xmp-lower-the-horns",
  "name": "Lower the Horns",
  "rarity": "uncommon",
  "set": {"code": "XMP", "collectorNumber": 373},
  "colors": ["R"],
  "supertypes": [],
  "subtypes": [],
  "keywords": [],
  "effects": [
    {
      "kind": "pumpUntilEndOfTurn",
      "power": 3,
      "toughness": 0,
      "target": {
        "kind": "targetCreature",
        "restriction": {
          "kind": "withCounter",
          "counter": "horn"
        }
      }
    }
  ],
  "abilities": [],
  "costReduction": null,
  "kind": "instant",
  "manaCost": {"W": 0, "U": 0, "B": 0, "R": 1, "G": 0, "generic": 0, "hasX": false},
  "oracleText": "Target creature with a horn counter on it gets +3/+0 until end of turn."
}
```

Horn is first strike, so +3/+0 on a horn bearer kills the blocker before it swings back. That is
the whole card, at one mana, at instant speed: it is a decision the opponent has to make with red
mana open, and unlike a +2/+2 it does not save the creature from a bigger body, so blocking is
still sometimes right.

+2/+2 prices better on the evaluator (-0.090 against -0.180). It was refused because a toughness
bump on a first striker is the redundant half; the card is more interesting when the attacker can
still lose.

### 2.3 Whet the Tusks, {G} uncommon

```json
{
  "id": "xmp-whet-the-tusks",
  "name": "Whet the Tusks",
  "rarity": "uncommon",
  "set": {"code": "XMP", "collectorNumber": 374},
  "colors": ["G"],
  "supertypes": [],
  "subtypes": [],
  "keywords": [],
  "effects": [
    {
      "kind": "pumpUntilEndOfTurn",
      "power": 1,
      "toughness": 1,
      "keyword": "deathtouch",
      "target": {
        "kind": "targetCreature",
        "restriction": {
          "kind": "withCounter",
          "counter": "hide"
        }
      }
    }
  ],
  "abilities": [],
  "costReduction": null,
  "kind": "instant",
  "manaCost": {"W": 0, "U": 0, "B": 0, "R": 0, "G": 1, "generic": 0, "hasX": false},
  "oracleText": "Target creature with a hide counter on it gets +1/+1 and gains deathtouch until end of turn."
}
```

Hide is trample, and trample plus deathtouch is the oldest real combination in green: one damage is
lethal to each blocker and the rest goes to the player. At one mana this is a blowout against a
block and does nothing against no block, which is the shape a trick should have. Deathtouch is
legal for green in this set's `colorSignatures`; it is on white's and blue's absent lists, not
green's, and the check in section 3 is the set's own gate saying so rather than this report
asserting it.

### 2.4 Trophy Colossus, {2}{G} rare

```json
{
  "id": "xmp-trophy-colossus",
  "name": "Trophy Colossus",
  "rarity": "rare",
  "set": {"code": "XMP", "collectorNumber": 375},
  "colors": ["G"],
  "supertypes": [],
  "subtypes": ["Monster"],
  "keywords": ["trample"],
  "effects": [],
  "abilities": [
    {
      "kind": "static",
      "scope": "self",
      "subtype": null,
      "modification": {
        "kind": "statBonusPer",
        "power": 1,
        "toughness": 1,
        "each": {
          "kind": "countWithCounter",
          "filter": {
            "cardTypes": ["creature"]
          },
          "counters": ["fang", "hide", "horn", "talon", "wing"]
        }
      },
      "enabledWhile": null
    }
  ],
  "costReduction": null,
  "power": 1,
  "toughness": 1,
  "kind": "creature",
  "manaCost": {"W": 0, "U": 0, "B": 0, "R": 0, "G": 1, "generic": 2},
  "artifact": false,
  "oracleText": "Trample\nTrophy Colossus gets +1/+1 for each creature you control with a fang, hide, horn, talon, or wing counter on it."
}
```

The build-around, and the only card of the four that **counts** rather than checks. A 1/1 for three
that is a 4/4 trample with three bearers on the board and a blank without them is the card that
makes a drafter pick up the thirteen minters, which is what this cycle is for. It counts creatures
**you control**, it counts a permanent once however many part counters it carries, and it counts
itself once it has one.

`countWithCounter` is what makes it printable at all, and it arrived after the bead was written
(`mtg-25t8`, merged 2026-08-20). The bead's "vocabulary blocker" paragraph, which says a scaling
part payoff needs a ninth `ComputedAmount`, is stale: `countWithCounter` is a member of both
`ComputedAmountSchema` and `PermanentTallySchema` today, and this card is a `statBonusPer` over it.

---

## 3. Evidence, per card

Three checks each, all run against the literal records above.

**Validation.** `validateCard` returns zero violations for all four. `validateCards` over the 371
committed cards plus these four also returns zero, which is the id, name and `cardFingerprint`
collision sweep, so none of the four collides with a card the set already prints. Each card's id is
`cardIdFor('XMP', name)` as `packages/setgen/src/authored.ts` requires. `signatureFindings` against
the brief's `colorSignatures` returns nothing for all four, so no card prints a subject its color
has on its absent list. The cached `oracleText` on each record equals `renderOracleText(card)`,
which `packages/dsl/src/validate/index.ts` requires.

**Kernel.** Each card was built into a `scenario` board and resolved through the reducer. Fourteen
assertions, all passing:

- *Lower the Horns*: board of a Mountain, a 2/2 with a horn counter and a bare 2/2. `legalActions`
  offers the horn bearer as the only legal target, so the restriction is enforced by the kernel and
  not just by the schema. Cast at the bearer: power 3 (2 printed, +1 from the counter) becomes 6.
  The bare 2/2 is untouched.
- *Whet the Tusks*: a 2/2 with a hide counter (3/3 trample) against a 5/5. Cast: power 4. Attack
  into the 5/5: the blocker is in the graveyard after combat and the defender is at 17, so
  deathtouch made 1 damage lethal and trample carried the other 3 through.
- *Warren Tollkeeper*: the Tollkeeper and a 2/2 fang bearer attack. The reducer stops with a
  `triggerTargets` decision (CR 603.3d) and offers exactly one target, the fang bearer. Aimed and
  resolved: the bearer is 4 power, the defender ends at 13 (3 + 4 unblocked) and the attacking
  player at 24, so lifelink paid.
- *Trophy Colossus*: a board of a horn bearer, a hide bearer, a gloom bearer, a bare 2/2 and an
  opposing wing bearer. The Colossus is 3/3 (1/1 plus two bearers), so the gloom counter is not a
  part and the opposing bearer is not counted. Put a fang counter on the Colossus: 5 power (1
  printed, +1 from its own counter, +3 for three bearers including itself). Put a second part
  counter on a body that already has one: still 3, so a tally of permanents is not a tally of
  counters.

**Price.** `evaluateCard` with the default weights, against the bands the fixture already prints at
the same rarity and card kind:

| card | score | comparable band (fixture) | n | median | range |
| --- | --- | --- | --- | --- | --- |
| Warren Tollkeeper | 1.782 | uncommon creatures at mana value 3 | 28 | 1.528 | -1.139 to 4.350 |
| Lower the Horns | -0.180 | uncommon instants and sorceries at mana value 2 or less | 18 | 0.250 | -0.900 to 3.400 |
| Whet the Tusks | -0.270 | same band | 18 | 0.250 | -0.900 to 3.400 |
| Trophy Colossus | 3.300 | rare creatures, all mana values | 19 | 3.557 | -1.274 to 5.017 |

Negative scores on the two instants are normal for the band: six of the eighteen comparable spells
in the fixture score at or below zero, because the mana penalty is charged before the effect is
credited and a one-mana conditional trick is a small effect. Both sit inside the printed range.

Trophy Colossus at 3.300 is the number to argue about, and it is an artifact of the evaluator
rather than of the card. `staticModificationValue`'s `statBonusPer` arm prices a computed amount at
`weights.computedAmountAssumption`, a flat 3, so the evaluator reads this card as an unconditional
+3/+3 and prices it as a 4/4 trample for three. That is the *ceiling* of the card priced as its
floor. Printed at 2/2 it scores 5.450, above every rare creature in the set including the six-mana
mythofrare bodies, which is why it is printed at 1/1: at 1/1 the flat assumption lands it just under
the fixture's median rare creature instead of at the top of the set. `mtg-xiis` records the sibling
gap for `effect.target.filter`; this is the same class of finding for `computedAmountAssumption`,
and section 4 is where it bites hardest.

---

## 4. Is a part payoff draftable yet?

The bead says to check this before authoring anything: "the evaluator is a pure function of one
card and cannot see what the pool mints, so a payoff card in a pool with thirteen minters and a
payoff card in a pool with none score identically". `mtg-ji87` has since landed pool context, so
the question is whether that retires the warning.

**It half retires it, and the surviving half is different from the one that was predicted.**

Two shapes reach the pool and one does not:

- A `withCounter` **target restriction** is priced through `counterSupply(context, counter)`
  instead of the flat 0.5 `restrictedTargetFactor` (`targetNarrowingFactor`), and `readsTheDeck`
  returns true for it, so `priceAgainstDeck` adds a `deckUnlock` component when a minter joins the
  deck. All three uncommons are this shape.
- An `enabledWhile` **condition** is priced through `conditionSupply`, which routes
  `anyCreatureHasCounter` to the same supply. No card here uses it, but it is the other live path.
- `countWithCounter` in an amount or in `statBonusPer.each` reaches nothing. It is always
  `weights.computedAmountAssumption`, and `readsTheDeck` does not look at it at all. **Trophy
  Colossus scores exactly 3.300 in a pool with thirteen minters and in a pool with none.** The
  bead's warning is true, verbatim, for the rare.

Then the measurement, which found the larger problem. A 40-card pool holding all thirteen minters,
priced twice: once with the counter census the tree ships, and once with a census patched to
descend into the tokens a card creates.

```
counter    sources (shipped)  sources (deep)  supply (shipped)  supply (deep)
fang                       0               2             0.000          0.550
hide                       0               5             0.000          0.877
horn                       2               4             0.550          0.808
talon                      0               2             0.000          0.550
wing                       0               3             0.000          0.704
```

`deckContextOf` builds `counterSources` from `printedEffects(card)`, which is the card's own
effects, its modes' effects and its abilities' effects. It does not descend into a `createToken`
effect's token. **Eleven of the thirteen minters mint only inside a token's activated ability**
(the token sacrifices itself to place the counter); only two place a counter from the card's own
text. So four of the five part counters have a measured supply of zero in a deck that is nothing
but part minters.

What that does to the four cards:

| card | reads the deck | context-free | shipped census, 13 minters | shipped census, 0 minters | deep census, 13 minters |
| --- | --- | --- | --- | --- | --- |
| Warren Tollkeeper | yes | 1.782 | 1.440 | 1.440 | 1.816 |
| Lower the Horns | yes | -0.180 | -0.143 | -0.550 | 0.048 |
| Whet the Tusks | yes | -0.270 | -0.550 | -0.550 | -0.059 |
| Trophy Colossus | no | 3.300 | 3.300 | 3.300 | 3.300 |

Read the middle two columns first. Horn is the only counter the shipped census can see, so Lower
the Horns is the only card that prices *up* in a pool full of minters (-0.180 to -0.143) and down
in a pool without them (-0.550). Every other payoff prices at or below its context-free score in
both pools, because a supply of zero is a worse multiplier than the flat 0.5 the context replaced.
A part payoff on fang, hide, talon or wing is therefore not merely invisible to the pool today, it
is actively penalized by it.

The last column is the same measurement with the census descending into tokens. Every checking card
then prices up in the minter pool and unchanged in the empty one, which is the behavior `mtg-ji87`
was landed for.

**So: the three uncommons are draftable the day the counter census descends into tokens, and that is
a change to one function.** The rare is not draftable at any point without a second change:
`countWithCounter` needs an arm in `targetNarrowingFactor`'s neighborhood that reads
`counterSupply` over the counters it names, and `readsTheDeck` needs to return true for it. Both are
worth a bead; neither is this lane's.

Printed as they stand, on the tree as it stands, this cycle would add four cards that the
10,035-game gate plays without the deck builder ever preferring them to a card that does the same
thing unconditionally. That is the sentence the bead asked for out loud.

---

## 5. What the cycle costs

The brief's authored list is full: **124 of a cap of 124**. Four cards means the cap moves to 128.
The cap's own docblock (`packages/setgen/src/brief.ts`) sets the standard a raise has to meet:

> So this is the appending the paragraph above predicted, at about the size it predicted. The bound
> moves to exactly where the list ends this time instead of leaving room ahead of it, which is a
> deliberate reversal of that paragraph's last decision: the room is what let this pass append
> sixteen cards without anyone reading the argument for the previous sixteen, and a raise that has
> to be typed is a raise that has to be argued. The one after this should arrive the way this one
> did, with a census and a named hole.

The named hole is thirteen minters and zero readers, re-measured in section 1 rather than carried
over from the bead. The census is section 1. So this proposal meets the docblock's standard on both
counts, with one qualification the previous raise did not have to make: the 124 raise closed a hole
that no effect census could find, and this one closes a hole that an effect census found a year of
cards ago and that has not been closed because the slots ran out.

The wording for the raise, matching the existing docblock's form:

> 128 is the fourth, and its hole is the oldest one in the set: five bespoke counters that thirteen
> cards mint and no card reads. `docs/research/part-payoffs.md` is the census and `mtg-rxc0` carries
> it. Four cards close it, a cycle rather than a scattering: an uncommon in each color that already
> mints parts, each pairing its counter's granted keyword with the half that keyword does not
> supply, plus one rare that counts bearers of all five. The three uncommons check a counter through
> `withCounter` and price against the pool; the rare counts through `countWithCounter` and does not,
> because no pricing path reads that amount. Section 4 of the report measures both and names the two
> functions that would close the gap.

Alternative, if the cap does not move: four of the 124 authored cards come out. This report does not
recommend which, because that is a design judgment about cards it deliberately does not name, and
because a replacement is the more expensive option in every way that matters below (the same
re-sweep, plus whatever the removed cards were doing for the format).

---

## 6. What landing it would require

1. Append the four records to `authoredCards` in the flagship brief under
   `packages/setgen/briefs/`, and raise the cap in `packages/setgen/src/brief.ts` from 124 to 128
   with the argument in section 5 written into its docblock.
2. Rebuild the committed set fixture under `packages/setgen/fixtures/sets/`. The four cards take
   collector numbers 372 through 375; the records above are stamped with those, and
   `printAuthoredCards` restamps them anyway.
3. Re-sweep and move all three digest pins in one commit: the balance baseline in
   `packages/metrics/test/balance/baseline.ts`, the precon status fixture under
   `packages/setgen/fixtures/decks/`, and the retained preconstructed-deck evidence. This is the
   serial 10,035-game sweep, it is blocking in CI, and it is not an agent's job to run unattended.
4. Art: four new cards are four new surfaces, so the art pipeline's governance check will name them until they are
   either in a manifest or declared pending against a bead.

Steps 1 and 2 are cheap and reversible. Step 3 is the real price of this cycle and it is the same
price any four authored cards cost.

### 6.1 Why this report names no card in the set

`docs/research/` is not in `PRIVATE_PATHS` and not in the individually listed private docs, so this
file exports. the public-export boundary test under `packages/slice/` fails a build that leaves a private
path in an exported file, and the set fixture and the flagship brief are both private paths, which is why
every reference above is to the containing directory. Card names are the softer half: the boundary's
term scan covers public *packages*, not `docs/`, so a set card named here would not fail the gate,
it would simply leave the building. The four names below are new and appear in no fixture, so they
carry nothing; the thirteen minters are described by color, rarity and counter instead. Registering
the set's names through the census tool under `packages/slice/tools/` would have meant a second
tracked file, which this lane is not allowed to add.

---

## 7. What could not be made to work

Five things, none of them fixed here, all of them read off the tree.

**A static ability cannot be narrowed to counter-bearers.** `STATIC_SCOPES` is `self`,
`creaturesYouControl` and `otherCreaturesYouControl`; `subtype` narrows by creature type and
`enabledWhile` is a whole-board presence question. "Creatures you control with a fang counter get
+1/+1" is inexpressible, and that is the lord this cycle would otherwise have wanted at rare.
`statBonusPer` over `countWithCounter` is the nearest reachable shape and it scales one creature by
a count rather than scaling the counted creatures, which is a different card.

**The first design for the black uncommon priced at exactly zero.** A `mustBeBlockedIfAble` static
gated on `anyCreatureHasCounter` is a lure that pairs with menace, and it is the best interaction in
any draft of this cycle: fang grants menace, so a lure on a menacing body forces two blockers or
none. `staticModificationValue` returns 0 for `mustBeBlockedIfAble` on purpose, with a docblock
arguing that its sign cannot be resolved from the card alone, so the card scored as a vanilla body
in every pool. It is not printed here because a card the builder cannot see the point of is the
exact failure this report is about. It is the right card the day that arm has a number.

**No activation cost removes a counter.** `ActivationCost` is mana, `tapSelf`, `sacrificeSelf` and
`sacrificeOther`. "Remove a fang counter: do X" is not expressible, which rules out the whole family
of payoffs that spend the counter instead of reading it.

**No trigger watches a counter arrive or a bearer attack.** None of the 25 `TRIGGER_CONDITIONS`
mentions counters. "Whenever a creature you control gets a part counter" is inexpressible, so a
payoff has to ask the board a standing question or aim at a target, and Warren Tollkeeper's
`selfAttacks` trigger is the closest reachable shape.

**Forge export refuses the rare.** `@mtg/forge-export` declines `countWithCounter` outright: its
part counters each decompose into two Forge counter types and no `counters_GE1_` restriction counts
the same permanents. So Trophy Colossus would be a card the parity oracle cannot take, which is a
known and accepted limit rather than a new one, but it is worth knowing before printing the set's
first `countWithCounter` card.

---

## 8. The two things this set calls "part"

The set carries two unrelated things under that word, and the bead is right that it does real
damage. Re-measured on the 371-card fixture:

- the five part **counters**: 13 cards mint one, 0 read one.
- the Part artifact **subtype**: 1 card is printed with it, 46 cards create a token that has it, 54
  token instances across the set, 8 distinct Part tokens by name, 53 cards whose record mentions the
  word at all.

The bead's note reports one card for the subtype because it counted printed subtypes only; the
tokens are where that population actually lives, and it is much larger than the note implies. Both
readings of the mechanic therefore have a real population behind them, which is why repointing the
existing subtype-reading rare is a live decision (`mtg-kvm1`) rather than an obvious cleanup.

**All four cards here read the counters. None of them names the subtype**, and that is deliberate:
the counters are the population that reaches every rarity and every color that matters, and a
proposal that read both nouns would make the collision worse. There is one relationship worth
stating, because it is the same finding as section 4 from the other side: the Part **tokens** are
the delivery mechanism for the part **counters**. Eleven of the thirteen minters create a Part token
whose own ability sacrifices it to place the counter. So the cycle's supply chain runs entirely
through the subtype while naming none of it, and any change to how Part tokens work is a change to
how these four cards get fed.
