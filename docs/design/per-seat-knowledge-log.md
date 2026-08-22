# A per-seat knowledge log

`mtg-qbuq`. Measured against the working tree at `main` = `86c9079`, which
carries four other lanes' uncommitted edits; every number below names the command
or file that produced it, and anything I could not measure is marked unmeasured
rather than estimated.

The absence is one sentence. Nothing in this codebase records what a seat has
already legitimately seen, so visibility is decided from position alone: a card
is concealed if it is in a hidden zone right now, and it is concealable again the
moment it returns to one. `packages/kernel/src/visibility.ts:59` states the
consequence and takes the conservative direction deliberately — a spell cast,
countered and bounced "reads as 'a card' again, even though the opponent watched
it go on the stack", and losing information the opponent was entitled to is the
safe way to be wrong.

**It is not safe in both directions, and that is the finding this document is
built on.** The kernel's *state* projector is too strict at that position and the
kernel's *event log* is too loose at the same position, because the log is
cumulative and the id was published while the object was public. `@mtg/engine`'s
audit reads both and reports the disagreement as a leak. Section 2's fifth row
has the probe.

---

## 1. The requirement, in units

The unit is an **(object, seat, from-position) fact**: seat *s* may identify
object *o* from position *p* onward, until something revokes it. A log is a
collection of those facts, folded forward.

What exists today, measured:

| Mechanism | Package | Its input | Carries history |
| --- | --- | --- | --- |
| `concealedFrom` | kernel | one `GameState` and one viewer | no |
| `seatEvent` | kernel | one `GameEvent`, one viewer, one index | no |
| `PositionMemo.revealed` | engine | the previous memo plus this position's events | **yes, for one entry kind** |

- The kernel's event union has **53 arms**, and **32 of them name an
  `ObjectId`**. Command: a Python split of the `GameEvent` union in
  `packages/kernel/src/events.ts` on top-level union members, counting members
  whose text contains `ObjectId`.
- `seatEvent` decides visibility with a switch of **53 cases**, whose case set is
  **equal** to the arm set (same script). **4** of them redact and **49** return
  the event unchanged (`packages/kernel/src/visibility.ts:196-264`). Three of the
  four redact by substituting a placeholder id derived from the delivery key; one
  clears a field.
- The kernel treats **two** zones as hidden (`HIDDEN_ZONES`,
  `packages/kernel/src/visibility.ts:85`), and the exhaustive switch is closed by
  `assertNever`, so a new event arm fails to compile rather than defaulting to
  public.

The important measurement is the third row. `PositionMemo.revealed`
(`packages/engine/src/hidden-information.ts:359-366`) is a per-seat set of object
ids, carried forward from the previous position, re-intersected with the hand's
actual current contents, and extended by whatever this position's events said was
revealed. That is a per-seat knowledge log. It has exactly one entry kind, it
lives in the auditor rather than in the state, and it is sourced by
duck-typing one backend's private `detail` payload.

**So the requirement is not to invent a mechanism; it is to move one that already
exists to a layer that can hold all of it, and to widen it from one entry kind to
five.** The five are section 2.

Two things follow immediately from the shape of the existing one, and both hold
for the full version:

1. **The fold is the reader's, not the writer's.** `revealed` is recomputed at
   every position from the previous memo and this position's events. Nothing
   stores an accumulated set anywhere a backend could hand one over.
2. **Presence is re-checked every position.** An object that leaves the hand
   falls out of the intersection and stops being searched for, so the log never
   has to explain why an id stopped mattering.

---

## 2. The transfers

Four legitimate transfers are named across the bead and
`packages/engine/src/hidden-information.ts`. A fifth is not named anywhere and is
live today; it gets its own row and a correction below.

| # | Transfer | Kernel event today | Which limit it closes | Kernel can already observe it |
| --- | --- | --- | --- | --- |
| 1 | A hand is revealed to all players (CR 701.16a) | `handRevealed { player, oids }`, passed through unredacted | limit 3, first half | **yes** — the ids are in the event |
| 2 | The top card of a library is revealed | none | limit 3, second half | **no** — no effect in the vocabulary produces one |
| 3 | A library is searched | none | limit 3, second half | **no** — same |
| 4 | The owner learns their own library: scry, mulligan bottoming | `cardsScried { player, count, bottom }`, `handKept { player, mulligans, bottomed }` | limit 1 | **partly** — see below |
| 5 | A publicly identified object returns to a hidden zone | `zoneChanged { oid, from, to, owner }`, plus whatever earlier event published the id | none of the three; it is the bead's own opening example | **yes** |

Measurements behind the "can observe" column:

- The DSL runs **14** effect kinds (`ALL_EFFECT_KINDS` in
  `packages/dsl/src/vocabulary.ts:112`, being the 11 priced kinds plus
  `exileTarget`, `revealHand`, `scry`). **None searches a library and none
  reveals a card from the top of one.** So rows 2 and 3 are not reachable by our
  kernel at all; they are a foreign-backend concern, and nothing about them needs
  a kernel emission.
- Row 4's events carry the wrong payload for a log. `cardsScried` deliberately
  carries a **count and a bottom count and no ids** — its own docblock says the
  looked-at identities stay hidden (`packages/kernel/src/events.ts:247-253`). So
  the fact "seat *s* now knows the identity of the card on top of its own
  library" is **not reconstructible from today's stream by any reader**. That is
  the one row that forces a new kernel emission, and it is per-seat by
  construction: only the scrying player learns anything.
  `handKept.bottomed` does carry ids, and `seatEvent` already replaces them with
  placeholders for the non-owner, so the owner's arm of row 4 is half-built.

### Correction to the bead: row 5 is not a hypothetical, and it fires against our own kernel

The bead's opening example is a card that was public and is now in a hand. The
three limits then move on to foreign backends. The example is the live bug.

Probed directly, in a scratch script rather than a conformance run: a position
with six Mountains and a two-generic bounce instant in seat 0's hand and a
creature on seat 1's battlefield; cast the instant at the creature, pass priority
twice to resolve, then take seat 0's projection. Result:

```
bear zone after resolution: hand
bear in player 1 hand: true
viewer 0 state still carries the object: false
viewer 0 payload names the oid: true
viewer 0 payload names the card: false
event types naming it in viewer 0 log: spellCast
```

`seatState` removes the object correctly, and the card *name* is therefore absent.
The **id** is still in seat 0's payload, carried by the `spellCast` event that
`seatEvent` passes through unredacted, while the object sits in seat 1's
concealed hand. `auditSeatPayloads` tests exactly
`payload.includes(JSON.stringify(card.oid))` for each card in the other seat's
hand and adds a finding when it matches
(`packages/engine/src/hidden-information.ts:366-379`). Seat 0 holds no license
for that id, because no `handRevealed` named it. **It is a finding, today, against
the kernel backend, of the same shape the hand-reveal scoping was written to
stop.**

The mechanism is worth stating precisely, because it is the argument for where the
log lives. `seatEvent`'s `zoneChanged` arm already redacts exactly this move — a
non-owner viewer gets a placeholder id when the destination is hidden
(`packages/kernel/src/visibility.ts:201-202`). The redaction is correct and
useless: the id was already published, legitimately, by an earlier event in a
cumulative log. **A per-event redactor cannot repair a cumulative log**, because
the question is not "may this event name this id" but "may this seat still
identify this object", and the second question is about the seat's history rather
than about the event.

Why nobody has hit it: the committed replay fixture at
`packages/ui/test/replay/fixtures/replay-events.jsonl` holds 384 event-bearing
frames and 1,530 events over 29 distinct event types, with **35 hidden-to-public
zone transitions and 0 public-to-hidden ones** (Python over the file, counting
`zoneChanged` against the two hidden zones). The neutral example set at
`packages/setgen/fixtures/sets/tideglass-reach.set.json` has 90 cards, **3** of
which carry a `returnToHand` effect, and 0 with `revealHand` or `scry`
(`json.dumps` string count). The shape is reachable and rare.

### Which of the three limits actually close

- **Limit 1 (a seat's own payload is unchecked)** closes only after row 4 gets a
  new kernel emission carrying the ids the owner learned. It cannot be closed by
  the auditor at any cost, because the information is not on the wire.
- **Limit 3 (false leak findings)** closes for rows 2, 3 and 5 at the contract
  layer with no new kernel emission for rows 2 and 3, and with no new kernel
  emission for row 5 either — the kernel already knows both facts, it just has
  no field to say them in.
- **Limit 2 (a backend that fabricates a reveal) does not close.** See below.

### Correction to the bead and to `hidden-information.ts:191-196`

The file says closing the fabricated-reveal hole "is `mtg-qbuq`'s per-seat
knowledge log, not this". **It is not, and moving the log does not make it so.**

A log the backend writes is exactly as forgeable as an event the backend writes.
A backend that fabricates `handRevealed { player, oids }` will fabricate a log
entry saying the same thing, and the auditor has no more independent account of
one than of the other. The file already argues this class correctly, one section
up: "this suite has no independent account of where a card is — every value it
reads is the backend's own projection of it"
(`packages/engine/src/hidden-information.ts:137-139`), and the digest and
commitment-scheme paragraphs above it rule out the only techniques that would
reach it.

What the log genuinely fixes about limit 2 is narrower and worth having: **for
the kernel, the log becomes a consequence of reduction rather than an
assertion.** An entry appears because `reduce` moved a card, not because an
emitter chose to say so, so a kernel bug that forgets to log a reveal produces a
false *leak* finding, which is loud, rather than a silent license. For a foreign
backend it stays a claim. The bead should say that.

---

## 3. Where it lives

**Kernel state carries the log. The contract carries a per-event delta. The
auditor folds the delta.** One place, three roles, and the split is not a
compromise: each layer holds the only thing it can hold.

**It cannot live in the auditor.** The auditor is a fold over a stream, and row 4
is not in the stream — `cardsScried` carries counts. No amount of cleverness in
`hidden-information.ts` reconstructs which card the scrying player looked at,
because the projection never carried it. An auditor-side log would close rows 1,
2, 3 and 5 and leave limit 1 permanently open, which is the limit the bead names
first.

**It cannot live in the contract.** `@mtg/engine` depends on nothing and holds no
state; a per-seat knowledge log is per-seat state. `seats.ts` settles the
governing rule for exactly this shape — a projection is a value to look at and is
never fed back in — and `visibility.ts:69-76` makes the kernel-side half of the
same argument, with a test that reads the tree to prove `seatState` cannot reach
`reduce`. A log in the contract would be a second state machine running beside
the backend's, derived from the backend's own output, which is the fabrication
problem with more moving parts.

**It has to be kernel state.** Deciding whether seat *s* may identify object *o*
requires knowing which zone *o* is in, which seats saw it, and which effects have
since taken that knowledge away. The reducer is the only layer that knows all
three at once. It is also the only layer where the log is derived rather than
asserted, which is the whole of what section 2's correction says limit 2 buys.

Concretely: `GameState` grows a knowledge relation; `reduce` writes to it as a
consequence of the moves it already makes; `concealedFrom` reads it instead of
asking only where the card is now; `seatEvent` reads it instead of asking only
what kind of event this is. That last sentence is the one that makes row 5 go
away, because `seatEvent` gets the missing input — the seat's history — that its
`zoneChanged` arm is currently trying to substitute for.

**Revocation is one class, not five.** Knowledge of an object in a zone is
destroyed by randomizing that zone: `libraryShuffled`, and the shuffle inside a
mulligan. Everything else either leaves the knowledge true (the object moves to a
zone the seat can see anyway) or is handled by presence — an object that is no
longer in a hidden zone is not one the check is looking for, which is the rule
`PositionMemo.revealed` already implements by re-intersecting every position. The
committed replay fixture contains 4 `libraryShuffled` and 4 `handKept` events
(same Python count), so the revocation path is exercised by existing material.

---

## 4. The neutral expression

`EngineEvent` grows a **required** `reveals` field carrying a **delta**: for this
event, which objects became identifiable by which seats.

```ts
export interface EngineReveal {
  readonly oid: string;
  readonly seats: readonly SeatId[];
}

export interface EngineEvent {
  readonly seq: number;
  readonly type: string;
  readonly text: string;
  readonly detail: unknown;
  /** What this event made identifiable, and to whom. Empty when nothing. */
  readonly reveals: readonly EngineReveal[];
}
```

`SeatId` comes from `./table`, so `events.ts` gains one intra-package import and
the contract gains no dependency. `oid` is the projection's own opaque identity,
the same string `MoveTarget.oid` and `ObjectView.oid` already carry, so the
auditor compares it to the ids it is already searching for without a translation
step.

### Which precedent, and why

**`labels.ts`, on `decision.ts`'s rule.** `decision.ts` asks a single question to
choose between the two shapes: is the property true of a *backend*, or true of
*one value at one position*? A determinism-style discriminant fits when the arms
carry different kinds of record — a seed and a move list against a list of
observed positions — so a flag would make one look like the other with a feature
missing. `labels.ts`'s third reason fits when the property is a fact about a
value: truncation is true of one decision on one board and false of the same
kernel on the next, so no static declaration could be kept.

"Which seats may now identify this object" is a fact about one event at one
position. The same kernel reveals a hand at one event and reveals nothing at the
next, and every backend that emits events emits some that reveal and some that do
not. A `RevealingBackend` discriminant would narrow to no new member — both arms
take the same submit and hand back the same session — and it would be a claim no
backend could keep. So the declaration goes on the value and is computed per
event, exactly as `complete` is computed per decision.

### Why required rather than optional

`labels.ts`'s own reason, applied here. An optional field invites
`event.reveals ?? []` at every reader, and that expression reads "this event
revealed nothing" for a backend that never fills the field in. The failure is
silent and it is the wrong direction: an unfilled field would hand a backend
blanket relief from the audit. Required makes it a compile error at every
construction site instead, and the empty array is a real answer that most events
give. Reading the declaration and reaching the value are one act.

### Why a delta and not a log

The contract carries facts about values and never state, which is the rule
`seats.ts` sets and `determinism.ts` respects. An accumulated per-seat set on the
contract would be state, and it would be state the backend maintains and the
auditor trusts. A delta is a fact about this event: *this* is what *this* event
showed. The accumulation stays the reader's fold, which is what
`PositionMemo.revealed` already is, so the auditor's structure does not change —
it stops duck-typing `detail` and starts reading a field.

### What this deliberately does not do

It does not generalize to "everything a seat knows". A field that had to express
scry ordering, mulligan bottoming order and search results would stop being a
field and become the knowledge log itself, on the contract, which section 3 rules
out. `reveals` says only *identifiable from now on, by these seats*. Row 4's
owner-side knowledge reaches the wire as a reveal to one seat — the owner — which
is the same shape, and the ordering it implies stays kernel-side where CR 401.1
can be honored.

### Why the neutral field beats the duck-typing it replaces

`revealedBy` matches on the literal `'handRevealed'`, which
`hidden-information.ts:198-203` admits is "one engine's word for the event, not a
neutral one", and it grants no license to any backend that spells it differently.
A field on `EngineEvent` needs no agreement about vocabulary: a backend that
reveals hands under any name fills in `reveals`, and the auditor never learns
what the event was called. That is the thing `hidden-information.ts:215-217` says
the log would do — "it would not need to know a reveal's shape to know a reveal
happened" — and the field is the part of the log that does it.

---

## 5. What it costs

Two facts the brief asked me to verify personally rather than accept.

### Recorded LLM fixture keys: untouched

A fixture is keyed by a stable hash over a version tag, the system prompt, the
user prompt and the JSON schema (`fixtureKey`,
`packages/llm/src/schema.ts:68-80`). No game state and no event stream enters the
key. So the only way a change here moves a key is by changing a prompt's text.

The repository holds **180** committed fixtures — 172 under `@mtg/setgen`, 6 art,
1 cube, 1 referee (`git ls-files | grep fixtures/llm | sed | sort | uniq -c`).
`@mtg/referee` is the only package whose prompt could plausibly contain a log,
and it does not: its prompt is `renderFrame(frameDecision(view, …))`
(`packages/referee/src/referee.ts:112`), and **`packages/referee/src/frame.ts`
and `prompt.ts` contain zero occurrences of "events" or "log"** (grep, no
output). Its one recorded fixture contains **0 occurrences of "event", "seq" or
"oid"** (Python over the JSON). **Nothing in this plan re-records an LLM
fixture, at any stage.**

### The `m11-m13-*` digests: they move on a kernel code edit and only then

The reference artifacts that `npm run reference:refresh` maintains carry per-file
token digests of `@mtg/kernel` and `@mtg/dsl` source. Measured across the seven
committed artifacts (Python walking each JSON for `sha256` fields; the artifacts
use four different key names and three different path spellings for the same
thing, which is why a single grep undercounts):

- **5 of the 7** carry a digest of `packages/kernel/src/visibility.ts`, and all
  five hold the same value.
- The kernel digest set is **53 files**; the dsl set is **37**.
- **0 of the 7** name any `@mtg/engine` or `@mtg/setgen` source file at all
  (string search for `@mtg/engine`, `packages/engine/`, `@mtg/setgen`,
  `packages/setgen/src` across all seven: no hits).

Confirmed by probe (`fileTokenSha256` run over three versions of
`visibility.ts`): the committed digest equals the current file's; a
**docblock-only** edit produces a byte-identical digest, because the unit is the
TypeScript token stream and trivia is dropped; a **code** edit produces a
different one. So the property is exactly as the brief stated, and it partitions
the plan: every stage that touches only `@mtg/engine` moves nothing, and the one
stage that edits kernel code moves the digest in five artifacts.

The same artifacts carry **182 committed state fingerprints** (91
`beforeStateFingerprint` and 91 `afterStateFingerprint`, across four of the
seven). A `stateFingerprint` is a hash of the canonicalized `GameState`
(`packages/kernel/src/fork.ts`), so **adding a field to `GameState` moves every
one of them**, whatever its value. That is the real price of stage 3 and it is
not avoidable by keeping the new field empty: canonicalization sorts keys and
filters `undefined` entries, so a field present and empty is a field present.
Whether an always-`undefined` field would be filtered out is **unmeasured** — I
did not run a probe that adds a field to `GameState`, because that is a source
edit in a package another lane owns.

### The rest of the inventory

- **`EngineEvent` construction sites: 6.** One in the kernel's adapter
  (`packages/kernel/src/backend-projection.ts:271`), one in the contract's toy
  backend (`packages/engine/src/stub.ts:245`), four in
  `packages/engine/test/contract.test.ts` (`grep -E "seq:"` across the files that
  mention `EngineEvent`). A required field costs six edits, which is the whole
  argument against making it optional to save typing.
- **`@mtg/netplay` puts kernel `GameEvent[]` on its wire**, not `EngineEvent[]`,
  so the contract stages do not touch the protocol; the kernel-state stage does.
- **`@mtg/ui` never imports `EngineEvent`** (it does not appear in the grep of
  files mentioning the type), so no surface changes for the contract stages.
- **No vitest snapshots and no committed engine transcripts.** The two committed
  replay files are frame logs whose `state` is a reduced snapshot with four keys
  (`battlefield`, `exile`, `seats`, `stack`), not a `GameState`, so they carry no
  fingerprint and need no re-recording.
- **The balance gate: unmeasured here.** I did not run it, and the brief forbids
  it. The mechanism argues it is untouched — a knowledge log changes what a seat
  is *shown*, and `packages/sim`'s bot plays from the unprojected state — but
  that is an argument, not a measurement, and stage 3 should be re-pinned by
  running the gate rather than by citing this paragraph.

---

## 6. The staged plan

Each stage lands alone, is proved alone, and the re-recording line is stated
plainly.

### Stage 1 — the neutral field, empty everywhere

Add `reveals` to `EngineEvent` as a required field. Fill it with an empty array
at all six construction sites. Nothing changes behavior.

*Verified alone by:* a contract test asserting the field exists on every event a
backend emits, and `checkBackend` against the toy backend staying green.
*Re-recording forced:* none. No kernel source, no `GameState`, no prompt.

### Stage 2 — the auditor reads the field, and `revealedBy` is deleted

`auditSeatPayloads` builds its license from `event.reveals` instead of from
`detail`. `revealedBy` goes. The kernel adapter fills `reveals` from the events
it already has: `handRevealed` reveals its `oids` to both seats; an object
published to a seat by any pass-through event that names it reveals it to that
seat. Rows 1 and 5 close. Rows 2 and 3 close for any foreign backend that fills
the field.

*Verified alone by:* the existing hand-reveal case, which must stay green with
the duck-typing gone; plus a new case built from the bounce probe in section 2 —
cast a bounce spell at a creature, resolve, and assert the audit reports no
finding, which it does report today.
*Re-recording forced:* none. This is `packages/engine` plus
`packages/kernel/src/backend-projection.ts`. **That kernel file is in the digest
set**, so re-run `npm run reference:refresh -- --check` and expect the five
artifacts holding kernel digests to want an update for that one file. No state
fingerprint moves, because `GameState` is untouched.

*This is the stage that closes limit 3 and the bead's own opening example, and it
costs no state change at all.* It is worth landing on its own for that reason.

### Stage 3 — the log in `GameState`

`GameState` grows the knowledge relation. `reduce` writes it. `concealedFrom` and
`seatEvent` read it. `cardsScried` gains the ids the owner saw, redacted from the
non-owner by `seatEvent`'s fifth special arm. Row 4 closes, and with it limit 1.

*Verified alone by:* a kernel test that scries, then draws, and asserts the owner
can identify the card it put back on top while the opponent cannot; a second that
shuffles afterwards and asserts the knowledge is revoked; and the audit's own-seat
check, newly enabled, staying green across a full game.
*Re-recording forced:* **yes, and this is the only stage that forces one.** All
182 committed state fingerprints move, and the kernel digests move in five
artifacts. `npm run reference:refresh` regenerates both; the balance gate needs a
run and, if it drifts, a re-pin. The netplay protocol carries kernel events, so
its wire shape changes with the `cardsScried` payload.

### Stage 4 — the auditor's own-seat check

Turn on the check `hidden-information.ts:80-96` currently declines to write:
a seat's own payload against its own library, using the log to decide what the
owner was entitled to know. Only reachable after stage 3.

*Verified alone by:* a scry that must not be reported, and a fabricated
own-library disclosure that must be.
*Re-recording forced:* none beyond stage 3's.

---

## 7. What this does not do

- **It does not make a foreign backend trustworthy.** Sections 2 and 3 say why:
  a log the backend writes is as forgeable as an event the backend writes, and
  the only techniques that would reach that are ruled out in
  `hidden-information.ts` on grounds this design does not change.
- **It does not make rows 2 and 3 reachable by our kernel.** No effect in the
  vocabulary searches or reveals from a library. Landing the neutral field means a
  backend that does those things stops producing false findings; it does not mean
  we can play those cards.
- **It does not change what a seat is shown.** `seatState` still conceals both
  libraries including the viewer's own, which is stricter than CR 401.1 requires
  and stays that way; the log decides what the *auditor* accepts, and what
  `seatEvent` may leave in a cumulative log, not what the projector hands over.
- **It does not carry ordering.** A scry's ordering and a mulligan's bottoming
  order stay inside the kernel. The contract learns only that a seat may identify
  an object, which is the fact the audit needs and the least that suffices.
- **It does not touch the recorded/observed split.** `reveals` is a fact about a
  value and both arms carry it, so nothing here narrows a signature.

---

## 8. What I could not settle

- **Whether an always-`undefined` field on `GameState` survives
  canonicalization without moving a fingerprint.** Unmeasured; measuring it means
  editing kernel source, which this lane may not do. If it does survive, stage 3
  could be split again into a field-added stage and a field-populated stage, and
  the 182 fingerprints would move only at the second.
- **Whether the balance gate drifts at stage 3.** Unmeasured, and forbidden to
  run here. The mechanism says no; run it anyway.
- **The exact representation of the knowledge relation in `GameState`.** A map
  from object id to a seat set is the obvious one and canonicalizes cleanly; a
  per-seat set of object ids reads better at the two call sites. I have no
  measurement that separates them and would not choose one from a document.
- **Whether row 5's fix belongs in `seatEvent` or in a post-pass over the
  cumulative log.** Stage 2 puts it in the adapter, which is enough to close the
  finding; whether the kernel's own log should also stop republishing the id is a
  separate question about what a replay is allowed to see, and it touches
  `packages/ui`'s replay path, which this lane did not read.
