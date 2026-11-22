/**
 * The browser end of a Forge table over the LAN.
 *
 * `@mtg/netplay`'s observed arm holds one Forge session and hands each of two
 * machines the half it may see: `ObservedSeatFrame`, revision by revision,
 * through a long poll on `GET /api/observed/:token`. This file is the client
 * of that wire, and it is three things at once because the page needs all
 * three from one connection.
 *
 * It is a **reader**: `readObservedFrame` validates a frame off the wire with
 * this side's own checks, for the reason `snapshot.ts` gives (the sender is
 * the thing that might be wrong). It is a **page store**: `observedSeatBackend`
 * runs the long poll and publishes the newest frame and the connection's last
 * complaint, so the seat page can draw whichever phase the table is in. And it
 * is a **backend**: the same client is an `ObservedBackend` whose `open`
 * resolves with the position the table is at, whose sessions `submit` through
 * `POST /moves`, and whose `feed` pushes every position the *other* seat
 * reaches, which is the one thing a request-and-answer backend cannot do. The
 * session controller takes that feed and `BackendGame` draws the result
 * without learning which backend it is talking to.
 *
 * # What a session built from a frame is
 *
 * A seat is sent its own view, the decision when it is its own, the redacted
 * events and its own deck. So a session here has `localSeats: [seat]`, an
 * empty transcript, and a table whose other deck is a stated placeholder: the
 * other seat's list never crosses the wire, and `observed-table.test.ts` pins
 * that a parsed frame carries no hand but this seat's own.
 *
 * # Protocol
 *
 * `OBSERVED_CLIENT_PROTOCOL` is mirrored rather than imported, because the
 * package's barrel reaches `node:http`; `isolation.test.ts` compares the two.
 */
import type {
  DeckRef,
  EngineEvent,
  MatchResult,
  MatchRules,
  MoveId,
  ObservedBackend,
  ObservedSession,
  OpenResult,
  PendingDecision,
  PlayInteraction,
  SeatId,
  SessionSpec,
  SubmitResult,
  TableView,
} from '@mtg/engine';
import { MIN_SEATS, seatViewOf } from '@mtg/engine';
import type { ObservedOpenRequest, ObservedPhase, ObservedSeatFrame } from '@mtg/netplay';
import {
  isRecord,
  isSafeCount,
  isSeat,
  readContent,
  readDecision,
  readDeck,
  readEvents,
  readPlayInteraction,
  readResult,
  readTableView,
} from './backend-gateway';
import type { ReadResult } from './backend-gateway';
import type { SessionFeed } from '../routes/play/session-controller';

export const OBSERVED_CLIENT_PROTOCOL = 1;

/** The backend id a LAN seat's sessions carry; the Forge behind it is the server's. */
export const OBSERVED_SEAT_BACKEND = 'lan-forge';

/** How long the poll waits after an answer it could not use before asking again. */
const RETRY_MS = 2_000;

/** What a seat's table says about the deck it cannot see. */
export const HIDDEN_DECK_NAME = 'The other seat';

export type ObservedFrameResult =
  { readonly ok: true; readonly frame: ObservedSeatFrame } | { readonly ok: false; readonly message: string };

function refused<T>(message: string): ReadResult<T> {
  return { ok: false, message };
}

function readSeating(value: Readonly<Record<string, unknown>>, at: string): ReadResult<ObservedPhase> {
  const submitted = value['submitted'];
  if (typeof value['poolSeed'] !== 'string' || value['poolSeed'].length === 0)
    return refused(`${at} sent a seating phase with no pool seed`);
  if (
    !Array.isArray(submitted) ||
    submitted.length < MIN_SEATS ||
    !submitted.every((held): held is boolean => typeof held === 'boolean')
  )
    return refused(`${at} sent a seating phase without every seat's deck status`);
  return { ok: true, value: { kind: 'seating', poolSeed: value['poolSeed'], submitted } };
}

function readPlaying(value: Readonly<Record<string, unknown>>, at: string): ReadResult<ObservedPhase> {
  const view = readTableView(value['view']);
  if (!view.ok) return view;
  const decision = readDecision(value['decision']);
  if (!decision.ok) return decision;
  const events = readEvents(value['events']);
  if (!events.ok) return events;
  const play = readPlayInteraction(value['play'], decision.value, view.value);
  if (!play.ok) return play;
  if (!isSafeCount(value['transcriptLength']))
    return refused(`${at} sent a playing phase with no transcript length`);
  return {
    ok: true,
    value: {
      kind: 'playing',
      view: view.value,
      decision: decision.value,
      events: events.value,
      play: play.value,
      transcriptLength: value['transcriptLength'],
    },
  };
}

function readFinished(value: Readonly<Record<string, unknown>>, at: string): ReadResult<ObservedPhase> {
  const view = readTableView(value['view']);
  if (!view.ok) return view;
  const events = readEvents(value['events']);
  if (!events.ok) return events;
  const result = readResult(value['result']);
  if (!result.ok) return result;
  if (result.value === null) return refused(`${at} sent a finished phase with no result`);
  return {
    ok: true,
    value: { kind: 'finished', view: view.value, events: events.value, result: result.value },
  };
}

const END_REASONS = ['left', 'seating-timeout', 'disconnected', 'backend-failure'] as const;

function readEnded(value: Readonly<Record<string, unknown>>, at: string): ReadResult<ObservedPhase> {
  const reason = END_REASONS.find((candidate) => candidate === value['reason']);
  if (reason === undefined) return refused(`${at} sent an ended phase with an unknown reason`);
  if (typeof value['message'] !== 'string') return refused(`${at} sent an ended phase with no message`);
  return { ok: true, value: { kind: 'ended', reason, message: value['message'] } };
}

function readPhase(value: unknown, at: string): ReadResult<ObservedPhase> {
  if (!isRecord(value)) return refused(`${at} sent no phase`);
  switch (value['kind']) {
    case 'seating':
      return readSeating(value, at);
    case 'playing':
      return readPlaying(value, at);
    case 'finished':
      return readFinished(value, at);
    case 'ended':
      return readEnded(value, at);
    default:
      return refused(`${at} sent a phase this page does not know`);
  }
}

/** One seat's frame off the wire, checked by this side; `at` names the sender in the message. */
export function readObservedFrame(value: unknown, at: string): ObservedFrameResult {
  if (!isRecord(value)) return { ok: false, message: `${at} did not answer with a seat frame` };
  if (value['protocol'] !== OBSERVED_CLIENT_PROTOCOL) {
    return {
      ok: false,
      message: `${at} speaks observed protocol ${String(value['protocol'])}; this page speaks ${String(OBSERVED_CLIENT_PROTOCOL)}`,
    };
  }
  if (!isSafeCount(value['revision'])) return { ok: false, message: `${at} sent a frame with no revision` };
  if (!isSeat(value['seat'])) return { ok: false, message: `${at} sent a frame for no seat` };
  if (typeof value['format'] !== 'string' || value['format'].length === 0)
    return { ok: false, message: `${at} sent a frame naming no format` };
  const content = value['content'];
  if (!readContent(content))
    return { ok: false, message: `${at} sent a frame with an invalid content reference` };
  const deck = value['deck'];
  if (deck !== null && !readDeck(deck, content.kind === 'mixed'))
    return { ok: false, message: `${at} sent a frame with an invalid deck` };
  const phase = readPhase(value['phase'], at);
  if (!phase.ok) return phase;
  return {
    ok: true,
    frame: {
      protocol: OBSERVED_CLIENT_PROTOCOL,
      revision: value['revision'],
      seat: value['seat'],
      format: value['format'],
      content,
      deck: deck as DeckRef | null,
      phase: phase.value,
    },
  };
}

export type ObservedTableStart =
  | { readonly ok: true; readonly table: string; readonly host: string; readonly guest: string }
  | { readonly ok: false; readonly message: string };

/** What `POST /api/observed` answered, or why this page will not open it. */
export function readObservedStart(body: unknown, at: string): ObservedTableStart {
  if (!isRecord(body)) return { ok: false, message: `${at} did not answer with an object` };
  if (body['protocol'] !== OBSERVED_CLIENT_PROTOCOL)
    return { ok: false, message: `${at} speaks a protocol this page does not` };
  const seats = body['seats'];
  if (typeof body['table'] !== 'string' || body['table'].length === 0)
    return { ok: false, message: `${at} opened a table and named no table` };
  if (!isRecord(seats) || typeof seats['host'] !== 'string' || typeof seats['guest'] !== 'string')
    return { ok: false, message: `${at} opened a table and named no seats` };
  return { ok: true, table: body['table'], host: seats['host'], guest: seats['guest'] };
}

export type LanForgeAvailability =
  { readonly status: 'ready' } | { readonly status: 'unavailable'; readonly reason: string };

/**
 * Whether the lab on this origin seats a Forge table for a format.
 *
 * `observed` is the format list `/api/health` advertised, or null when it
 * advertised none, which is a lab started without a Forge backend or without a
 * game server at all; the sentence says which the page can tell apart.
 */
export function lanForgeAvailability(
  observed: readonly string[] | null,
  format: string,
): LanForgeAvailability {
  if (observed === null) {
    return {
      status: 'unavailable',
      reason: 'This lab was started without a Forge backend, so it cannot seat a table over the network.',
    };
  }
  if (!observed.includes(format)) {
    return {
      status: 'unavailable',
      reason: `Forge on this lab does not serve ${format} over the network; it serves ${observed.join(', ')}.`,
    };
  }
  return { status: 'ready' };
}

type WireAnswer =
  | { readonly kind: 'frame'; readonly frame: ObservedSeatFrame }
  | { readonly kind: 'refused'; readonly message: string; readonly gone: boolean }
  | { readonly kind: 'failed'; readonly message: string };

function refusalOf(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['refused'] === 'string') return body['refused'];
  return `the table answered ${String(status)}`;
}

async function ask(request: typeof globalThis.fetch, url: string, init: RequestInit): Promise<WireAnswer> {
  try {
    const response = await request(url, init);
    const body = (await response.json()) as unknown;
    if (!response.ok)
      return { kind: 'refused', message: refusalOf(response.status, body), gone: response.status === 404 };
    const frame = readObservedFrame(body, 'the table');
    return frame.ok ? { kind: 'frame', frame: frame.frame } : { kind: 'failed', message: frame.message };
  } catch (cause) {
    return { kind: 'failed', message: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Opens a table for this format; the caller becomes its host. */
export async function startObservedTable(
  base: string,
  request: Omit<ObservedOpenRequest, 'protocol'>,
  fetcher: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init),
): Promise<ObservedTableStart> {
  try {
    const response = await fetcher(`${base}/observed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: OBSERVED_CLIENT_PROTOCOL, ...request }),
    });
    const body = (await response.json()) as unknown;
    if (!response.ok) return { ok: false, message: refusalOf(response.status, body) };
    return readObservedStart(body, 'the lab');
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

export interface ObservedSeatState {
  /** The newest frame the table has sent, or null before the first answer. */
  readonly frame: ObservedSeatFrame | null;
  /** The last thing the connection could not do, or null while it is answering. */
  readonly problem: string | null;
}

export interface ObservedSeatClient {
  /** The seat as an `ObservedBackend`, for `BackendGame`. */
  readonly backend: ObservedBackend;
  /** Every position the table reaches, for the session controller. */
  readonly feed: SessionFeed;
  readonly getSnapshot: () => ObservedSeatState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Starts the long poll; the returned function stops it, and it may be started again. */
  readonly connect: () => () => void;
  /** Hands the table this seat's deck; resolves with the refusal, or null when it was taken. */
  readonly submitDeck: (deck: DeckRef) => Promise<string | null>;
  /** Leaves the table; resolves with the refusal, or null when the table let the seat go. */
  readonly leave: () => Promise<string | null>;
}

export interface ObservedSeatOptions {
  /** Injectable for tests; defaults to the browser fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

type PlayedPhase = Extract<ObservedPhase, { readonly kind: 'playing' | 'finished' }>;

/** The table as this seat may state it: its own deck, and a placeholder where the other seat's would be. */
export function observedTableOf(
  frame: ObservedSeatFrame,
  phase: PlayedPhase,
  rules?: MatchRules,
): SessionSpec {
  const own = frame.deck ?? { name: HIDDEN_DECK_NAME, cards: [] };
  const hidden: DeckRef = { name: HIDDEN_DECK_NAME, cards: [] };
  const seat = (index: SeatId): SessionSpec['seats'][number] => ({
    name: seatViewOf(phase.view, index).name,
    controller: 'local',
    deck: index === frame.seat ? own : hidden,
  });
  return {
    content: frame.content,
    seats: [seat(0), seat(1)],
    ...(rules === undefined ? {} : { rules }),
    seed: null,
    maximumTurns: null,
  };
}

function playedPhase(frame: ObservedSeatFrame): PlayedPhase | null {
  return frame.phase.kind === 'playing' || frame.phase.kind === 'finished' ? frame.phase : null;
}

interface Played {
  readonly view: TableView;
  readonly events: readonly EngineEvent[];
  readonly decision: PendingDecision | null;
  readonly play: PlayInteraction | undefined;
  readonly result: MatchResult | null;
  readonly submitted: number;
}

function playedOf(phase: PlayedPhase): Played {
  if (phase.kind === 'playing') {
    return {
      view: phase.view,
      events: phase.events,
      decision: phase.decision,
      play: phase.play ?? undefined,
      result: null,
      submitted: Math.max(0, phase.transcriptLength - 1),
    };
  }
  return {
    view: phase.view,
    events: phase.events,
    decision: null,
    play: undefined,
    result: phase.result,
    submitted: 0,
  };
}

function sessionOf(
  frame: ObservedSeatFrame,
  phase: PlayedPhase,
  submit: (move: MoveId) => Promise<SubmitResult<ObservedSession>>,
): ObservedSession {
  const played = playedOf(phase);
  return {
    backend: OBSERVED_SEAT_BACKEND,
    determinism: 'observed',
    table: observedTableOf(frame, phase),
    status: phase.kind === 'playing' ? 'awaiting' : 'finished',
    view: played.view,
    events: played.events,
    decision: played.decision,
    ...(played.play === undefined ? {} : { play: played.play }),
    seats: null,
    result: played.result,
    submitted: played.submitted,
    localSeats: [frame.seat],
    transcript: [],
    submit,
    // The page owns the connection; closing a session must not leave the table.
    close: () => Promise.resolve(),
  };
}

export function observedSeatBackend(
  base: string,
  token: string,
  options: ObservedSeatOptions = {},
): ObservedSeatClient {
  const request = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const at = `${base}/observed/${token}`;
  let state: ObservedSeatState = { frame: null, problem: null };
  let latest: ObservedSession | null = null;
  const listeners = new Set<() => void>();
  const sessions = new Set<(session: ObservedSession) => void>();
  const arrivals = new Set<(frame: ObservedSeatFrame) => void>();

  const publish = (next: ObservedSeatState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const submit = async (move: MoveId): Promise<SubmitResult<ObservedSession>> => {
    const answered = await ask(request, `${at}/moves`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The protocol number belongs in the body, not only in the open request.
      // `@mtg/netplay`'s `readObservedMove` refuses a move body without it, and
      // this call sent `{ move }` alone: every move from an observed seat came
      // back `illegal-move: the request has no recognized protocol`, starting
      // with the die-roll answer, so a LAN table could be opened and never
      // played. Found by the playtester on 2026-09-17 pressing "let host play
      // first". The test wire in `../../test/net/observed-wire.ts` read the
      // body itself instead of through that reader, which is why no suite saw
      // it; it now goes through the reader.
      body: JSON.stringify({ protocol: OBSERVED_CLIENT_PROTOCOL, move }),
    });
    if (answered.kind === 'frame') {
      accept(answered.frame);
      if (latest !== null && state.frame?.phase.kind !== 'ended') return { ok: true, session: latest };
      return { ok: false, error: { kind: 'backend-failure', message: endedMessage(state.frame) } };
    }
    return {
      ok: false,
      error: {
        kind: answered.kind === 'refused' ? 'illegal-move' : 'backend-failure',
        message: answered.message,
      },
    };
  };

  /** Takes a frame in if it is newer than the one held, and tells everyone waiting. */
  const accept = (frame: ObservedSeatFrame): void => {
    const held = state.frame;
    if (held !== null && frame.seat !== held.seat) {
      publish({ frame: held, problem: 'the table answered for the other seat' });
      return;
    }
    if (held !== null && frame.revision <= held.revision) {
      if (state.problem !== null) publish({ frame: held, problem: null });
      return;
    }
    const phase = playedPhase(frame);
    if (phase !== null) latest = sessionOf(frame, phase, submit);
    publish({ frame, problem: null });
    if (phase !== null) for (const listener of [...sessions]) listener(latest as ObservedSession);
    for (const arrival of [...arrivals]) arrival(frame);
  };

  const connect = (): (() => void) => {
    let live = true;
    const controller = new AbortController();
    const loop = async (): Promise<void> => {
      while (live) {
        const held = state.frame;
        if (held !== null && (held.phase.kind === 'ended' || held.phase.kind === 'finished')) return;
        const url = held === null ? at : `${at}?revision=${String(held.revision)}`;
        const answered = await ask(request, url, { signal: controller.signal });
        if (!live) return;
        if (answered.kind === 'frame') {
          accept(answered.frame);
          continue;
        }
        publish({ frame: state.frame, problem: answered.message });
        if (answered.kind === 'refused' && answered.gone) return;
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    };
    void loop();
    return (): void => {
      live = false;
      controller.abort();
    };
  };

  const open = (): Promise<OpenResult<ObservedSession>> =>
    new Promise((resolve) => {
      const settle = (frame: ObservedSeatFrame): boolean => {
        if (playedPhase(frame) !== null && latest !== null) {
          resolve({ ok: true, session: latest });
          return true;
        }
        if (frame.phase.kind === 'ended') {
          resolve({ ok: false, error: { kind: 'backend-failure', message: frame.phase.message } });
          return true;
        }
        return false;
      };
      if (state.frame !== null && settle(state.frame)) return;
      const arrival = (frame: ObservedSeatFrame): void => {
        if (settle(frame)) arrivals.delete(arrival);
      };
      arrivals.add(arrival);
    });

  const post = async (path: string, init: RequestInit): Promise<string | null> => {
    const answered = await ask(request, `${at}${path}`, init);
    if (answered.kind !== 'frame') return answered.message;
    accept(answered.frame);
    return null;
  };

  return {
    backend: {
      id: OBSERVED_SEAT_BACKEND,
      determinism: 'observed',
      capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: false },
      // The server chose the backend when it opened the table; nothing is refused here.
      supports: (): Promise<readonly string[]> => Promise.resolve([]),
      open,
    },
    feed: {
      subscribe: (listener) => {
        sessions.add(listener);
        return (): void => {
          sessions.delete(listener);
        };
      },
    },
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    connect,
    submitDeck: (deck) =>
      post('/deck', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deck }),
      }),
    leave: () => post('', { method: 'DELETE' }),
  };
}

function endedMessage(frame: ObservedSeatFrame | null): string {
  return frame?.phase.kind === 'ended' ? frame.phase.message : 'the table answered with no position to play';
}
