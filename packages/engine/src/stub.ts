/**
 * A backend that is not our kernel, so the contract is provably inhabitable by
 * something that is not our kernel.
 *
 * It plays a toy: the table's seats take turns round-robin, each may advance
 * the clock or concede, and the game ends when the clock runs out. It is not
 * Magic and does not pretend to be. Its whole job is to sit on the observed
 * arm and be driven by `checkBackend`, which is a claim about the *contract*
 * rather than about any engine: if the only implementation is the one the
 * contract was written from, the contract is a description of the kernel
 * wearing an interface, and the first foreign backend discovers that the
 * expensive way.
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
 *  5. **A commander table is a table.** The toy seats one: each seat starts on
 *     the rules' life, its named commanders sit in a command zone it projects at
 *     every position, and nothing about the clock changes. That is the least a
 *     backend can do with the variant and it is enough for `checkBackend`'s
 *     command-zone check to have a subject that passes it, beside the ones in
 *     `contract.test.ts` that are rewritten to fail it.
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
import { matchRulesRefusals, perSeat, rulesOf, seatIdsOf } from './table';
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
      Promise.resolve([
        ...(table.content.kind === 'printed'
          ? []
          : [`content kind "${table.content.kind}": this backend plays printed formats only`]),
        ...matchRulesRefusals(table),
      ]),
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
      const rules = matchRulesRefusals(table);
      if (rules.length > 0) {
        return Promise.resolve({
          ok: false,
          error: { kind: 'backend-failure', message: `the table's rules refuse it: ${rules.join('; ')}` },
        });
      }
      return Promise.resolve({
        ok: true,
        session: sessionFor({ table, moves: [], conceded: null }, options),
      });
    },
  };
}

function activeSeat(moves: readonly MoveId[], seatCount: number): SeatId {
  return moves.length % seatCount;
}

/** Who made the move at this position, which is the seat that was active then. */
function moverAt(index: number, seatCount: number): SeatId {
  return index % seatCount;
}

function advances(moves: readonly MoveId[]): number {
  return moves.filter((move) => move === ADVANCE).length;
}

/** How many cards this seat has drawn, which is how many times it advanced. */
function drawnBy(moves: readonly MoveId[], id: SeatId, seatCount: number): number {
  return moves.filter((move, index) => move === ADVANCE && moverAt(index, seatCount) === id).length;
}

function resultOf(toy: Toy, options: ScriptOptions): MatchResult | null {
  if (toy.conceded !== null) {
    const survivors = seatIdsOf(toy.table.seats.length).filter((seat) => seat !== toy.conceded);
    return {
      // Two seats: conceding leaves exactly one survivor, so the toy still
      // names a winner outright, unchanged from before this widening. More
      // than two: one concession does not settle a toy with no combat, so
      // there is nobody left to call the winner.
      winner: survivors.length === 1 ? (survivors[0] ?? null) : null,
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
function handOf(moves: readonly MoveId[], id: SeatId, seatCount: number): readonly ObjectView[] {
  return Array.from({ length: OPENING_HAND + drawnBy(moves, id, seatCount) }, (_unused, at) => ({
    oid: `hand-${String(id)}-${String(at)}`,
    name: `held-${String(id)}-${String(at)}`,
    typeLine: 'Token',
    power: null,
    toughness: null,
    tapped: false,
    attacking: false,
    damage: 0,
    controller: id,
    counters: {},
  }));
}

/**
 * The command zone, on a commander table: the named commanders, which the toy
 * never casts, so they sit there for the whole game.
 */
function commandZoneOf(
  table: SessionSpec,
  id: SeatId,
): Pick<SeatView, 'commandZone' | 'commanderDamage' | 'commanderCasts'> {
  if (rulesOf(table).variant !== 'commander') return {};
  const commanders = table.seats[id]?.deck.commanders ?? [];
  return {
    commandZone: commanders.map((slot, at) => ({
      oid: `command-${String(id)}-${String(at)}`,
      name: slot.name,
      typeLine: 'Legendary Creature',
      power: null,
      toughness: null,
      tapped: false,
      attacking: false,
      damage: 0,
      controller: id,
      counters: {},
    })),
    commanderDamage: {},
    commanderCasts: Object.fromEntries(commanders.map((_, at) => [`command-${String(id)}-${String(at)}`, 0])),
  };
}

function avatarsOf(table: SessionSpec, id: SeatId): Pick<SeatView, 'avatars'> {
  if (rulesOf(table).variant !== 'momir') return {};
  return {
    avatars: [
      {
        oid: `avatar-${String(id)}`,
        name: 'Momir Vig, Simic Visionary Avatar',
        typeLine: 'Vanguard',
        power: null,
        toughness: null,
        tapped: false,
        attacking: false,
        damage: 0,
        controller: id,
        counters: {},
      },
    ],
  };
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
  // Unreachable: every call site draws `id` from
  // `seatIdsOf(toy.table.seats.length)`.
  if (spec === undefined) throw new Error(`seatView: table has no seat ${String(id)}`);
  const seatCount = toy.table.seats.length;
  const mine = viewer === null ? spec.controller === 'local' : viewer === id;
  const drawn = drawnBy(toy.moves, id, seatCount);
  return {
    id,
    name: spec.name,
    life: rulesOf(toy.table).startingLife,
    hand: mine ? handOf(toy.moves, id, seatCount) : null,
    handSize: OPENING_HAND + drawn,
    librarySize: LIBRARY_SIZE - drawn,
    graveyard: [],
    exile: [],
    battlefield: [],
    ...commandZoneOf(toy.table, id),
    ...avatarsOf(toy.table, id),
  };
}

function viewOf(toy: Toy, viewer: SeatId | null = null): TableView {
  const seatCount = toy.table.seats.length;
  const turn = advances(toy.moves) + 1;
  return {
    version: PROJECTION_VERSION,
    turn: { number: turn, active: activeSeat(toy.moves, seatCount), phase: 'main', step: 'main' },
    priority: activeSeat(toy.moves, seatCount),
    stack: [],
    seats: perSeat(seatIdsOf(seatCount).map((id) => seatView(toy, id, viewer))),
  };
}

function eventsOf(toy: Toy): readonly EngineEvent[] {
  const seatCount = toy.table.seats.length;
  return toy.moves.map((move, seq) => {
    const mover = moverAt(seq, seatCount);
    const moverName = toy.table.seats[mover]?.name ?? `seat ${String(mover)}`;
    return {
      seq,
      type: move === ADVANCE ? 'clockAdvanced' : 'conceded',
      text: `${moverName} ${move === ADVANCE ? 'advanced the clock' : 'conceded'}`,
      detail: { move, seat: mover },
      // The toy shows nobody anything. Its cards are dealt face down and stay
      // there, and the clock is public without naming an object, so every event it
      // emits reveals nothing — which is the answer most events give and the
      // reason the empty array is a real answer rather than a placeholder.
      reveals: [],
    };
  });
}

function decisionOf(toy: Toy, result: MatchResult | null, options: ScriptOptions): PendingDecision | null {
  if (result !== null) return null;
  const seat = activeSeat(toy.moves, toy.table.seats.length);
  const seatName = toy.table.seats[seat]?.name ?? `seat ${String(seat)}`;
  return {
    seat,
    kind: 'toy',
    prompt: `${seatName}, advance the clock or concede`,
    options: [
      { id: ADVANCE, text: 'Advance the clock', targets: [] },
      { id: CONCEDE, text: 'Concede', targets: [] },
    ],
    complete: !(options.truncate ?? false),
  };
}

function transcriptOf(toy: Toy): readonly TranscriptFrame[] {
  const seatCount = toy.table.seats.length;
  const frames: TranscriptFrame[] = [];
  for (let taken = 0; taken <= toy.moves.length; taken += 1) {
    const moves = toy.moves.slice(0, taken);
    const upTo: Toy = { ...toy, moves, conceded: concededIn(moves, seatCount) };
    frames.push({
      seq: taken,
      view: viewOf(upTo),
      events: eventsOf(upTo),
      move: taken === 0 ? null : (toy.moves[taken - 1] ?? null),
    });
  }
  return frames;
}

/** Which seats a person is holding. */
function localSeatsOf(table: SessionSpec): readonly SeatId[] {
  return seatIdsOf(table.seats.length).filter((seat) => table.seats[seat]?.controller === 'local');
}

function concededIn(moves: readonly MoveId[], seatCount: number): SeatId | null {
  const at = moves.indexOf(CONCEDE);
  if (at === -1) return null;
  return moverAt(at, seatCount);
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
        session: sessionFor({ ...toy, moves, conceded: concededIn(moves, toy.table.seats.length) }, options),
      });
    },
    close: (): Promise<void> => Promise.resolve(),
  };
}
