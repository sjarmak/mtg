/**
 * Backend-neutral EngineSession ownership over loopback HTTP.
 *
 * This module is Node-only. It owns installed backend values, selects exactly
 * one of them through explicit BackendRoutes before open, and keeps the live
 * EngineSession behind a random capability. Browser code receives immutable
 * observed snapshots and can only return an offered MoveId with the monotonic
 * revision that issued it.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { BackendRoutes, GameBackend, ObservedSession, SessionSpec } from '@mtg/engine';
import { MIN_SEATS, perSeat, routeBackend } from '@mtg/engine';
import type { GameplayRecorder } from './gameplay';
import { BACKEND_GATEWAY_PROTOCOL, failure } from './gateway-envelope';
import { json, readBody } from './http-support';
import {
  isRecord,
  nonempty,
  readContent,
  readDeck,
  readMaximumTurns,
  readRules,
  readSeed,
} from './wire-readers';

export const MAX_BACKEND_GATEWAY_SESSIONS = 8;
export const BACKEND_GATEWAY_ABANDONED_AFTER_MS = 15 * 60_000;
const RECLAIMED_TOKENS_REMEMBERED = 64;

export interface BackendGatewayOptions {
  readonly port: number;
  /** Stated explicitly; callers use loopback and Vite is the reachable process. */
  readonly host: string;
  readonly installed: readonly GameBackend[];
  readonly routes: BackendRoutes;
  /**
   * Where a finished session goes. The gateway sees the session whole, before
   * any seat's projection, so this is the one place a Forge game's transcript
   * can be recorded as the backend showed it. Absent records nothing.
   */
  readonly recorder?: GameplayRecorder | undefined;
  readonly now?: (() => number) | undefined;
}

export interface RunningBackendGateway {
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

interface LiveSession {
  readonly token: string;
  revision: number;
  session: ObservedSession;
  busy: boolean;
  closed: boolean;
  closing: Promise<void> | null;
  /** Whether the finished game has been handed to the recorder; once only. */
  recorded: boolean;
  touchedAt: number;
}

interface Capacity {
  opening: number;
}

interface Reclaim {
  readonly now: () => number;
  readonly tokens: Set<string>;
}

function readSeat(value: unknown, requireOrigin: boolean): string | SessionSpec['seats'][number] {
  if (!isRecord(value) || !nonempty(value['name'])) return 'each seat needs a name';
  if (value['controller'] !== 'local' && value['controller'] !== 'engine') {
    return 'each seat controller must be local or engine';
  }
  const deck = readDeck(value['deck'], requireOrigin);
  if (typeof deck === 'string') return deck;
  return { name: value['name'], controller: value['controller'], deck };
}

function readTable(value: unknown): string | SessionSpec {
  if (!isRecord(value)) return 'the request has no content reference';
  const reference = readContent(value['content']);
  if (typeof reference === 'string') return reference;
  const named: unknown = value['seats'];
  if (!Array.isArray(named) || named.length < MIN_SEATS) {
    return `the request must name at least ${String(MIN_SEATS)} seats`;
  }
  const requireOrigin = reference.kind === 'mixed';
  const seats: SessionSpec['seats'][number][] = [];
  for (const entry of named) {
    const seat = readSeat(entry, requireOrigin);
    if (typeof seat === 'string') return seat;
    seats.push(seat);
  }
  const rules = readRules(value['rules']);
  if (typeof rules === 'string') return rules;
  const seed = readSeed(value['seed']);
  if (typeof seed === 'string') return seed;
  const maximumTurns = readMaximumTurns(value['maximumTurns']);
  if (typeof maximumTurns === 'string') return maximumTurns;
  return {
    content: reference,
    seats: perSeat(seats),
    ...(rules === undefined ? {} : { rules }),
    ...seed,
    ...maximumTurns,
  };
}

function parseJson(body: string): unknown | undefined {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function wireSession(session: ObservedSession): unknown {
  return {
    backend: session.backend,
    determinism: session.determinism,
    table: session.table,
    status: session.status,
    view: session.view,
    events: session.events,
    decision: session.decision,
    play: session.play ?? null,
    result: session.result,
    submitted: session.submitted,
    localSeats: session.localSeats,
    transcript: session.transcript,
  };
}

function snapshot(response: ServerResponse, live: LiveSession): void {
  json(response, 200, {
    protocol: BACKEND_GATEWAY_PROTOCOL,
    ok: true,
    token: live.token,
    revision: live.revision,
    session: wireSession(live.session),
  });
}

async function release(session: ObservedSession): Promise<void> {
  try {
    await session.close();
  } catch {
    // Closing is terminal and has no recovery action. A dead child process is
    // already the state this operation was trying to reach.
  }
}

function closeLive(live: LiveSession): Promise<void> {
  if (live.closing !== null) return live.closing;
  live.closed = true;
  live.closing = release(live.session);
  return live.closing;
}

/**
 * Hands a finished session to the recorder, once. Called from the submit that
 * finished it and again from the close, because a page that closes a finished
 * session is the ordinary end of a game and the second call is what makes the
 * first one's absence harmless.
 */
function captureFinished(live: LiveSession, recorder: GameplayRecorder | undefined): void {
  if (recorder === undefined || live.recorded) return;
  const session = live.session;
  if (session.status !== 'finished' || session.result === null) return;
  live.recorded = true;
  void recorder.record({
    source: 'gateway-forge',
    backend: session.backend,
    table: session.table,
    localSeats: session.localSeats,
    transcript: session.transcript,
    result: session.result,
  });
}

function reclaimable(sessions: ReadonlyMap<string, LiveSession>, now: number): LiveSession | undefined {
  let chosen: LiveSession | undefined;
  for (const live of sessions.values()) {
    const finished = live.session.status === 'finished';
    if (!finished && now - live.touchedAt < BACKEND_GATEWAY_ABANDONED_AFTER_MS) continue;
    if (chosen === undefined) {
      chosen = live;
      continue;
    }
    const chosenFinished = chosen.session.status === 'finished';
    if (finished === chosenFinished ? live.touchedAt < chosen.touchedAt : finished) chosen = live;
  }
  return chosen;
}

function reclaim(
  sessions: Map<string, LiveSession>,
  reclaimed: Reclaim,
  recorder: GameplayRecorder | undefined,
): Promise<void> | undefined {
  const live = reclaimable(sessions, reclaimed.now());
  if (live === undefined) return undefined;
  sessions.delete(live.token);
  reclaimed.tokens.add(live.token);
  const [oldest] = reclaimed.tokens;
  if (reclaimed.tokens.size > RECLAIMED_TOKENS_REMEMBERED && oldest !== undefined) {
    reclaimed.tokens.delete(oldest);
  }
  captureFinished(live, recorder);
  return closeLive(live);
}

async function bodyOf(request: IncomingMessage, response: ServerResponse): Promise<unknown | undefined> {
  const body = await readBody(request);
  if (typeof body !== 'string') {
    failure(response, 413, 'request-too-large', 'the request body is larger than 64 KiB');
    return undefined;
  }
  const parsed = parseJson(body);
  if (parsed === undefined) {
    failure(response, 400, 'malformed-request', 'the request body is not JSON');
    return undefined;
  }
  return parsed;
}

async function openSession(
  options: BackendGatewayOptions,
  sessions: Map<string, LiveSession>,
  capacity: Capacity,
  reclaimed: Reclaim,
  request: IncomingMessage,
  response: ServerResponse,
  stopping: () => boolean,
): Promise<void> {
  if (request.method !== 'POST') {
    request.resume();
    failure(response, 405, 'wrong-method', 'a backend session is opened with POST');
    return;
  }
  const full = sessions.size + capacity.opening >= MAX_BACKEND_GATEWAY_SESSIONS;
  const making = full ? reclaim(sessions, reclaimed, options.recorder) : undefined;
  if (full && making === undefined) {
    request.resume();
    failure(
      response,
      429,
      'session-limit',
      `this gateway is already holding ${String(MAX_BACKEND_GATEWAY_SESSIONS)} games, each played within the last ${String(BACKEND_GATEWAY_ABANDONED_AFTER_MS / 60_000)} minutes; finish or leave one and try again`,
    );
    return;
  }
  capacity.opening += 1;
  try {
    await making;
    const parsed = await bodyOf(request, response);
    if (parsed === undefined) return;
    if (!isRecord(parsed) || parsed['protocol'] !== BACKEND_GATEWAY_PROTOCOL) {
      failure(response, 400, 'malformed-request', 'the request has no recognized protocol');
      return;
    }
    const table = readTable(parsed['table']);
    if (typeof table === 'string') {
      failure(response, 400, 'malformed-request', table);
      return;
    }

    const selected = await routeBackend(table, options.installed, options.routes);
    if (!selected.ok) {
      failure(
        response,
        422,
        'route-refused',
        `${selected.error.kind}: ${selected.error.message}`,
        selected.error.kind === 'content-unsupported' ? selected.error : undefined,
      );
      return;
    }
    if (selected.backend.determinism !== 'observed') {
      failure(response, 422, 'route-refused', 'the browser gateway accepts observed backends only');
      return;
    }

    let opened: Awaited<ReturnType<typeof selected.backend.open>>;
    try {
      opened = await selected.backend.open(table);
    } catch (cause) {
      failure(
        response,
        502,
        'backend-refused',
        `backend open failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return;
    }
    if (!opened.ok) {
      failure(response, 422, 'backend-refused', opened.error.message, opened.error);
      return;
    }
    if (stopping()) {
      await release(opened.session);
      failure(response, 503, 'server-closing', 'the gateway is closing');
      return;
    }
    const token = randomUUID();
    const live: LiveSession = {
      token,
      revision: opened.session.submitted,
      session: opened.session,
      busy: false,
      closed: false,
      closing: null,
      recorded: false,
      touchedAt: reclaimed.now(),
    };
    sessions.set(token, live);
    snapshot(response, live);
  } finally {
    capacity.opening -= 1;
  }
}

interface MoveRequest {
  readonly revision: number;
  readonly move: string;
}

function readMove(value: unknown): string | MoveRequest {
  if (!isRecord(value) || value['protocol'] !== BACKEND_GATEWAY_PROTOCOL) {
    return 'the request has no recognized protocol';
  }
  if (!Number.isSafeInteger(value['revision']) || (value['revision'] as number) < 0) {
    return 'the request has no nonnegative safe-integer revision';
  }
  if (!nonempty(value['move'])) return 'the request has no move id';
  return { revision: value['revision'] as number, move: value['move'] };
}

async function submitMove(
  live: LiveSession,
  recorder: GameplayRecorder | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const parsed = await bodyOf(request, response);
  if (parsed === undefined) return;
  const move = readMove(parsed);
  if (typeof move === 'string') {
    failure(response, 400, 'malformed-request', move);
    return;
  }
  if (move.revision !== live.revision) {
    failure(
      response,
      409,
      'stale-revision',
      `revision ${String(move.revision)} is stale; the session is at ${String(live.revision)}`,
    );
    return;
  }
  if (live.busy) {
    failure(response, 409, 'session-busy', 'the session is already submitting a move');
    return;
  }
  const decision = live.session.decision;
  if (decision === null || !decision.options.some((option) => option.id === move.move)) {
    failure(response, 409, 'unknown-move', 'the move id was not offered at this revision');
    return;
  }

  live.busy = true;
  try {
    const submitted = await live.session.submit(move.move);
    if (live.closed) {
      if (submitted.ok) await release(submitted.session);
      failure(response, 404, 'unknown-session', 'the session was closed while the move was pending');
      return;
    }
    if (!submitted.ok) {
      failure(response, 409, 'backend-refused', submitted.error.message, submitted.error);
      return;
    }
    live.session = submitted.session;
    live.revision = submitted.session.submitted;
    captureFinished(live, recorder);
    snapshot(response, live);
  } catch (cause) {
    failure(
      response,
      502,
      'backend-refused',
      `backend submit failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  } finally {
    live.busy = false;
  }
}

async function handleSession(
  sessions: Map<string, LiveSession>,
  reclaimed: Reclaim,
  recorder: GameplayRecorder | undefined,
  token: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const live = sessions.get(token);
  if (live === undefined) {
    request.resume();
    failure(
      response,
      404,
      'unknown-session',
      reclaimed.tokens.has(token)
        ? `this game was closed to make room for a new one after ${String(BACKEND_GATEWAY_ABANDONED_AFTER_MS / 60_000)} minutes without a move; start a new game`
        : 'no session answers to that capability',
    );
    return;
  }
  live.touchedAt = reclaimed.now();
  if (request.method === 'DELETE') {
    request.resume();
    sessions.delete(token);
    captureFinished(live, recorder);
    await closeLive(live);
    json(response, 200, { protocol: BACKEND_GATEWAY_PROTOCOL, ok: true, closed: true });
    return;
  }
  if (request.method !== 'POST') {
    request.resume();
    failure(
      response,
      405,
      'wrong-method',
      'a move is submitted with POST and a session is closed with DELETE',
    );
    return;
  }
  await submitMove(live, recorder, request, response);
}

function tokenOf(pathname: string): string | null {
  const segments = pathname.split('/').filter((part) => part.length > 0);
  if (segments.length !== 3 || segments[0] !== 'engine-api' || segments[1] !== 'sessions') return null;
  return segments[2] ?? null;
}

function reportReadiness(
  options: BackendGatewayOptions,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  request.resume();
  if (request.method !== 'GET') {
    failure(response, 405, 'wrong-method', 'gateway readiness is read with GET');
    return;
  }
  const format = url.searchParams.get('format');
  if (format === null || format.trim() === '') {
    failure(response, 400, 'malformed-request', 'gateway readiness requires a format');
    return;
  }
  const backend = options.routes.printed[format];
  const ready =
    backend !== undefined && options.installed.filter((candidate) => candidate.id === backend).length === 1;
  json(response, 200, {
    protocol: BACKEND_GATEWAY_PROTOCOL,
    ok: true,
    format,
    ready,
  });
}

export function serveBackendGateway(options: BackendGatewayOptions): Promise<RunningBackendGateway> {
  const sessions = new Map<string, LiveSession>();
  const capacity: Capacity = { opening: 0 };
  const reclaimed: Reclaim = { now: options.now ?? Date.now, tokens: new Set<string>() };
  const operations = new Set<Promise<void>>();
  let stopping = false;
  let closing: Promise<void> | null = null;

  const track = (operation: Promise<void>, response: ServerResponse): void => {
    const guarded = operation.catch((cause: unknown) => {
      if (!response.writableEnded) {
        try {
          failure(
            response,
            500,
            'backend-refused',
            `gateway handler failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        } catch {
          // A disconnected response has no receiver. The guarded promise must
          // still settle so shutdown never inherits an unhandled rejection.
        }
      }
    });
    operations.add(guarded);
    void guarded.then(() => operations.delete(guarded));
  };
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://gateway.invalid');
    if (stopping) {
      request.resume();
      failure(response, 503, 'server-closing', 'the gateway is closing');
      return;
    }
    if (url.pathname === '/engine-api/sessions') {
      track(
        openSession(options, sessions, capacity, reclaimed, request, response, () => stopping),
        response,
      );
      return;
    }
    if (url.pathname === '/engine-api/readiness') {
      reportReadiness(options, url, request, response);
      return;
    }
    const token = tokenOf(url.pathname);
    if (token !== null) {
      track(handleSession(sessions, reclaimed, options.recorder, token, request, response), response);
      return;
    }
    request.resume();
    failure(response, 404, 'not-found', 'no such gateway route');
  });

  return new Promise<RunningBackendGateway>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      server.off('error', reject);
      resolve({
        port,
        host: options.host,
        close: (): Promise<void> => {
          if (closing !== null) return closing;
          stopping = true;
          closing = (async (): Promise<void> => {
            const owned = [...sessions.values()];
            sessions.clear();
            const releasing = owned.map(closeLive);
            const failures: unknown[] = [];
            try {
              await Promise.all([...operations]);
              await Promise.all(releasing);
              const backends = [...new Set(options.installed)];
              const shutdowns = await Promise.allSettled(
                backends.map((backend) => backend.shutdown?.() ?? Promise.resolve()),
              );
              for (const result of shutdowns) {
                if (result.status === 'rejected') failures.push(result.reason);
              }
            } catch (cause) {
              failures.push(cause);
            } finally {
              server.closeAllConnections();
              try {
                await new Promise<void>((done, failed) => {
                  server.close((cause) => {
                    if (cause === undefined) done();
                    else failed(cause);
                  });
                });
              } catch (cause) {
                failures.push(cause);
              }
            }
            if (failures.length > 0) {
              throw new AggregateError(failures, 'backend gateway shutdown failed');
            }
          })();
          return closing;
        },
      });
    });
  });
}
