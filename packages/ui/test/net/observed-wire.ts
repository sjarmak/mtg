/**
 * A LAN Forge table reached without a socket.
 *
 * `observedSeatBackend` takes a `fetch`, and this one answers the way
 * `packages/netplay/src/observed-routes.ts` does, over a real dealer held in
 * memory: the seat's frame on GET, held while `?revision=` is current and
 * released by the table's own `watch`; a frame or a 409 refusal for a posted
 * deck or move; the frame after leaving on DELETE; 404 for a token no seat
 * answers to; and the health answer the launcher gives when it has an
 * observed arm. The routes themselves are pinned in `packages/netplay`. What
 * the ui tests need is a client reaching a table the way a browser would, with
 * no port, so every frame is one the table actually built rather than a
 * fixture that might drift from it.
 */
import type { LobbySeat, ObservedClock, ObservedDealer, ObservedTable } from '@mtg/netplay';
import { OBSERVED_TABLE_PROTOCOL, readObservedMove } from '@mtg/netplay';
import { CLIENT_PROTOCOL } from '../../src/net/snapshot';

export const WIRE_BASE = '/api';

/** A clock whose deadlines never arrive; the seating and disconnect timers are not under test here. */
export function stillClock(): ObservedClock {
  return { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Answers once the table moves past the revision the seat holds, or rejects when the seat stops asking. */
function held(
  table: ObservedTable,
  seat: LobbySeat,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const unwatch = table.watch(() => {
      unwatch();
      resolve(json(200, table.frameFor(seat)));
    });
    signal?.addEventListener('abort', () => {
      unwatch();
      reject(new Error('the seat stopped asking'));
    });
  });
}

function bodyOf(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
}

async function openTable(dealer: ObservedDealer, init: RequestInit | undefined): Promise<Response> {
  const body = bodyOf(init);
  const opened = await dealer.open(body as Parameters<ObservedDealer['open']>[0]);
  if (!opened.ok) return json(400, { refused: opened.refused, code: opened.code });
  return json(201, {
    protocol: OBSERVED_TABLE_PROTOCOL,
    table: opened.table.id,
    seats: { host: opened.tokens[0], guest: opened.tokens[1] },
  });
}

async function serveSeat(
  table: ObservedTable,
  seat: LobbySeat,
  rest: string,
  url: URL,
  init: RequestInit | undefined,
): Promise<Response> {
  const method = init?.method ?? 'GET';
  if (rest === '/invite') return json(404, { refused: 'this table was started without links to hand out' });
  if (rest === '/deck' && method === 'POST') {
    const body = bodyOf(init) as { readonly deck: Parameters<ObservedTable['submitDeck']>[1] };
    const refusal = await table.submitDeck(seat, body.deck);
    return refusal === null ? json(200, table.frameFor(seat)) : json(409, refusal);
  }
  if (rest === '/moves' && method === 'POST') {
    // Through `readObservedMove`, not around it. This route used to read
    // `body.move` off the parsed body directly, which made the harness accept a
    // body the real route refuses -- and the client was sending exactly one,
    // with no `protocol` field, so every LAN move was refused in a browser
    // while every suite passed.
    const read = readObservedMove(bodyOf(init));
    if (typeof read === 'string') return json(400, { refused: read, at: table.revision });
    const refusal = await table.submit(seat, read.move);
    return refusal === null ? json(200, table.frameFor(seat)) : json(409, refusal);
  }
  if (rest === '' && method === 'DELETE') {
    await table.leave(seat);
    return json(200, table.frameFor(seat));
  }
  if (rest === '' && method === 'GET') {
    table.touch(seat);
    const revision = url.searchParams.get('revision');
    if (revision !== null && Number(revision) === table.revision) return held(table, seat, init?.signal);
    return json(200, table.frameFor(seat));
  }
  return json(405, { refused: `${method} ${rest} is not one this table answers` });
}

/** The lab's `/health`, as a launcher with an observed arm answers it. */
function health(dealer: ObservedDealer): Response {
  return json(200, {
    ok: true,
    protocol: CLIENT_PROTOCOL,
    rooms: false,
    drafts: false,
    deals: true,
    observed: { protocol: OBSERVED_TABLE_PROTOCOL, formats: dealer.formats },
  });
}

/** A `fetch` that answers for `dealer` at `WIRE_BASE`, the way the observed routes do. */
export function observedWire(dealer: ObservedDealer): typeof globalThis.fetch {
  const prefix = `${WIRE_BASE}/observed`;
  return (input, init) => {
    const url = new URL(String(input), 'http://lab.test');
    if (url.pathname === `${WIRE_BASE}/health`) return Promise.resolve(health(dealer));
    if (url.pathname === prefix) return openTable(dealer, init);
    if (!url.pathname.startsWith(`${prefix}/`))
      return Promise.resolve(json(404, { refused: 'no such route' }));
    const [token = '', ...rest] = url.pathname.slice(prefix.length + 1).split('/');
    const found = dealer.find(token);
    if (found === null) return Promise.resolve(json(404, { refused: 'no seat answers to that link' }));
    return serveSeat(found.table, found.seat, rest.length === 0 ? '' : `/${rest.join('/')}`, url, init);
  };
}
