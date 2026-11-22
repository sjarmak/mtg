/**
 * The observed table's routes, beside the kernel table's in `server.ts`.
 *
 *   POST   /api/observed                — open a table for a format; answers both seat tokens
 *   GET    /api/observed/:token         — this seat's frame, held while `?revision=` is current
 *   POST   /api/observed/:token/deck    — this seat's deck, while seating
 *   POST   /api/observed/:token/moves   — this seat's move, while it holds the decision
 *   DELETE /api/observed/:token         — this seat leaves; the other wins in play
 *   GET    /api/observed/:token/invite  — the links the host may hand out
 *
 * Kept out of `server.ts` so that file stays the kernel table's and under its
 * length, and because these routes answer with a different shape: one frame
 * per seat from `ObservedTable.frameFor` rather than a kernel snapshot. The
 * server delegates every `/api/observed` path here first and `handleObserved`
 * answers whether it took it.
 *
 * `POST /api/observed` is the route with no token in front of it, for the
 * reason `server.ts` gives for `POST /api/tables`: a page cannot mint a seat
 * capability. What it costs is bounded by `MAX_OBSERVED_TABLES`, which is a
 * cap on Forge processes rather than on kernel games, and is answered 429 with
 * the count in the sentence.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hold, inviteFor, json, readBody } from './http-support';
import { OBSERVED_TABLE_PROTOCOL, readObservedMove, readObservedOpenRequest } from './observed-protocol';
import type { ObservedStart } from './observed-protocol';
import type { LobbySeat, ObservedDealer, ObservedTable } from './observed-table';
import { isRecord, readDeck } from './wire-readers';

interface ObservedRoute {
  readonly token: string;
  readonly kind: 'frame' | 'deck' | 'moves' | 'invite';
}

const REFUSAL_STATUS = { 'unknown-format': 404, 'table-limit': 429 } as const;

/** `/api/observed/<token>`, `…/deck`, `…/moves`, `…/invite`, or null. */
function routeOf(segments: readonly string[]): ObservedRoute | null {
  const token = segments[2] ?? '';
  if (token.length === 0) return null;
  if (segments.length === 3) return { token, kind: 'frame' };
  if (segments.length !== 4) return null;
  const tail = segments[3];
  if (tail === 'deck' || tail === 'moves' || tail === 'invite') return { token, kind: tail };
  return null;
}

/** The parsed JSON body, or null once a refusal has been written. */
async function bodyOf(request: IncomingMessage, response: ServerResponse): Promise<unknown | null> {
  const body = await readBody(request);
  if (typeof body !== 'string') {
    json(response, 413, { refused: 'the request body is longer than any request this table has' });
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch (cause: unknown) {
    json(response, 400, { refused: `the request body is not JSON (${String(cause)})` });
    return null;
  }
}

async function openTable(
  dealer: ObservedDealer,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const parsed = await bodyOf(request, response);
  if (parsed === null) return;
  const open = readObservedOpenRequest(parsed);
  if (typeof open === 'string') {
    json(response, 400, { refused: open });
    return;
  }
  const opened = await dealer.open(open);
  if (!opened.ok) {
    json(response, REFUSAL_STATUS[opened.code], { refused: opened.refused, code: opened.code });
    return;
  }
  const start: ObservedStart = {
    protocol: OBSERVED_TABLE_PROTOCOL,
    table: opened.table.id,
    seats: { host: opened.tokens[0], guest: opened.tokens[1] },
    tokens: opened.tokens,
  };
  json(response, 201, start);
}

function serveFrame(
  table: ObservedTable,
  seat: LobbySeat,
  url: URL,
  pollMs: number,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const raw = url.searchParams.get('revision');
  const revision = raw === null ? null : Number(raw);
  if (revision !== null && (!Number.isInteger(revision) || revision < 0)) {
    json(response, 400, { refused: 'revision is a whole number' });
    return;
  }
  table.touch(seat);
  if (revision !== null && revision === table.revision) {
    hold(table, pollMs, request, response, () => table.frameFor(seat));
    return;
  }
  json(response, 200, table.frameFor(seat));
}

async function submitDeck(
  table: ObservedTable,
  seat: LobbySeat,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const parsed = await bodyOf(request, response);
  if (parsed === null) return;
  const deck = isRecord(parsed)
    ? readDeck(parsed['deck'], table.request.content.kind === 'mixed')
    : 'a deck is an object';
  if (typeof deck === 'string') {
    json(response, 400, { refused: deck, at: table.revision });
    return;
  }
  const refusal = await table.submitDeck(seat, deck);
  if (refusal !== null) {
    json(response, 409, refusal);
    return;
  }
  json(response, 200, table.frameFor(seat));
}

async function submitMove(
  table: ObservedTable,
  seat: LobbySeat,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const parsed = await bodyOf(request, response);
  if (parsed === null) return;
  const read = readObservedMove(parsed);
  if (typeof read === 'string') {
    json(response, 400, { refused: read, at: table.revision });
    return;
  }
  // A refusal is 409 rather than 400 for the reason `server.ts` gives: the
  // request was well formed and the table is not where the client thought, most
  // often because the other seat moved first. The frame that follows says where.
  const refusal = await table.submit(seat, read.move);
  if (refusal !== null) {
    json(response, 409, refusal);
    return;
  }
  json(response, 200, table.frameFor(seat));
}

function serveSeat(
  found: { readonly table: ObservedTable; readonly seat: LobbySeat },
  route: ObservedRoute,
  url: URL,
  pollMs: number,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const { table, seat } = found;
  const method = request.method ?? 'GET';
  if (route.kind === 'invite') {
    if (method !== 'GET') json(response, 405, { refused: 'an invite is read, not written' });
    else if (table.invite === undefined) {
      json(response, 404, { refused: 'this table was started without links to hand out' });
    } else json(response, 200, inviteFor(table.invite, seat, table.joined));
    return;
  }
  if (route.kind === 'frame' && method === 'GET') {
    serveFrame(table, seat, url, pollMs, request, response);
    return;
  }
  if (route.kind === 'frame' && method === 'DELETE') {
    request.resume();
    void table.leave(seat).then(() => json(response, 200, table.frameFor(seat)));
    return;
  }
  if (method !== 'POST') {
    json(response, 405, { refused: `${method} is not one this table answers` });
    return;
  }
  if (route.kind === 'deck') void submitDeck(table, seat, request, response);
  else if (route.kind === 'moves') void submitMove(table, seat, request, response);
  else json(response, 405, { refused: 'a frame is read with GET or left with DELETE' });
}

/**
 * Answers an `/api/observed` request, or returns false when `url` is not one.
 *
 * `dealer` absent means the launcher started without a per-seat backend, and
 * every route here says so with a 404 rather than pretending the path is
 * unknown, because the page reads `observed` off `/api/health` and should
 * never reach this state, and a bare 404 would send it looking for a typo.
 */
export function handleObserved(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dealer: ObservedDealer | undefined,
  pollMs: number,
): boolean {
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  if (segments[0] !== 'api' || segments[1] !== 'observed') return false;
  if (dealer === undefined) {
    request.resume();
    json(response, 404, { refused: 'this server was started without a way to open an observed table' });
    return true;
  }
  if (segments.length === 2) {
    if (request.method !== 'POST') {
      request.resume();
      json(response, 405, { refused: 'an observed table is opened with POST' });
    } else void openTable(dealer, request, response);
    return true;
  }
  const route = routeOf(segments);
  if (route === null) {
    request.resume();
    json(response, 404, { refused: 'no such route' });
    return true;
  }
  const found = dealer.find(route.token);
  if (found === null) {
    request.resume();
    json(response, 404, { refused: 'no seat answers to that link' });
    return true;
  }
  serveSeat(found, route, url, pollMs, request, response);
  return true;
}
