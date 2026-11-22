/**
 * The invite route: what one seat may hand out, and what it may not.
 *
 * The route exists so a host's browser can draw the guest's link instead of the
 * host reading a UUID aloud, and the whole security question it raises is the
 * one this file is about. A seat link is a capability — it is the only thing
 * identifying a client — so a route that answers *here are the links* has to be
 * exactly as careful as the one that answers *here is your hand*. It is:
 *
 *  - The invite states which seat hosts, and the server enforces that and
 *    nothing else. A guest asking gets `{ host: false }`, not the host's link
 *    with a flag on it, because a payload a page declines to draw has still
 *    been delivered.
 *  - A table dealt with no invite has no route to leak. It answers 404, which
 *    the page reads as *nothing to hand out* rather than as an error.
 *  - `joined` is what the host is actually waiting to know, and it moves when a
 *    seat asks for a position — the request a page makes when it opens a link.
 *    The host reading its own invite is not that, and this file pins it: a poll
 *    that recorded the asker would report the guest as arrived before they had
 *    opened anything.
 *
 * Bound to 127.0.0.1 on port 0. Nothing here listens on a network interface.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GameSetup } from '@mtg/kernel';
import { humanSeat } from '@mtg/kernel';
import type { InviteResponse, RunningServer, Table, TableInvite } from '@mtg/netplay';
import { createTable, serveTable } from '@mtg/netplay';
import { twoDecks } from './decks';

const SETUP: GameSetup = { seed: 'netplay/invite/v0', decks: twoDecks(), maximumTurns: 30 };

const TOKENS: readonly [string, string] = ['host-token', 'guest-token'];

const INVITE: TableInvite = {
  hostSeat: 0,
  guests: [
    {
      name: 'Two',
      links: [
        { label: 'Tailnet (100.64.0.2)', url: 'http://100.64.0.2:5173/#/play?table=guest-token' },
        { label: 'This network (192.168.1.20)', url: 'http://192.168.1.20:5173/#/play?table=guest-token' },
      ],
      joined: false,
    },
  ],
};

function table(): Table {
  return createTable({
    id: 'invited',
    setup: SETUP,
    seats: [humanSeat('One'), humanSeat('Two')],
    seating: [
      { name: 'One', token: TOKENS[0] },
      { name: 'Two', token: TOKENS[1] },
    ],
  });
}

let running: RunningServer | null = null;

async function start(live: Table, invite?: TableInvite): Promise<string> {
  running = await serveTable({
    table: live,
    port: 0,
    host: '127.0.0.1',
    pollMs: 500,
    ...(invite === undefined ? {} : { invite }),
  });
  return `http://127.0.0.1:${String(running.port)}`;
}

afterEach(async () => {
  if (running !== null) await running.close();
  running = null;
});

async function askInvite(base: string, token: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}/api/table/${token}/invite`);
  return { status: response.status, body: await response.json() };
}

describe('the invite route', () => {
  it('hands the host the guest link, with every address the launcher found', async () => {
    const base = await start(table(), INVITE);
    const { status, body } = await askInvite(base, TOKENS[0]);
    expect(status).toBe(200);
    const invite = body as InviteResponse;
    expect(invite.host).toBe(true);
    if (!invite.host) throw new Error('the host was not told it hosts');
    expect(invite.guests).toHaveLength(1);
    expect(invite.guests[0]?.name).toBe('Two');
    expect(invite.guests[0]?.links.map((link) => link.url)).toEqual([
      'http://100.64.0.2:5173/#/play?table=guest-token',
      'http://192.168.1.20:5173/#/play?table=guest-token',
    ]);
  });

  it('tells the guest it is not the host, and sends it no link at all', async () => {
    const base = await start(table(), INVITE);
    const { status, body } = await askInvite(base, TOKENS[1]);
    expect(status).toBe(200);
    expect(body).toEqual({ host: false });
    // The stronger claim, and the one worth having: the host's token is not in
    // the bytes. A page that declined to draw a link it had been sent would
    // pass the assertion above and still have leaked it.
    expect(JSON.stringify(body)).not.toContain('table=');
  });

  it('answers 404 for a table that was dealt without links', async () => {
    const base = await start(table());
    const { status } = await askInvite(base, TOKENS[0]);
    expect(status).toBe(404);
  });

  it('answers 404 for a token no seat answers to', async () => {
    const base = await start(table(), INVITE);
    const { status } = await askInvite(base, 'not-a-token');
    expect(status).toBe(404);
  });

  it('refuses to be written to', async () => {
    const base = await start(table(), INVITE);
    const response = await fetch(`${base}/api/table/${TOKENS[0]}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(405);
  });

  it('reports a guest as joined once that seat opens its link, and not before', async () => {
    const base = await start(table(), INVITE);

    // The host has read its own invite twice by now. If asking counted as
    // arriving, the guest would already be reported present.
    const before = (await askInvite(base, TOKENS[0])).body as InviteResponse;
    if (!before.host) throw new Error('the host was not told it hosts');
    expect(before.guests[0]?.joined).toBe(false);

    const opened = await fetch(`${base}/api/table/${TOKENS[1]}`);
    expect(opened.ok).toBe(true);
    await opened.json();

    const after = (await askInvite(base, TOKENS[0])).body as InviteResponse;
    if (!after.host) throw new Error('the host was not told it hosts');
    expect(after.guests[0]?.joined).toBe(true);
  });
});
