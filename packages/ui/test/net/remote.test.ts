// @vitest-environment jsdom
/**
 * The page at one seat of a networked table.
 *
 * `play/play.test.ts` clicks a whole hot-seat game through the rendered surface;
 * this is the same surface with the game somewhere else, so what it checks is
 * only what the wire changed:
 *
 *  - The board is drawn from the seat this page holds the link for, and it does
 *    not follow the question across the table the way the shared-screen surface
 *    does. The opponent's hand is a face-down count here because the payload has
 *    no cards in it, not because a component declined to draw them.
 *  - A press posts and waits. There is no local session to reduce, so the board
 *    changes when the server says it did.
 *  - The seat that is not being asked is told who is, rather than being shown
 *    the "Game over" panel that an empty prompt means on one screen.
 *
 * `fetch` is stood in for rather than a server being started, and the stand-in
 * is a real `Table` answering real requests. jsdom has no `fetch` of its own, so
 * a socket here would be testing the environment; what is worth testing is the
 * loop, the reader and the component, and all three run against the same table
 * the server would have been holding.
 */
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import type { DeckList, PlayerId } from '@mtg/kernel';
import { humanSeat } from '@mtg/kernel';
import type { Table } from '@mtg/netplay';
import { createTable, readSeatRequest } from '@mtg/netplay';
import { RemoteGame } from '../../src/routes/play/RemoteGame';
import { LEGAL_MOVES_LABEL } from '../../src/routes/play/PlayView';
import { WAITING_LABEL } from '../../src/routes/play/rail';

function deck(name: string): DeckList {
  const cards: Card[] = [
    ...Array.from({ length: 17 }, () => exampleCard('slc-mountain')),
    ...Array.from({ length: 23 }, () => exampleCard('slc-emberflow-raider')),
  ];
  return { name, cards };
}

const TOKENS: readonly [string, string] = ['token-one', 'token-two'];

function table(): Table {
  return createTable({
    id: 'rendered',
    setup: { seed: 'ui/netplay/rendered', decks: [deck('One'), deck('Two')], maximumTurns: 20 },
    seats: [humanSeat('Ada'), humanSeat('Bea')],
    seating: [
      { name: 'Ada', token: TOKENS[0] },
      { name: 'Bea', token: TOKENS[1] },
    ],
  });
}

/**
 * The server, minus the sockets.
 *
 * Routes the two shapes `remote-table.ts` asks for, **including the hold**. That
 * part is not optional and this file found out the hard way: a stub that answers
 * a held poll immediately turns the client's loop into a spin, and a spin that
 * allocates a snapshot per turn exhausts the heap in forty seconds. Holding is
 * what makes the ordinary state of a waiting player one open request and no
 * traffic, so a stand-in that does not hold is not standing in for the server.
 */
function stubFetch(live: Table): void {
  const original = globalThis.fetch;
  const answer = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  /** Resolves when the table moves, or after a beat, whichever comes first. */
  const hold = (): Promise<void> =>
    new Promise<void>((done) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unwatch();
        done();
      };
      const timer = setTimeout(finish, 25);
      const unwatch = live.watch(finish);
    });

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: unknown, init?: { method?: string; body?: string }): Promise<Response> => {
      const url = new URL(String(input), 'http://page.invalid');
      const parts = url.pathname.split('/').filter((part) => part.length > 0);
      const token = parts[2] ?? '';
      const seat = live.seatOf(token);
      if (seat === null) return answer({ refused: 'no seat answers to that link' }, 404);
      if ((init?.method ?? 'GET') === 'GET') {
        const since = url.searchParams.get('since');
        if (since !== null && Number(since) === live.revision) await hold();
        return answer(live.snapshotFor(seat));
      }
      const request = readSeatRequest(JSON.parse(init?.body ?? 'null'));
      if (typeof request === 'string') return answer({ refused: request }, 400);
      const refusal = live.apply(seat, request);
      return refusal === null ? answer(live.snapshotFor(seat)) : answer(refusal, 409);
    },
  });
  restore = (): void => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: original });
  };
}

let restore: (() => void) | null = null;

beforeEach(() => {
  restore = null;
});

afterEach(() => {
  cleanup();
  if (restore !== null) restore();
});

/** The rail's move list, once the first snapshot has landed. */
async function moves(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole('group', { name: LEGAL_MOVES_LABEL }), { timeout: 3000 });
}

describe('a seat at a networked table', () => {
  it('draws the board once the table answers, from the seat that holds the link', async () => {
    const live = table();
    stubFetch(live);
    render(h(RemoteGame, { base: '/api', token: TOKENS[0] }));
    await moves();
    // Seat 0's own hand is drawn face up. The other seat's count already lives
    // in its pod, so the board does not duplicate it as hatched card slots.
    const mine = screen.getByLabelText("Ada's hand");
    expect(within(mine).queryAllByLabelText('face-down card')).toHaveLength(0);
    expect(screen.queryByLabelText("Bea's hand")).toBeNull();
    const theirs = screen.getByLabelText("Bea's status");
    expect(within(theirs).getByText('7', { selector: '[title="hand"]' })).toBeTruthy();
  });

  it('tells the seat that is not being asked who is, instead of saying the game is over', async () => {
    const live = table();
    stubFetch(live);
    const owed = live.snapshotFor(0).awaiting as PlayerId;
    const watching: PlayerId = owed === 0 ? 1 : 0;
    render(h(RemoteGame, { base: '/api', token: TOKENS[watching] }));
    await waitFor(() => {
      expect(screen.getByText(WAITING_LABEL)).toBeTruthy();
    });
    expect(screen.queryByText('Game over')).toBeNull();
    expect(
      screen.getByText(`${owed === 0 ? 'Ada' : 'Bea'} is deciding. The board keeps up as they play.`),
    ).toBeTruthy();
  });

  it('moves the game by posting an index, and redraws from what came back', async () => {
    const live = table();
    stubFetch(live);
    const owed = live.snapshotFor(0).awaiting as PlayerId;
    render(h(RemoteGame, { base: '/api', token: TOKENS[owed] }));
    const rail = await moves();
    const before = live.snapshotFor(owed).decisions;
    const first = within(rail).getAllByRole('button')[0];
    expect(first).toBeTruthy();
    if (first !== undefined) fireEvent.click(first);
    await waitFor(() => {
      expect(live.snapshotFor(owed).decisions).toBeGreaterThan(before);
    });
  });

  it('says it cannot reach the table rather than drawing nothing', async () => {
    const live = table();
    stubFetch(live);
    render(h(RemoteGame, { base: '/api', token: 'not-a-token' }));
    await waitFor(() => {
      expect(screen.getByText(/Cannot reach the table/)).toBeTruthy();
    });
  });
});
