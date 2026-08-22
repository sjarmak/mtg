/**
 * The table over HTTP. Node-only; never imported from the barrel.
 *
 * Four routes and no framework, because `node:http` is already a router with a
 * `switch` in front of it and the workspace has neither `express` nor `ws`
 * installed. Adding one is a finding to report rather than an install to run
 * (`AGENTS.md`), and none of this needs one.
 *
 *   GET  /api/health              — is anything listening, and speaking which protocol
 *   GET  /api/table/:token        — this seat's position right now
 *   GET  /api/table/:token/wait   — the same, held until it changes
 *   POST /api/table/:token        — a choice, a yield, or this seat's own stops
 *
 * `:token` is the seat. There is nothing else to identify a client with and
 * nothing else is wanted: the bead states no accounts and no matchmaking, two
 * known people on one network. What the token does buy is the thing a query
 * string would not — one player cannot open the other player's board by editing
 * a digit — and it costs one `randomUUID` at deal time.
 *
 * **Bound to loopback unless told otherwise.** `serveTable` takes a host and has
 * no default that reaches a network. The arrangement the launcher sets up is
 * Vite on the LAN proxying `/api` to this server on 127.0.0.1, so exactly one
 * listener is reachable from another machine and it is the one that was already
 * designed to be (`packages/ui/vite.config.ts` carries that argument). Same
 * origin also means no CORS headers here, which is not an oversight: a server
 * that answered every origin would undo the seat capability the moment a page in
 * another tab knew the token.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { PlayerId } from '@mtg/kernel';
import type { Table } from './table';
import { NETPLAY_PROTOCOL, readSeatRequest } from './protocol';

/** How long a held poll waits before answering with the position it has. */
export const DEFAULT_POLL_MS = 25_000;

/** A request body past this is refused unread; a choice is a hundred bytes. */
const MAX_BODY_BYTES = 64 * 1024;

export interface ServeOptions {
  readonly table: Table;
  readonly port: number;
  /** Stated, never defaulted. See the header. */
  readonly host: string;
  readonly pollMs?: number | undefined;
}

export interface RunningServer {
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    // A position is true for one revision. A cached one is a board that has
    // stopped moving, which on this surface looks exactly like a game nobody is
    // playing.
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/**
 * The body, or the reason there is none.
 *
 * Capped and counted as it arrives rather than after, because a body that is
 * refused only once it has all been buffered has already been accepted.
 */
async function readBody(request: IncomingMessage): Promise<string | { readonly tooLarge: true }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return { tooLarge: true };
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface Route {
  readonly token: string;
  readonly wait: boolean;
  readonly since: number | null;
}

/**
 * `/api/table/<token>` and `/api/table/<token>/wait?since=N`, or null.
 *
 * Parsed rather than matched with a regular expression so the two shapes are
 * visibly the only two: anything with more segments, or a `since` that is not a
 * number, is not a route this server has.
 */
function routeOf(url: URL): Route | null {
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  if (segments.length < 3 || segments[0] !== 'api' || segments[1] !== 'table') return null;
  const token = segments[2] ?? '';
  if (token.length === 0) return null;
  if (segments.length === 3) return { token, wait: false, since: null };
  if (segments.length !== 4 || segments[3] !== 'wait') return null;
  const raw = url.searchParams.get('since');
  const since = raw === null ? null : Number(raw);
  if (since !== null && (!Number.isInteger(since) || since < 0)) return null;
  return { token, wait: true, since };
}

/**
 * Answers once the table has moved past `since`, or once the wait is up.
 *
 * The whole of the push half of this protocol. A client asks with the revision
 * it last drew; if the table is already past it the answer is immediate, and
 * otherwise the request is held. Three things can end it and each of them ends
 * it exactly once — the table changed, the timer expired, or the client went
 * away — because a response written twice is a socket error and a table whose
 * listener set never shrinks is a leak the length of the game.
 */
function hold(
  table: Table,
  seat: PlayerId,
  pollMs: number,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  let settled = false;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    unwatch();
    request.off('close', finish);
    if (!response.writableEnded) json(response, 200, table.snapshotFor(seat));
  };
  const timer = setTimeout(finish, pollMs);
  const unwatch = table.watch(finish);
  request.on('close', finish);
}

function handle(table: Table, pollMs: number, request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://table.invalid');
  if (url.pathname === '/api/health') {
    json(response, 200, { ok: true, protocol: NETPLAY_PROTOCOL, table: table.id });
    return;
  }
  const route = routeOf(url);
  if (route === null) {
    json(response, 404, { refused: 'no such route' });
    return;
  }
  const seat = table.seatOf(route.token);
  if (seat === null) {
    json(response, 404, { refused: 'no seat answers to that link' });
    return;
  }
  if (request.method === 'GET') {
    if (route.wait && route.since !== null && route.since === table.revision) {
      hold(table, seat, pollMs, request, response);
      return;
    }
    json(response, 200, table.snapshotFor(seat));
    return;
  }
  if (request.method !== 'POST') {
    json(response, 405, { refused: `${request.method ?? 'that method'} is not one this table answers` });
    return;
  }
  void readBody(request).then(
    (body) => {
      if (typeof body !== 'string') {
        json(response, 413, { refused: 'the request body is longer than any request this table has' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (cause: unknown) {
        json(response, 400, { refused: `the request body is not JSON (${String(cause)})` });
        return;
      }
      const seatRequest = readSeatRequest(parsed);
      if (typeof seatRequest === 'string') {
        json(response, 400, { refused: seatRequest, at: table.snapshotFor(seat).decisions });
        return;
      }
      const refusal = table.apply(seat, seatRequest);
      // A refusal is 409 rather than 400: the request was well formed and the
      // table simply is not in the position the client thought it was, which is
      // the ordinary outcome of two people clicking at once and is answered by
      // the snapshot that comes back with it.
      if (refusal !== null) {
        json(response, 409, refusal);
        return;
      }
      json(response, 200, table.snapshotFor(seat));
    },
    (cause: unknown) => {
      json(response, 400, { refused: `the request body could not be read (${String(cause)})` });
    },
  );
}

export function serveTable(options: ServeOptions): Promise<RunningServer> {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const server: Server = createServer((request, response) => {
    handle(options.table, pollMs, request, response);
  });
  return new Promise<RunningServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      server.off('error', reject);
      resolve({
        port,
        host: options.host,
        close: (): Promise<void> =>
          new Promise<void>((done, failed) => {
            // Held polls keep a socket open for up to `pollMs`, so a close that
            // only stopped accepting would hang for the length of one wait.
            server.closeAllConnections();
            server.close((cause) => {
              if (cause === undefined) done();
              else failed(cause);
            });
          }),
      });
    });
  });
}
