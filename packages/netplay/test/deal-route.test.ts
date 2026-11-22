/**
 * `POST /api/tables`: the one route with no token in front of it.
 *
 * It exists because pressing a button in the page is the whole of what starting
 * a LAN table should take, and a page cannot mint a seat capability — the point
 * of one is that the server minted it. So this route is reachable from wherever
 * the page is, and everything below is the argument that this is safe:
 *
 *  - The host token is written exactly once, into the response the caller gets.
 *    Nothing else on the server ever hands it out, so a second device posting
 *    here gets a table of its own rather than a way into somebody else's.
 *  - A server with no dealer answers 404. That is every launcher that predates
 *    the button, and it must not become a way to deal a table by surprise.
 *  - `MAX_LIVE_TABLES` bounds what an unauthenticated caller can spend. Refused
 *    rather than evicted: dealing an eleventh table must not end the game
 *    somebody is playing at the first.
 *  - A dealer that throws is a 500 that names the reason, because the button on
 *    the other end has to be able to say why the press did nothing.
 *
 * Bound to 127.0.0.1 on port 0. Nothing here listens on a network interface.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GameSetup } from '@mtg/kernel';
import { humanSeat } from '@mtg/kernel';
import type { DealtSeats, RunningServer, SeatSnapshot, Table, TableInvite } from '@mtg/netplay';
import { createTable, MAX_LIVE_TABLES, NETPLAY_PROTOCOL, serveTable } from '@mtg/netplay';
import { twoDecks } from './decks';

const SETUP: GameSetup = { seed: 'netplay/deal-route/v0', decks: twoDecks(), maximumTurns: 30 };

function inviteFor(guestToken: string): TableInvite {
  return {
    hostSeat: 0,
    guests: [
      {
        name: 'Two',
        links: [
          {
            label: 'This network (192.168.1.20)',
            url: `http://192.168.1.20:5173/#/play?table=${guestToken}`,
          },
        ],
        joined: false,
      },
    ],
  };
}

function dealtTable(n: number): DealtSeats {
  const tokens: readonly [string, string] = [`host-${String(n)}`, `guest-${String(n)}`];
  const table: Table = createTable({
    id: `dealt-${String(n)}`,
    setup: SETUP,
    seats: [humanSeat('One'), humanSeat('Two')],
    seating: [
      { name: 'One', token: tokens[0] },
      { name: 'Two', token: tokens[1] },
    ],
  });
  return { table, invite: inviteFor(tokens[1]), hostToken: tokens[0] };
}

/** A dealer that counts, so a test can tell a refusal from a silent success. */
function counting(): { readonly deal: () => DealtSeats; readonly dealt: () => number } {
  let n = 0;
  return {
    deal: (): DealtSeats => {
      n += 1;
      return dealtTable(n);
    },
    dealt: (): number => n,
  };
}

let running: RunningServer | null = null;

afterEach(async () => {
  if (running !== null) await running.close();
  running = null;
});

async function startDealing(deal: () => DealtSeats | Promise<DealtSeats>): Promise<string> {
  running = await serveTable({ port: 0, host: '127.0.0.1', pollMs: 500, dealer: deal });
  return `http://127.0.0.1:${String(running.port)}`;
}

async function post(base: string): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await fetch(`${base}/api/tables`, { method: 'POST' });
  return { status: response.status, body: await response.json() };
}

describe('dealing a table from the page', () => {
  it('hands back a seat that plays, and hands back nothing else', async () => {
    const dealer = counting();
    const base = await startDealing(dealer.deal);
    const created = await post(base);

    expect(created.status).toBe(201);
    const body = created.body as { token: string; protocol: number; table: string };
    expect(body.protocol).toBe(NETPLAY_PROTOCOL);
    expect(body.token).toBe('host-1');
    // The guest's capability is not in the create response. It reaches the guest
    // through the host's invite and through nothing else, which is the same rule
    // the invite route already enforces between two seats.
    expect(JSON.stringify(created.body)).not.toContain('guest-1');

    const seat = await fetch(`${base}/api/table/${body.token}`);
    expect(seat.status).toBe(200);
    const snapshot = (await seat.json()) as SeatSnapshot;
    expect(snapshot.seat).toBe(0);
  });

  it('deals a second table without taking the first one away', async () => {
    const dealer = counting();
    const base = await startDealing(dealer.deal);
    const first = (await post(base)).body as { token: string };
    const second = (await post(base)).body as { token: string };

    expect(second.token).not.toBe(first.token);
    expect((await fetch(`${base}/api/table/${first.token}`)).status).toBe(200);
    expect((await fetch(`${base}/api/table/${second.token}`)).status).toBe(200);
  });

  it('says it deals, so the page can draw a button rather than a command', async () => {
    const dealer = counting();
    const base = await startDealing(dealer.deal);
    const health = await fetch(`${base}/api/health`);
    expect(await health.json()).toEqual({
      ok: true,
      protocol: NETPLAY_PROTOCOL,
      deals: true,
      rooms: false,
      drafts: false,
      records: false,
    });
  });

  it('refuses a table when the server was started without a way to deal one', async () => {
    running = await serveTable({ table: dealtTable(0).table, port: 0, host: '127.0.0.1', pollMs: 500 });
    const base = `http://127.0.0.1:${String(running.port)}`;
    const refused = await post(base);
    expect(refused.status).toBe(404);
    expect(JSON.stringify(refused.body)).toContain('without a way to deal');
  });

  it('is written to, not read', async () => {
    const dealer = counting();
    const base = await startDealing(dealer.deal);
    const read = await fetch(`${base}/api/tables`);
    expect(read.status).toBe(405);
    expect(dealer.dealt()).toBe(0);
  });

  it('stops at the cap rather than ending a game to make room', async () => {
    const dealer = counting();
    const base = await startDealing(dealer.deal);
    const tokens: string[] = [];
    for (let n = 0; n < MAX_LIVE_TABLES; n += 1) {
      const created = await post(base);
      expect(created.status).toBe(201);
      tokens.push((created.body as { token: string }).token);
    }
    const refused = await post(base);
    expect(refused.status).toBe(429);
    expect(dealer.dealt()).toBe(MAX_LIVE_TABLES);
    // The first table is still there, which is the whole reason this is a
    // refusal and not an eviction.
    const first = tokens[0] ?? '';
    expect((await fetch(`${base}/api/table/${first}`)).status).toBe(200);
  });

  it('says why when the deal itself fails', async () => {
    const base = await startDealing(() => {
      throw new Error('the staged set has no cards');
    });
    const refused = await post(base);
    expect(refused.status).toBe(500);
    expect(JSON.stringify(refused.body)).toContain('the staged set has no cards');
  });

  it('hands the dealt table its own invite', async () => {
    const dealer = counting();
    const base = await startDealing(dealer.deal);
    const created = (await post(base)).body as { token: string };
    const invite = await fetch(`${base}/api/table/${created.token}/invite`);
    expect(invite.status).toBe(200);
    const body = (await invite.json()) as { host: boolean; guests: readonly { name: string }[] };
    expect(body.host).toBe(true);
    expect(body.guests.map((guest) => guest.name)).toEqual(['Two']);
  });
});
