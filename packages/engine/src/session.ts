/**
 * The contract itself: a backend opens a session, a session answers questions.
 *
 * Three shapes and one rule. `GameBackend` opens matches. `EngineSession` is one
 * match, as an immutable snapshot. Both split on `determinism`, and the split is
 * argued in `determinism.ts`.
 *
 * # A session is a value, not a handle
 *
 * `submit` returns a *new* session rather than mutating one, which is how
 * `@mtg/kernel`'s session already behaves and is worth keeping across a
 * subprocess boundary rather than losing to it. It costs a foreign backend
 * nothing real: the process is stateful either way, and what comes back is a
 * fresh snapshot of it. What it buys is that holding the previous value still
 * shows what just happened, so the Replay tab's rule — a frame is a value, and
 * stepping back returns the recorded frame rather than a recomputed one — is
 * still available to a surface over any backend.
 *
 * It does mean a stale session can be submitted to. That is `stale-session`
 * territory and the backend reports it as `backend-failure`, because a surface
 * holding two live snapshots of one subprocess has lost track of which one the
 * process is actually standing in.
 *
 * # Everything is asynchronous, and the kernel pays for it
 *
 * A subprocess cannot answer synchronously, so `open` and `submit` return
 * promises and the kernel adapter resolves them immediately. ADR-0001 §9.6 files
 * this under reversible-at-a-price and calls it the largest cost in the
 * amendment: the kernel does not need asynchrony and carries it anyway, and a
 * surface written against awaited decisions does not go back to synchronous ones
 * without a rewrite.
 *
 * # The table's view, and the view that crosses a wire
 *
 * `view`, `events` and `decision` are the *table's*: everything this session
 * knows, for a caller that holds the whole table. That is the right value at one
 * screen and the wrong one to put on a socket. A backend that can remove a
 * seat's hidden information rather than merely decline to draw it carries
 * `seats` as well, and a networked surface sends that. `seats.ts` argues the
 * shape.
 *
 * # Four states, mutually exclusive
 *
 * `status` is the state a session is in, and it is a union rather than three
 * booleans because a surface should be made to handle each: `awaiting` has a
 * `decision`, `finished` has a `result`, `closed` has neither and cannot be
 * submitted to. The kernel's fourth state — paused on a beat — is deliberately
 * not here; a beat is pacing for one person watching one screen, it asks nothing
 * and records nothing, and a contract that carried it would be asking a foreign
 * engine to have an opinion about our pacing controls. A surface that wants
 * beats asks the kernel for them.
 */
import type { PendingDecision } from './decision';
import type { EngineEvent } from './events';
import type { OpenResult, SubmitResult } from './errors';
import type { MoveId } from './decision';
import type { TableView } from './projection';
import type { SeatProjection } from './seats';
import type { MatchResult, SeatId, SessionSpec } from './table';
import type { BackendCapabilities, SessionRecord, TranscriptFrame } from './determinism';

export type SessionStatus = 'awaiting' | 'finished' | 'closed';

/** Everything a session has whatever its determinism is. */
export interface SessionBase {
  /** The backend that owns this match. One backend owns all of it (ADR-0001 §9.2). */
  readonly backend: string;
  readonly table: SessionSpec;
  readonly status: SessionStatus;
  /** The position, projected. Present in every status, including `finished`. */
  readonly view: TableView;
  /** The whole log so far, densely numbered from 0. */
  readonly events: readonly EngineEvent[];
  /** Non-null exactly when `status` is `awaiting`. */
  readonly decision: PendingDecision | null;
  /**
   * The same three values again, per seat, with what that seat may not identify
   * removed rather than merely undrawn.
   *
   * Non-null exactly when this backend declares `perSeatProjection`, which
   * `checkBackend` holds it to in both directions. Null is the honest answer and
   * not a degraded one: a backend that cannot remove hidden information can
   * still run a whole match at one screen, and cannot serve two machines.
   * `seats.ts` argues why this is a nullable member rather than a boolean beside
   * a method, and `ProjectingSession` is how a caller requires one.
   */
  readonly seats: SeatProjection | null;
  /** Non-null exactly when `status` is `finished`. */
  readonly result: MatchResult | null;
  /** How many moves have been submitted. The index of the next one. */
  readonly submitted: number;
  /** Which seats a local player holds, from the spec. */
  readonly localSeats: readonly SeatId[];
  /** Releases whatever the backend is holding. Idempotent. */
  close(): Promise<void>;
}

/**
 * A session whose whole history is its seed and its moves.
 *
 * `record` is a value on the session rather than a method, because it is not a
 * computation: the session already holds the moves it accepted. `fingerprint` is
 * the check that a reproduction actually reproduced — two sessions at the same
 * point in the same game agree on it, and a backend that cannot supply one
 * cannot be on this arm.
 */
export interface RecordedSession extends SessionBase {
  readonly determinism: 'recorded';
  readonly record: SessionRecord;
  /** A digest of the position. Equal digests mean equal positions. */
  readonly fingerprint: string;
  submit(move: MoveId): Promise<SubmitResult<RecordedSession>>;
}

/**
 * A session that can say what happened and cannot promise it would happen again.
 *
 * `transcript` grows by one frame per submitted move. It is the only record this
 * arm has, and `determinism.ts` argues why it is a different kind of value from
 * a record rather than a degraded one.
 */
export interface ObservedSession extends SessionBase {
  readonly determinism: 'observed';
  readonly transcript: readonly TranscriptFrame[];
  submit(move: MoveId): Promise<SubmitResult<ObservedSession>>;
}

export type EngineSession = RecordedSession | ObservedSession;

export interface BackendBase {
  /** Stable identity, written into every record this backend produces. */
  readonly id: string;
  readonly capabilities: BackendCapabilities;
  /**
   * Whether this backend will play this content at all.
   *
   * Returns the reasons it will not, empty when it will. ADR-0001 §9.2 makes
   * this all-or-nothing and requires the refusal to name what is unsupported,
   * so the answer is a list of names and never a boolean.
   */
  supports(table: SessionSpec): Promise<readonly string[]>;
}

export interface RecordedBackend extends BackendBase {
  readonly determinism: 'recorded';
  open(table: SessionSpec): Promise<OpenResult<RecordedSession>>;
  /**
   * Rebuilds a session from a record.
   *
   * The claim is byte-identity: the returned session stands in the same position
   * the original stood in after the same moves, and its `fingerprint` proves it.
   * A record from another backend is refused rather than replayed.
   *
   * Passing a prefix of the moves resumes mid-game, which is what makes this
   * double as both save-and-continue and the rewind that undo is built from.
   */
  reopen(record: SessionRecord): Promise<OpenResult<RecordedSession>>;
}

export interface ObservedBackend extends BackendBase {
  readonly determinism: 'observed';
  open(table: SessionSpec): Promise<OpenResult<ObservedSession>>;
}

export type GameBackend = RecordedBackend | ObservedBackend;

/**
 * Narrows a backend to the recorded arm, for a caller that needs one.
 *
 * A convenience over `backend.determinism === 'recorded'` and nothing more —
 * the point of the discriminant is that the narrowing happens, not that it is
 * spelled a particular way. A caller that can *require* a recorded backend
 * should say so in its signature instead and never reach this.
 */
export function isRecorded(backend: GameBackend): backend is RecordedBackend {
  return backend.determinism === 'recorded';
}

/** The same narrowing for a session. */
export function isRecordedSession(session: EngineSession): session is RecordedSession {
  return session.determinism === 'recorded';
}
