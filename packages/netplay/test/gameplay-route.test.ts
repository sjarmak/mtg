/**
 * The recording seam on the served table: the four `/api/games` arms and the
 * hook that hands a finished kernel table over without any of them.
 *
 * Every refusal the route can make is pinned here by its status and its name,
 * because the browser reads the name to decide what to tell the person, and
 * because each ceiling exists for a stated reason (`games-route.ts`) that a
 * change to the number should have to re-argue. The recorder is a fake: what it
 * does with a capture is `packages/ui/test/tools/gameplay-recorder.test.ts`'s
 * subject, and this file's is what reaches it and what does not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameSetup } from '@mtg/kernel';
import { botSeat, humanSeat, simpleAgent } from '@mtg/kernel';
import type {
  GameplayCapture,
  GameplayRecorded,
  GameplayRecorder,
  RunningServer,
  SeatSnapshot,
  Table,
} from '@mtg/netplay';
import {
  createTable,
  MAX_GAME_BODY_BYTES,
  MAX_OPEN_RECORDINGS,
  MAX_RECORDED_POSTS,
  NETPLAY_PROTOCOL,
  serveTable,
} from '@mtg/netplay';
import { twoDecks } from './decks';

const SETUP: GameSetup = { seed: 'netplay/games/v0', decks: twoDecks(), maximumTurns: 30 };

interface FakeRecorder extends GameplayRecorder {
  readonly captures: GameplayCapture[];
}

function recorder(answer: GameplayRecorded = { ok: true, id: 'served-id' }): FakeRecorder {
  const captures: GameplayCapture[] = [];
  return {
    captures,
    record: vi.fn((capture: GameplayCapture): Promise<GameplayRecorded> => {
      captures.push(capture);
      return Promise.resolve(answer);
    }),
    index: vi.fn(() => Promise.resolve([{ id: 'served-id', path: '20260916/served-id.json' }])),
    read: vi.fn((id: string) => Promise.resolve(id === 'served-id' ? '{"id":"served-id"}' : null)),
  };
}

function table(): Table {
  return createTable({
    id: 'served',
    setup: SETUP,
    format: 'sealed',
    seats: [humanSeat('One'), botSeat(simpleAgent('Two'))],
    seating: [
      { name: 'One', token: 'token-one' },
      { name: 'Two', token: null },
    ],
  });
}

let running: RunningServer | null = null;

async function start(live: Table | undefined, records: GameplayRecorder | undefined): Promise<string> {
  running = await serveTable({
    ...(live === undefined ? {} : { table: live }),
    port: 0,
    host: '127.0.0.1',
    pollMs: 200,
    ...(records === undefined ? {} : { recorder: records }),
  });
  return `http://127.0.0.1:${String(running.port)}`;
}

afterEach(async () => {
  if (running !== null) await running.close();
  running = null;
});

/** A browser's account of a game, shaped right; whether it reproduces is the recorder's call. */
function wire(): Record<string, unknown> {
  return {
    protocol: NETPLAY_PROTOCOL,
    format: 'constructed',
    setup: { seed: 'browser/one', maximumTurns: 20, startingPlayer: 0 },
    decks: [
      { name: 'Red', cardIds: ['netplay-mountain'] },
      { name: 'Green', cardIds: ['netplay-forest'] },
    ],
    seats: [
      { kind: 'human', name: 'You' },
      { kind: 'bot', name: 'Bot' },
    ],
    choices: [0, 0, { type: 'passPriority', player: 0 }],
    result: { winner: null, loser: null, reason: 'turnLimit', endedOnTurn: 20 },
  };
}

async function mint(base: string): Promise<{ readonly status: number; readonly token: string }> {
  const response = await fetch(`${base}/api/games`, { method: 'POST' });
  const body = (await response.json()) as { token?: string };
  return { status: response.status, token: body.token ?? '' };
}

async function put(
  base: string,
  token: string,
  body: string,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(`${base}/api/games/${token}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('a server that records nothing', () => {
  it('says so on every games arm and in its health', async () => {
    const base = await start(table(), undefined);
    const health = (await (await fetch(`${base}/api/health`)).json()) as { records: boolean };
    expect(health.records).toBe(false);
    for (const [path, method] of [
      ['/api/games', 'GET'],
      ['/api/games', 'POST'],
      ['/api/games/some-token', 'PUT'],
      ['/api/games/some-id', 'GET'],
    ] as const) {
      const response = await fetch(`${base}${path}`, { method, ...(method === 'PUT' ? { body: '{}' } : {}) });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(await response.json()).toEqual({ refused: 'this server records nothing' });
    }
  });
});

describe('the games routes', () => {
  it('lists the index, mints a token, takes the finished game once, and serves it back', async () => {
    const records = recorder();
    const base = await start(undefined, records);
    expect(((await (await fetch(`${base}/api/health`)).json()) as { records: boolean }).records).toBe(true);

    const index = await fetch(`${base}/api/games`);
    expect(index.status).toBe(200);
    expect(await index.json()).toEqual({
      protocol: NETPLAY_PROTOCOL,
      games: [{ id: 'served-id', path: '20260916/served-id.json' }],
    });

    const minted = await mint(base);
    expect(minted.status).toBe(201);
    expect(minted.token.length).toBeGreaterThan(0);

    const finished = await put(base, minted.token, JSON.stringify(wire()));
    expect(finished.status).toBe(201);
    expect(finished.body).toEqual({ protocol: NETPLAY_PROTOCOL, id: 'served-id' });
    expect(records.captures).toEqual([{ source: 'browser-kernel', wire: wire() }]);

    // The token was spent by the finish: the same body again records nothing.
    const again = await put(base, minted.token, JSON.stringify(wire()));
    expect(again.status).toBe(404);
    expect(records.record).toHaveBeenCalledTimes(1);

    const read = await fetch(`${base}/api/games/served-id`);
    expect(read.status).toBe(200);
    expect(await read.text()).toBe('{"id":"served-id"}');
    expect((await fetch(`${base}/api/games/never-recorded`)).status).toBe(404);
  });

  it('refuses a finish under a token it never minted', async () => {
    const base = await start(undefined, recorder());
    const refused = await put(base, 'not-minted', JSON.stringify(wire()));
    expect(refused.status).toBe(404);
    expect(refused.body['refused']).toContain('no game is waiting');
  });

  it('refuses a body over the cap, one that is not JSON, and one that is not a game', async () => {
    const records = recorder();
    const base = await start(undefined, records);
    const large = await put(base, (await mint(base)).token, `{"pad":"${'x'.repeat(MAX_GAME_BODY_BYTES)}"}`);
    expect(large.status).toBe(413);
    const broken = await put(base, (await mint(base)).token, '{not json');
    expect(broken.status).toBe(400);
    const shape = await put(base, (await mint(base)).token, JSON.stringify({ ...wire(), seats: [] }));
    expect(shape.status).toBe(400);
    expect(shape.body['refused']).toBe('seats is not a list of two');
    const protocol = await put(base, (await mint(base)).token, JSON.stringify({ ...wire(), protocol: 2 }));
    expect(protocol.status).toBe(400);
    expect(protocol.body['refused']).toContain('protocol 2');
    expect(records.record).not.toHaveBeenCalled();
  });

  it("answers a claim that does not reproduce with 422 and the recorder's code, a full disk with 507", async () => {
    const base = await start(
      undefined,
      recorder({
        ok: false,
        code: 'not-reproduced',
        message: 'the claimed result is not what the choices play to',
      }),
    );
    const refused = await put(base, (await mint(base)).token, JSON.stringify(wire()));
    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      refused: 'not-reproduced',
      message: 'the claimed result is not what the choices play to',
    });
    await running?.close();
    const full = await start(undefined, recorder({ ok: false, code: 'write-failed', message: 'ENOSPC' }));
    const failed = await put(full, (await mint(full)).token, JSON.stringify(wire()));
    expect(failed.status).toBe(507);
    expect(failed.body['refused']).toBe('write-failed');
  });

  it('holds at most MAX_OPEN_RECORDINGS unfinished tokens', async () => {
    const base = await start(undefined, recorder());
    const tokens: string[] = [];
    for (let minted = 0; minted < MAX_OPEN_RECORDINGS; minted += 1) tokens.push((await mint(base)).token);
    const over = await fetch(`${base}/api/games`, { method: 'POST' });
    expect(over.status).toBe(429);
    expect(((await over.json()) as { refused: string }).refused).toBe('too-many-open');
    // Spending one frees one.
    expect((await put(base, tokens[0] ?? '', JSON.stringify(wire()))).status).toBe(201);
    expect((await mint(base)).status).toBe(201);
  });

  it('records at most MAX_RECORDED_POSTS browser games per process', async () => {
    const base = await start(undefined, recorder());
    for (let accepted = 0; accepted < MAX_RECORDED_POSTS; accepted += 1) {
      const minted = await mint(base);
      expect(minted.status).toBe(201);
      expect((await put(base, minted.token, JSON.stringify(wire()))).status).toBe(201);
    }
    const over = await fetch(`${base}/api/games`, { method: 'POST' });
    expect(over.status).toBe(429);
    expect(((await over.json()) as { refused: string }).refused).toBe('budget-spent');
  });

  it('refuses a method an arm does not answer', async () => {
    const base = await start(undefined, recorder());
    expect((await fetch(`${base}/api/games`, { method: 'DELETE' })).status).toBe(405);
    expect((await fetch(`${base}/api/games/served-id`, { method: 'POST', body: '{}' })).status).toBe(405);
    expect((await fetch(`${base}/api/games/a/b`)).status).toBe(404);
  });
});

describe('a kernel table the server plays to a result', () => {
  it('is handed to the recorder once, whole, under the format it was dealt for', async () => {
    const records = recorder();
    const base = await start(table(), records);
    let snapshot = (await (await fetch(`${base}/api/table/token-one`)).json()) as SeatSnapshot;
    for (let guard = 0; snapshot.result === null && guard < 4000; guard += 1) {
      const response = await fetch(`${base}/api/table/token-one`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'choose',
          index: (snapshot.pending?.options.length ?? 1) - 1,
          at: snapshot.decisions,
        }),
      });
      snapshot = (await response.json()) as SeatSnapshot;
    }
    expect(snapshot.result).not.toBeNull();
    expect(records.record).toHaveBeenCalledTimes(1);
    const [capture] = records.captures;
    expect(capture?.source).toBe('netplay-kernel');
    if (capture?.source !== 'netplay-kernel') return;
    expect(capture.format).toBe('sealed');
    expect(capture.setup).toEqual(SETUP);
    expect(capture.seats.map((seat) => seat.kind)).toEqual(['human', 'bot']);
    expect(capture.result).toEqual(snapshot.result);
    expect(capture.choices.length).toBeGreaterThan(0);

    // A request after the end is refused by the table and records nothing more.
    await fetch(`${base}/api/table/token-one`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'choose', index: 0, at: snapshot.decisions }),
    });
    expect(records.record).toHaveBeenCalledTimes(1);
  });
});
