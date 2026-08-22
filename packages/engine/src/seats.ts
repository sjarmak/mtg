/**
 * The position as one seat may be *sent* it, rather than as one screen may draw
 * it.
 *
 * `SessionBase.view`, `SessionBase.events` and `SessionBase.decision` are the
 * table's own. They hold everything the session knows, minus whatever the
 * backend already declines to show a non-local seat, and they are the right
 * thing for a surface that holds the whole table: two people at one screen are
 * looking at the same pixels, so a component that holds both hands and draws one
 * face-down is honest. Across a wire it is not concealment at all — the client
 * holds the bytes, and the other hand is one devtools panel away. `@mtg/kernel`'s
 * `visibility.ts` argues that at length and is where the kernel's answer lives.
 *
 * So a backend that can serve two machines has to be able to *remove* what a
 * seat may not identify, and that is a different value per seat rather than one
 * value drawn twice. `SeatProjection` is the three of them: the board, the log
 * and the question, each for one viewer.
 *
 * # Why this is a member that can be absent rather than a boolean beside a method
 *
 * `determinism.ts` argues the same shape for reproducibility and its three
 * reasons carry over almost unchanged. A `capabilities.perSeatProjection: boolean`
 * beside a `seatView()` method that throws when it is false can be called
 * without reading the flag; an *optional* method invites `session.seatView?.(0)`,
 * which returns `undefined` and ships a payload with nothing removed from it;
 * and the failure lands in the middle of somebody's networked game rather than at
 * the seam.
 *
 * `seats` is therefore `SeatProjection | null` on every session, and under
 * `strictNullChecks` a caller cannot reach `view` without the null check. Reading
 * the declaration and reaching the projector are the same act, which is the
 * property the boolean could not have.
 *
 * # Why it is not a second discriminant
 *
 * Determinism is a discriminant on the session type itself, and this is
 * deliberately one level weaker. Two reasons:
 *
 *  1. **The cross product is not free.** Determinism already splits the session
 *     in two. A second literal discriminant makes four session types for two
 *     independent facts, and the third capability makes eight. A contract whose
 *     arms multiply is one nobody can write a `switch` over.
 *  2. **Nothing here is a different *kind* of value.** The recorded and observed
 *     arms carry genuinely different records — a seed and a move list against a
 *     list of observed positions — and `determinism.ts`'s third reason is that a
 *     flag would make one look like the other with a feature missing. A
 *     non-projecting backend has no second kind of view; it has no per-seat view
 *     at all. Absence is what is being modeled, and a nullable member models
 *     absence exactly.
 *
 * What a caller gets is still compile-time: a function that *requires* per-seat
 * projection says `ProjectingSession` in its signature, and a session that may
 * not have one fails to typecheck rather than failing a run-time check.
 *
 * # What a seat may be sent is narrower than the session it hangs off
 *
 * `view`, `events` and `decision` are the three values, and `hidden-information.ts`
 * searches exactly those three. The session carrying them holds more, and on the
 * recorded arm one of those members is the whole match in one object:
 * `RecordedSession.record` names the seed the game was dealt from and every move
 * made since, which with the two decklists reproduces both libraries. It is on
 * the session because the local caller owns the game and needs it to save,
 * reopen and rewind; it is not a thing to put on a socket, and no per-seat
 * variant of it exists.
 *
 * No conformance suite can catch a server that forwards it, because forwarding
 * is not something a backend does. So the rule is written here, where a server
 * reaches for the projector: what a seat receives is what the projector
 * returned. Nothing else off the session travels beside it. `@mtg/netplay`
 * arrived at the same rule from the other end and its wire carries the recording
 * as a count.
 *
 * # What a server still has to read the backend's code for
 *
 * `checkBackend` searches these three values at every position of a game and
 * catches a backend that names a card in somebody's hand, or the seed, or a card
 * still sitting in the other seat's library. Three things it cannot reach, and a
 * surface putting a *foreign* backend on a socket owes each of them a look
 * before it trusts one:
 *
 *  1. **The bottom of a library.** The library check works by asking what came
 *     out of one, so a card that never surfaces during the game the suite played
 *     is never examined. A backend that ships whole decklists in an opening
 *     payload will be caught on the first draw; one that ships them in a payload
 *     the suite's move policy never reaches will not.
 *  2. **A seat's own library.** Deliberately unchecked, because scry and the
 *     London mulligan make some of that knowledge legitimate and the contract
 *     has no per-seat knowledge log to tell which. `@mtg/kernel` conceals both
 *     libraries including the viewer's own; a foreign backend is not held to
 *     that here.
 *  3. **Zones the projection does not carry at all**, exile among them. Nothing
 *     the suite searches for can be derived from a zone it cannot see.
 *
 * # The capability flag is the pre-open declaration and nothing else
 *
 * `BackendCapabilities.perSeatProjection` stays, because a caller choosing among
 * backends has no session yet and the question "will this one serve a networked
 * table" has to be answerable before `open`. It is a promise about every session
 * the backend opens, it is not a thing anyone can call, and `checkBackend`
 * refuses a backend whose sessions disagree with it in either direction.
 */
import type { EngineEvent } from './events';
import type { PendingDecision } from './decision';
import type { TableView } from './projection';
import type { SeatId } from './table';
import type { ObservedSession, RecordedSession } from './session';

/**
 * One seat's three payloads, computed on demand.
 *
 * Functions rather than precomputed values because a hot-seat game never asks:
 * projecting both seats on every snapshot would pay a networked game's cost at a
 * kitchen table. A backend may cache; nothing here says it must.
 *
 * **A projection is a value to look at and is never fed back in.** Submitting a
 * move still goes through the session, which holds the position the backend
 * actually has. Every id in here is the same opaque id the table view uses,
 * except where the object is concealed, and a concealed object has no id a
 * viewer can hold onto — a backend that reused one across deliveries would have
 * handed out a tracking tag for a card nobody may identify.
 */
export interface SeatProjection {
  /** The board as this seat may see it. Another seat's hidden zones are gone. */
  view(seat: SeatId): TableView;
  /** The log as this seat may read it, in the same order and length. */
  events(seat: SeatId): readonly EngineEvent[];
  /** The question, when this seat is the one being asked, and null otherwise. */
  decision(seat: SeatId): PendingDecision | null;
}

type Projecting<S> = S & { readonly seats: SeatProjection };

/**
 * A session known to project per seat, on whichever determinism arm it is.
 *
 * Written as a union of the two arms rather than as `EngineSession & …` so that
 * narrowing on `determinism` still works after narrowing on this: the two splits
 * are independent and a caller may need both.
 */
export type ProjectingSession = Projecting<RecordedSession> | Projecting<ObservedSession>;

/**
 * Narrows a session to one that projects per seat.
 *
 * Only needed to *hand the session on* to something that requires projection.
 * Reading the projector needs no guard at all — `const seats = session.seats;
 * if (seats === null) …` is the whole of it, and is what most callers should
 * write.
 */
export function projectsPerSeat(session: RecordedSession | ObservedSession): session is ProjectingSession {
  return session.seats !== null;
}
