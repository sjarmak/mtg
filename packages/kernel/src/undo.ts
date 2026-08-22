/**
 * Where undo stops.
 *
 * Rewinding is mechanical and this file is not about it: a session is a seed
 * plus a list of integers, so the position `n` decisions ago is
 * `replaySession(setup, seats, choices.slice(0, n))` and nothing has to be
 * un-done. Deciding how far back `n` may go is the whole problem, and it is a
 * rules question rather than an interface one.
 *
 * The playtester stated the rule (`mtg-bz2.13`, 2026-08-13): "Undo applies only
 * before information/state becomes committed. For example, selecting attackers
 * can be changed before submitting attackers. Once priority is passed or a
 * hidden-information-changing action resolves, it cannot simply be undone."
 *
 * **Nothing here is game state**, and it is here rather than in `GameState` for
 * the reason `autopass.ts` gives about stop sets: a boundary is a fact about
 * what an interface may offer, not about the position. A predicate over the
 * event log cannot reach `stateFingerprint`, `fork` or replay determinism, and
 * two players with different undo settings — if there ever are any — would still
 * be playing one game.
 *
 * **The predicate is a fold over events rather than over actions**, and that is
 * the load-bearing choice. An action says what a player asked for; the events
 * say what the kernel did about it, including everything it did in the same
 * breath — the opponent's answer, the step it walked into, the card that came
 * off the top for somebody else. Undo is about knowledge, and knowledge is in
 * the log.
 *
 * ## The boundaries
 *
 * Seven events close a boundary, in two groups with two different arguments.
 *
 * **Control crossed the table.**
 *
 *  - `priorityPassed`. CR 117.3: a pass is how the game moves, and the moment it
 *    lands the other seat has been asked. On one screen that is literal — the
 *    board is drawn from the seat that owes the decision (`@mtg/ui`'s
 *    `use-session.ts`), so a pass is when the device changes hands and the other
 *    player's hand comes up. the playtester's first boundary, and the busiest one:
 *    almost every slice in a driven game contains one.
 *
 * **Hidden information moved, and cannot be un-learned.**
 *
 *  - `cardDrawn`. The drawer now knows a card that was the top of a hidden
 *    library. This is the exact failure ADR-0001 line 133 cites from MTG Bench,
 *    "irreversibly corrupting hidden information (draw then undo)", as its
 *    reason the kernel and not a model owns state. A rule cited as a reason to
 *    build the kernel has to be enforced by the kernel.
 *  - `libraryShuffled`. A shuffle is drawn from the seeded stream, so a replay
 *    reproduces it exactly. That makes rewinding across one worse than rewinding
 *    across an ordinary decision, not better: a player who has seen what the
 *    shuffle produced and rewinds to before it is choosing between a hand they
 *    have read and a hand they already know is coming. The randomness the rules
 *    are relying on is gone.
 *  - `cardsMilled` and `cardsDiscarded`. Cards left a hidden zone for a public
 *    one. Both seats learned them, so both seats would have to un-learn them.
 *  - `cardsScried`. The choosing player saw and ordered cards from a hidden
 *    library. The public event deliberately carries only counts, but the
 *    chooser's knowledge is still irreversible; rewinding to the choice would
 *    offer a second answer informed by the first window.
 *  - `handKept`. CR 103.4: a kept hand is the opening hand and the rules offer no
 *    take-back. It is also the last point at which the seat could still have
 *    chosen randomness over the cards it has read, and the bottomed cards are
 *    library positions the keeper now knows.
 *  - `libraryTopRevealed`. CR 701.16a showed cards from a library to both seats
 *    without moving them, so no zone change records it and nothing downstream
 *    can un-show them. It is `cardsScried`'s case with the leak pointed the
 *    other way: the scry event carries counts and the chooser alone knows the
 *    cards, while a reveal names the ids to everyone.
 *  - `librarySearchRevealed`. The same rule at CR 701.19's reveal clause, and it
 *    is the one search event that is a boundary. `librarySearched` is retired
 *    below because the shuffle that follows it closes the boundary already; a
 *    shuffle un-learns *order* and this event's knowledge is *contents*, which
 *    survives it.
 *
 * ## What is deliberately not a boundary
 *
 * `handMulliganed` is not in the set because it cannot occur without one that
 * is: `mulligan.ts` shuffles and redraws in the same reduction, so every slice
 * carrying it carries `libraryShuffled` first. Listing it would be a rule that
 * never fires. `librarySearched` is retired by the same entailment and it is
 * worth being explicit about, because a search is the most information any one
 * effect moves: the searcher read their whole library. CR 701.19c shuffles at
 * the end of every search whether or not a card was found (`answerSearch`,
 * `scry.ts`), so the slice carrying the search carries `libraryShuffled` in the
 * same reduction and the boundary is already closed. The same entailment retires the obvious candidates on the far
 * side of the stack — `resolutionBegan`, `spellFizzled`, `spellCountered`,
 * `damageDealt`, `gameEnded`. Nothing resolves without a round of passes, so
 * `priorityPassed` is already in the slice; the playtester's second boundary is
 * reached through her first.
 *
 * Playing a land, tapping for mana, casting a spell, declaring attackers,
 * declaring blockers, ordering blockers and aiming a trigger are **not**
 * boundaries, and that is the whole of what undo buys. Each is a public act by
 * one player that the other player has not been asked about yet, and the pass
 * that would show it to them is the boundary. So a misclicked land, a
 * misassigned tap, a cast nobody has responded to and a declaration already
 * submitted are all takeable-back right up to the pass, and none of them can be
 * taken back after it. That extends the playtester's attacker example by exactly one
 * step and the step is defensible: her "before submitting attackers" is
 * `@mtg/ui`'s `selection.ts`, interaction state that never reached the kernel,
 * and submitting a declaration into a kernel nobody else has been asked about
 * leaks nothing to anybody.
 *
 * ## A decision the interface splits into several
 *
 * `mtg-cs8t` sequences one `declareBlockers` decision into one submit per
 * blocker, which puts k recorded choices where one was and hands `undoTo` k-1
 * new prefixes to land on. Each of them replays to a position with part of the
 * block assigned and the rest still being asked for, and CR 509.1 has no such
 * position: blockers are declared as one turn-based action. Two answers were on
 * the table (`mtg-nj6m`) and only one survives contact with this file.
 *
 * **Rejected — close a boundary at the end of the sequence.** A boundary is a
 * floor and a floor is a lower bound, so putting one at the end of the block
 * forbids the interior and everything before it in the same stroke: the
 * declaration stops being takeable back at all, which is the rewind the section
 * above promises by name and one step from the playtester's own attacker example. It
 * also spends the boundary set on the wrong kind of fact. The seven events here
 * are each a rules-level irreversibility, "the interface asked this in six
 * pieces" is not one, and a set that admits it is no longer a set anybody can
 * argue from. Measured rather than asserted:
 * `packages/kernel/test/blocker-commitment.test.ts` goes red on four counts with
 * `blockersDeclared` added to `boundaryOf` below, and the first of them is the
 * undo window at a declared block collapsing from two landings to one.
 *
 * **Chosen — undo pops the whole block.** The interior stops being a landing,
 * and a rewind that would reach one lands on the position the declaration opened
 * from. Nothing else about the block changes, including that it is takeable back
 * right up to the pass. That is not a new principle: `session.ts`'s `undo`
 * already refuses to take back one decision because a decision is not a unit the
 * player can see, and k submits of one declaration are k units nobody can see
 * either. The block is the unit.
 *
 * **The rule is a predicate over the replayed position, and that is why it is
 * not in this file yet.** A position that owes `declareBlockers` while
 * `combat.blocks` already holds something is mid-sequence by construction, so
 * the sequencer has to supply no marker for it and cannot drift from one. That
 * puts it where the replay happens, in `session.ts`'s `undoTo`, and it cannot be
 * written until stage 2 exists to produce the position. The test above fixes the
 * property in the meantime, and builds the forbidden position by hand so the
 * predicate has been seen to say yes to one.
 *
 * The other half of `mtg-nj6m` is what the increments show the opposing seat,
 * measured in `packages/netplay/test/blocker-sequence.test.ts` and read in
 * `docs/design/blocker-sequence-commitment.md`. It lands on the same
 * monotonicity this rule protects: an increment costs the attacking seat nothing
 * while increments only ever add.
 */
import type { GameEvent, GameEventType } from './events';
import type { PlayerId } from './ids';

/** Which event closed a boundary, whose it was, and what it says to a player. */
export interface CommitReason {
  readonly event: GameEventType;
  /** The seat the event belongs to, or null for an event that names no seat. */
  readonly player: PlayerId | null;
  /** A clause, so a refusal can read "…, where <why>". */
  readonly why: string;
}

/** A boundary, and how many recorded choices sit at or before it. */
export interface Commitment {
  /**
   * The shortest prefix of `GameSession.choices` a rewind may land on. Choices
   * below it are committed; the ones at or above it are not.
   */
  readonly floor: number;
  readonly reason: CommitReason;
}

/** The boundary one event closes, or null when it closes none. */
function boundaryOf(event: GameEvent): CommitReason | null {
  switch (event.type) {
    case 'priorityPassed':
      return {
        event: event.type,
        player: event.player,
        why: `player ${String(event.player)} passed priority and the other seat has been asked`,
      };
    case 'cardDrawn':
      return {
        event: event.type,
        player: event.player,
        why: `player ${String(event.player)} drew a card and cannot un-learn it`,
      };
    case 'libraryShuffled':
      return {
        event: event.type,
        player: event.player,
        why: `player ${String(event.player)}'s library was shuffled and a replay would deal the same order back`,
      };
    case 'cardsMilled':
      return {
        event: event.type,
        player: event.player,
        why: `${String(event.oids.length)} card(s) went from player ${String(event.player)}'s library to a public zone`,
      };
    case 'cardsDiscarded':
      return {
        event: event.type,
        player: event.player,
        why: `${String(event.oids.length)} card(s) went from player ${String(event.player)}'s hand to a public zone`,
      };
    case 'cardsScried':
      return {
        event: event.type,
        player: event.player,
        why: `player ${String(event.player)} scried and cannot un-learn the library cards they saw`,
      };
    case 'handKept':
      return {
        event: event.type,
        player: event.player,
        why: `player ${String(event.player)} kept an opening hand, which CR 103.4 gives no take-back on`,
      };
    case 'libraryTopRevealed':
    case 'librarySearchRevealed':
      return {
        event: event.type,
        player: event.player,
        why: `${String(event.oids.length)} card(s) off player ${String(event.player)}'s library were revealed to both seats`,
      };
    default:
      return null;
  }
}

/**
 * The first boundary a slice of the log closes, or null when it closes none.
 *
 * First rather than last, because the refusal should name the earliest thing the
 * rewind would have had to undo. A slice that passes priority and then walks
 * into somebody's draw step is refused on the pass: that is where the rewind
 * stops being possible, and the draw is downstream of it.
 */
export function commitPoint(events: readonly GameEvent[]): CommitReason | null {
  for (const event of events) {
    const closed = boundaryOf(event);
    if (closed !== null) return closed;
  }
  return null;
}

/** `commitPoint` as the predicate: did this slice commit anything. */
export function commits(events: readonly GameEvent[]): boolean {
  return commitPoint(events) !== null;
}

/**
 * Folds one batch of newly appended events into a session's running commitment.
 *
 * `recorded` is `choices.length` at the moment the events were appended, so the
 * batch is attributed to the choice that produced it and the floor lands one
 * past that choice's index. Bot decisions and the settling that follows a human
 * choice append with `recorded` unchanged, which is right: rewinding to that
 * prefix discards them too, so they belong to the choice that let them happen.
 *
 * A batch appended while nothing has been recorded is the opening deal, and it
 * is not a commitment because there is no choice to attribute it to and no
 * shorter prefix to refuse. The floor only ever rises, so this never re-opens a
 * boundary that has closed.
 *
 * One slice arrives in several batches, because a human choice reduces once and
 * then `advance` reduces again for every bot decision behind it. A floor that
 * has already closed keeps the reason it closed with, so a mulligan reads as the
 * shuffle it dealt from rather than as whatever the opponent did afterwards.
 * That is `commitPoint`'s first-not-last rule holding across the batches as well
 * as inside one.
 */
export function commitmentAfter(
  previous: Commitment | null,
  appended: readonly GameEvent[],
  recorded: number,
): Commitment | null {
  if (recorded === 0) return previous;
  if (previous !== null && previous.floor >= recorded) return previous;
  const reason = commitPoint(appended);
  if (reason === null) return previous;
  return { floor: recorded, reason };
}
