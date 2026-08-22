/**
 * The one authority: a live session, and a snapshot per seat.
 *
 * # Why the server holds the session at all
 *
 * Because that is the only place concealment can happen. `@mtg/ui` hides the
 * other hand at the projection layer, which is honest between two people at one
 * screen and is nothing at all across a network. A table hands each seat a
 * position that has been through `seatState`, so what a player is not entitled
 * to see is not in the bytes their browser received.
 *
 * # Why this does not go through `@mtg/engine`'s `SeatProjection`
 *
 * The contract grew a per-seat projector (`seats.ts`) and the obvious next move
 * is to rewrite this file onto it. It is the wrong move, and the reason is the
 * payload rather than the concealment.
 *
 * The concealment is already one implementation and always was. `seatState` and
 * `seatEvents` are `@mtg/kernel`'s, they own the CR 400.2 answer, and both this
 * file and `backend-projection.ts` call them. What is doubled here is two lines
 * of assembly: the delivery key, and the rule that an enumeration goes to the
 * seat that owes it.
 *
 * The payloads are a different matter. `SeatProjection` answers in `TableView`,
 * which is thin on purpose — a name, a type line, power and toughness, tapped,
 * damage, counters. A seat here is sent a `GameState`, and the page drawing it
 * reads mana pools, combat, exile, a pending scry, the step as a step rather
 * than as a string, and the whole DSL card behind every object, because it
 * renders a card face. Moving the wire onto the projection is not a refactor of
 * this file; it is a smaller game with the same tests around it.
 *
 * And it would weaken the check while looking like the opposite.
 * `test/hidden-information.test.ts` searches the bytes this table actually
 * sends. `@mtg/engine`'s `auditSeatPayloads` searches a projection, which is
 * lossy against the state it came from, so a concealed card's rules text can be
 * absent from the one and present in the other. A test rewritten onto the
 * neutral search would be green about a payload nobody sends.
 *
 * # Where the salt enters, and why a replay stays byte-identical
 *
 * One line: `projectionSalt`, a `randomUUID` taken once per table and prefixed
 * onto the delivery key. Everything after the prefix is derived from the
 * position — the revision and the seat — which is the rule
 * `backend-projection.ts` applies with no prefix at all (`at:<n>:seat:<n>`).
 *
 * The two properties do not trade against each other, because they are claims
 * about different things. A replay reproduces a *session*, and the kernel's
 * projector keys on moves submitted, so the same moves redraw the same
 * placeholders and a recorded game is reproducible down to its bytes. A server
 * hands out *deliveries*, and a table rebuilt from its recording is a new table
 * with a new salt, so a server restart cannot be used to go on tracking a
 * face-down card across it. `test/reconnection.test.ts` asserts both halves: the
 * two tables agree about every public fact, and their placeholders differ.
 *
 * # The three things a seat can do, and the one thing it cannot
 *
 * A seat submits an index, a yield, or a change to its own auto-pass. There is
 * no fourth door and in particular there is no door that takes a *move*: the
 * index addresses `session.pending.options`, which the server built from its own
 * state, and the server checks that the seat asking is the seat being asked
 * before it spends anything. Legality is never a question a client gets to have
 * an opinion about; it is answered where it always was, by the enumeration.
 *
 * # Bots belong to whoever owns the game
 *
 * They ran inline in the client because the client owned the session. Now the
 * server does, so `advance` plays them here, on the far side of the wire, and a
 * mixed game needs no special case at all: a bot seat has no token, nobody polls
 * for it, and its decisions land inside the same `advance` that settles every
 * other one. A two-human table is the same object with two tokens and no agents.
 *
 * # A table is rebuildable, because a game is a seed and a list of integers
 *
 * `record` returns exactly that, and `createTable` takes it back. A process that
 * died mid-game is not a lost game: the same spec plus the same choices replays
 * to the same position, byte for byte, which is `replaySession`'s own claim and
 * is asserted in `test/reconnection.test.ts` rather than assumed here.
 *
 * # What is deliberately not here
 *
 * **Undo.** `undoTo` rewinds by replaying a shorter prefix, and in a two-player
 * game that prefix contains the opponent's decisions as well. Taking those back
 * needs both players to agree, which is a protocol nobody has designed, so a
 * table refuses rather than quietly rewinding somebody else's turn. The hot-seat
 * surface keeps its own undo untouched.
 */
import { randomUUID } from 'node:crypto';
import type {
  AutoPassSettings,
  Choice,
  GameSession,
  GameSetup,
  PlayerId,
  Seat,
  SessionOptions,
} from '@mtg/kernel';
import {
  advance,
  choose,
  chooseAction,
  DEFAULT_AUTO_PASS,
  replaySession,
  seatEvents,
  seatState,
  yieldPriority,
} from '@mtg/kernel';
import type { SeatRefusal, SeatRequest, SeatSnapshot } from './protocol';
import { fromWireAutoPass, NETPLAY_PROTOCOL, toWireAutoPass } from './protocol';

/** One seat's public name and the capability that addresses it. */
export interface TableSeating {
  readonly name: string;
  /**
   * The unguessable path segment that *is* this seat.
   *
   * Null for a bot, which nobody sits at. This is a capability and not an
   * account: whoever holds the link is that seat, there is nothing to log into,
   * and the bead states no-accounts as a non-goal. What it buys over naming a
   * seat in a query string is the thing that actually matters at a kitchen
   * table — one player cannot open the other player's board by editing a `0` to
   * a `1`.
   */
  readonly token: string | null;
}

export interface TableSpec {
  readonly id: string;
  readonly setup: GameSetup;
  readonly seats: readonly [Seat, Seat];
  readonly seating: readonly [TableSeating, TableSeating];
  /** A recording to replay on creation; this is how a table comes back. */
  readonly choices?: readonly Choice[] | undefined;
}

/** Everything needed to build this table again somewhere else. */
export interface TableRecord {
  readonly id: string;
  readonly choices: readonly Choice[];
}

export interface Table {
  readonly id: string;
  /** Which seat this capability addresses, or null when it addresses none. */
  seatOf(token: string): PlayerId | null;
  snapshotFor(seat: PlayerId): SeatSnapshot;
  /** Null when it was applied; a refusal, with the server's counter, when not. */
  apply(seat: PlayerId, request: SeatRequest): SeatRefusal | null;
  record(): TableRecord;
  /** Runs on every change. Returns the way to stop listening. */
  watch(listener: () => void): () => void;
  /**
   * Bumped on every change, so a held poll knows whether it missed one.
   *
   * Per process and not part of the game: a rebuilt table starts at zero on the
   * same position, which is right, because a client that reconnects to a
   * restarted server has to be told the position again from scratch.
   */
  readonly revision: number;
}

export function createTable(spec: TableSpec): Table {
  const names: readonly [string, string] = [spec.seating[0].name, spec.seating[1].name];
  let auto: readonly [AutoPassSettings, AutoPassSettings] = [DEFAULT_AUTO_PASS, DEFAULT_AUTO_PASS];
  let revision = 0;
  const projectionSalt = randomUUID();
  const listeners = new Set<() => void>();

  const options = (): SessionOptions => ({ seatAutoPass: auto });

  /**
   * The recording is spent at full control and the tail is settled under the
   * seats' own preferences, which is the same ordering `usePlaySession` uses and
   * for the same reason: an auto-passed priority is already an integer in the
   * list, so replaying it under auto-pass would consume the decision without
   * consuming the integer that recorded it.
   */
  let session: GameSession = advance(replaySession(spec.setup, spec.seats, spec.choices ?? []), options());

  function announce(): void {
    revision += 1;
    for (const listener of listeners) listener();
  }

  function refuse(why: string): SeatRefusal {
    return { refused: why, at: session.decisions };
  }

  /**
   * Every path that moves the session, wrapped once.
   *
   * A throw here is a bug on this side of the wire rather than an illegal move —
   * the index came out of an enumeration this process built one message ago — so
   * it becomes a refusal the client can read instead of a dead connection and a
   * table nobody can rejoin.
   */
  function move(next: (current: GameSession) => GameSession): SeatRefusal | null {
    let moved: GameSession;
    try {
      moved = next(session);
    } catch (cause: unknown) {
      return refuse(cause instanceof Error ? cause.message : String(cause));
    }
    session = moved;
    announce();
    return null;
  }

  function owes(seat: PlayerId, at: number): SeatRefusal | null {
    const decision = session.pending;
    if (decision === null) {
      return refuse(
        session.result === null
          ? 'the table is not waiting on a decision'
          : 'the game is over, so there is nothing left to answer',
      );
    }
    if (decision.player !== seat) return refuse(`the next decision belongs to ${names[decision.player]}`);
    // The stale click. Refused rather than applied, because the index addressed
    // an enumeration that no longer exists and spending it would make a legal
    // move nobody chose.
    if (at !== session.decisions) return refuse('that decision has already been answered');
    return null;
  }

  return {
    id: spec.id,

    get revision(): number {
      return revision;
    },

    seatOf(token: string): PlayerId | null {
      if (token.length === 0) return null;
      if (spec.seating[0].token === token) return 0;
      if (spec.seating[1].token === token) return 1;
      return null;
    },

    snapshotFor(seat: PlayerId): SeatSnapshot {
      const pending = session.pending;
      const projectionKey = `${projectionSalt}:${String(revision)}:${String(seat)}`;
      return {
        protocol: NETPLAY_PROTOCOL,
        tableId: spec.id,
        seat,
        names,
        revision,
        state: seatState(session.state, seat, projectionKey),
        // The log goes through concealment too. Most of it needs nothing —
        // an event names an object by id and the id identifies nothing once the
        // object is gone — but `gameStarted` carries the seed, and the seed is
        // both libraries in four words. A payload test found that; `seatEvents`
        // is where it is closed.
        events: seatEvents(session.events, seat, projectionKey),
        // The enumeration goes to the seat that owes it and to nobody else. A
        // discard decision names the cards in a hand, and an option list is a
        // shorter road to the same leak the state would have been.
        pending: pending !== null && pending.player === seat ? pending : null,
        result: session.result,
        decisions: session.decisions,
        choices: { length: session.choices.length },
        awaiting: pending?.player ?? null,
        autoPass: toWireAutoPass(auto[seat]),
      };
    },

    apply(seat: PlayerId, request: SeatRequest): SeatRefusal | null {
      if (request.kind === 'autoPass') {
        const settings = fromWireAutoPass(request.autoPass);
        auto = seat === 0 ? [settings, auto[1]] : [auto[0], settings];
        // Re-settled rather than left until the next click, exactly as the
        // hot-seat surface does it: turning stops off while sitting on a
        // priority nobody has anything to do with should move the game on.
        return move((current) => advance(current, options()));
      }
      const refusal = owes(seat, request.at);
      if (refusal !== null) return refusal;
      if (request.kind === 'yield') {
        return move((current) => yieldPriority(current, request.boundary, options()));
      }
      if (request.kind === 'declare') {
        // The seat comes from the connection rather than the body, so a client
        // cannot declare for the other player (`readDeclaration` argues it).
        // Legality is `chooseAction`'s, which re-derives it from the position
        // and prefers the enumerated index where the move has one, so a
        // declaration that fits under the cap is recorded exactly as a `choose`
        // of the same move would have recorded it.
        return move((current) => chooseAction(current, { ...request.declaration, player: seat }, options()));
      }
      const offered = session.pending?.options.length ?? 0;
      if (request.index >= offered) {
        return refuse(`choice ${String(request.index)} is outside the ${String(offered)} options offered`);
      }
      return move((current) => choose(current, request.index, options()));
    },

    record(): TableRecord {
      return { id: spec.id, choices: session.choices };
    },

    watch(listener: () => void): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
