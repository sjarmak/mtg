/**
 * The observed table's routes over HTTP, driven the way `server.test.ts` drives
 * the kernel table's: through fetch against a server bound to 127.0.0.1:0, with
 * the toy `scriptBackend` behind it so no JVM is needed.
 *
 * What each case checks is a status and a body shape, because those are the
 * whole of what the page in `packages/ui/src/net/observed-table.ts` reads;
 * the table's own behavior is `observed-table.test.ts`'s.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DeckRef } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import { humanSeat } from '@mtg/kernel';
import type {
  InviteResponse,
  ObservedDealer,
  ObservedSeatFrame,
  ObservedStart,
  RunningServer,
  TableInvite,
} from '@mtg/netplay';
import {
  createObservedDealer,
  createTable,
  MAX_OBSERVED_TABLES,
  OBSERVED_TABLE_PROTOCOL,
  serveTable,
} from '@mtg/netplay';
import { twoDecks } from './decks';
import { fakeClock } from './observed-clock';

const OPEN = {
  protocol: OBSERVED_TABLE_PROTOCOL,
  format: 'toy',
  content: { kind: 'printed', format: 'toy' },
  seed: 'seed-over-http',
  maximumTurns: null,
};

const HOST_DECK: DeckRef = { name: 'Host deck', cards: [{ name: 'Island', count: 40 }] };
const GUEST_DECK: DeckRef = { name: 'Guest deck', cards: [{ name: 'Forest', count: 40 }] };

function invite(_table: unknown, tokens: readonly string[]): TableInvite {
  return {
    hostSeat: 0,
    guests: [
      {
        name: 'Guest',
        links: [{ label: 'LAN', url: `http://10.0.0.2:5173/#/play?table=${tokens[1]}` }],
        joined: false,
      },
    ],
  };
}

let running: RunningServer | null = null;

async function start(observed: ObservedDealer, pollMs = 500): Promise<string> {
  running = await serveTable({ port: 0, host: '127.0.0.1', pollMs, observed });
  return `http://127.0.0.1:${String(running.port)}`;
}

/** A launcher with no per-seat backend: the kernel table's server as it always was. */
async function startBare(): Promise<string> {
  const table = createTable({
    id: 'bare',
    setup: { seed: 'netplay/observed-server/bare', decks: twoDecks(), maximumTurns: 30 },
    seats: [humanSeat('One'), humanSeat('Two')],
    seating: [
      { name: 'One', token: 'token-one' },
      { name: 'Two', token: 'token-two' },
    ],
  });
  running = await serveTable({ table, port: 0, host: '127.0.0.1', pollMs: 500 });
  return `http://127.0.0.1:${String(running.port)}`;
}

afterEach(async () => {
  if (running !== null) await running.close();
  running = null;
});

function dealer(): ObservedDealer {
  return createObservedDealer({
    backend: scriptBackend({ clock: 2 }),
    formats: ['toy'],
    clock: fakeClock(),
    invite,
  });
}

async function post(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body) });
}

async function opened(base: string): Promise<ObservedStart> {
  const response = await post(base, '/api/observed', OPEN);
  expect(response.status).toBe(201);
  return (await response.json()) as ObservedStart;
}

async function frame(base: string, token: string): Promise<ObservedSeatFrame> {
  const response = await fetch(`${base}/api/observed/${token}`);
  expect(response.status).toBe(200);
  return (await response.json()) as ObservedSeatFrame;
}

async function seated(base: string): Promise<ObservedStart> {
  const start = await opened(base);
  expect((await post(base, `/api/observed/${start.seats.host}/deck`, { deck: HOST_DECK })).status).toBe(200);
  expect((await post(base, `/api/observed/${start.seats.guest}/deck`, { deck: GUEST_DECK })).status).toBe(
    200,
  );
  return start;
}

describe('POST /api/observed', () => {
  it('opens with the requested guest deck already seated', async () => {
    const base = await start(dealer());
    const response = await post(base, '/api/observed', { ...OPEN, deck: GUEST_DECK });
    expect(response.status).toBe(201);
    const opened = (await response.json()) as ObservedStart;
    expect(await frame(base, opened.seats.host)).toMatchObject({
      phase: { kind: 'seating', submitted: [false, true] },
    });
    expect(await frame(base, opened.seats.guest)).toMatchObject({ deck: GUEST_DECK });
  });

  it('answers both seat tokens and the protocol', async () => {
    const base = await start(dealer());
    const start_ = await opened(base);
    expect(start_.protocol).toBe(OBSERVED_TABLE_PROTOCOL);
    expect(start_.table.startsWith('obs-')).toBe(true);
    expect(start_.seats.host).not.toBe(start_.seats.guest);
    const host = await frame(base, start_.seats.host);
    expect(host.seat).toBe(0);
    expect(host.phase.kind).toBe('seating');
    expect((await frame(base, start_.seats.guest)).seat).toBe(1);
  });

  it('refuses a body the reader refuses with 400 and a sentence', async () => {
    const base = await start(dealer());
    const response = await post(base, '/api/observed', { ...OPEN, format: '' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ refused: 'the request names no format' });
    const notJson = await fetch(`${base}/api/observed`, { method: 'POST', body: '{' });
    expect(notJson.status).toBe(400);
  });

  it('refuses an unknown format with 404 and a full house with 429, each with its code', async () => {
    const base = await start(dealer());
    const unknown = await post(base, '/api/observed', { ...OPEN, format: 'nope' });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ refused: 'nope is not served here', code: 'unknown-format' });
    for (let count = 0; count < MAX_OBSERVED_TABLES; count += 1) await opened(base);
    const full = await post(base, '/api/observed', OPEN);
    expect(full.status).toBe(429);
    expect(await full.json()).toMatchObject({ code: 'table-limit' });
  });

  it('answers 405 to any other method and 404 when no dealer was configured', async () => {
    const base = await start(dealer());
    expect((await fetch(`${base}/api/observed`)).status).toBe(405);
    await running?.close();
    const bare = await startBare();
    const response = await post(bare, '/api/observed', OPEN);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      refused: 'this server was started without a way to open an observed table',
    });
    expect((await fetch(`${bare}/api/observed/obs-x`)).status).toBe(404);
  });
});

describe('GET /api/health', () => {
  it('names the observed formats only when a dealer is configured', async () => {
    const base = await start(dealer());
    const health = (await (await fetch(`${base}/api/health`)).json()) as Record<string, unknown>;
    expect(health['observed']).toEqual({ protocol: OBSERVED_TABLE_PROTOCOL, formats: ['toy'] });
    await running?.close();
    const bare = await startBare();
    const without = (await (await fetch(`${bare}/api/health`)).json()) as Record<string, unknown>;
    expect('observed' in without).toBe(false);
  });
});

describe('GET /api/observed/:token', () => {
  it('answers 404 to a token nobody holds and 400 to a revision that is not a count', async () => {
    const base = await start(dealer());
    const start_ = await opened(base);
    expect((await fetch(`${base}/api/observed/obs-nobody`)).status).toBe(404);
    expect((await fetch(`${base}/api/observed/${start_.seats.host}?revision=x`)).status).toBe(400);
    expect((await fetch(`${base}/api/observed/${start_.seats.host}/nothing`)).status).toBe(404);
  });

  it('holds a poll at the current revision until the other seat changes it', async () => {
    const base = await start(dealer());
    const start_ = await opened(base);
    const before = await frame(base, start_.seats.host);
    const held = fetch(`${base}/api/observed/${start_.seats.host}?revision=${String(before.revision)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await post(base, `/api/observed/${start_.seats.guest}/deck`, { deck: GUEST_DECK })).status).toBe(
      200,
    );
    const answered = (await (await held).json()) as ObservedSeatFrame;
    expect(answered.revision).toBe(before.revision + 1);
    expect(answered.phase).toMatchObject({ kind: 'seating', submitted: [false, true] });
  });

  it('answers a held poll with the current frame when the wait runs out', async () => {
    const base = await start(dealer(), 30);
    const start_ = await opened(base);
    const before = await frame(base, start_.seats.host);
    const answered = await frame(base, `${start_.seats.host}?revision=${String(before.revision)}`);
    expect(answered.revision).toBe(before.revision);
  });
});

describe('POST /api/observed/:token/deck', () => {
  it('refuses a body with no deck with 400 and a second deck with 409', async () => {
    const base = await start(dealer());
    const start_ = await opened(base);
    const empty = await post(base, `/api/observed/${start_.seats.host}/deck`, {});
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ at: 0 });
    expect((await post(base, `/api/observed/${start_.seats.host}/deck`, { deck: HOST_DECK })).status).toBe(
      200,
    );
    const again = await post(base, `/api/observed/${start_.seats.host}/deck`, { deck: HOST_DECK });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ at: 1 });
    expect((await fetch(`${base}/api/observed/${start_.seats.host}/deck`)).status).toBe(405);
  });
});

describe('POST /api/observed/:token/moves', () => {
  it('relays a move from the seat holding the decision and refuses the other seat', async () => {
    const base = await start(dealer());
    const start_ = await seated(base);
    const host = await frame(base, start_.seats.host);
    expect(host.phase).toMatchObject({ kind: 'playing', decision: { seat: 0 } });
    const wrong = await post(base, `/api/observed/${start_.seats.guest}/moves`, {
      protocol: OBSERVED_TABLE_PROTOCOL,
      move: 'advance',
    });
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toEqual({ refused: "it is not this seat's decision", at: host.revision });
    const noMove = await post(base, `/api/observed/${start_.seats.host}/moves`, {
      protocol: OBSERVED_TABLE_PROTOCOL,
    });
    expect(noMove.status).toBe(400);
    const right = await post(base, `/api/observed/${start_.seats.host}/moves`, {
      protocol: OBSERVED_TABLE_PROTOCOL,
      move: 'advance',
    });
    expect(right.status).toBe(200);
    const after = (await right.json()) as ObservedSeatFrame;
    expect(after.revision).toBe(host.revision + 1);
    expect(after.phase).toMatchObject({ kind: 'playing', decision: null });
  });
});

describe('DELETE /api/observed/:token', () => {
  it('ends a seating table and hands the game to the other seat in play', async () => {
    const base = await start(dealer());
    const first = await opened(base);
    const left = await fetch(`${base}/api/observed/${first.seats.host}`, { method: 'DELETE' });
    expect(left.status).toBe(200);
    expect(((await left.json()) as ObservedSeatFrame).phase).toMatchObject({ kind: 'ended', reason: 'left' });
    const second = await seated(base);
    const conceded = await fetch(`${base}/api/observed/${second.seats.guest}`, { method: 'DELETE' });
    expect(((await conceded.json()) as ObservedSeatFrame).phase).toMatchObject({
      kind: 'finished',
      result: { winner: 0, reason: 'Guest left the table' },
    });
  });
});

describe('GET /api/observed/:token/invite', () => {
  it('hands the host the guest link and marks the guest joined once it has polled', async () => {
    const base = await start(dealer());
    const start_ = await opened(base);
    const before = (await (
      await fetch(`${base}/api/observed/${start_.seats.host}/invite`)
    ).json()) as InviteResponse;
    expect(before).toMatchObject({ host: true, guests: [{ joined: false }] });
    expect(JSON.stringify(before)).toContain(start_.seats.guest);
    await frame(base, start_.seats.guest);
    const after = (await (
      await fetch(`${base}/api/observed/${start_.seats.host}/invite`)
    ).json()) as InviteResponse;
    expect(after).toMatchObject({ host: true, guests: [{ joined: true }] });
    const guest = (await (
      await fetch(`${base}/api/observed/${start_.seats.guest}/invite`)
    ).json()) as InviteResponse;
    expect(guest).toEqual({ host: false });
    expect((await fetch(`${base}/api/observed/${start_.seats.host}/invite`, { method: 'POST' })).status).toBe(
      405,
    );
  });

  it('answers 404 when the table was opened without links', async () => {
    const base = await start(
      createObservedDealer({ backend: scriptBackend({ clock: 2 }), formats: ['toy'], clock: fakeClock() }),
    );
    const start_ = await opened(base);
    expect((await fetch(`${base}/api/observed/${start_.seats.host}/invite`)).status).toBe(404);
  });
});
