/**
 * The kernel behind `@mtg/engine`'s contract: our engine as one backend among
 * the two ADR-0001 §9 allows.
 *
 * It adapts and adds nothing. Every question goes to `createSession`,
 * `advance`, `choose` and `replaySession`, so there is still exactly one
 * enforcement path and one recording path, and a game played through this
 * adapter is byte-identical to the same game played through the kernel's own
 * API. That is checked rather than claimed: `test/backend.test.ts` plays a game
 * both ways and compares fingerprints.
 *
 * **It sits on the recorded arm, and it is the reason that arm exists.** Seed
 * plus choice list is the whole record here, so `reopen` is `replaySession` and
 * `fingerprint` is `stateFingerprint`. A prefix of the moves lands mid-game,
 * which is what makes the arm's contract with undo and with the parity harness
 * real rather than nominal.
 *
 * **A move id is the option's index, as a string.** That keeps the record the
 * kernel already keeps — `choices` is a list of integers — while giving the
 * contract the opaque token it wants. The cast is the only place the two
 * spellings meet on the read side, `indexOf`; `moveIdOf` is the write side, and
 * it is checked rather than assumed. `GameSession.choices` is `readonly
 * Choice[]`, `number | Action` (`session.ts`, `mtg-y1t.2`), so the type already
 * promises `wrap` may see an `Action` even though nothing in this file can
 * produce one today (the next paragraph says why): `moveIdOf` throws on one
 * rather than stringifying it into a record `reopen` cannot read back
 * (`mtg-2guj`).
 *
 * # Three things this deliberately does not carry across
 *
 * **The constructed-action door.** `chooseAction` takes a move built out of
 * clicks and asks whether it is legal, which is what the MTGO-style board uses
 * for a click-built block. It needs the kernel's action algebra, so it is not in
 * the neutral contract and a surface that wants it holds a `GameSession`
 * (`@mtg/engine`'s `decision.ts` argues why). One consequence follows and it is
 * a real limit: a declaration the enumeration truncated is unreachable through
 * this backend, because the neutral channel offers only what was enumerated.
 *
 * **Beats.** A beat is pacing for one person at one screen: it asks nothing,
 * records nothing, and `SessionOptions` is where it lives precisely because it
 * is not a fact about the position. Putting it in a contract would be asking a
 * foreign engine to have an opinion about our pacing controls. A surface that
 * wants beats asks the kernel for them.
 *
 * **Stops.** Same reason, one step further: `autoPass` is interface policy about
 * which priorities a *person* is asked about, and a backend-neutral session has
 * no opinion on it. The adapter runs at full control, which is also what
 * `replaySession` does and for the same reason — a recording spent under one
 * stop set has to replay identically under another.
 */
import type {
  BackendCapabilities,
  ContentRef,
  DeckRef,
  MoveId,
  OpenResult,
  RecordedBackend,
  RecordedSession,
  SeatId,
  SessionError,
  SessionRecord,
  SessionStatus,
  SubmitResult,
  SessionSpec,
} from '@mtg/engine';
import { simpleAgent } from './simple-agent';
import type { PlayerAgent } from './agent';
import type { Choice, GameSession, Seat } from './session';
import { botSeat, choose, humanSeat, replaySession } from './session';
import type { GameSetup } from './setup';
import { stateFingerprint } from './fork';
import {
  localSeatsOf,
  projectDecision,
  projectEvent,
  projectState,
  seatProjection,
} from './backend-projection';

export const KERNEL_BACKEND_ID = 'kernel';

/**
 * How a table's content becomes a kernel setup.
 *
 * Handed in rather than looked up, because the kernel runs whatever DSL cards it
 * is given and has no opinion about where a set lives — the public-boundary rule
 * that engine code never names set content is the same rule one layer up. A
 * caller that cannot resolve a name says so, and the refusal reaches the surface
 * as `content-unresolved` with the names in it.
 */
export interface ContentResolver {
  resolve(
    content: ContentRef,
    decks: readonly [DeckRef, DeckRef],
    seed: string,
  ):
    | { readonly ok: true; readonly setup: GameSetup }
    | { readonly ok: false; readonly unresolved: readonly string[] };
}

export interface KernelBackendOptions {
  readonly content: ContentResolver;
  /** The agent an `engine`-controlled seat gets. Greedy by default. */
  readonly agentFor?: (seat: SeatId, name: string) => PlayerAgent;
  /** Seed used when the table names none. Stated so the record can hold it. */
  readonly defaultSeed?: string;
}

const CAPABILITIES: BackendCapabilities = {
  // `undoTo` rewinds by replaying a prefix and refuses at a commit boundary.
  undo: true,
  // Immutable state, O(1) fork. This is the property a search bot tier needs.
  fork: true,
  // `visibility.ts` removes what a seat may not identify, and
  // `backend-projection.ts` hands the result out as the neutral projection, so
  // every session below carries a `seats`. `checkBackend` searches the bytes of
  // both seats at every position of a whole game rather than taking this line's
  // word for it.
  perSeatProjection: true,
  engineSeats: true,
};

export function kernelBackend(options: KernelBackendOptions): RecordedBackend {
  const agentFor = options.agentFor ?? ((_seat: SeatId, name: string): PlayerAgent => simpleAgent(name));
  const defaultSeed = options.defaultSeed ?? 'kernel-backend';

  const start = (table: SessionSpec, moves: readonly MoveId[]): OpenResult<RecordedSession> => {
    const seed = table.seed ?? defaultSeed;
    const resolved = options.content.resolve(table.content, [table.seats[0].deck, table.seats[1].deck], seed);
    if (!resolved.ok) {
      return {
        ok: false,
        error: {
          kind: 'content-unresolved',
          message: `the kernel could not resolve ${String(resolved.unresolved.length)} name(s) for this table`,
          unresolved: resolved.unresolved,
        },
      };
    }
    const seats = seatsOf(table, agentFor);
    const indices = moves.map(indexOf);
    const bad = indices.findIndex((index) => index === null);
    if (bad !== -1) {
      return {
        ok: false,
        error: {
          kind: 'unknown-move',
          message: `move ${String(bad)} of the record is not an option index`,
          offered: 0,
        },
      };
    }
    try {
      const session = replaySession(resolved.setup, seats, indices as readonly number[]);
      return { ok: true, session: wrap(resolved.setup, seats, table, seed, session) };
    } catch (cause) {
      return { ok: false, error: replayFailure(cause) };
    }
  };

  return {
    id: KERNEL_BACKEND_ID,
    determinism: 'recorded',
    capabilities: CAPABILITIES,
    supports: (table: SessionSpec): Promise<readonly string[]> =>
      Promise.resolve(
        table.content.kind === 'dsl-set'
          ? []
          : [
              `content kind "${table.content.kind}": the kernel runs DSL cards, and a printed card is not one`,
            ],
      ),
    open: (table: SessionSpec): Promise<OpenResult<RecordedSession>> => Promise.resolve(start(table, [])),
    reopen: (record: SessionRecord): Promise<OpenResult<RecordedSession>> => {
      if (record.backend !== KERNEL_BACKEND_ID) {
        return Promise.resolve({
          ok: false,
          error: {
            kind: 'backend-failure',
            message: `this record was written by "${record.backend}" and its move ids mean nothing here`,
          },
        });
      }
      return Promise.resolve(start({ ...record.table, seed: record.seed }, record.moves));
    },
  };
}

function seatsOf(
  table: SessionSpec,
  agentFor: (seat: SeatId, name: string) => PlayerAgent,
): readonly [Seat, Seat] {
  const one = table.seats[0];
  const two = table.seats[1];
  return [
    one.controller === 'local' ? humanSeat(one.name) : botSeat(agentFor(0, one.name)),
    two.controller === 'local' ? humanSeat(two.name) : botSeat(agentFor(1, two.name)),
  ];
}

/** A move id is an option index rendered as a string, and this is the only reader. */
function indexOf(move: MoveId): number | null {
  if (!/^\d+$/.test(move)) return null;
  return Number.parseInt(move, 10);
}

/**
 * `indexOf`'s inverse: an option index rendered as the move id the neutral
 * contract carries.
 *
 * `session.choices` is `readonly Choice[]` (`session.ts`), and `Choice` was
 * widened to `number | Action` under `mtg-y1t.2` so `chooseAction` can record
 * a declaration no index names. `chooseAction` already prefers an
 * index and writes only the index when one resolves — it is `choose(session,
 * index, …)` that appends to `choices` on that path (`session.ts`, around its
 * `indexOfAction` call) — so an `Action` reaches this function only where none
 * did: a legal declaration the enumeration does not list. Since `mtg-tb7v` that
 * is a whole declaration handed to a decision the kernel is asking one creature
 * or one position at a time, rather than one the cap ran out before; the two are
 * the same fact from this side, which is a move the option list cannot name.
 *
 * `MoveId` is opaque and comes from the backend (`@mtg/engine`'s
 * `decision.ts`): a surface may hold one, compare two and send one back, and
 * may not build one. Inventing a spelling for a kernel `Action` here would put
 * a kernel term in the neutral contract, which that file argues at length is
 * the one thing the fork over `mtg-bc2.151.1` must not do. So there is no
 * honest string for this case, and writing one anyway is exactly what
 * `session.choices.map(String)` used to do — coerce the object to
 * `"[object Object]"`, write it into `record.moves`, and let `indexOf` (`196`)
 * hand back `null` for it the next time anybody tried to `reopen`. This throws
 * instead, at the moment the record would have been written rather than the
 * moment it fails to be read back; both call sites already turn a thrown
 * kernel failure into a `SessionError` (`replayFailure`, used by `start`'s and
 * `submit`'s `catch`), so a surface sees a real refusal rather than a session
 * it can never reopen.
 */
export function moveIdOf(choice: Choice): MoveId {
  if (typeof choice === 'number') return String(choice);
  throw new Error(
    `this session cannot be recorded: a "${choice.type}" declaration the option list does not name has no index, and the neutral contract has no move id for a constructed action`,
  );
}

function replayFailure(cause: unknown): SessionError {
  return {
    kind: 'backend-failure',
    message: `the kernel refused a recorded move: ${cause instanceof Error ? cause.message : String(cause)}`,
  };
}

function wrap(
  setup: GameSetup,
  seats: readonly [Seat, Seat],
  table: SessionSpec,
  seed: string,
  session: GameSession,
  closed = false,
): RecordedSession {
  const status: SessionStatus = closed ? 'closed' : session.result === null ? 'awaiting' : 'finished';
  const decision =
    closed || session.pending === null ? null : projectDecision(session.state, session.pending);
  const moves = session.choices.map(moveIdOf);
  return {
    backend: KERNEL_BACKEND_ID,
    determinism: 'recorded',
    table,
    status,
    view: projectState(session.state, table, localSeatsOf(table)),
    events: session.events.map(projectEvent),
    decision,
    // Built even for a closed session, because closing releases nothing here and
    // a surface reading the final position per seat is reading a real position.
    seats: seatProjection({
      state: session.state,
      events: session.events,
      pending: closed ? null : session.pending,
      table,
      at: session.choices.length,
    }),
    result:
      session.result === null
        ? null
        : {
            winner: session.result.winner,
            reason: session.result.reason,
            endedOnTurn: session.result.endedOnTurn,
          },
    submitted: session.choices.length,
    localSeats: localSeatsOf(table),
    record: { backend: KERNEL_BACKEND_ID, table, seed, moves },
    fingerprint: stateFingerprint(session.state),
    submit: (move: MoveId): Promise<SubmitResult<RecordedSession>> => {
      if (decision === null) {
        return Promise.resolve({
          ok: false,
          error: {
            kind: 'no-decision-pending',
            message: closed ? 'this session is closed' : 'the game is not asking anything',
          },
        });
      }
      const index = indexOf(move);
      if (index === null || index < 0 || index >= decision.options.length) {
        return Promise.resolve({
          ok: false,
          error: {
            kind: 'unknown-move',
            message: `"${move}" is not one of the ${String(decision.options.length)} moves offered`,
            offered: decision.options.length,
          },
        });
      }
      try {
        return Promise.resolve({
          ok: true,
          session: wrap(setup, seats, table, seed, choose(session, index)),
        });
      } catch (cause) {
        return Promise.resolve({ ok: false, error: replayFailure(cause) });
      }
    },
    // Nothing is held: the kernel session is a value and the garbage collector
    // owns it. It is on the contract because a subprocess backend has something
    // to release and a surface must not have to know which kind it is holding.
    close: (): Promise<void> => Promise.resolve(),
  };
}
