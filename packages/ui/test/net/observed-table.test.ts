/**
 * The browser end of a Forge table over the LAN.
 *
 * Every frame here is one a real `ObservedDealer` built over `scriptBackend`,
 * sent through `JSON` and read back by `readObservedFrame`, so the reader is
 * checked against what the table sends and not against a fixture of it. The
 * client cases reach the same dealer through `observed-wire.ts`, which answers
 * the way the observed routes do, with no socket.
 *
 * The last describe is the claim the whole arrangement rests on, from this
 * side of the wire: the frame a seat parses carries its own hand and never
 * the other, its own deck and never the other, and the decision only when it
 * is its own. `packages/netplay` pins the same from the sending side.
 */
import { describe, expect, it } from 'vitest';
import type { DeckRef, SessionSpec } from '@mtg/engine';
import { STANDARD_RULES, scriptBackend, seatViewOf } from '@mtg/engine';
import { OBSERVED_TABLE_PROTOCOL, createObservedDealer } from '@mtg/netplay';
import type {
  ObservedDealer,
  ObservedOpenRequest,
  ObservedPhase,
  ObservedSeatFrame,
  ObservedTable,
  SeatTokens,
} from '@mtg/netplay';
import {
  HIDDEN_DECK_NAME,
  OBSERVED_SEAT_BACKEND,
  lanForgeAvailability,
  observedSeatBackend,
  observedTableOf,
  readObservedFrame,
  readObservedStart,
  startObservedTable,
} from '../../src/net/observed-table';
import type { ObservedSeatClient, ObservedSeatState } from '../../src/net/observed-table';
import { WIRE_BASE, observedWire, stillClock } from './observed-wire';

const REQUEST: ObservedOpenRequest = {
  protocol: OBSERVED_TABLE_PROTOCOL,
  format: 'toy',
  content: { kind: 'printed', format: 'toy' },
  seed: 'seed-of-the-match',
  maximumTurns: null,
};

const HOST_DECK: DeckRef = { name: 'Host deck', cards: [{ name: 'Island', count: 40 }] };
/** What a board would hand `open`; the client opens the table behind its token and reads nothing from it. */
const SEAT_TABLE: SessionSpec = {
  content: REQUEST.content,
  seats: [
    { name: 'Host', controller: 'local', deck: { name: 'Host deck', cards: [] } },
    { name: 'Guest', controller: 'local', deck: { name: 'Guest deck', cards: [] } },
  ],
  seed: null,
  maximumTurns: null,
};
const GUEST_DECK: DeckRef = { name: 'Guest deck', cards: [{ name: 'Forest', count: 40 }] };
const DECKS: readonly [DeckRef, DeckRef] = [HOST_DECK, GUEST_DECK];

function dealerOf(clock: number): ObservedDealer {
  return createObservedDealer({ backend: scriptBackend({ clock }), formats: ['toy'], clock: stillClock() });
}

async function opened(dealer: ObservedDealer): Promise<{ table: ObservedTable; tokens: SeatTokens }> {
  const outcome = await dealer.open(REQUEST);
  if (!outcome.ok) throw new Error(outcome.refused);
  return { table: outcome.table, tokens: outcome.tokens };
}

async function seated(dealer: ObservedDealer): Promise<{ table: ObservedTable; tokens: SeatTokens }> {
  const table = await opened(dealer);
  expect(await table.table.submitDeck(0, HOST_DECK)).toBeNull();
  expect(await table.table.submitDeck(1, GUEST_DECK)).toBeNull();
  return table;
}

/** What the wire carries: the frame with every prototype and undefined gone. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function parsed(frame: ObservedSeatFrame): ObservedSeatFrame {
  const read = readObservedFrame(wire(frame), 'the table');
  if (!read.ok) throw new Error(read.message);
  return read.frame;
}

function playingOf(frame: ObservedSeatFrame): Extract<ObservedPhase, { readonly kind: 'playing' }> {
  if (frame.phase.kind !== 'playing') throw new Error(`the frame is ${frame.phase.kind}`);
  return frame.phase;
}

/** Resolves with the client's state once `ready` holds of it. */
function once(
  client: ObservedSeatClient,
  ready: (state: ObservedSeatState) => boolean,
): Promise<ObservedSeatState> {
  return new Promise((resolve) => {
    if (ready(client.getSnapshot())) {
      resolve(client.getSnapshot());
      return;
    }
    const unsubscribe = client.subscribe(() => {
      if (!ready(client.getSnapshot())) return;
      unsubscribe();
      resolve(client.getSnapshot());
    });
  });
}

const atPhase =
  (kind: ObservedPhase['kind']) =>
  (state: ObservedSeatState): boolean =>
    state.frame?.phase.kind === kind;

describe('readObservedFrame', () => {
  it('takes every phase the table sends, unchanged, off the wire', async () => {
    const dealer = dealerOf(2);
    const { table } = await opened(dealer);
    expect(parsed(table.frameFor(0))).toEqual(table.frameFor(0));
    expect(parsed(table.frameFor(1)).phase.kind).toBe('seating');
    await table.submitDeck(0, HOST_DECK);
    await table.submitDeck(1, GUEST_DECK);
    expect(parsed(table.frameFor(1))).toEqual(table.frameFor(1));
    expect(parsed(table.frameFor(1)).phase.kind).toBe('playing');
    expect(await table.submit(0, 'advance')).toBeNull();
    expect(await table.submit(1, 'advance')).toBeNull();
    expect(parsed(table.frameFor(0))).toEqual(table.frameFor(0));
    expect(parsed(table.frameFor(0)).phase.kind).toBe('finished');
    const left = await opened(dealer);
    await left.table.leave(1);
    expect(parsed(left.table.frameFor(0))).toEqual(left.table.frameFor(0));
    expect(parsed(left.table.frameFor(0)).phase).toMatchObject({ kind: 'ended', reason: 'left' });
    await dealer.close();
  });

  it('refuses what it cannot vouch for and names the sender', async () => {
    const dealer = dealerOf(2);
    const { table } = await opened(dealer);
    const frame = wire(table.frameFor(0)) as Record<string, unknown>;
    const refusal = (value: unknown): string => {
      const read = readObservedFrame(value, 'the table');
      return read.ok ? 'accepted' : read.message;
    };
    expect(refusal('a frame')).toBe('the table did not answer with a seat frame');
    expect(refusal({ ...frame, protocol: 2 })).toBe(
      'the table speaks observed protocol 2; this page speaks 1',
    );
    expect(refusal({ ...frame, revision: -1 })).toBe('the table sent a frame with no revision');
    expect(refusal({ ...frame, seat: 2 })).toBe('the table sent a frame for no seat');
    expect(refusal({ ...frame, format: '' })).toBe('the table sent a frame naming no format');
    expect(refusal({ ...frame, content: { kind: 'printed' } })).toBe(
      'the table sent a frame with an invalid content reference',
    );
    expect(refusal({ ...frame, deck: { name: 'no cards' } })).toBe(
      'the table sent a frame with an invalid deck',
    );
    expect(refusal({ ...frame, phase: { kind: 'dancing' } })).toBe(
      'the table sent a phase this page does not know',
    );
    expect(refusal({ ...frame, phase: { kind: 'seating', poolSeed: 'p', submitted: [true] } })).toBe(
      "the table sent a seating phase without every seat's deck status",
    );
    expect(refusal({ ...frame, phase: { kind: 'ended', reason: 'weather', message: 'rain' } })).toBe(
      'the table sent an ended phase with an unknown reason',
    );
    await dealer.close();
  });
});

describe('readObservedStart and lanForgeAvailability', () => {
  it('reads the two seat links off a started table and refuses the rest', () => {
    const start = { protocol: 1, table: 'obs-t', seats: { host: 'obs-h', guest: 'obs-g' } };
    expect(readObservedStart(start, 'the lab')).toEqual({
      ok: true,
      table: 'obs-t',
      host: 'obs-h',
      guest: 'obs-g',
    });
    expect(readObservedStart({ ...start, protocol: 2 }, 'the lab')).toMatchObject({ ok: false });
    expect(readObservedStart({ ...start, seats: { host: 'obs-h' } }, 'the lab')).toEqual({
      ok: false,
      message: 'the lab opened a table and named no seats',
    });
    expect(readObservedStart(null, 'the lab')).toEqual({
      ok: false,
      message: 'the lab did not answer with an object',
    });
  });

  it('starts a table through the lab and hands back its seats', async () => {
    const dealer = dealerOf(2);
    const request = { format: 'toy', content: REQUEST.content, seed: null, maximumTurns: null };
    const started = await startObservedTable(WIRE_BASE, request, observedWire(dealer));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(dealer.find(started.host)?.seat).toBe(0);
    expect(dealer.find(started.guest)?.seat).toBe(1);
    const refused = await startObservedTable(WIRE_BASE, { ...request, format: 'm11' }, observedWire(dealer));
    expect(refused).toEqual({ ok: false, message: 'm11 is not served here' });
    await dealer.close();
  });

  it('says which of the three states a lab is in', () => {
    expect(lanForgeAvailability(null, 'toy')).toMatchObject({ status: 'unavailable' });
    expect(lanForgeAvailability(['m11', 'm13'], 'toy')).toEqual({
      status: 'unavailable',
      reason: 'Forge on this lab does not serve toy over the network; it serves m11, m13.',
    });
    expect(lanForgeAvailability(['toy'], 'toy')).toEqual({ status: 'ready' });
  });
});

describe('observedTableOf', () => {
  it('states the seat its own deck, the other a named placeholder, and both as local', async () => {
    const dealer = dealerOf(2);
    const { table } = await seated(dealer);
    const frame = parsed(table.frameFor(1));
    const stated = observedTableOf(frame, playingOf(frame), STANDARD_RULES);
    expect(stated.seats[1].deck).toEqual(GUEST_DECK);
    expect(stated.seats[0].deck).toEqual({ name: HIDDEN_DECK_NAME, cards: [] });
    expect(stated.seats.map((seat) => seat.controller)).toEqual(['local', 'local']);
    expect(stated.content).toEqual(REQUEST.content);
    expect(stated.rules).toEqual(STANDARD_RULES);
    expect(observedTableOf(frame, playingOf(frame)).rules).toBeUndefined();
    await dealer.close();
  });
});

describe('observedSeatBackend', () => {
  it('follows the table from seating to playing and pushes the other seat through the feed', async () => {
    const dealer = dealerOf(3);
    const { table, tokens } = await opened(dealer);
    const client = observedSeatBackend(WIRE_BASE, tokens[0], { fetch: observedWire(dealer) });
    const stop = client.connect();
    const seating = await once(client, atPhase('seating'));
    expect(seating.frame?.seat).toBe(0);
    expect(seating.frame?.deck).toBeNull();

    expect(await client.submitDeck(HOST_DECK)).toBeNull();
    expect(client.getSnapshot().frame).toMatchObject({
      deck: HOST_DECK,
      phase: { submitted: [true, false] },
    });
    const pushed: number[] = [];
    client.feed.subscribe((session) => pushed.push(session.submitted));
    const playing = client.backend.open(SEAT_TABLE);
    expect(await table.submitDeck(1, GUEST_DECK)).toBeNull();
    const openedSession = await playing;
    expect(openedSession.ok).toBe(true);
    if (!openedSession.ok) return;
    const session = openedSession.session;
    expect(session.backend).toBe(OBSERVED_SEAT_BACKEND);
    expect(session.localSeats).toEqual([0]);
    expect(session.view.seats[1].hand).toBeNull();
    expect(session.table.seats[1].deck.name).toBe(HIDDEN_DECK_NAME);
    expect(pushed).toEqual([0]);
    expect(await client.submitDeck(HOST_DECK)).not.toBeNull();

    const moved = await session.submit('advance');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.session.submitted).toBe(1);
    expect(moved.session.decision).toBeNull();
    expect(moved.session.view.priority).toBe(1);
    expect(await table.submit(1, 'advance')).toBeNull();
    await once(
      client,
      (state) => state.frame?.phase.kind === 'playing' && state.frame.phase.transcriptLength === 3,
    );
    expect(pushed).toEqual([0, 1, 2]);
    expect(client.getSnapshot().problem).toBeNull();
    stop();
    await dealer.close();
  });

  it('maps a refused move to illegal-move and a walked-out opponent to a finished session', async () => {
    const dealer = dealerOf(3);
    const { table, tokens } = await seated(dealer);
    const client = observedSeatBackend(WIRE_BASE, tokens[1], { fetch: observedWire(dealer) });
    const stop = client.connect();
    await once(client, atPhase('playing'));
    const openedSession = await client.backend.open(SEAT_TABLE);
    if (!openedSession.ok) throw new Error(openedSession.error.message);
    const refused = await openedSession.session.submit('advance');
    expect(refused).toEqual({
      ok: false,
      error: { kind: 'illegal-move', message: "it is not this seat's decision" },
    });

    await table.leave(0);
    const finished = await once(client, atPhase('finished'));
    expect(finished.frame?.phase).toMatchObject({ kind: 'finished', result: { winner: 1 } });
    const again = await client.backend.open(SEAT_TABLE);
    expect(again.ok && again.session.status).toBe('finished');
    stop();
    await dealer.close();
  });

  it('answers an open with backend-failure when the table ends before it is played', async () => {
    const dealer = dealerOf(3);
    const { table, tokens } = await opened(dealer);
    const client = observedSeatBackend(WIRE_BASE, tokens[0], { fetch: observedWire(dealer) });
    const stop = client.connect();
    await once(client, atPhase('seating'));
    const opening = client.backend.open(SEAT_TABLE);
    await table.leave(1);
    expect(await opening).toEqual({
      ok: false,
      error: { kind: 'backend-failure', message: 'Guest left the table.' },
    });
    expect(client.getSnapshot().frame?.phase).toMatchObject({ kind: 'ended', reason: 'left' });
    stop();
    await dealer.close();
  });

  it('says once that no seat answers to a link, and stops asking', async () => {
    const dealer = dealerOf(2);
    let asked = 0;
    const counted: typeof globalThis.fetch = (input, init) => {
      asked += 1;
      return observedWire(dealer)(input, init);
    };
    const client = observedSeatBackend(WIRE_BASE, 'obs-nobody', { fetch: counted });
    const stop = client.connect();
    const state = await once(client, (current) => current.problem !== null);
    expect(state).toEqual({ frame: null, problem: 'no seat answers to that link' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toBe(1);
    stop();
    await dealer.close();
  });

  it('publishes a revision once and lets the held request go when told to stop', async () => {
    const dealer = dealerOf(2);
    const { table, tokens } = await opened(dealer);
    const frame = table.frameFor(0);
    const urls: string[] = [];
    let reached: (() => void) | null = null;
    const third = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const canned: typeof globalThis.fetch = (input, init) => {
      urls.push(String(input));
      if (urls.length < 3) {
        return Promise.resolve(new Response(JSON.stringify(wire(frame)), { status: 200 }));
      }
      reached?.();
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('let go')));
      });
    };
    const client = observedSeatBackend(WIRE_BASE, tokens[0], { fetch: canned });
    let published = 0;
    client.subscribe(() => {
      published += 1;
    });
    const stop = client.connect();
    await third;
    expect(published).toBe(1);
    const at = `${WIRE_BASE}/observed/${tokens[0]}`;
    expect(urls).toEqual([
      at,
      `${at}?revision=${String(frame.revision)}`,
      `${at}?revision=${String(frame.revision)}`,
    ]);
    stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(urls).toHaveLength(3);
    expect(client.getSnapshot().problem).toBeNull();
    await dealer.close();
  });
});

describe('what a seat may know', () => {
  it('parses its own hand, its own deck and only its own decision, and nothing of the other seat', async () => {
    const dealer = dealerOf(4);
    const { table } = await seated(dealer);
    for (let move = 0; move < 3; move += 1) {
      const frames = [parsed(table.frameFor(0)), parsed(table.frameFor(1))] as const;
      const decider: 0 | 1 = playingOf(frames[0]).decision === null ? 1 : 0;
      const other: 0 | 1 = decider === 0 ? 1 : 0;
      const own = playingOf(frames[decider]);
      expect(own.decision?.seat).toBe(decider);
      expect(seatViewOf(own.view, decider).hand?.length).toBe(seatViewOf(own.view, decider).handSize);
      expect(seatViewOf(own.view, other).hand).toBeNull();
      expect(frames[decider].deck).toEqual(DECKS[decider]);

      const theirs = playingOf(frames[other]);
      expect(theirs.decision).toBeNull();
      expect(seatViewOf(theirs.view, decider).hand).toBeNull();
      expect(seatViewOf(theirs.view, other).hand?.length).toBe(seatViewOf(theirs.view, other).handSize);
      expect(frames[other].deck).toEqual(DECKS[other]);
      expect(observedTableOf(frames[other], theirs).seats[decider].deck.name).toBe(HIDDEN_DECK_NAME);

      const text = JSON.stringify(frames[other]);
      expect(text).not.toContain(`hand-${String(decider)}-`);
      expect(text).not.toContain(DECKS[decider].name);
      expect(text).not.toContain(`${seatViewOf(own.view, decider).name}, advance the clock or concede`);
      expect(text).not.toContain(REQUEST.seed);
      expect(await table.submit(decider, 'advance')).toBeNull();
    }
    await dealer.close();
  });
});
