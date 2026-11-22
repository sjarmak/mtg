/**
 * The room over the wire: `POST /api/rooms`, then two seats building.
 *
 * `room.test.ts` argues the object. This argues the seam, and the claims are the
 * ones that decide whether a build screen can be put on the far end of a link:
 *
 *  - Opening a room hands back one seat, the host's, and the guest's capability
 *    is not in the bytes. Same rule as `POST /api/tables`, second caller.
 *  - A seat reading its room gets its own pool. The other seat's cards never
 *    cross, before there is a game to conceal them in.
 *  - The token that read the room is the token that plays the table. Nothing is
 *    reissued when the second deck lands, so nobody is handed a second link.
 *  - Until then the seat route says *why* there is no position, rather than 404
 *    (which reads as a bad link) or an empty board.
 *  - A malformed build is a 400 and a refused one is a 409 carrying the room's
 *    sentence, which is the same bargain the play route already strikes.
 *  - One POST route carries both a pick and a deck, and the room decides which
 *    it is reading. A page that sends the other one is told so in the phase it
 *    is actually in, rather than being allowed to submit a deck out of a pool it
 *    has not finished drafting.
 *  - The room serves the set its pool is printed in, behind the same token. The
 *    pool crosses as ids, and which set they name is a fact about the room; the
 *    page used to supply it and got it wrong the moment the two ends had
 *    different sets staged (`mtg-77i6`).
 *
 * Bound to 127.0.0.1 on port 0. Nothing here listens on a network interface.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { DealtRoom, RoomView, RunningServer, SeatSnapshot, Table } from '@mtg/netplay';
import { createTable, MAX_LIVE_TABLES, NETPLAY_PROTOCOL, openRoom, serveTable } from '@mtg/netplay';
import { humanSeat } from '@mtg/kernel';
import { twoDecks } from './decks';

const HOST = 'host-token';
const GUEST = 'guest-token';

function openedRoom(n: number): DealtRoom {
  const tokens: readonly [string, string] = [`${HOST}-${String(n)}`, `${GUEST}-${String(n)}`];
  const room = openRoom({
    id: `room-${String(n)}`,
    set: EXAMPLE_CARDS,
    seed: `netplay/room-route/${String(n)}`,
    plan: [
      { name: 'One', token: tokens[0] },
      { name: 'Two', token: tokens[1] },
    ],
  });
  return {
    room,
    hostToken: tokens[0],
    invite: {
      hostSeat: 0,
      guests: [
        {
          name: 'Two',
          links: [{ label: 'This network', url: `http://192.168.1.20:5173/#/play?room=${tokens[1]}` }],
          joined: false,
        },
      ],
    },
  };
}

/**
 * The drafting half, on a set with collation sheets.
 *
 * `EXAMPLE_CARDS` opens a sealed pool and cannot fill a pack, so a drafting room
 * needs a real set; the fixture is the one `@mtg/draft-export`'s own pod tests
 * use. Loaded once, and only by the tests that draft.
 */
const DRAFT_SET_FIXTURE = fileURLToPath(
  new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

let draftSet: readonly Card[] | null = null;

function draftingSet(): readonly Card[] {
  if (draftSet === null) {
    const raw: unknown = JSON.parse(readFileSync(DRAFT_SET_FIXTURE, 'utf8'));
    const { cards } = raw as { cards: unknown[] };
    draftSet = cards.map((card) => parseCard(card));
  }
  return draftSet;
}

/** A server whose one room drafts three packs rather than dealing two pools. */
async function startDraftingRooms(): Promise<string> {
  running = await serveTable({
    port: 0,
    host: '127.0.0.1',
    pollMs: 500,
    rooms: () => {
      const tokens: readonly [string, string] = [`${HOST}-1`, `${GUEST}-1`];
      const room = openRoom({
        id: 'room-1',
        set: draftingSet(),
        seed: 'netplay/room-route/draft',
        plan: [
          { name: 'One', token: tokens[0] },
          { name: 'Two', token: tokens[1] },
        ],
        draft: { packs: 3 },
      });
      return { room, hostToken: tokens[0], invite: { hostSeat: 0, guests: [] } };
    },
  });
  return `http://127.0.0.1:${String(running.port)}`;
}

/** A table with both decks already built, which is what a room is not. */
function dealtTable(): Table {
  return createTable({
    id: 'dealt',
    setup: { seed: 'netplay/room-route/dealt', decks: twoDecks(), maximumTurns: 30 },
    seats: [humanSeat('One'), humanSeat('Two')],
    seating: [
      { name: 'One', token: 'dealt-host' },
      { name: 'Two', token: 'dealt-guest' },
    ],
  });
}

let running: RunningServer | null = null;

afterEach(async () => {
  if (running !== null) await running.close();
  running = null;
});

async function startRooms(): Promise<string> {
  let n = 0;
  running = await serveTable({
    port: 0,
    host: '127.0.0.1',
    pollMs: 500,
    rooms: () => {
      n += 1;
      return openedRoom(n);
    },
  });
  return `http://127.0.0.1:${String(running.port)}`;
}

async function openRoute(base: string): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await fetch(`${base}/api/rooms`, { method: 'POST' });
  return { status: response.status, body: await response.json() };
}

async function readRoom(base: string, token: string): Promise<RoomView> {
  const response = await fetch(`${base}/api/room/${token}`);
  expect(response.status).toBe(200);
  return (await response.json()) as RoomView;
}

async function send(
  base: string,
  token: string,
  build: unknown,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await fetch(`${base}/api/room/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(build),
  });
  return { status: response.status, body: await response.json() };
}

/** A legal build out of what the seat was told it has. See `room.test.ts`. */
function legalBuild(view: RoomView): { readonly chosen: number[]; readonly basics: null } {
  const byId = new Map(EXAMPLE_CARDS.map((card: Card) => [card.id, card]));
  const chosen: number[] = [];
  for (const [index, id] of view.pool.entries()) {
    if (chosen.length >= 23) break;
    if (byId.get(id)?.kind === 'land') continue;
    chosen.push(index);
  }
  return { chosen, basics: null };
}

describe('opening a room from the page', () => {
  it('hands back the host seat and nothing about the other one', async () => {
    const base = await startRooms();
    const opened = await openRoute(base);

    expect(opened.status).toBe(201);
    const body = opened.body as { token: string; protocol: number; room: string };
    expect(body.protocol).toBe(NETPLAY_PROTOCOL);
    expect(body.token).toBe(`${HOST}-1`);
    expect(JSON.stringify(opened.body)).not.toContain(`${GUEST}-1`);
  });

  it('says it opens rooms, so the page can draw the second button', async () => {
    const base = await startRooms();
    const health = await fetch(`${base}/api/health`);
    expect(await health.json()).toEqual({
      ok: true,
      protocol: NETPLAY_PROTOCOL,
      deals: false,
      rooms: true,
      drafts: false,
      records: false,
    });
  });

  it('refuses a room when the server was started without a way to open one', async () => {
    // A server holding a dealt table and nothing else, which is every launcher
    // that predates the build screen. It must not become a way to open a room by
    // surprise, and the refusal names the room rather than the table.
    running = await serveTable({ table: dealtTable(), port: 0, host: '127.0.0.1', pollMs: 500 });
    const base = `http://127.0.0.1:${String(running.port)}`;
    const refused = await openRoute(base);
    expect(refused.status).toBe(404);
    expect(JSON.stringify(refused.body)).toContain('without a way to open a room');
  });

  it('is written to, not read', async () => {
    const base = await startRooms();
    const read = await fetch(`${base}/api/rooms`);
    expect(read.status).toBe(405);
  });

  it('stops at the same cap live tables stop at', async () => {
    const base = await startRooms();
    for (let n = 0; n < MAX_LIVE_TABLES; n += 1) {
      expect((await openRoute(base)).status).toBe(201);
    }
    expect((await openRoute(base)).status).toBe(429);
  });
});

describe('a seat in a room', () => {
  it('reads its own pool and is told nothing of the other one', async () => {
    const base = await startRooms();
    await openRoute(base);
    const host = await readRoom(base, `${HOST}-1`);
    const guest = await readRoom(base, `${GUEST}-1`);

    expect(host.seat).toBe(0);
    expect(guest.seat).toBe(1);
    expect(host.phase).toBe('build');
    expect(host.pool.length).toBeGreaterThan(0);
    expect(host.pool).not.toEqual(guest.pool);
    expect(host.deckSize).toBeGreaterThan(0);
    // Both seats are named, so a page can say who it is waiting for, and neither
    // view carries the other's cards.
    expect(host.seats.map((entry) => entry.name)).toEqual(['One', 'Two']);
    expect(host.seats.every((entry) => !entry.ready)).toBe(true);
  });

  it('has no position to send until both seats have built', async () => {
    const base = await startRooms();
    await openRoute(base);
    const waiting = await fetch(`${base}/api/table/${HOST}-1`);
    expect(waiting.status).toBe(409);
    expect(JSON.stringify(await waiting.json())).toContain('still building');
  });

  it('falls through to the table it built, under the same link', async () => {
    const base = await startRooms();
    await openRoute(base);
    const host = await readRoom(base, `${HOST}-1`);
    const guest = await readRoom(base, `${GUEST}-1`);

    const first = await send(base, `${HOST}-1`, legalBuild(host));
    expect(first.status).toBe(200);
    expect((first.body as RoomView).phase).toBe('build');
    expect((first.body as RoomView).seats[0]?.ready).toBe(true);

    const second = await send(base, `${GUEST}-1`, legalBuild(guest));
    expect(second.status).toBe(200);
    expect((second.body as RoomView).phase).toBe('playing');

    // The token that read the room plays the table, which is the whole reason a
    // room is a phase rather than a second game.
    const seat = await fetch(`${base}/api/table/${GUEST}-1`);
    expect(seat.status).toBe(200);
    expect(((await seat.json()) as SeatSnapshot).seat).toBe(1);
  });

  it('answers a build it cannot read with a 400 and one it will not take with a 409', async () => {
    const base = await startRooms();
    await openRoute(base);
    const host = await readRoom(base, `${HOST}-1`);

    const unreadable = await send(base, `${HOST}-1`, { chosen: 'everything' });
    expect(unreadable.status).toBe(400);
    expect(JSON.stringify(unreadable.body)).toContain('pool indices');

    const short = await send(base, `${HOST}-1`, { chosen: [0], basics: null });
    expect(short.status).toBe(409);
    const refused = short.body as { refused: string; room: RoomView };
    expect(refused.refused).toContain('this table plays');
    // The view rides along with the refusal, so a page that was told no does not
    // then have to ask what it is looking at.
    expect(refused.room.pool).toEqual(host.pool);
    expect(refused.room.seats[0]?.ready).toBe(false);
  });

  it('serves the set its pool is printed in, so the page never has to supply one', async () => {
    const base = await startRooms();
    await openRoute(base);
    const host = await readRoom(base, `${HOST}-1`);
    const response = await fetch(`${base}/api/room/${HOST}-1/set`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { protocol: number; cards: readonly Card[] };
    expect(body.protocol).toBe(NETPLAY_PROTOCOL);
    expect(body.cards.map((card) => card.id)).toEqual(EXAMPLE_CARDS.map((card: Card) => card.id));
    // The claim that makes the route worth having: every id in this seat's pool
    // is printed by the set the same route just served.
    const printed = new Set(body.cards.map((card) => card.id));
    expect(host.pool.filter((id) => !printed.has(id))).toEqual([]);
  });

  it('holds the set behind the same capability as the room', async () => {
    const base = await startRooms();
    await openRoute(base);
    expect((await fetch(`${base}/api/room/not-a-token/set`)).status).toBe(404);
  });

  it('will not be written to, since a set is read', async () => {
    const base = await startRooms();
    await openRoute(base);
    const written = await fetch(`${base}/api/room/${HOST}-1/set`, { method: 'POST', body: '{}' });
    expect(written.status).toBe(405);
  });

  it('does not count reading the set as the other seat arriving', async () => {
    const base = await startRooms();
    await openRoute(base);
    await fetch(`${base}/api/room/${GUEST}-1/set`);
    const invite = await fetch(`${base}/api/table/${HOST}-1/invite`);
    const body = (await invite.json()) as { guests: readonly { joined: boolean }[] };
    // A browser fetching a card list is not a person in the room, and the host's
    // panel closes on the second one.
    expect(body.guests[0]?.joined).toBe(false);
  });

  it('does not answer to a link no seat holds', async () => {
    const base = await startRooms();
    await openRoute(base);
    const stranger = await fetch(`${base}/api/room/not-a-token`);
    expect(stranger.status).toBe(404);
  });

  it('keeps answering after the game starts, which is how a page learns it did', async () => {
    const base = await startRooms();
    await openRoute(base);
    const host = await readRoom(base, `${HOST}-1`);
    const guest = await readRoom(base, `${GUEST}-1`);
    await send(base, `${HOST}-1`, legalBuild(host));
    await send(base, `${GUEST}-1`, legalBuild(guest));
    expect((await readRoom(base, `${HOST}-1`)).phase).toBe('playing');
  });

  it('is not a room at all when the table was dealt with its decks already built', async () => {
    running = await serveTable({ table: dealtTable(), port: 0, host: '127.0.0.1', pollMs: 500 });
    const base = `http://127.0.0.1:${String(running.port)}`;
    const asked = await fetch(`${base}/api/room/dealt-host`);
    expect(asked.status).toBe(404);
    expect(JSON.stringify(await asked.json())).toContain('decks already built');
    // Its set route says the same thing, rather than 404ing as a bad link.
    const set = await fetch(`${base}/api/room/dealt-host/set`);
    expect(set.status).toBe(404);
    expect(JSON.stringify(await set.json())).toContain('decks already built');
    // And that seat still plays, because the route it uses is the other one.
    expect((await fetch(`${base}/api/table/dealt-host`)).status).toBe(200);
  });
});

describe('two seats drafting one pod', () => {
  it('opens on the draft with a pack in front of each seat and neither pool filled', async () => {
    const base = await startDraftingRooms();
    await openRoute(base);
    const host = await readRoom(base, `${HOST}-1`);
    const guest = await readRoom(base, `${GUEST}-1`);

    expect(host.phase).toBe('draft');
    expect(host.rounds).toBe(3);
    expect(host.pool).toEqual([]);
    expect(host.pack?.round).toBe(1);
    expect(host.pack?.cards.length).toBeGreaterThan(0);
    // Each seat's pack is its own, and neither view carries the other's.
    expect(guest.pack?.cards).not.toEqual(host.pack?.cards);
    expect(JSON.stringify(host)).not.toContain(guest.pack?.cards[0] ?? 'nothing');
  });

  it('takes a pick by position and holds the pack until the other seat picks too', async () => {
    const base = await startDraftingRooms();
    await openRoute(base);
    const host = await readRoom(base, `${HOST}-1`);
    const wanted = host.pack?.cards[0];

    const picked = await send(base, `${HOST}-1`, { pick: 0 });
    expect(picked.status).toBe(200);
    const after = picked.body as RoomView;
    expect(after.pool).toEqual([wanted]);
    expect(after.pack).toBeNull();
    expect(after.seats.map((entry) => entry.ready)).toEqual([true, false]);

    // The other seat is still looking at exactly the pack it was looking at.
    const guest = await readRoom(base, `${GUEST}-1`);
    expect(guest.pack?.pickNumber).toBe(1);
  });

  it('reads a deck as a pick while the draft is on, and says so', async () => {
    const base = await startDraftingRooms();
    await openRoute(base);
    const sent = await send(base, `${HOST}-1`, { chosen: [0, 1], basics: null });
    expect(sent.status).toBe(400);
    expect(JSON.stringify(sent.body)).toContain('whole position in the pack');
    // And nothing was taken.
    expect((await readRoom(base, `${HOST}-1`)).pool).toEqual([]);
  });

  it('answers a pick the pack cannot fill with a 409 carrying the room', async () => {
    const base = await startDraftingRooms();
    await openRoute(base);
    const host = await readRoom(base, `${HOST}-1`);
    const refused = await send(base, `${HOST}-1`, { pick: host.pack?.cards.length ?? 0 });
    expect(refused.status).toBe(409);
    const body = refused.body as { refused: string; room: RoomView };
    expect(body.refused).toContain('no card at position');
    expect(body.room.pack?.cards).toEqual(host.pack?.cards);
  });

  it('drafts out, builds, and plays under the tokens it started with', async () => {
    const base = await startDraftingRooms();
    await openRoute(base);

    for (let guard = 0; guard < 200; guard += 1) {
      const host = await readRoom(base, `${HOST}-1`);
      if (host.phase !== 'draft') break;
      for (const token of [`${HOST}-1`, `${GUEST}-1`]) {
        const view = await readRoom(base, token);
        if (view.pack === null) continue;
        expect((await send(base, token, { pick: 0 })).status).toBe(200);
      }
    }

    const host = await readRoom(base, `${HOST}-1`);
    const guest = await readRoom(base, `${GUEST}-1`);
    expect(host.phase).toBe('build');
    expect(host.pack).toBeNull();
    expect(host.pool.length).toBeGreaterThan(0);
    expect(host.pool).not.toEqual(guest.pool);

    // A pick body is now read as the deck it is not, which is the same rule
    // running the other way.
    const late = await send(base, `${HOST}-1`, { pick: 0 });
    expect(late.status).toBe(400);
    expect(JSON.stringify(late.body)).toContain('pool indices');

    const build = (view: RoomView): { chosen: number[]; basics: null } => ({
      chosen: view.pool.map((_, index) => index).slice(0, 23),
      basics: null,
    });
    expect((await send(base, `${HOST}-1`, build(host))).status).toBe(200);
    const second = await send(base, `${GUEST}-1`, build(guest));
    expect(second.status).toBe(200);
    expect((second.body as RoomView).phase).toBe('playing');

    const seat = await fetch(`${base}/api/table/${GUEST}-1`);
    expect(seat.status).toBe(200);
    expect(((await seat.json()) as SeatSnapshot).seat).toBe(1);
  });
});
