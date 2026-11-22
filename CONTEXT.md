# MTG lab

The vocabulary of this project: the sets it can run, what it takes to run one,
and the art and evaluation work around that. Written with the playtester in a
grill-with-docs session on 2026-09-17 (mtg-36w7w), every term accepted by her.
One or two sentences per term, an `_Avoid_` line naming the words this project
does not use for it, and no implementation detail.

## Language

### What runs a game

**Kernel**:
This project's own rules engine, which runs the cards we write.
_Avoid_: our engine, the rules engine, the core

**Bridge**:
The arm's-length link to the third-party engine that runs real printed cards.
_Avoid_: Forge (when the link is meant rather than the program), the adapter

**Contract**:
The neutral interface a play screen talks to, so the screen does not care
whether a kernel or a bridge is behind it.
_Avoid_: the engine API, the backend interface

**Decision**:
One question the engine puts to a player: pay this cost or not, choose a card,
pick a mode.
_Avoid_: prompt, choice, callback

**Decision family**:
A shape of decision reviewed once and then reused. Card admission is granted
over families, not over cards one at a time.
_Avoid_: decision type, callback class

### Running a set

**Card admission**:
The state of having a reviewed, evidenced route for every decision a card can
ask a player, so play may use it. It is a property of the engine bridge, not of
the card or the set.
_Avoid_: card support, whitelisting, card coverage

**Set support**:
What a set can be used for, stated per activity: browsing, drafting, sealed and
play each carry their own status. A set is never supported as a whole.
_Avoid_: supported set (unqualified), set readiness

**The old gate**:
The retired rule that a set had to be exhaustively playtested before it could be
played at all.
_Avoid_: the playtest gate, the admission gate (ambiguous: admission outlived
the gate)

**The add-set approach**:
The current route: admit the decision families a set's cards need, each with its
own evidence, so sets land one at a time.
_Avoid_: the new gate, incremental admission

**Generated set**:
A set this project writes in its own card language, runnable by construction
because nothing can be written that the rules kernel cannot run.
_Avoid_: custom set, synthetic set, AI set, flagship (name the set instead)

**Reduced set**:
A printed set with every position the kernel cannot run removed, so what is left
plays: it names what it dropped and why. The kernel runs it; the bridge is not
involved.
_Avoid_: subset, trimmed set, cut-down set

**Printed set**:
A real Magic set. Its cards reach play only through the engine bridge, and only
once admitted.
_Avoid_: real set, official set, paper set

### Playing

**Table**:
One game and its seats. Two people play at one table.
_Avoid_: room, match, lobby

**Host** / **Guest**:
The host runs the table on their own machine; the guest joins it over the
network and sees only what the table sends.
_Avoid_: server and client, player one and player two

**Balance gate**:
A seeded run of thousands of games whose result is an assertion, not a report:
win rates inside stated bands, no dominant strategy. It blocks the build.
_Avoid_: balance sim, format health check, playtest

### Art

**Surface**:
Anything a set puts a picture on: a card, a token its cards create, or a basic
land it is played with. Art coverage is counted over surfaces, never over cards.
_Avoid_: image slot, art target, illustration slot

**Token art**:
The illustration of a token, owned by the token as its own surface rather than
by the card whose ability creates it.
_Avoid_: creature token image, spawned art

**Pending frame**:
A card face drawn with a labeled placeholder where the illustration goes. A
normal state for a set whose art has not been made yet.
_Avoid_: missing art, blank card, broken image

**Oldest printing**:
Among all printings of one card, the illustration from the set released
earliest. The standing preference for a printed set's art.
_Avoid_: original art, first printing, earliest available (availability is not
the test)

### Evaluation

**Learned evaluator**:
A model trained from self-play that scores how good a game position is, meant to
stand in for the hand-written scoring the bots use today.
_Avoid_: the model, the policy, the AI (all three mean something else here)

### Working

**Lane**:
One line of work with exactly one owner while it runs, from bead to landed
branch. Some lanes are exclusive, because a second one running at the same time
would falsify the first one's evidence.
_Avoid_: stream, track, workstream, thread

**Admission label**:
The mark on a backlog item saying who may take it: an agent, the playtester, or
nobody yet. Unrelated to card admission, which is about the engine.
_Avoid_: triage state, status, priority (priority is a separate field and does
not say who may take the item)
