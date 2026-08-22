/**
 * The table over HTTP, driven by two clients that share nothing.
 *
 * The point of this file is that neither client here is the test. Each one holds
 * only what its own socket delivered: a snapshot, and the token it was given.
 * Neither reaches for the table object, so a game played to a result through
 * these two is a game played through the wire, and the concealment claim
 * `hidden-information.test.ts` makes about the payload is being made about the
 * bytes these two actually received.
 *
 * Bound to 127.0.0.1 on port 0, which is the operating system picking a free
 * one. Nothing here listens on a network interface.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GameSetup, PlayerId } from '@mtg/kernel';
import { humanSeat } from '@mtg/kernel';
import type { RunningServer, SeatSnapshot, Table } from '@mtg/netplay';
import { createTable, NETPLAY_PROTOCOL, serveTable } from '@mtg/netplay';
import { twoDecks } from './decks';

const SETUP: GameSetup = { seed: 'netplay/server/v0', decks: twoDecks(), maximumTurns: 30 };

const TOKENS: readonly [string, string] = ['token-one', 'token-two'];

function table(): Table {
  return createTable({
    id: 'served',
    setup: SETUP,
    seats: [humanSeat('One'), humanSeat('Two')],
    seating: [
      { name: 'One', token: TOKENS[0] },
      { name: 'Two', token: TOKENS[1] },
    ],
  });
}

let running: RunningServer | null = null;

async function start(live: Table, pollMs = 500): Promise<string> {
  running = await serveTable({ table: live, port: 0, host: '127.0.0.1', pollMs });
  return `http://127.0.0.1:${String(running.port)}`;
}

afterEach(async () => {
  if (running !== null) await running.close();
  running = null;
});

/**
 * One player's whole world: a base URL, a token, and whatever the last response
 * said. It has no reference to the table.
 */
class Client {
  private snapshot: SeatSnapshot | null = null;

  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  async read(): Promise<SeatSnapshot> {
    const response = await fetch(`${this.base}/api/table/${this.token}`);
    if (!response.ok) throw new Error(`read responded ${String(response.status)}`);
    const body = (await response.json()) as SeatSnapshot;
    this.snapshot = body;
    return body;
  }

  async choose(index: number): Promise<{ readonly status: number; readonly body: unknown }> {
    const at = this.snapshot?.decisions ?? 0;
    const response = await fetch(`${this.base}/api/table/${this.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'choose', index, at }),
    });
    const body: unknown = await response.json();
    if (response.ok) this.snapshot = body as SeatSnapshot;
    return { status: response.status, body };
  }

  /** The last snapshot this client was given, and nothing the server did not send. */
  get held(): SeatSnapshot {
    if (this.snapshot === null) throw new Error('this client has not read anything yet');
    return this.snapshot;
  }
}

describe('the served table', () => {
  it('says what it is before anyone joins', async () => {
    const base = await start(table());
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, protocol: NETPLAY_PROTOCOL, table: 'served' });
  });

  it('answers nothing to a link nobody was given', async () => {
    const base = await start(table());
    const response = await fetch(`${base}/api/table/not-a-token`);
    expect(response.status).toBe(404);
  });

  it('answers nothing to a route it does not have', async () => {
    const base = await start(table());
    expect((await fetch(`${base}/api/table`)).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/api/table/${TOKENS[0]}/undo`)).status).toBe(404);
  });

  it('refuses a body that is not a request this table answers', async () => {
    const base = await start(table());
    const send = async (body: string): Promise<number> =>
      (
        await fetch(`${base}/api/table/${TOKENS[0]}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        })
      ).status;
    expect(await send('not json')).toBe(400);
    expect(await send('{"kind":"reduce"}')).toBe(400);
    expect(await send('{"kind":"choose","index":"three","at":0}')).toBe(400);
    expect(await send('{"kind":"choose","index":0}')).toBe(400);
  });

  it('refuses a choice from the seat that is not being asked, with the counter to resync on', async () => {
    const live = table();
    const base = await start(live);
    const owed = live.snapshotFor(0).awaiting as PlayerId;
    const other: PlayerId = owed === 0 ? 1 : 0;
    const waiting = new Client(base, TOKENS[other]);
    await waiting.read();
    const refusal = await waiting.choose(0);
    expect(refusal.status).toBe(409);
    expect(refusal.body).toMatchObject({ at: live.snapshotFor(other).decisions });
  });
});

describe('the held poll', () => {
  it('answers at once when the caller is behind', async () => {
    const live = table();
    const base = await start(live);
    const response = await fetch(`${base}/api/table/${TOKENS[0]}/wait?since=0`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SeatSnapshot;
    expect(body.revision).toBe(live.revision);
  });

  it('holds until the table moves, then answers with what moved', async () => {
    const live = table();
    const base = await start(live, 10_000);
    const since = live.revision;
    const held = fetch(`${base}/api/table/${TOKENS[1]}/wait?since=${String(since)}`);
    // The other seat plays while this one is waiting. Nothing polls; the
    // response arrives because the table changed.
    const owed = live.snapshotFor(0).awaiting as PlayerId;
    const owing = live.snapshotFor(owed);
    live.apply(owed, { kind: 'choose', index: 0, at: owing.decisions });
    const body = (await (await held).json()) as SeatSnapshot;
    expect(body.revision).toBeGreaterThan(since);
    expect(body.seat).toBe(1);
  });

  it('gives up after the wait rather than holding a socket forever', async () => {
    const live = table();
    const base = await start(live, 60);
    const response = await fetch(`${base}/api/table/${TOKENS[0]}/wait?since=${String(live.revision)}`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as SeatSnapshot).revision).toBe(live.revision);
  });
});

describe('two clients, one game', () => {
  it('plays it to a result over the wire, each seeing only its own cards', async () => {
    const live = table();
    const base = await start(live);
    const players: readonly [Client, Client] = [new Client(base, TOKENS[0]), new Client(base, TOKENS[1])];
    await players[0].read();
    await players[1].read();

    let moves = 0;
    for (let guard = 0; guard < 4000; guard += 1) {
      const owed = players[0].held.awaiting;
      if (owed === null) break;
      const owing = players[owed];
      // Whoever is not being asked reads too, which is what a client with a
      // held poll open is doing. It must never come back holding an option list.
      const watcher = players[owed === 0 ? 1 : 0];
      const seen = await watcher.read();
      expect(seen.pending).toBeNull();
      expect(seen.awaiting).toBe(owed);

      const options = owing.held.pending?.options.length ?? 0;
      expect(options).toBeGreaterThan(0);
      const outcome = await owing.choose(options - 1);
      expect(outcome.status).toBe(200);
      moves += 1;
      await players[owed === 0 ? 1 : 0].read();
    }

    // Same recalibration as `hidden-information.test.ts`'s audit floor, for the
    // same cause: `play/dead-stops` stopped a stop firing where `canRespond` is
    // false, so a whole game takes roughly half the decisions it used to. 69
    // moves measured here against a bound that was 150. The two lines below are
    // what say the game still finished and still finished over the wire, and
    // both are unchanged.
    expect(moves).toBeGreaterThan(50);
    const finished = await players[0].read();
    expect(finished.result).not.toBeNull();
    expect(finished.protocol).toBe(NETPLAY_PROTOCOL);

    // The bytes each client is holding, checked one last time for the cards
    // neither of them is entitled to. `hidden-information.test.ts` makes this
    // claim at every position; this one makes it about a payload that came off
    // a socket.
    for (const seat of [0, 1] as const) {
      const held = players[seat].held;
      const wire = JSON.stringify(held);
      for (const oid of held.state.players[seat === 0 ? 1 : 0].hand) {
        expect(held.state.objects[oid]).toBeUndefined();
      }
      for (const oid of held.state.players[0].library) expect(held.state.objects[oid]).toBeUndefined();
      for (const oid of held.state.players[1].library) expect(held.state.objects[oid]).toBeUndefined();
      expect(wire.includes(SETUP.seed)).toBe(false);
    }
  }, 60_000);
});
