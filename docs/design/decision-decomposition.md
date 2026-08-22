# Decomposing exponential decisions

The design half of `mtg-cs8t`. Nothing here changes code; it is the argument,
the measurements behind it, and a staged plan somebody else can execute.

Every number below was taken on this tree (`main` at `baf3647`) by scripts
written for it, not inherited from the bead. Where my reading disagrees with a
bead or a source docblock, the disagreement is stated and the source named, so
the next person can re-run the same thing rather than choose between two
sentences.

---

## 1. The defect, reproduced

`pendingDecision` asks a declaration space as one question and caps the answer.
`blockerDecision` (`packages/kernel/src/legal.ts:732`) builds `perBlocker`, the
list of attackers each eligible creature may legally block, and then calls
`cartesian` over it at `:737` with `DEFAULT_ENUMERATION_CAP = 512`. Everything
past the cap has no index, and an index is the whole of what `submit` and
`choose` accept.

Measured against today's `legal.ts`, vanilla 2/2s on both sides, no evasion, so
every blocker may block every attacker:

| attackers | blockers | legal declarations | options listed | `complete` | pairs offered / legal | blockers named in no option |
| --------: | -------: | -----------------: | -------------: | ---------- | --------------------: | --------------------------: |
|         1 |        3 |                  8 |              8 | true       |                 3 / 3 |                           0 |
|         1 |        6 |                 64 |             64 | true       |                 6 / 6 |                           0 |
|         1 |        8 |                256 |            256 | true       |                 8 / 8 |                           0 |
|         1 |       10 |              1,024 |            512 | false      |                9 / 10 |                           1 |
|         2 |        4 |                 81 |             81 | true       |                 8 / 8 |                           0 |
|         2 |        6 |                729 |            512 | false      |               12 / 12 |                           0 |
|         3 |        6 |              4,096 |            512 | false      |               13 / 18 |                           1 |
|         3 |        8 |             65,536 |            512 | false      |               13 / 24 |                           3 |
|         4 |        8 |            390,625 |            512 | false      |               16 / 32 |                           4 |

The bead's two headline figures reproduce exactly: two attackers and six
blockers is 729 legal declarations against 512 listed, so 217 have no index;
three attackers and eight blockers is 65,536 against the same 512, and those 512
name 13 of the 24 legal (blocker, attacker) pairs.

**Correction to the bead and to `packages/engine/src/decision.ts:44`.** Both say
"five of the eight creatures appear in no listed option at all" on the
three-by-eight board. It is **three**, which is what `legal.ts:134`'s own
docblock and `packages/kernel/test/block-enumeration.test.ts` already say. The
mechanism is `cartesian`'s early exit (`packages/kernel/src/enumerate.ts`): it
grows the result one slot at a time and `break`s out of the loop the moment the
cap bites, so with eight slots of width four it fills slots 0 through 3
(4^4 = 256), grows slot 4 to 512 by taking two of that slot's four choices, and
then never touches slots 5, 6 and 7. Three mute creatures, and 4 x 3 + 1 = 13
pairs. `decision.ts` is a source file another lane is not editing and I am not
either; the sentence needs one word changed.

**Correction to the bead's site list.** `legal.ts:861`'s `permutations` call is
the **scry** decision, not the damage assignment order, and it cannot truncate:
the next line throws outright if it does. The damage assignment order is
`orderDecision` at `:775-795`, which is `distinctPermutations` per attacker and
then a `cartesian` over those, so it is both a permutation and a product.

**Two things the arithmetic does not show.** First, the listed count is not
`min(512, legal)`: the cap is applied to the raw assignment product and
`validateBlocks` filters afterwards, so a board with menace can report 187
options of 374 legal (measured, section 5). Second, a bigger cap is not a fix
and the shape of the curve says why: the space is `(attackers + 1)^blockers`, so
doubling the cap buys 0.63 of a blocker against two attackers, and a cap of a
million truncates at thirteen.

Reproduce: the script is 95 lines, drives `scenario` to a blocker decision at a
stated width, and prints the table above.

---

## 2. How often it fires in seeded play

Instrumented the balance gate's own schedule rather than a contrived board:
`roundRobinSpecs` over `decksFor(pool)` at `BALANCE_RUN_SEED = 'mtg-balance/v0'`,
45 matchups, 223 games each, `DEFAULT_CAPS` (512/512), both committed subjects.
The loop is `playSimGame`'s, cloned so each `Decision` can be read before the
agent answers it. 20,070 games, 7.6 million decisions, about 6 minutes.
`npm run test:balance` was not run.

| subject | games | decisions | truncated | share of decisions | games with at least one |
| ------- | ----: | --------: | --------: | -----------------: | ----------------------: |
| the flagship set | 10,035 | 3,377,625 | 895 | 0.027% | 668 (**6.66%**) |
| Tideglass Reach | 10,035 | 4,236,474 | 214 | 0.005% | 173 (**1.72%**) |

Per decision kind, flagship first:

| kind | decisions | truncated | rate | widest option list seen |
| ---- | --------: | --------: | ---: | ----------------------: |
| priority | 3,206,822 / 4,034,861 | 0 / 0 | 0% | 344 / 233 |
| declareAttackers | 90,114 / 114,534 | 68 / 5 | 0.08% / 0.004% | 513 / 513 |
| declareBlockers | 56,046 / 63,510 | 827 / 209 | 1.48% / 0.33% | 512 / 512 |
| mulligan | 23,032 / 23,032 | 0 / 0 | 0% | 22 / 22 |
| orderBlockers | 1,506 / 162 | 0 / 0 | 0% | 60 / 6 |
| discard | 105 / 375 | 0 / 0 | 0% | 8 / 120 |

**Truncation is entirely combat, and combat truncation is entirely board width.**
The two priority-side sites the bead names, target tuples for casts (`:356`) and
for activations (`:583`), never truncated once in 7.2 million priority decisions
across both subjects; the widest priority list ever built was 344 against a cap
of 512. Blocks truncate first at four blockers against four attackers
(5^4 = 625) and at five blockers against three (4^5 = 1,024), and above that it
is routine: on the flagship, every one of the 24 decisions at four blockers
against eight attackers truncated, and so did 53 of the 134 six-by-two boards,
which is precisely the board the bead is written about.

**Which framing is the priority.** 0.027% of decisions sounds like a rounding
error; one game in fifteen sounds like a defect. Both are the same measurement.
The second is the one that matters, because the affected decision is never a
throwaway: it is a crowded combat, the one turn where the choice decides the
game, and the truncation removes the creatures the player is most likely to want.
A bot playing 10,035 games does not notice, which is exactly why this went
unnoticed. A person playing one game does.

---

## 3. The sites: six, not four

| # | site | shape | truncates in seeded play | bots read it |
| - | ---- | ----- | ------------------------ | ------------ |
| 1 | `legal.ts:737` blocker declaration | product over eligible blockers | yes, 1,036 times in 20,070 games | no |
| 2 | `legal.ts:680` / `:697` attacker declaration | subset, or product over defenders | yes, 73 times | no |
| 3 | `legal.ts:779` / `:782` damage assignment order | permutations per attacker, then a product | never observed; reachable (`packages/ui/test/play/order.test.ts:219` pins 512) | no |
| 4 | `legal.ts:356` cast targets | product over target slots | never observed in 7.2M priority decisions | **yes** |
| 5 | `legal.ts:583` / `:633` activation targets and sacrifice payments | product over slots, plus `combinations` for the payment | never observed | **yes** |
| 6 | `legal.ts:918` mulligan and `:960` discard | `combinations(hand, count, cap)` | never observed; a 12-card hand discarding 6 is 924 | mulligan yes, discard no |

`legal.ts:814` (trigger targets) is a seventh instance of shape 4. The bead names
four sites; six is the honest count, and the two extra ones are the cheap ones.

**One mechanism covers all of them**, because all six are the same object: a
sequence of slots, each with its own list of legal values, whose product is being
enumerated. The differences are what fills the slots and what makes a partial
answer illegal, and both are per-site data rather than per-site machinery:

| site | slots | values per slot | what makes a prefix unextendable |
| ---- | ----- | --------------- | -------------------------------- |
| blocks | eligible blockers, in `eligible` order | that blocker's `canBlock` list, plus decline | menace (CR 702.110b) |
| attacks | eligible attackers | the legal defenders, plus decline | nothing |
| damage order | the ordered positions of one attacker's blockers | the blockers not yet placed, folded by `damageOrderClasses` | nothing |
| targets | the effect's target slots | `targetChoicesFor*` per slot | the distinct-slot rule (`packages/kernel/src/effects.ts:167`) |
| sacrifice, mulligan, discard | the k cards being chosen | the cards after the last one chosen | nothing |

So the implementation is one helper (a slot list, a per-slot legal-value
function, an extendability predicate, and a fold that applies the finished
sequence) instantiated six times, not six rewrites of `legal.ts`.

---

## 4. The mechanism, and one thing it must not do

The recommended shape, stated so a stage plan can be written against it:

1. **State carries the partial answer.** A decomposed decision needs somewhere to
   put "blocker 3 is assigned to attacker 1, blockers 4 through 8 not yet asked".
   It goes in `GameState` (a `declaring` field under `state.combat` for the two
   combat kinds), because `pendingDecision` is a pure function of state and
   `replaySession` rebuilds a game by re-reducing. It must be **optional and
   `undefined` outside a declaration in progress**: `stateFingerprint`
   (`packages/kernel/src/fork.ts:50-66`) drops `undefined` entries before
   hashing, so every fingerprint taken at a position that is not mid-declaration
   stays byte-identical, which is what keeps section 6's blast radius from
   including every fingerprint in the repository.
2. **The sub-answer is an action.** `assignBlocker { blocker, attacker | null }`,
   one per question, is what an index addresses.
3. **The compound action survives and is defined as the fold.**
   `reduce(state, { type: 'declareBlockers', blocks })` stays legal and is
   specified as the sequence of sub-answers applied in slot order. This is not a
   convenience: `packages/sim` calls `reduce` directly with a whole declaration
   the bot constructed, and if the compound action stops working, every sim game
   changes. `validateBlocks` stays the authority on a finished declaration, so
   there is no second opinion about legality.
4. **`chooseAction` on a compound expands into k recorded indices.** The surface
   builds a whole declaration and submits it (section 7); the session records the
   expansion, not the action. That is what satisfies the bead's acceptance
   criterion, "answerable through decision indices alone, with no call to
   `chooseAction`", while leaving the click-built declaration exactly as it is.
5. **One answer path per declaration.** Slots in a fixed order, one question per
   slot, is a bijection between complete legal declarations and answer paths. The
   tempting alternative, "name the next blocker to add, or say done", is not: the
   same declaration is reachable by k! paths, so two identical games record
   different integers and `actionKey`-style canonicalization has to be
   reinvented per site. For the `combinations` sites (6) the same rule means
   choosing cards in increasing index order.

**What it must not do: decide its shape from the cap.** The obvious saving is to
decompose only when the product would exceed the cap, which would leave nearly
every recording in the repository untouched. Reject it. `pendingDecision(state,
cap)` takes the cap as a caller-supplied parameter with a default, and
`packages/sim` passes `FAST_CAPS = { priority: 512, declaration: 1 }` on the
throughput path. If the number of questions depended on the cap, then the number
of integers a game records would depend on a memory bound chosen by whichever
caller happened to drive it, and `driver.ts:31-49`'s claim that the two cap sets
produce identical games would become false by construction. A record must be a
function of the position. Decompose per kind, always.

### Correction, written after all six sites landed: the hybrid won, and this is why

The paragraph above is the rule this document argued for, and not one site
implements it. Every decomposed decision in `packages/kernel/src/legal.ts` is a
cap-keyed hybrid: a flat product of complete declarations when the enumeration
fits under the cap, and one-slot questions when it does not.
`blockerDecision` (:1242) branches on `enumerated.complete`, `attackerDecision`
(:1116) and `orderDecision` (:1789) set a `listable` flag off the same predicate,
and the three selection sites — `mulliganDecision` (:2235), `discardDecision`
(:2281) and `handDiscardDecision` (:2316) — all route through
`selectionAnswers` (:2195), which returns the combinations when they fit and a
one-card-per-option step list when they do not. That is six of six, including
`handDiscard`, which did not exist when the rule was written.

The strongest evidence that the shape is not fixed is that the kernel exports a
function to ask what it turned out to be. `asksInSteps` (:1885) reads a
`Decision` and reports whether this position decomposed, per kind, by inspecting
whether an option carries a partial answer. Under the rule above that function
has nothing to compute.

**Why the hybrid won.** The rule's argument was that a record must be a function
of the position, and that a cap-keyed shape makes the number of integers a game
records depend on a memory bound chosen by whichever caller drove it. Both
halves are true in general and neither one bites here, because nothing records
an index at a cap other than 512:

- `session.ts:352` calls `pendingDecision(state)` with **no cap argument**, so
  every recorded session in this repository is enumerated at
  `DEFAULT_ENUMERATION_CAP`. There is no second cap in the recording path to
  disagree with the first.
- The `FAST_CAPS` path (`packages/sim/src/driver.ts:53`) is not a recording
  path. It exists for policies that build their own declaration and hand it to
  `reduce` as a compound action, which is item 3 of the mechanism above and is
  exactly what both shipped bots do. Its docblock's claim that the two cap sets
  produce identical games survives the hybrid rather than being falsified by it:
  the games are identical because the bots never answer by index, so the shape
  of a list they do not read cannot change the game.

Against that, decomposing unconditionally would have re-enumerated every
committed recording that contains a combat step or a mulligan, turning one
recorded integer into k. The rule was written before that cost was measured
(section 6 is the measurement) and would have bought a property nothing in the
repository can currently observe.

**What the hybrid does cost, stated plainly.** Lowering
`DEFAULT_ENUMERATION_CAP` changes the recorded path of an existing game, so the
constant is load-bearing rather than a tuning knob. `mtg-4nkq` is the standing
record of what that costs today: nine kernel and ui tests assert an option count
measured at 512 and fail at a lowered cap. The cap is changeable; it is not
changeable cheaply.

### The one place the bijection bends: mulligan during a bottoming

Item 5 above claims one answer path per declaration. The mulligan site does not
have it. `mulliganDecision` appends `{ type: 'mulligan' }` whenever
`canMulligan(state, player)` holds, and it does so at every step of a bottoming
asked one card at a time — the `selectionAnswers` step list and the mulligan
option are built independently, and nothing suppresses the second while the
first is partway through.

So a seat that bottoms two cards and then mulligans records a longer path than a
seat that mulligans immediately, and both land on the same position. That is a
break in the bijection, and it is deliberate: abandoning a hand is a move, not a
permuted spelling of keeping one, and a player who has started naming bottom
cards and changed their mind is making a real decision rather than re-reaching a
state they could have reached faster. `selectionAnswers`' own docblock states
the ordering rule that follows from it — keeps first, mulligan last, at every
step.

The alternative is to offer the mulligan only at the first question, which
restores the strict bijection and takes the change of mind away. That trade has
not been made and is not currently proposed; this paragraph exists so the next
reader does not find the divergence and assume it is a bug.

---

## 5. The unextendable prefix, and what to do about it

Six blockers answered one at a time can reach a state that no complete legal
declaration extends. **Menace is the only source of one today.** `canBlock`
(`packages/kernel/src/combat.ts`) is entirely pair-level: tapped, `cantBlock`,
`cantBeBlocked`, protection, landwalk, flying against reach. `validateBlocks`
adds three declaration-level rules, of which two are also per-pair (the attacker
must be attacking, a blocker cannot block twice), and one is not: an attacker
with menace blocked by exactly one creature is illegal (CR 702.110b). `KEYWORDS`
in `packages/dsl/src/vocabulary.ts` has nine entries and menace is the only one
that is a property of the finished declaration. `validateAttackers` and
`validateOrdering` have no declaration-level rule at all, so sites 2 and 3 cannot
produce an unextendable prefix.

Note that declining is as dangerous as assigning. If blocker 1 takes a menace
attacker and blocker 2 then declines, and no one else can block it, the
declaration is illegal and the illegal step was the decline.

**The choice: refuse the option when offered, or allow the prefix and refuse the
commit. Refuse at offer.** Three reasons, in order of weight:

- `Decision.options` means "the moves this backend will accept", and every
  consumer takes it literally. `checkBackend` (`packages/engine/src/conformance.ts:150-164`)
  plays a whole game by taking `options[0]` blindly and files a finding when an
  offered move is refused, so a dead end is a conformance failure by the kernel's
  own contract check. A trap-shaped option is a worse defect than the one being
  fixed.
- The alternative needs a new refusal path and a new player-facing state
  ("you have painted yourself into a corner, press undo"), which is a rule the
  surface must learn and explain. Refusing at offer needs no surface change at
  all: the option is simply not on the roster.
- It is exactly computable today, and cheaply. The obligation at any prefix is
  "every menace attacker currently blocked by exactly one creature needs one
  more, from the blockers not yet asked". Two such attackers cannot be served by
  the same creature, so it is a bipartite matching, not a per-attacker count.
  Kuhn's algorithm over at most (blockers x attackers) edges is nothing at these
  sizes.

**Checked rather than argued.** I prototyped the rule and compared it against
brute force over the uncapped product filtered by `validateBlocks`, on six
boards:

| board | legal declarations | paths the decomposed questions admit | identical sets | dead ends | questions | widest question | listed today |
| ----- | -----------------: | -----------------------------------: | -------------- | --------: | --------: | --------------: | -----------: |
| 2 plain x 6 | 729 | 729 | yes | 0 | 6 | 3 | 512 (incomplete) |
| 3 plain x 8 | 65,536 | 65,536 | yes | 0 | 8 | 4 | 512 (incomplete) |
| 1 menace x 3 | 5 | 5 | yes | 0 | 3 | 2 | 5 |
| 2 menace x 4 | 29 | 29 | yes | 0 | 4 | 3 | 29 |
| 2 menace + 1 plain x 5 | 374 | 374 | yes | 0 | 5 | 4 | 187 (incomplete) |
| 3 menace x 3 | 13 | 13 | yes | 0 | 3 | 4 | 13 |

Set equality, not just counts. The reachability argument is short enough to
state: take any legal complete declaration D and ask the questions in order. If D
assigns blocker i to a menace attacker A, then D assigns at least two blockers to
A, so either a later blocker in D also takes A (the matching succeeds) or an
earlier one already did (A is no longer at count 1). So every legal declaration
is reachable, and by construction every offered prefix has a completion. The
all-decline path is always legal, so the option list is never empty and the
`if (options.length === 0)` fallback at `legal.ts:752` becomes dead code rather
than load-bearing.

**The policy for the rule that has not been written yet.** The extendability
predicate must be exact, never conservative: an approximation that refuses too
much makes a legal declaration undeclarable, which is the bug being fixed wearing
a different hat. If the vocabulary ever grows a declaration-level rule whose
extendability cannot be decided exactly and cheaply (a "must be blocked if able"
lure is the realistic candidate), the answer is not to relax the predicate. It is
that this decision kind stops being decomposed and goes back to enumerating a
capped product, loudly, with `complete: false` and a named reason. One
undecomposable kind is a known hole; a decomposed kind with a wrong predicate is
a silently wrong game.

---

## 6. Question one: do existing recordings survive?

**No, and not by a margin that any care about ordering can rescue.** A game is a
seed plus a list of integers; `replaySession` spends exactly one integer per
pending decision and throws on any length mismatch, so a game whose first
decomposed decision is at position n has an invalid recording from n onward. It
is not lengthened, it is invalidated. `packages/kernel/src/session.ts:36`
currently promises that "every recording made before this change replays
unchanged", about the `Choice = number | Action` widening; that sentence stops
being true and has to be rewritten in the same commit.

The measured cost in record length, from the same 20,070-game run (whole-record
totals, decomposing sites 1, 2 and 3):

| subject | integers recorded today | decomposed | change |
| ------- | ----------------------: | ---------: | -----: |
| the flagship set | 3,377,625 | 3,518,928 | +4.2% |
| Tideglass Reach | 4,236,474 | 4,349,618 | +2.7% |

Per kind on the flagship: blocks 56,046 to 93,158 (1.66x), attacks 90,114 to
194,282 (2.16x), damage order 1,506 to 1,529. **Attack declarations are 74% of
the growth and 7% of the truncations**, which is the one place a reader may want
to argue; I would still decompose them, because the alternative is a kernel where
one combat declaration is a sequence and the other is a capped product, and the
saving is 3% of a list of integers nobody reads by hand.

### What depends on the choice-index list

Everything below was found by grep and by reading the file; each is marked
**regenerable** (a command reproduces it) or **hand-pinned** (a person typed the
number and must retype it). The verification column is what tells you it broke.

**Committed recordings: 3 files.**

| file | what it holds | class | how |
| ---- | ------------- | ----- | --- |
| `packages/ui/test/replay/fixtures/replay-events.jsonl` | 387 lines, 382 recorded decisions, each with `chosen` (the index) and `optionCount` | **regenerable** | `npx tsx packages/ui/test/replay/support/write-fixture.ts`; byte-asserted at `packages/ui/test/replay/record.test.ts:59`, so it fails loudly |
| `packages/ui/test/fixtures/replay.slice.jsonl` | 4 lines, 3 game rows carrying `sim_decisions` 391, 481, 533 | **hand-cut**, and **not** byte-asserted, so it degrades quietly | cut by hand from a `packages/slice` run per `packages/ui/test/support/replay-fixture.ts`; no script does it |
| `packages/referee/fixtures/llm/8d5c1a73cfa6a031b20570ed88ab6c30.json` | one recorded live model ruling; the **filename is `hash(system, prompt, schema)`** and the prompt embeds the numbered blocker options of `exampleBlockingPosition` (2 attackers, 2 blockers, 9 options today) | **paid**: needs an authenticated `claude` binary | `npx tsx packages/referee/tools/record-ruling.ts`, then delete the stale file by hand because `recorded-ruling.test.ts:37` asserts there is exactly one; the key is recomputed live at `:41-53` |

The referee fixture is the only step that costs money and the easiest one to
miss, because nothing about its path says "combat".

**Regenerable derived artifacts: 4 files, one command.**
`packages/ui/test/analysis/fixtures/run-a.json` (pins `"games": 5400` and several
hundred derived floats), `run-b.json`, `run-strict.json`, `run-sparse.json`:
`npx tsx packages/ui/test/analysis/fixtures/make-fixtures.ts` then
`npx prettier --write "packages/ui/test/analysis/fixtures/*.json"`.

**Not committed, regenerated at launch, but with hand-pinned claims over them.**
`packages/ui/tools/stage-replay.ts` records three curated lab seeds
(`lab/v1/RW-UB/1`, `lab/v1/GW-UB/3`, `lab/v1/RW-GW/2`) into
`packages/ui/public/replay.events.jsonl`, which is gitignored.
`packages/ui/test/replay/staging.test.ts:46` and its set-specific sibling in the
same directory (`:93`) assert those seeds still produce **decided** games and
more than one distinct winner. A kernel change can turn a decided game
into a turn-limit draw, and then a human has to pick new seeds; the curation is
hand-pinned even though the file is not.

**Hand-pinned enumeration assertions: about 36 across 12 files.** The
load-bearing ones:

- `packages/kernel/test/block-enumeration.test.ts` — seven pinned option counts
  (512 twice, plus 1/3/1/2), `named.size === 24`, `applied.choices.length === 1`
  after one gang-block `chooseAction` (`:197`), `choices[0]` equals the Action
  object (`:277`), `choices === [0]` (`:395`), and a header table. **Rewritten
  wholesale**; the bead's acceptance criterion asks for a test that drives the
  whole 729 rather than asserting a count, and this is that file.
- `packages/kernel/test/attack-enumeration.test.ts` — a header table
  (9 eligible to 512 complete, 10 to 513 incomplete), `513`, `mute.length === 3`,
  `applied.choices.length === 1`.
- `packages/kernel/test/beats.test.ts:539-540` — `paced.choices` has length 3 and
  `hurried.choices` length 21, with a comment counting out which integer is
  which. Both numbers move; the prose has to be recounted, not just bumped.
- `packages/ui/test/play/declare.test.ts` (256, 512, 9, 4, 2 and a
  `complete: false`), `order.test.ts` (512, 60, 6, 3, and `:388` vs `:439`
  pinning **which shape** an ordering records as), `rail-contract.test.ts:480`
  (64), `block-gesture.test.ts:241` (108), `attack-cap.test.ts:111`.
- `packages/engine/test/contract.test.ts:309-310` — asserts the kernel backend
  produces a truncated decision. After the fix it should assert the opposite,
  which is the bead's own acceptance criterion.
- `packages/referee/test/frame.test.ts:45` and `backlog.test.ts:98`, plus
  `packages/referee/test/positions.ts:44-72`, whose `cappedBlockingPosition` (six
  attackers into six blockers, 117,649 assignments) exists **only** to produce a
  truncated decision. If nothing truncates, that helper's reason for existing is
  gone and the compile-down backlog it feeds needs a new subject.
- `packages/kernel/test/chest-and-keys.test.ts:443/458/481` and
  `activated-abilities.test.ts:303` — the priority-side truncations, which stage
  3 turns green.

Assertions that build a `Decision` literal with `complete: false` by hand
(`packages/kernel/test/autopass.test.ts:368`,
`packages/ui/test/replay/narrate.test.ts:264`) never call the kernel and survive
untouched. That distinction is worth keeping in mind while reading a grep: about
half the `complete` hits in the repository are synthetic.

**Relative assertions that should self-adjust** but are worth watching:
`packages/kernel/test/session.test.ts` (floors of 50 and 100 choices),
`choose-action.test.ts:108` (one `chooseAction` appends exactly one entry;
verified to be about `passPriority`, so it survives),
`undo.test.ts`, and every `replayed.choices === played.choices` pair.

**The balance gate.** `THE_FLAGSHIP_SET_WAIVERS`
(`packages/metrics/test/balance/baseline.ts:447`) pins `measured: 0.393` for
`balance.pair.RG` with a 0.02 drift tolerance, and `TIDEGLASS_REACH_WAIVERS` at
`:130` is empty, which is the strictest possible setting. **The claim that these
cannot move is checkable, and I checked it.** `decideGreedy`
(`packages/sim/src/greedy-bot.ts:61-100`) constructs its own attack, block,
order, discard and mulligan actions and reads `decision.options` only for
priority, scry and trigger targets, so nothing about how declarations are
enumerated can reach a bot's choice. Corroborated end to end: 450 game pairs per
subject played twice, once at `DEFAULT_CAPS` and once at
`FAST_CAPS { declaration: 1 }`, compared on winner, end reason, turns and
decision count — 900 pairs, 0 differing. **So stages 1 and 2 need no balance
re-pin.** Stage 3 touches the priority list the bots do score, and does need one.

**Ruled out, with the reason.** The reference-coverage artifacts that
`npm run reference:refresh` maintains carry 182 `stateFingerprint` values and
four `decisionSha256` fields,
which reads alarming; the `decisionSha256` are digests of *translation*
decisions over card text, and the state fingerprints are of positions that are
not mid-declaration, so under the `undefined`-outside-a-declaration rule in
section 4 they do not move. Run `npm run reference:refresh -- --check` before
committing each stage rather than trusting this paragraph. Also ruled out: there
are no vitest snapshots anywhere in the repository, no committed netplay or
engine transcripts, and nothing under `out/` or `data/` is tracked.

**Count.** Three committed recordings (one regenerable free, one hand-cut, one
paid), four regenerable analysis fixtures, one gitignored recording with two
hand-pinned outcome claims over it, about 36 hand-pinned enumeration assertions
across 12 test files, and one balance baseline that stage 3 alone disturbs.

---

## 7. Question two: is a decomposed sequence committable as one unit?

**It is a kernel concern, the kernel already has the mechanism, and the answer is
that no new commit action is needed.**

Undo in this kernel is not "back one decision". `undo`
(`packages/kernel/src/session.ts:844`) rewinds to `committed.floor`, and the
floor is raised only by an event that reveals information: a priority pass, a
draw, a shuffle, a mill, a discard, a scry, a kept hand
(`packages/kernel/src/undo.ts:113-160`). A block sub-answer reveals nothing and
emits none of those, so all k sub-answers sit above the same floor and a single
`undo` press takes back the entire half-declared block. Meanwhile `undoTo(keep)`
already accepts any prefix above the floor, so "take back just the last blocker I
assigned" becomes expressible for the first time. Decomposition improves undo
rather than threatening it, and the improvement needs no new type.

Three obligations come with that, and they are the real work:

1. **The partial declaration is not public.** `state.combat.declaring` is the
   defender's private working set until the declaration is finished; in paper
   Magic blocks become public all at once. `packages/netplay`'s per-seat
   projector (`seats.ts`, driven from `table.ts:241-254`) must conceal it from
   the seat not being asked, exactly as it conceals a hand.
   `packages/netplay/test/hidden-information.test.ts:156` walks a whole game
   asserting a seat is never sent a card it may not identify, and that test is
   the right place for the new case.
2. **A mid-declaration position is now reachable by `reopen`.** `checkBackend`
   reopens a record and then reopens a half-length prefix of it
   (`packages/engine/src/conformance.ts:368-402`), and half of a decomposed move
   list can land inside a declaration. That position must be a legal thing to
   land on: the state carries the partial answer, `pendingDecision` returns the
   next slot's question, and the fingerprint matches. If it does not, the
   decomposition is wrong, not the check.
3. **The netplay `at` token still counts submits.** `protocol.ts` carries
   `at: number` and `table.ts` refuses a stale one, so a six-question block is
   six round trips with six tokens. That is correct as it stands; it is called
   out because "one declaration, one message" is an easy assumption to carry into
   a UI change.

### What this means for the surface beads

- **`mtg-y1t` (closed) and `mtg-2aca` (closed) do not reopen.** Their fix was to
  stop rendering the enumeration and build the declaration on the board instead:
  `declarationPlan` reads `Decision.candidates` and `Decision.blocks` rather than
  `options`, and `declarationChoice`
  (`packages/ui/src/routes/play/declare.ts:373-383`) submits the enumerated index
  when one exists and the constructed action when it does not. That surface is
  already the per-creature gesture this design decomposes the kernel into, which
  is the strongest evidence the decomposition is the right shape: the person
  playing already answers one creature at a time.
- **The surface keeps its commit gesture and does not become a wizard.** The
  player assigns creatures in any order, sees the whole block, and presses
  confirm; the panel then submits the compound action, which
  `chooseAction` expands into k indices (section 4, point 4). A surface that
  forced the kernel's slot order onto the player would be a regression against
  both closed beads. The kernel's order is the recording's order, not the
  player's.
- **`mtg-f6ns` (open, P2) gets smaller and its open question is answered.** It
  asks whether the damage assignment order wants "the roster treatment or a
  drag-to-reorder list", and notes `declarationPlan` narrows only the two
  declaration kinds. Once `orderBlockers` is a sequence of "which blocker takes
  damage next" questions, the rail is a list of at most as many buttons as there
  are unplaced blockers, and the drag-to-reorder version becomes a presentation
  choice over the same submissions rather than a different contract. Its
  acceptance criterion ("ordered without reading a list of permutations, and the
  rail stays the complete enumeration") is met by stage 1 of this plan for the
  second half and by a small panel change for the first. **Recommendation: leave
  `mtg-f6ns` open, retarget it at the panel, and note that the enumeration half
  lands in stage 1.**
- **One bead's assumption breaks.** `declarationChoice`'s "one it did not
  [enumerate] is offered as the declaration itself" arm becomes unreachable once
  nothing truncates, and so does `moveIdOf`'s throw
  (`packages/kernel/src/backend.ts:234-239`), which is the refusal `mtg-2guj`
  (closed, commit `32504b5`) installed so a constructed action could not
  stringify into an unreopenable record. That refusal stops being reachable
  through the shipped surfaces; it should stay anyway, as the guard for a
  future undecomposable kind. Deleting the `Choice = number | Action` widening is a separate
  decision and should be a separate bead; keeping a door nobody walks through is
  cheap, and the widening also covers the case a future undecomposable kind
  reintroduces (section 5's policy).

---

## 8. The staged plan

Split by who reads the option list, so that the stage that can move a graded
number is last and alone.

**Stage 0 — the mechanism, with no site converted.** Add the slot helper (slot
list, per-slot values, extendability predicate, fold) and its unit tests in
`packages/kernel/src`. No decision kind uses it yet. *Verified alone by:* new
unit tests plus `npm run typecheck`; every existing test unchanged and green.
*Re-recording forced:* none.

**Stage 1 — `orderBlockers` (`legal.ts:775-795`).** The safest site: never
truncated in 20,070 games, at most 60 options observed, no bot reads it, prefix
always extendable, and `damageOrderClasses` already folds indistinguishable
blockers. *Verified alone by:* `packages/kernel/test` and
`packages/ui/test/play/order.test.ts`, updated; a test that drives every ordering
of a three-blocker gang block through indices; `checkBackend` reports no
enumeration finding on an ordering-heavy board. *Re-recording forced:*
`replay-events.jsonl` only if either fixture game reaches a multiple block (0.15
`orderBlockers` decisions per game, so it is a coin flip). The byte assertion at
`record.test.ts:59` is the detector; the fix is one command.

**Stage 2 — blocks (`:737`) and attacks (`:680`/`:697`) together.** This is the
bead's acceptance criterion. Together because they share the combat cursor in
`state.combat` and because `blockerDecision`'s `candidates` field
(`legal.ts:124-142`) is already the per-question option list, built by the same
`canBlock` walk. Menace's extendability predicate lands here. *Verified alone
by:* a test that drives all 729 declarations of the two-by-six board through
indices with no `chooseAction` call; the section 5 prototype promoted to a test
(decomposed paths equal brute force over `validateBlocks`, on the menace boards
too); `checkBackend` against `kernelBackend` on a board that used to truncate
returning no enumeration finding; `checkBackend`'s half-prefix reopen landing
mid-declaration; the netplay hidden-information walk. *Re-recording forced:*
`replay-events.jsonl` (free, byte-asserted), `replay.slice.jsonl` (hand-cut, and
its three `sim_decisions` values move), the analysis fixtures (free), and **the
paid referee fixture** — its prompt is a blocker enumeration, so its key changes.
All of it in the same commit, because a fixture that lags its kernel by one
commit is a test asserting an old game. *No balance re-pin:* the 900-pair cap
invariance result in section 6 is the evidence, and it should be re-run rather
than cited.

**Stage 3 — target tuples (`:356`, `:583`, `:633`, `:814`) and the
`combinations` sites (`:918`, `:960`).** Last, because these are the only lists
the bots score, so this is the only stage that can move a graded number. The
distinct-slot rule gets the same matching-based extendability predicate as
menace. *Verified alone by:* `chest-and-keys.test.ts` and
`activated-abilities.test.ts` inverted (they currently assert truncation);
`npm run test:balance` on both subjects, with `baseline.ts` re-pinned and the
`why` prose rewritten if a gate moves. *Re-recording forced:* potentially the
balance baseline, which is why it is alone at the end.

Run `npm run reference:refresh -- --check` before committing each stage rather
than assuming section 6's ruling-out holds.

---

## 9. What I could not settle

- **Whether the `Choice = number | Action` widening should be removed.** Once
  nothing truncates, the Action arm is unreachable through the shipped surfaces,
  but section 5's fallback policy (an undecomposable future rule goes back to a
  capped product) is exactly the case that would want it back. Left as a separate
  bead rather than folded into this one.
- **Whether `replay.slice.jsonl` should stay hand-cut.** It is the one committed
  recording with no regenerator and no byte assertion, so it can disagree with
  the kernel silently and nothing says so. Writing the cutter is a small,
  unrelated job that would make this change and every future kernel change
  cheaper. Not in this bead's scope; worth its own.
- **Whether `packages/referee/test/positions.ts`'s `cappedBlockingPosition`
  should survive.** It exists to produce a truncated decision, and after stage 2
  it produces an ordinary one. Whether the compile-down backlog it feeds still
  has a subject is a referee question I did not chase.
- **The exact re-pin cost of stage 3.** I did not run the balance sweep at
  gate volume with a decomposed priority list, because no such kernel exists yet
  and because another lane was measuring. The cap invariance result bounds
  stages 1 and 2 at zero; it says nothing about stage 3.
- **Whether attack declarations should decompose at all.** I recommend yes and
  gave the reason, but the measurement is genuinely unflattering (74% of the
  added record length, 7% of the truncations) and a reader who weighs record size
  more heavily than shape uniformity would land elsewhere. The decision is
  reversible per site, which is the point of the mechanism in section 3.
