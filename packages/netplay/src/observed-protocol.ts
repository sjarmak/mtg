/**
 * The wire between two browsers and one observed table, in words both ends
 * can import.
 *
 * `protocol.ts` carries a kernel game seat by seat and `backend-gateway.ts`
 * hands one browser a whole `ObservedSession`; neither fits a Forge match
 * played by two people over the LAN, because a Forge session is opened once
 * for both seats and each seat may be sent only its own projection. This
 * module is the shape of that third wire, with no server in it: the browser's
 * `packages/ui/src/net/observed-table.ts` imports it as types and pins the
 * protocol constant equal, the way `NETPLAY_PROTOCOL` is pinned.
 *
 * A frame is what one seat is told: the table's format and content, that
 * seat's own deck once it has submitted one, and a phase. In `seating` the
 * phase is that seat's pool seed and who has submitted; in `playing` it is
 * `SeatProjection` for that seat plus the play interaction cut down by
 * `playFor`; `finished` carries the result over the final projected view, and
 * `ended` the reason. The other seat's hand, deck, decision and pool seed are
 * never in a frame, and `observed-table.test.ts` searches the bytes to say so.
 */
import type {
  ContentRef,
  DeckRef,
  EngineEvent,
  MatchResult,
  MatchRules,
  MoveId,
  PendingDecision,
  PlayInteraction,
  SeatId,
  TableView,
} from '@mtg/engine';
import {
  isRecord,
  nonempty,
  readContent,
  readDeck,
  readMaximumTurns,
  readRules,
  readSeatCount,
  readSeed,
} from './wire-readers';

export const OBSERVED_TABLE_PROTOCOL = 1;

/**
 * Concurrent observed tables one launcher will hold. Each is a Forge JVM
 * beside the launcher's own, and this box has been measured under two.
 */
export const MAX_OBSERVED_TABLES = 2;

/**
 * The largest pod one observed table seats. Four is the Commander pod; the
 * table takes any count from `MIN_SEATS` up to this, and a backend that plays
 * fewer (the kernel plays two) refuses the rest with its own reason.
 */
export const MAX_OBSERVED_SEATS = 4;

/** How long a table waits in `seating` for both decks before it ends. */
export const OBSERVED_SEATING_MS = 30 * 60_000;

/** How long a playing seat may go without polling before the table ends. */
export const OBSERVED_DISCONNECT_MS = 10 * 60_000;

export interface ObservedOpenRequest {
  readonly protocol: number;
  readonly format: string;
  readonly content: ContentRef;
  readonly seed: string | null;
  readonly rules?: MatchRules;
  readonly maximumTurns: number | null;
  readonly deck?: DeckRef;
  /** How many seats the table opens; absent means the two-seat game. */
  readonly seats?: number;
}

export type ObservedEndReason = 'left' | 'seating-timeout' | 'disconnected' | 'backend-failure';

export type ObservedPhase =
  | { readonly kind: 'seating'; readonly poolSeed: string; readonly submitted: readonly boolean[] }
  | {
      readonly kind: 'playing';
      readonly view: TableView;
      readonly decision: PendingDecision | null;
      readonly events: readonly EngineEvent[];
      readonly play: PlayInteraction | null;
      readonly transcriptLength: number;
    }
  | {
      readonly kind: 'finished';
      readonly view: TableView;
      readonly events: readonly EngineEvent[];
      readonly result: MatchResult;
    }
  | { readonly kind: 'ended'; readonly reason: ObservedEndReason; readonly message: string };

export interface ObservedSeatFrame {
  readonly protocol: number;
  readonly revision: number;
  readonly seat: SeatId;
  readonly format: string;
  readonly content: ContentRef;
  /** This seat's own deck, once it has submitted one; never the other seat's. */
  readonly deck: DeckRef | null;
  readonly phase: ObservedPhase;
}

/** What `POST /api/observed` answers when it opens a table. */
export interface ObservedStart {
  readonly protocol: number;
  readonly table: string;
  readonly seats: { readonly host: string; readonly guest: string };
  /** Every seat's token in seat order; `seats` names the first two of them. */
  readonly tokens: readonly [string, string, ...string[]];
}

/**
 * An open request off the wire, or the sentence refusing it.
 *
 * A sentence rather than a `SeatRefusal`, like `readRoomBuild` and
 * `readSeatRequest`: there is no table yet, so there is no counter to resync to.
 */
export function readObservedOpenRequest(value: unknown): ObservedOpenRequest | string {
  if (!isRecord(value) || value['protocol'] !== OBSERVED_TABLE_PROTOCOL) {
    return 'the request has no recognized protocol';
  }
  if (!nonempty(value['format'])) return 'the request names no format';
  const content = readContent(value['content']);
  if (typeof content === 'string') return content;
  const rules = readRules(value['rules']);
  if (typeof rules === 'string') return rules;
  const seed = readSeed(value['seed']);
  if (typeof seed === 'string') return seed;
  const maximumTurns = readMaximumTurns(value['maximumTurns']);
  if (typeof maximumTurns === 'string') return maximumTurns;
  const deck = value['deck'] === undefined ? undefined : readDeck(value['deck'], content.kind === 'mixed');
  if (typeof deck === 'string') return deck;
  const seats = readSeatCount(value['seats'], MAX_OBSERVED_SEATS);
  if (typeof seats === 'string') return seats;
  return {
    protocol: OBSERVED_TABLE_PROTOCOL,
    format: value['format'],
    content,
    ...(rules === undefined ? {} : { rules }),
    ...seed,
    ...maximumTurns,
    ...(deck === undefined ? {} : { deck }),
    ...seats,
  };
}

/**
 * A relayed move off the wire, or the sentence refusing it.
 *
 * Wrapped rather than bare, because a `MoveId` is a string and so is a
 * refusal; the shape is `readSeed`'s in `wire-readers.ts`.
 */
export function readObservedMove(value: unknown): { readonly move: MoveId } | string {
  if (!isRecord(value) || value['protocol'] !== OBSERVED_TABLE_PROTOCOL) {
    return 'the request has no recognized protocol';
  }
  if (!nonempty(value['move'])) return 'the request has no move id';
  return { move: value['move'] };
}

/**
 * The play interaction one seat may be sent.
 *
 * The backend's interaction is written for whoever holds the decision: its
 * object actions name that seat's cards, and `passPriority` and `concede` are
 * that seat's moves. The seat that does not hold the decision keeps only what
 * is public, the turn step and both floating pools, and gets no move at all,
 * so a relayed move from the wrong seat is refused before the backend sees it.
 */
export function playFor(
  seat: SeatId,
  decision: PendingDecision | null,
  play: PlayInteraction | null,
): PlayInteraction | null {
  if (play === null) return null;
  if (decision !== null && decision.seat === seat) return play;
  return {
    turnStep: play.turnStep,
    passPriority: null,
    concede: null,
    ...(play.manaPools === undefined ? {} : { manaPools: play.manaPools }),
    objectActions: [],
    seatActions: [],
    promptRole: null,
    automatic: null,
  };
}
