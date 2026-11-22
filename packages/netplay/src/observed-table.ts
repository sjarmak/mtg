/**
 * One observed session, N seats, one server holding the session for all of them.
 *
 * `table.ts` relays a kernel game and `backend-gateway.ts` hands one browser a
 * whole observed session; this is the third arrangement the LAN needs, a
 * session opened once behind one seat token per seat, where each seat is sent
 * `ObservedSession.seats` for itself and nothing of the other. The backend
 * has to declare `perSeatProjection`, and `createObservedDealer` refuses one
 * that does not at construction rather than leaking at the first frame.
 *
 * A table is born in `seating`, where each seat submits a deck it built from
 * its own pool seed, opens the backend when both are in, plays until the
 * backend reports a result or a seat leaves, and ends on a timer when nobody
 * comes: `OBSERVED_SEATING_MS` for a deck that never arrives and
 * `OBSERVED_DISCONNECT_MS` for a seat that stops polling. Every timer runs on
 * the injected clock, so `observed-table.test.ts` turns the hands by itself.
 *
 * `onFinished` is the one seam a recorder needs: an `ObservedTableCapture`, the
 * unprojected transcript beside the table that was opened, which seats were
 * local and the result, handed over exactly once when the table finishes. It is
 * optional and unused by default; nothing here writes a file.
 */
import { createHash, randomUUID } from 'node:crypto';
import type {
  DeckRef,
  MatchResult,
  MoveId,
  ObservedBackend,
  ObservedSession,
  SeatId,
  SessionSpec,
  TranscriptFrame,
} from '@mtg/engine';
import { MIN_SEATS, describeSessionError, perSeat, seatIdsOf, seatSpecOf } from '@mtg/engine';
import { poolSeedFor } from './deal';
import type {
  ObservedEndReason,
  ObservedOpenRequest,
  ObservedPhase,
  ObservedSeatFrame,
} from './observed-protocol';
import {
  MAX_OBSERVED_TABLES,
  OBSERVED_DISCONNECT_MS,
  OBSERVED_SEATING_MS,
  OBSERVED_TABLE_PROTOCOL,
  playFor,
} from './observed-protocol';
import type { SeatRefusal, TableInvite } from './protocol';

export const OBSERVED_SEAT_NAMES: readonly [string, string] = ['Host', 'Guest'];

/** What seat `seat` is called: the host, the guest, then by place at the pod. */
export function observedSeatName(seat: LobbySeat): string {
  return OBSERVED_SEAT_NAMES[seat] ?? `Player ${String(seat + 1)}`;
}

/** A seat of this lobby: the contract's seat number, which a table of any size counts from zero. */
export type LobbySeat = SeatId;

/** One token per seat, in seat order; a table has at least `MIN_SEATS`. */
export type SeatTokens = readonly [string, string, ...string[]];

/** The clock every timer here runs on; the real one by default, a fake one under test. */
export interface ObservedClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * What a recorder is handed when a table finishes: the whole game, unprojected.
 *
 * The shape is the one a gameplay recorder takes for an observed session, so
 * the caller adds a `source` and records it (`./gameplay.ts` is where that
 * `source` is added, and it names this type rather than restating it); both
 * decks are `table.seats[i].deck` and the rules are `rulesOf(table)`, which is
 * why neither is repeated here.
 */
export interface ObservedTableCapture {
  readonly backend: string;
  readonly table: SessionSpec;
  readonly localSeats: readonly SeatId[];
  readonly transcript: readonly TranscriptFrame[];
  readonly result: MatchResult;
}

export interface ObservedTableOptions {
  readonly backend: ObservedBackend;
  readonly clock?: ObservedClock;
  readonly mint?: () => string;
  /**
   * The links the host may hand out for a table, built by whoever knows this
   * machine's addresses and the page's port; absent means the invite route
   * answers 404, the way a kernel table started without links does.
   */
  readonly invite?: (table: ObservedTable, tokens: SeatTokens) => TableInvite;
  /** Called exactly once per table, when it reaches a result. Absent by default. */
  readonly onFinished?: (capture: ObservedTableCapture) => void;
  /**
   * Called exactly once per table, when it ends without a result (backend
   * failure, timeout, disconnect, a seat leaving before play, or an explicit
   * close). Absent by default. mtg-72fjo: both seats already learn of an
   * `ended` table through their own polled frame (`phaseFor`'s `'ended'`
   * case), but nothing before this wrote the failure anywhere the launcher's
   * own log could show it, so a backend exception mid-game looked like a
   * silent wedge instead of a visible, logged error.
   */
  readonly onEnded?: (table: ObservedTable, reason: ObservedEndReason, message: string) => void;
}

export type ObservedOpenRefusalCode = 'unknown-format' | 'table-limit';

export type ObservedOpenOutcome =
  | { readonly ok: true; readonly table: ObservedTable; readonly tokens: SeatTokens }
  | { readonly ok: false; readonly code: ObservedOpenRefusalCode; readonly refused: string };

export interface ObservedDealer {
  readonly formats: readonly string[];
  open(request: ObservedOpenRequest): Promise<ObservedOpenOutcome>;
  find(token: string): { readonly table: ObservedTable; readonly seat: LobbySeat } | null;
  /** Tables holding a slot: seating or playing. */
  readonly live: number;
  close(): Promise<void>;
}

type State =
  | {
      readonly kind: 'seating';
      readonly decks: readonly (DeckRef | null)[];
      readonly opening: boolean;
    }
  | { readonly kind: 'playing'; readonly session: ObservedSession; readonly busy: boolean }
  | { readonly kind: 'finished'; readonly session: ObservedSession; readonly result: MatchResult }
  | { readonly kind: 'ended'; readonly reason: ObservedEndReason; readonly message: string };

const DEFAULT_CLOCK: ObservedClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The seed one seat opens its pool from: a digest, so neither seat can read
 * the match seed or the other seat's pool seed out of its own.
 */
function observedPoolSeed(seed: string, seat: LobbySeat): string {
  return createHash('sha256')
    .update(poolSeedFor(`${seed}/observed-pool`, seat))
    .digest('hex');
}

function isFatal(kind: string): boolean {
  return kind === 'backend-failure' || kind === 'timeout';
}

export class ObservedTable {
  readonly id: string;
  /** How many seats this table was opened with. */
  readonly seatCount: number;
  readonly request: ObservedOpenRequest;
  readonly poolSeeds: readonly string[];
  /** Which seats have ever read a frame; the host's invite panel reads it. */
  readonly joined = new Set<LobbySeat>();
  /** The host's links, filled in by the dealer once the tokens exist. */
  invite: TableInvite | undefined = undefined;
  private state: State;
  private revisionCounter = 0;
  private readonly listeners = new Set<() => void>();
  private readonly timers: unknown[];
  private seatingTimer: unknown = null;
  private closing: Promise<void> | null = null;

  constructor(
    id: string,
    request: ObservedOpenRequest,
    seed: string,
    private readonly options: ObservedTableOptions,
    private readonly clock: ObservedClock,
  ) {
    this.id = id;
    this.request = request;
    this.seatCount = request.seats ?? MIN_SEATS;
    const seats = seatIdsOf(this.seatCount);
    this.poolSeeds = seats.map((seat) => observedPoolSeed(seed, seat));
    this.timers = seats.map(() => null);
    this.state = {
      kind: 'seating',
      decks: seats.map((seat) => (seat === 1 ? (request.deck ?? null) : null)),
      opening: false,
    };
    this.seatingTimer = clock.setTimeout(() => {
      void this.end('seating-timeout', 'Nobody finished a deck in time, so the table was closed.');
    }, OBSERVED_SEATING_MS);
  }

  get revision(): number {
    return this.revisionCounter;
  }

  /** Whether this table still holds one of the dealer's slots. */
  get live(): boolean {
    return this.state.kind === 'seating' || this.state.kind === 'playing';
  }

  get phase(): State['kind'] {
    return this.state.kind;
  }

  frameFor(seat: LobbySeat): ObservedSeatFrame {
    return {
      protocol: OBSERVED_TABLE_PROTOCOL,
      revision: this.revisionCounter,
      seat,
      format: this.request.format,
      content: this.request.content,
      deck: this.deckOf(seat),
      phase: this.phaseFor(seat),
    };
  }

  private deckOf(seat: LobbySeat): DeckRef | null {
    const state = this.state;
    if (state.kind === 'seating') return state.decks[seat] ?? null;
    if (state.kind === 'ended') return null;
    return seatSpecOf(state.session.table, seat).deck;
  }

  private poolSeedOf(seat: LobbySeat): string {
    const seed = this.poolSeeds[seat];
    if (seed === undefined) throw new Error(`the table has no seat ${String(seat)}`);
    return seed;
  }

  private phaseFor(seat: LobbySeat): ObservedPhase {
    const state = this.state;
    switch (state.kind) {
      case 'seating':
        return {
          kind: 'seating',
          poolSeed: this.poolSeedOf(seat),
          submitted: state.decks.map((deck) => deck !== null),
        };
      case 'playing': {
        const seats = state.session.seats;
        if (seats === null) throw new Error('an observed table needs a per-seat projection');
        return {
          kind: 'playing',
          view: seats.view(seat),
          decision: seats.decision(seat),
          events: seats.events(seat),
          play: playFor(seat, state.session.decision, state.session.play ?? null),
          transcriptLength: state.session.transcript.length,
        };
      }
      case 'finished': {
        const seats = state.session.seats;
        if (seats === null) throw new Error('an observed table needs a per-seat projection');
        return { kind: 'finished', view: seats.view(seat), events: seats.events(seat), result: state.result };
      }
      case 'ended':
        return { kind: 'ended', reason: state.reason, message: state.message };
    }
  }

  watch(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Marks `seat` as having read a frame and resets its disconnect timer while playing. */
  touch(seat: LobbySeat): void {
    this.joined.add(seat);
    if (this.state.kind !== 'playing') return;
    if (seat >= this.seatCount) return;
    this.clock.clearTimeout(this.timers[seat]);
    this.timers[seat] = this.clock.setTimeout(() => {
      void this.end('disconnected', `${observedSeatName(seat)} stopped answering, so the table was closed.`);
    }, OBSERVED_DISCONNECT_MS);
  }

  private bump(state: State): void {
    this.state = state;
    this.revisionCounter += 1;
    for (const listener of [...this.listeners]) listener();
  }

  private refusal(refused: string): SeatRefusal {
    return { refused, at: this.revisionCounter };
  }

  async submitDeck(seat: LobbySeat, deck: DeckRef): Promise<SeatRefusal | null> {
    const state = this.state;
    if (state.kind !== 'seating') return this.refusal('the table is no longer seating');
    if (seat >= this.seatCount) return this.refusal('the table has no such seat');
    if (state.decks[seat] !== null || state.opening)
      return this.refusal('this seat already submitted a deck');
    const decks = state.decks.map((held, index) => (index === seat ? deck : held));
    const seated = decks.filter((held): held is DeckRef => held !== null);
    if (seated.length < this.seatCount) {
      this.bump({ kind: 'seating', decks, opening: false });
      return null;
    }
    this.bump({ kind: 'seating', decks, opening: true });
    await this.openSession(seated);
    return null;
  }

  private spec(decks: readonly DeckRef[]): SessionSpec {
    return {
      content: this.request.content,
      seats: perSeat(
        decks.map((deck, seat) => ({
          name: observedSeatName(seat),
          controller: 'local' as const,
          deck,
        })),
      ),
      ...(this.request.rules === undefined ? {} : { rules: this.request.rules }),
      seed: this.request.seed,
      maximumTurns: this.request.maximumTurns,
    };
  }

  private async openSession(decks: readonly DeckRef[]): Promise<void> {
    const opened = await this.options.backend.open(this.spec(decks));
    if (this.state.kind !== 'seating') {
      if (opened.ok) await opened.session.close();
      return;
    }
    if (!opened.ok) {
      await this.end('backend-failure', describeSessionError(opened.error));
      return;
    }
    this.clock.clearTimeout(this.seatingTimer);
    this.seatingTimer = null;
    this.bump({ kind: 'playing', session: opened.session, busy: false });
    for (const seat of seatIdsOf(this.seatCount)) this.touch(seat);
    await this.settle(opened.session);
  }

  /** Moves a session that has reached a result into `finished`, once. */
  private async settle(session: ObservedSession): Promise<void> {
    if (session.status !== 'finished' || session.result === null) return;
    await this.finish(session, session.result);
  }

  private async finish(session: ObservedSession, result: MatchResult): Promise<void> {
    this.clearTimers();
    this.bump({ kind: 'finished', session, result });
    this.options.onFinished?.({
      backend: session.backend,
      table: session.table,
      localSeats: session.localSeats,
      transcript: session.transcript,
      result,
    });
    await session.close();
  }

  async submit(seat: LobbySeat, move: MoveId): Promise<SeatRefusal | null> {
    const state = this.state;
    if (state.kind !== 'playing') return this.refusal('the table is not in play');
    if (state.busy) return this.refusal('a move is already being submitted');
    const decision = state.session.decision;
    if (decision === null || decision.seat !== seat) return this.refusal("it is not this seat's decision");
    this.state = { ...state, busy: true };
    const submitted = await state.session.submit(move);
    if (this.state.kind !== 'playing') return this.refusal('the table is not in play');
    if (!submitted.ok) {
      if (isFatal(submitted.error.kind)) {
        await this.end('backend-failure', describeSessionError(submitted.error));
        return null;
      }
      this.state = { ...state, busy: false };
      return this.refusal(submitted.error.message);
    }
    this.bump({ kind: 'playing', session: submitted.session, busy: false });
    await this.settle(submitted.session);
    return null;
  }

  /**
   * A seat walks away. In `seating` the table ends; in play at a two-seat table
   * the other seat wins, through the backend's own concede when the leaver holds
   * the decision and by declaration otherwise, so a recorder still sees a
   * result. A pod has no single other seat to award the game to, so the game
   * ends undecided and the result names who left.
   */
  async leave(seat: LobbySeat): Promise<void> {
    const state = this.state;
    const name = observedSeatName(seat);
    if (state.kind === 'seating') {
      await this.end('left', `${name} left the table.`);
      return;
    }
    if (state.kind !== 'playing' || state.busy) return;
    const concede = state.session.play?.concede ?? null;
    if (concede !== null && state.session.decision?.seat === seat) {
      this.state = { ...state, busy: true };
      const submitted = await state.session.submit(concede);
      if (submitted.ok && submitted.session.status === 'finished' && submitted.session.result !== null) {
        await this.finish(submitted.session, submitted.session.result);
        return;
      }
    }
    await this.finish(state.session, {
      winner: this.seatCount === MIN_SEATS ? (seat === 0 ? 1 : 0) : null,
      reason: `${name} left the table`,
      endedOnTurn: state.session.view.turn.number,
    });
  }

  private clearTimers(): void {
    this.clock.clearTimeout(this.seatingTimer);
    for (const [seat, handle] of this.timers.entries()) {
      this.clock.clearTimeout(handle);
      this.timers[seat] = null;
    }
    this.seatingTimer = null;
  }

  private async end(reason: ObservedEndReason, message: string): Promise<void> {
    const state = this.state;
    if (state.kind === 'ended' || state.kind === 'finished') return;
    this.clearTimers();
    this.bump({ kind: 'ended', reason, message });
    this.options.onEnded?.(this, reason, message);
    if (state.kind === 'playing') await state.session.close();
  }

  /** Releases the backend session and ends the table if it was still going. Idempotent. */
  close(): Promise<void> {
    this.closing ??= this.end('left', 'The table was closed.');
    return this.closing;
  }
}

export function createObservedDealer(
  options: ObservedTableOptions & { readonly formats: readonly string[] },
): ObservedDealer {
  if (!options.backend.capabilities.perSeatProjection) {
    throw new Error(
      `backend ${options.backend.id} does not project per seat, so it cannot serve two machines`,
    );
  }
  const clock = options.clock ?? DEFAULT_CLOCK;
  const mint = options.mint ?? randomUUID;
  const tables = new Map<string, ObservedTable>();
  const seats = new Map<string, { readonly table: ObservedTable; readonly seat: LobbySeat }>();
  const live = (): number => [...tables.values()].filter((table) => table.live).length;
  const forget = (table: ObservedTable, tokens: SeatTokens): void => {
    tables.delete(table.id);
    for (const token of tokens) seats.delete(token);
  };
  return {
    formats: options.formats,
    get live() {
      return live();
    },
    open: (request) => {
      if (!options.formats.includes(request.format)) {
        return Promise.resolve({
          ok: false,
          code: 'unknown-format',
          refused: `${request.format} is not served here`,
        });
      }
      if (live() >= MAX_OBSERVED_TABLES) {
        return Promise.resolve({
          ok: false,
          code: 'table-limit',
          refused: `${String(MAX_OBSERVED_TABLES)} tables are already open; finish one before starting another`,
        });
      }
      const id = `obs-${mint()}`;
      const table = new ObservedTable(id, request, request.seed ?? mint(), options, clock);
      const [host = mint(), guest = mint(), ...rest] = seatIdsOf(table.seatCount).map(() => `obs-${mint()}`);
      const tokens: SeatTokens = [host, guest, ...rest];
      table.invite = options.invite?.(table, tokens);
      tables.set(id, table);
      for (const [seat, token] of tokens.entries()) seats.set(token, { table, seat });
      // A finished or ended table stays readable for the disconnect window, so
      // the seat that did not end it can read why, and is then forgotten.
      const unwatch = table.watch(() => {
        if (table.live) return;
        unwatch();
        clock.setTimeout(() => forget(table, tokens), OBSERVED_DISCONNECT_MS);
      });
      return Promise.resolve({ ok: true, table, tokens });
    },
    find: (token) => seats.get(token) ?? null,
    close: async () => {
      await Promise.all([...tables.values()].map((table) => table.close()));
    },
  };
}
