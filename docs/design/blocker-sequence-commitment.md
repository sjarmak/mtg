# A decomposed block needs one commitment boundary

`mtg-nj6m`. Measured 2026-08-16 against the working tree at `main` = `baf3647`,
which carries several lanes' uncommitted edits; every number below names the test
that produces it, and anything I could not measure is marked unmeasured rather
than estimated.

Sequencing one `declareBlockers` decision into one submit per blocker
(`mtg-cs8t`, stage 2) changes two things that are not enumeration. The bead filed
both as open questions. This note answers the second with a measurement and the
first with a decision that the measurement is what argues for.

---

## 1. The netplay question, and why the identity instruments cannot answer it

The question as filed: does the projection sent to the attacking seat between two
per-blocker submits name a blocker the attacker should not yet know about?

The obvious instruments do not apply, and that is the first measurement rather
than a preamble. `packages/netplay/test/hidden-information.test.ts` searches a
seat's payload for a card it may not identify; `@mtg/engine`'s
`auditSeatPayloads` folds a per-seat license out of `EngineEvent.reveals` and
searches for object ids (`docs/design/per-seat-knowledge-log.md`). A blocker is a
creature that has been face up on the battlefield for turns. Measured at the
position before the defender has declared anything, the attacking seat's payload
already contains both candidate blockers' ids as JSON string literals — so both
searches answer "present" at the position where nothing has been declared and at
the position where a block has, and neither can tell the two apart.

What moves between those positions is not an identity but a **relation**: which
blocker is on which attacker. `state.combat` is public, `visibility.ts` touches
none of it, and the relation is therefore the instrument. It reads zero at the
position before the declaration, which is what gives it somewhere to move to.

## 2. The measurement

A real seeded game driven through the real table to a `declareBlockers` decision
with two eligible blockers and two attackers (`netplay/blocker-sequence/v0`, 405
recorded choices). Both seats are taken off auto-pass on the fork before anything
is declared, because under the table's default the settle loop runs from the
declaration to the end of the game and what would be measured is the wreckage
afterwards.

| Position                              | Blocker-on-attacker pairs in the attacking seat's payload |
| ------------------------------------- | --------------------------------------------------------- |
| Before the defender declares anything | 0                                                         |
| After one blocker is assigned         | 1                                                         |
| After the whole two-blocker block     | 2                                                         |

Three further readings:

- **The increment is delivered rather than held.** `apply` bumps the table's
  revision and wakes every watcher once per submit, which is what a held poll
  returns on. Six increments are six deliveries to each seat, which is the round
  trip count the bead predicted, now measured as one wake per increment.
- **The interior is the position the kernel still owes the decision at.** The
  position a sequence stops at is not a finished one-blocker declaration; it is
  `turn.awaiting === 'blockers'` with `combat.blocks` already holding something.
  Built by hand (no reducer produces it yet) and put to `pendingDecision`, that
  position still owes the defender a `declareBlockers` decision — and `seatState`
  projects the assigned pair to the attacking seat there too. So the exposure is
  at the real interior and not only at its analogue.
- **The increments only add, and that is what makes them free.** The
  one-blocker set is a subset of the finished two-blocker set: the set difference
  is empty. Everything the attacker is told mid-sequence, the completed
  declaration was about to tell it one message later.

### The leak, and what it takes to fire

Monotonicity is the whole guarantee, and it is not structural — it is a
consequence of nothing being able to take an increment back. Measured against a
completion that assigns the first blocker somewhere else — a real one-pair block
of its own, not an empty declaration against a full one: the attacking seat was
shown `o55 blocks o22`, the finished declaration does not contain it, and the set
difference is exactly one pair. That is a block the attacker watched and the game
never had, which is a fact the rules give it at no point.

**It is not reachable over this wire today.** `SeatRequest` has four kinds and
none of them names a prefix; `readSeatRequest` refuses `undo` and `undoTo` by
name. `table.ts` already argues why undo is absent — a rewind in a two-player game
takes back the opponent's decisions too, and no protocol for agreeing to that
exists — and that argument is now load-bearing for concealment as well as for
fairness. The finding is therefore conditional and worth stating in that form: a
sequenced declaration leaks nothing extra over netplay **for exactly as long as
the table refuses every rewind**. A "back one blocker" affordance added to the
declaration surface is not a UI detail; on this wire it is a protocol change that
strands a block in the opponent's payload.

## 3. The undo question

`undoTo` takes any prefix at or above the commit floor. Measured at a real
two-blocker declaration (`blockers/v2`, 178 recorded choices, a gang block of two
creatures on one attacker): the floor sits at 177 and the recording is 178 long,
so the window undo may land in is **exactly one choice wide — two landings**. One
of them owes the declaration with nothing assigned; the other has both blockers
assigned and owes the damage assignment order. Neither is half-assigned, and
today none can be, because one choice answers the whole block.

Sequencing widens that window from 1 choice to k and adds k-1 interior landings,
each a position with some of the block in and the defender still being asked for
the rest. The bead's six-blocker example is five such positions.

**Chosen: undo pops the whole block.** The interior stops being a landing; a
rewind that would reach one lands on the position the declaration opened from.
Everything else about the block is unchanged, including that it stays takeable
back right up to the pass.

**Rejected: close a commitment boundary at the end of the sequence.** A boundary
is a floor and a floor is a lower bound, so a boundary at the end of the block
forbids the interior and everything before it together: the declaration stops
being takeable back at all. That is the rewind `undo.ts` promises by name, one
step from the attacker example the whole undo rule was stated from. It also
spends the boundary set on the wrong kind of fact — the seven events in that set
are each a rules-level irreversibility, and "the interface asked this in six
pieces" is not one.

That rejection is executable rather than rhetorical. Adding `blockersDeclared` to
`boundaryOf` and re-running `packages/kernel/test/blocker-commitment.test.ts`
turns four of its five tests red, and the first failure is the window collapsing
from two landings to one: `expected 1 to be greater than or equal to 2`.

The chosen rule is also the cheaper one to state. A position that owes
`declareBlockers` while `combat.blocks` already holds something is mid-sequence
**by construction**, so the landing rule is a predicate over the replayed
position and needs no marker from the sequencer that could drift from it.

## 4. What remains

The rule belongs in `session.ts`'s `undoTo`, which is where a prefix becomes a
position, and it cannot be written until stage 2 exists to produce the position
it refuses. What is landed instead:

- `packages/kernel/test/blocker-commitment.test.ts` fixes the property against
  the current kernel and builds the forbidden position by hand, so the predicate
  has been seen to say yes to one rather than merely never firing.
- `packages/netplay/test/blocker-sequence.test.ts` holds every number in §2.
- `packages/kernel/src/undo.ts`'s header carries the decision and the rejected
  alternative, so stage 2 does not have to rediscover either.

Unmeasured, and named as such: whether the sequenced declaration surface wants a
"back one blocker" control at all. If it does, netplay needs an answer to the
stranded block in §2 before it ships, and the hot-seat surface needs the landing
rule above. Neither is settled here.
