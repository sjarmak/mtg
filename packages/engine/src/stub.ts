/**
 * A backend that is not our kernel, so the contract is provably inhabitable by
 * something that is not our kernel.
 *
 * It plays a toy: two seats alternate, each may advance the clock or concede,
 * and the game ends when the clock runs out. It is not Magic and does not
 * pretend to be. Its whole job is to sit on the observed arm and be driven by
 * `checkBackend`, which is a claim about the *contract* rather than about any
 * engine: if the only implementation is the one the contract was written from,
 * the contract is a description of the kernel wearing an interface, and the
 * first foreign backend discovers that the expensive way.
 *
 * Four things it demonstrates that the kernel adapter cannot:
 *
 *  1. **The observed arm is reachable.** No record, no fingerprint, a transcript
 *     instead, and every surface that wants a reproduction has to notice.
 *  2. **`supports` refuses by name.** It plays `printed` content and not
 *     `dsl-set`, which is the mirror image of the kernel's answer, and the
 *     refusal is a list of reasons rather than a boolean (ADR-0001 §9.2).
 *  3. **Nothing in the contract needs `@mtg/kernel`.** This package imports it
 *     nowhere, which is checked by the import graph rather than promised here.
 *  4. **Per-seat projection is a property of the seam and not of our
 *     concealment code.** The toy deals each seat two cards it alone may
 *     identify and removes the other seat's from the payload — three lines,
 *     nothing like `visibility.ts`, and enough for `checkBackend`'s payload
 *     search to have something to find. `perSeat: false` turns it off, so both
 *     sides of the declaration have a subject.
 *
 * The clock also draws. Advancing it moves one card out of the advancing seat's
 * library and into its hand, which is the smallest thing that is a library at
 * all: the conformance suite checks library concealment by asking what came out
 * of one, so a toy whose `librarySize` were a decorative counter would leave that
 * check with no subject outside the kernel it was written from.
 *
 * A deliberate non-goal: this is not a fixture backend for testing surfaces
 * against. A surface driven by a toy would be tested against a toy. It exists
 * for the conformance suite and for the argument above.
 */
import type { MoveId, PendingDecision } from './decision';
import type { EngineEvent } from './events';
import type { OpenResult, SubmitResult } from './errors';
import type { ObservedBackend, ObservedSession, SessionStatus } from './session';
import type { TranscriptFrame } from './determinism';
import type { MatchResult, SeatId, SessionSpec } from './table';
import type { ObjectView, SeatView, TableView } from './projection';
import type { SeatProjection } from './seats';
import { PROJECTION_VERSION } from './projection';

const ADVANCE: MoveId = 'advance';
const CONCEDE: MoveId = 'concede';

export interface ScriptOptions {
  /** How many advances end the game. The clock, in moves. */
  readonly clock: number;
  /** Whether the toy projects per seat. True by default; false is the other subject. */
  readonly perSeat?: boolean;
  /**
   * Whether the toy hands out a list it has already said is not the list.
   *
   * False by default, and there is no honest reason for a backend to set it: two
   * options is not a space anything could have truncated. It exists because
   * `decision.ts` concludes that `complete: false` is a non-conformance rather
   * than a fact to carry, and a check with no subject outside the engine it was
   * written from is a check nobody has run. `@mtg/kernel` truncates for real, on
   * boards this package may not import; this is the same admission, made by a
   * backend that is not our kernel, so `checkBackend`'s finding is demonstrated
   * rather than asserted.
   */
  readonly truncate?: boolean;
}

const DEFAULT_OPTIONS: ScriptOptions = { clock: 6 };

/** How many cards a seat is dealt before the first move. */
const OPENING_HAND = 2;

/** How many cards a seat's library starts with, big enough to outlast any clock. */
const LIBRARY_SIZE = 40;

/** The whole of this backend's position. */
interface Toy {
  readonly table: SessionSpec;
  readonly moves: readonly MoveId[];
  readonly conceded: SeatId | null;
}

export function scriptBackend(options: ScriptOptions = DEFAULT_OPTIONS): ObservedBackend {
  return {
    id: 'script',
    determinism: 'observed',
    capabilities: {
      undo: false,
      fork: false,
      perSeatProjection: options.perSeat ?? true,
      engineSeats: true,
    },
    supports: (table: SessionSpec): Promise<readonly string[]> =>
      Promise.resolve(
        table.content.kind === 'printed'
          ? []
          : [`content kind "${table.content.kind}": this backend plays printed formats only`],
      ),
    open: (table: SessionSpec): Promise<OpenResult<ObservedSession>> => {
      const refusals = table.content.kind === 'printed' ? [] : [`content kind "${table.content.kind}"`];
      if (refusals.length > 0) {
        return Promise.resolve({
          ok: false,
          error: {
            kind: 'content-unresolved',
            message: 'this backend plays printed formats only',
            unresolved: refusals,
          },
        });
      }
      return Promise.resolve({
        ok: true,
        session: sessionFor({ table, moves: [], conceded: null }, options),
      });
    },
  };
}

function activeSeat(moves: readonly MoveId[]): SeatId {
  return moves.length % 2 === 0 ? 0 : 1;
}

/** Who made the move at this position, which is the seat that was active then. */
function moverAt(index: number): SeatId {
  return index % 2 === 0 ? 0 : 1;
}

function advances(moves: readonly MoveId[]): number {
  return moves.filter((move) => move === ADVANCE).length;
}

/** How many cards this seat has drawn, which is how many times it advanced. */
function drawnBy(moves: readonly MoveId[], id: SeatId): number {
  return moves.filter((move, index) => move === ADVANCE && moverAt(index) === id).length;
}

function resultOf(toy: Toy, options: ScriptOptions): MatchResult | null {
  if (toy.conceded !== null) {
    return {
      winner: toy.conceded === 0 ? 1 : 0,
      reason: 'concession',
      endedOnTurn: advances(toy.moves) + 1,
    };
  }
  if (advances(toy.moves) >= options.clock) {
    return { winner: null, reason: 'the clock ran out', endedOnTurn: options.clock };
  }
  return null;
}

/**
 * The cards a seat holds, named so that one string identifies one object.
 *
 * Lowercase and hyphenated rather than title case: this is a toy and its cards
 * are not cards, so giving them names shaped like printed ones would put
 * invented card names into a workspace that keeps a census of exactly that.
 *
 * The opening two, then one per advance. A drawn card's id follows from the
 * count alone, which is what makes the toy's library a library the conformance
 * suite can reason about at all: the card at position `k` was in the library
 * until the `k`th draw and is in the hand afterwards.
 */
function handOf(moves: readonly MoveId[], id: SeatId): readonly ObjectView[] {
  return Array.from({ length: OPENING_HAND + drawnBy(moves, id) }, (_unused, at) => ({
    oid: `hand-${String(id)}-${String(at)}`,
    name: `held-${String(id)}-${String(at)}`,
    typeLine: 'Token',
    power: null,
    toughness: null,
    tapped: false,
    damage: 0,
    controller: id,
    counters: {},
  }));
}

/**
 * One seat as some viewer may see it.
 *
 * `viewer` is null for the table's own view, which shows a seat's hand when a
 * person at this screen is holding it, and the seat itself for a per-seat view,
 * which shows one hand and removes the other outright.
 */
function seatView(toy: Toy, id: SeatId, viewer: SeatId | null): SeatView {
  const spec = toy.table.seats[id];
  const mine = viewer === null ? spec.controller === 'local' : viewer === id;
  const drawn = drawnBy(toy.moves, id);
  return {
    id,
    name: spec.name,
    life: 20,
    hand: mine ? handOf(toy.moves, id) : null,
    handSize: OPENING_HAND + drawn,
    librarySize: LIBRARY_SIZE - drawn,
    graveyard: [],
    battlefield: [],
  };
}

function viewOf(toy: Toy, viewer: SeatId | null = null): TableView {
  const turn = advances(toy.moves) + 1;
  return {
    version: PROJECTION_VERSION,
    turn: { number: turn, active: activeSeat(toy.moves), phase: 'main', step: 'main' },
    priority: activeSeat(toy.moves),
    stack: [],
    seats: [seatView(toy, 0, viewer), seatView(toy, 1, viewer)],
  };
}

function eventsOf(toy: Toy): readonly EngineEvent[] {
  return toy.moves.map((move, seq) => ({
    seq,
    type: move === ADVANCE ? 'clockAdvanced' : 'conceded',
    text: `${toy.table.seats[moverAt(seq)].name} ${move === ADVANCE ? 'advanced the clock' : 'conceded'}`,
    detail: { move, seat: moverAt(seq) },
    // The toy shows nobody anything. Its cards are dealt face down and stay
    // there, and the clock is public without naming an object, so every event it
    // emits reveals nothing — which is the answer most events give and the
    // reason the empty array is a real answer rather than a placeholder.
    reveals: [],
  }));
}

function decisionOf(toy: Toy, result: MatchResult | null, options: ScriptOptions): PendingDecision | null {
  if (result !== null) return null;
  const seat = activeSeat(toy.moves);
  return {
    seat,
    kind: 'toy',
    prompt: `${toy.table.seats[seat].name}, advance the clock or concede`,
    options: [
      { id: ADVANCE, text: 'Advance the clock', targets: [] },
      { id: CONCEDE, text: 'Concede', targets: [] },
    ],
    complete: !(options.truncate ?? false),
  };
}

function transcriptOf(toy: Toy): readonly TranscriptFrame[] {
  const frames: TranscriptFrame[] = [];
  for (let taken = 0; taken <= toy.moves.length; taken += 1) {
    const moves = toy.moves.slice(0, taken);
    const upTo: Toy = { ...toy, moves, conceded: concededIn(moves) };
    frames.push({
      seq: taken,
      view: viewOf(upTo),
      events: eventsOf(upTo),
      move: taken === 0 ? null : (toy.moves[taken - 1] ?? null),
    });
  }
  return frames;
}

/** Which seats a person is holding, as the tuple positions they are. */
function localSeatsOf(table: SessionSpec): readonly SeatId[] {
  const seated: SeatId[] = [];
  if (table.seats[0].controller === 'local') seated.push(0);
  if (table.seats[1].controller === 'local') seated.push(1);
  return seated;
}

function concededIn(moves: readonly MoveId[]): SeatId | null {
  const at = moves.indexOf(CONCEDE);
  if (at === -1) return null;
  return moverAt(at);
}

/**
 * What each seat is sent, which is the table's view with one hand removed.
 *
 * Nothing else in the toy needs removing, because nothing else in the toy is
 * hidden information a payload could carry. The libraries are counts and a
 * naming rule, never a list, so there is no list to drop; no log entry names a
 * card. A real backend's answer is its own and will be longer.
 */
function seatsOf(toy: Toy, decision: PendingDecision | null): SeatProjection {
  return {
    view: (seat: SeatId): TableView => viewOf(toy, seat),
    events: (_seat: SeatId): readonly EngineEvent[] => eventsOf(toy),
    decision: (seat: SeatId): PendingDecision | null =>
      decision !== null && decision.seat === seat ? decision : null,
  };
}

function sessionFor(toy: Toy, options: ScriptOptions, closed = false): ObservedSession {
  const result = resultOf(toy, options);
  const status: SessionStatus = closed ? 'closed' : result === null ? 'awaiting' : 'finished';
  const decision = closed ? null : decisionOf(toy, result, options);
  return {
    backend: 'script',
    determinism: 'observed',
    table: toy.table,
    status,
    view: viewOf(toy),
    events: eventsOf(toy),
    decision,
    result,
    seats: (options.perSeat ?? true) ? seatsOf(toy, decision) : null,
    submitted: toy.moves.length,
    localSeats: localSeatsOf(toy.table),
    transcript: transcriptOf(toy),
    submit: (move: MoveId): Promise<SubmitResult<ObservedSession>> => {
      if (decision === null) {
        return Promise.resolve({
          ok: false,
          error: { kind: 'no-decision-pending', message: 'the toy game is over' },
        });
      }
      if (!decision.options.some((option) => option.id === move)) {
        return Promise.resolve({
          ok: false,
          error: {
            kind: 'unknown-move',
            message: `"${move}" is not one of the moves offered`,
            offered: decision.options.length,
          },
        });
      }
      const moves = [...toy.moves, move];
      return Promise.resolve({
        ok: true,
        session: sessionFor({ ...toy, moves, conceded: concededIn(moves) }, options),
      });
    },
    close: (): Promise<void> => Promise.resolve(),
  };
}
