# ADR-0003: The Draftmancer rating scale

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-11 |
| **Bead** | `mtg-bc2.19` |
| **Resolves** | `docs/research/decision-synthesis.md` §7.6 (first half: the rating mapping). The external-bot registration spike, the second half of that question, stays open. |
| **Inputs** | `docs/research/prior-art-tooling.md` §1.1 and §8.1, `docs/research/prior-art-mtg-ai.md` §3.4, `packages/deckbuild/src/evaluate.ts`, `packages/draft-export/` |

---

## 1. Context

Draftmancer is adopted (tooling §1.1): MIT, self-hostable, and the only open format found that
describes custom cards *and* booster collation. `@mtg/draft-export` compiles a DSL set into that
format. This ADR settles the one number in that file we have to invent.

Draftmancer's bot layer is a chain of external services, and every one of them dead-ends on custom
content: `fallbackToSimpleBots()` returns true whenever any custom card lacks an oracle id, which
for a generated set is every card. A generated set is therefore always drafted by `SimpleBot`,
whose entire algorithm is

```
score = card.rating + 0.35 × (already-picked cards in each of this card's colors)
```

argmax with a random tie-break. Everything a bot knows about our cards arrives through one number
per card, which we emit. The scale that number is on is the whole of the bot's card judgment.

The lab already has a card evaluator: `evaluateCard` in `@mtg/deckbuild` scores a card into named,
inspectable components from named weights, and it is a pure function of (card, weights). It is what
the deck builder picks with, it is deterministic, and it is already the baseline the later LLM
deck-building tier is measured against. It reports scores in an open-ended range around zero, in
this repository's fixture set from -2.10 to +2.45.

## 2. Decision

The emitted `rating` is a **min-max map of `evaluateCard`'s score onto [0, 5], fitted per set over
the non-land cards, rounded to three decimals**.

1. **Monotone.** Ordering by rating is ordering by score. The bot's preference inside a color is
   the deck builder's preference, and a rating that surprises you is an evaluator weight that
   surprises you — one place to argue with, not two.
2. **Set-relative, and only ordinal.** The worst spell in a set rates 0 and the best rates 5,
   whatever the set. A 4.0 in one set does not mean what a 4.0 means in another. That is a real
   limitation and it is deliberate: an absolute scale needs a calibration constant, we have no data
   to fit one from tonight, and a fitted-looking constant that came from nowhere is worse than an
   admittedly ordinal one. §5 files the calibration.
3. **Lands take the floor.** `evaluateCard` scores every land 0 by construction, because the mana
   base is built separately — that 0 is a sentinel, not a measurement. Normalizing it alongside real
   scores rates a basic above every spell that scores negative, and a bot that first-picks a Plains
   over a removal spell is not a bot, so lands are held out of the fit and pinned to 0. A basic in a
   pack is never the pick, and 0 is how that is said in this format.
4. **Spells the evaluator cannot separate rate 2.5.** One spell, or a set of equal ones, has no
   worst and no best; 0 and 5 would both be claims the evaluator did not make.
5. **Three decimals.** The step is 0.001, roughly 350× finer than the 0.35 the bot reasons in, so
   rounding never reorders cards the evaluator separated. It also makes the emitted file
   byte-stable, which is what makes a draft reproducible. Two scores that differ only in float noise
   collapse to one rating, which is correct: they are the same card to a drafter.

### 2.1 Why 0-5 and not a narrower band

The one hard constraint in the source is the 0.35. The band is `5 / 0.35 = 14.29` color steps
wide, so a bot needs **fifteen** already-picked on-color cards before color affinity alone
overtakes the full quality range — that is, before the worst card in its colors beats the best card
outside them. Over a three-pack draft that point arrives late in pack two, which is where a drafter
should in fact stop reading and stay in their lane.

Both directions from there are worse. A wider band (say 0-15) would need ~43 on-color cards to
matter, and the bot would rare-draft across five colors all draft. A narrow band (0-1) flips after
three on-color cards, and the bot would take its third-color filler over a bomb. The format's own
documented band is the one that lands nearest the behavior we want, which is why the format has it.

### 2.2 Rejected: an LLM rating pass

Tooling §1.1 notes that "an LLM pass assigning Limited ratings per card directly upgrades draft bots
with zero Draftmancer changes", and that is probably true. It is not what this ADR does. A model
asked for a 0-5 Limited rating produces a number with no relationship to anything else in the lab:
it cannot be diffed against a weight, it is not reproducible without a fixture, and it would make
the bot's judgment and the deck builder's judgment two different opinions with no way to
adjudicate. The deterministic map ships first *because* it is the thing that can be wrong in a
legible way. The LLM tier belongs on top of it, scored against it, the same way the LLM deck builder
sits on top of `buildDeck` — filed in §5.

## 3. What this does not verify

Nothing in this checkout parses the emitted file the way Draftmancer's parser does. No Draftmancer
was cloned, installed or run for this change, and the format was implemented strictly from
tooling §1.1 §69-88. A wrong token passes every test we can write here. The specific guesses, so
that the first real import knows where to look:

| Guess | Why it was made this way |
|---|---|
| `type` carries the whole rendered type line, subtypes and all, *and* `subtypes` repeats them | §1.1 lists the two as separate fields and says nothing about how they compose. Scryfall's `type_line` is the whole line, and `type` reads like that field. If Draftmancer instead builds its type line from `type` plus `subtypes`, every creature imports as "Creature — Bird Soldier — Bird Soldier". This is the highest-risk row here: it is wrong on every card or right on every card, and `typeLineParts` already returns supertypes, types and subtypes apart, so the other encoding is one field access away. |
| `power` / `toughness` as JSON numbers | The DSL has integers and the format documents the fields without a type. Scryfall itself uses strings (`"*"` exists there; it cannot here). |
| A land's `mana_cost` is `""` | Scryfall's own encoding for a card with no mana cost. `{0}` would say the card costs nothing to cast, which is a different card. |
| Sheet headers carry no collation token | §1.1 documents `random` as the default; naming it would mean guessing its spelling. |
| A sheet no layout draws from is still legal | The alternative is dropping those cards from the file, which would hide them. We report the sheet instead (`collationReport`). |
| `[Settings]` is `{"layouts": {name: {weight, slots}}}` | The shape §1.1 describes: named layouts with a weight and per-slot sheet counts. |
| Section order, and bare card-name lines | §1.1 documents `[Count] CardName [(Set) [CollectorNumber]]` with count optional; order is unstated. |
| The lab's own pick loop picks what `SimpleBot` picks | `packages/draft-export/src/simple-bot.ts` mirrors §1's algorithm from the same source reading rather than from a run: `rating + 0.35 x on-color picks summed over each of a card's colors`, argmax, random tie-break. `mtg-bc2.116` took that shape because running a self-hosted Draftmancer needs a clone and an install this environment does not allow, and a TypeScript loop runs in CI. The bonus is the same `SIMPLE_BOT_COLOR_BONUS` the rating band is measured in, so the two cannot drift apart in this repo; what is unchecked is whether the constant, the summation, and the tie-break are still the source's today. |

The first import into a real Draftmancer is the test that settles all eight, and it is filed. The
table is the checklist for that import; a guess that is made in the code and not written here is the
failure this section exists to prevent, so a new field is a new row — and so is a second
implementation of somebody else's algorithm.

## 4. Consequences

- Changing `DEFAULT_SCORE_WEIGHTS` changes every rating in every exported set, and the golden
  fixture in `packages/draft-export/test/fixtures/` will fail. That is the intended alarm: the deck
  builder's opinion and the draft bot's opinion are the same opinion, and they move together.
- The worst spell in a set rates 0 and therefore ties with the basics. At the bottom of a pack the
  bot picks between them at random, which is the truth about a pack whose remaining cards are a
  basic and an unplayable.
- Basic lands are in the Common sheet, because that is their DSL rarity and it is what
  `openSealedPool` already does with them. They dilute a booster by five cards' worth of common
  slot. A land slot is a change to `BoosterRecipe`, not to the rating scale, and is filed.

## 5. Open questions

1. **Absolute calibration.** Map the scale onto 17lands GIH WR for a real set with published pick
   orders, and check our ordering against ATA. That turns the ordinal scale into a comparable one
   and is the acceptance check the bead's third clause asks for.
2. **The LLM rating tier**, scored against this one rather than replacing it.
3. **The external-bot spike** — the second half of decision-synthesis §7.6, untouched here.
4. **A land slot in `BoosterRecipe`**, which would take the basics out of the common sheet in both
   the draft export and `openSealedPool`.
