/**
 * What happened, as the backend that made it happen says so.
 *
 * The kernel's `GameEvent` is a wide discriminated union and it is the kernel's:
 * every arm names kernel concepts and a foreign engine emits none of them. So
 * the neutral event carries three things a surface can honestly use — an
 * ordinal, a type tag, and a sentence — and one thing it cannot.
 *
 * **`detail` is for the backend that emitted it and for nobody else.** A backend
 * may put its own typed payload there and re-read it later; a surface that
 * branches on it has silently become a surface for one engine. This is the seam
 * where that mistake is cheapest to make and hardest to see, so it is named
 * here rather than left to reviewers.
 *
 * **`type` is a string, and comparing two of them is fine.** Grouping a log by
 * type, filtering one out, styling one differently: all of that reads the value
 * as an identity, which is what it is. An exhaustive switch over it is the same
 * mistake as branching on `detail`, one step later.
 *
 * **`seq` is dense and monotonic within a session**, because the Replay tab
 * addresses frames by position (`#/replay?game=&seq=`) and a log with holes in it
 * makes that address a lie.
 *
 * **`reveals` is the one thing a reader may learn from an event without knowing
 * the backend.** A log is cumulative, so an id published while an object was
 * public sits in every later payload, and a reader deciding what a seat may still
 * identify has to know the object was shown rather than guess from where it is
 * now. That is a fact about this event at this position, not a property of the
 * backend, which is why it is a field on the value and not a discriminant on the
 * backend: the same engine reveals a hand at one event and reveals nothing at the
 * next.
 *
 * It is **required**, and empty is the answer most events give. Optional would
 * invite `event.reveals ?? []` at every reader, and that expression reads
 * "revealed nothing" for a backend that never filled the field in — silent, and
 * wrong in the direction that hands an unfilled backend blanket relief from the
 * hidden-information audit. Required makes it a compile error at the
 * construction site instead.
 *
 * It is a **delta, not a log**. The contract carries facts about values and never
 * state (`seats.ts`), and an accumulated per-seat set would be state the backend
 * maintains and a reader trusts. Accumulating is the reader's fold, which is what
 * `hidden-information.ts`'s `PositionMemo.revealed` already is.
 */
import type { SeatId } from './table';

/** One object this event made identifiable, and the seats it made it identifiable to. */
export interface EngineReveal {
  /** The projection's own opaque identity, the same string `ObjectView.oid` carries. */
  readonly oid: string;
  /**
   * Which seats may identify the object from here on.
   *
   * Not "who was shown it once": a reader folds these forward, so an entry is a
   * license that survives the object returning to a hidden zone. Scoped per seat
   * because a reveal made to one seat must not quiet a leak in the other's
   * payload — a hand shown to the table names both seats and says so.
   */
  readonly seats: readonly SeatId[];
}

export interface EngineEvent {
  /** Position in this session's log, from 0, with no gaps. */
  readonly seq: number;
  /** The backend's own tag. An identity to compare, not a union to switch on. */
  readonly type: string;
  /** One sentence, written by the backend, for a person to read. */
  readonly text: string;
  /** The backend's own payload. Opaque to every surface. */
  readonly detail: unknown;
  /** What this event made identifiable, and to whom. Empty when nothing. */
  readonly reveals: readonly EngineReveal[];
}
