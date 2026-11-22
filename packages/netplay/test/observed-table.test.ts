/**
 * The observed table's phases, its timers and what each seat is sent.
 *
 * The backend under most cases is `scriptBackend`, the toy on the observed
 * arm, so nothing here needs Forge or a JVM; the fake session cases cover what
 * the toy does not carry, a play interaction and a concede move. The claim the
 * whole arrangement rests on is the last describe: two seats' frames, searched
 * by `auditSeatPayloads`, carry neither the other hand nor the other decision.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  DeckRef,
  ObservedBackend,
  ObservedSession,
  PlayInteraction,
  SeatId,
  SeatProjection,
  TableView,
} from '@mtg/engine';
import { auditSeatPayloads, rulesOf, scriptBackend, seatSpecOf, seatViewOf } from '@mtg/engine';
import {
  MAX_OBSERVED_TABLES,
  OBSERVED_DISCONNECT_MS,
  OBSERVED_SEATING_MS,
  OBSERVED_TABLE_PROTOCOL,
  createObservedDealer,
} from '@mtg/netplay';
import type {
  LobbySeat,
  ObservedDealer,
  ObservedTableCapture,
  ObservedOpenRequest,
  ObservedPhase,
  ObservedTable,
  SeatTokens,
} from '@mtg/netplay';
import { fakeClock } from './observed-clock';

const REQUEST: ObservedOpenRequest = {
  protocol: OBSERVED_TABLE_PROTOCOL,
  format: 'toy',
  content: { kind: 'printed', format: 'toy' },
  seed: 'seed-of-the-match',
  maximumTurns: null,
};

const HOST_DECK: DeckRef = { name: 'Host deck', cards: [{ name: 'Island', count: 40 }] };
const GUEST_DECK: DeckRef = { name: 'Guest deck', cards: [{ name: 'Forest', count: 40 }] };

/** A backend whose sessions count their closes and expose their latest unprojected view. */
function counting(
  backend: ObservedBackend,
): ObservedBackend & { closes: number; current: ObservedSession | null } {
  const wrapper = {
    ...backend,
    closes: 0,
    current: null as ObservedSession | null,
    open: async (table: Parameters<ObservedBackend['open']>[0]) => {
      const opened = await backend.open(table);
      if (!opened.ok) return opened;
      return { ok: true as const, session: wrap(opened.session) };
    },
  };
  const wrap = (session: ObservedSession): ObservedSession => {
    wrapper.current = session;
    return {
      ...session,
      close: async () => {
        wrapper.closes += 1;
        await session.close();
      },
      submit: async (move) => {
        const submitted = await session.submit(move);
        return submitted.ok ? { ok: true, session: wrap(submitted.session) } : submitted;
      },
    };
  };
  return wrapper;
}

async function seated(
  dealer: ObservedDealer,
  request: ObservedOpenRequest = REQUEST,
): Promise<{ table: ObservedTable; tokens: SeatTokens }> {
  const opened = await dealer.open(request);
  if (!opened.ok) throw new Error(opened.refused);
  expect(await opened.table.submitDeck(0, HOST_DECK)).toBeNull();
  expect(await opened.table.submitDeck(1, GUEST_DECK)).toBeNull();
  return { table: opened.table, tokens: opened.tokens };
}

function playing(table: ObservedTable, seat: SeatId): Extract<ObservedPhase, { kind: 'playing' }> {
  if (seat !== 0 && seat !== 1) throw new Error(`the toy table seats two, not seat ${String(seat)}`);
  const phase = table.frameFor(seat).phase;
  if (phase.kind !== 'playing') throw new Error(`seat ${String(seat)} is ${phase.kind}`);
  return phase;
}

describe('createObservedDealer', () => {
  it('refuses a backend that does not project per seat', () => {
    expect(() =>
      createObservedDealer({ backend: scriptBackend({ clock: 2, perSeat: false }), formats: ['toy'] }),
    ).toThrow(/does not project per seat/);
  });

  it('refuses an unknown format and counts the slots it hands out', async () => {
    const dealer = createObservedDealer({
      backend: scriptBackend({ clock: 2 }),
      formats: ['toy'],
      clock: fakeClock(),
    });
    expect(await dealer.open({ ...REQUEST, format: 'm11' })).toEqual({
      ok: false,
      code: 'unknown-format',
      refused: 'm11 is not served here',
    });
    const first = await dealer.open(REQUEST);
    const second = await dealer.open(REQUEST);
    expect(first.ok && second.ok).toBe(true);
    expect(dealer.live).toBe(MAX_OBSERVED_TABLES);
    const third = await dealer.open(REQUEST);
    expect(third).toMatchObject({ ok: false, code: 'table-limit' });
    if (!first.ok) return;
    await first.table.leave(0);
    expect(dealer.live).toBe(1);
    expect((await dealer.open(REQUEST)).ok).toBe(true);
  });

  it('mints obs- tokens that find the table and its seat', async () => {
    const dealer = createObservedDealer({
      backend: scriptBackend({ clock: 2 }),
      formats: ['toy'],
      mint: () => 'x',
    });
    const opened = await dealer.open(REQUEST);
    if (!opened.ok) throw new Error(opened.refused);
    expect(opened.table.id).toBe('obs-x');
    expect(opened.tokens.every((token) => token.startsWith('obs-'))).toBe(true);
    expect(dealer.find(opened.tokens[1])?.seat).toBe(1);
    expect(dealer.find('nobody')).toBeNull();
  });
});

describe('ObservedTable', () => {
  it('opens with the guest deck already seated', async () => {
    const backend = counting(scriptBackend({ clock: 2 }));
    const dealer = createObservedDealer({ backend, formats: ['toy'], clock: fakeClock() });
    const opened = await dealer.open({ ...REQUEST, deck: GUEST_DECK });
    if (!opened.ok) throw new Error(opened.refused);
    expect(opened.table.frameFor(0)).toMatchObject({
      deck: null,
      phase: { kind: 'seating', submitted: [false, true] },
    });
    expect(opened.table.frameFor(1)).toMatchObject({ deck: GUEST_DECK });
    expect(await opened.table.submitDeck(1, GUEST_DECK)).toEqual({
      refused: 'this seat already submitted a deck',
      at: 0,
    });
    expect(await opened.table.submitDeck(0, HOST_DECK)).toBeNull();
    expect(backend.current?.table.seats.map((seat) => seat.deck.name)).toEqual(['Host deck', 'Guest deck']);
  });

  it('seats both decks, hands each seat its own pool seed, then plays', async () => {
    const backend = counting(scriptBackend({ clock: 2 }));
    const dealer = createObservedDealer({ backend, formats: ['toy'], clock: fakeClock() });
    const opened = await dealer.open(REQUEST);
    if (!opened.ok) throw new Error(opened.refused);
    const { table } = opened;
    const host = table.frameFor(0);
    const guest = table.frameFor(1);
    expect(host.phase.kind).toBe('seating');
    if (host.phase.kind !== 'seating' || guest.phase.kind !== 'seating') return;
    expect(host).toMatchObject({ format: 'toy', content: REQUEST.content, deck: null });
    expect(host.phase.submitted).toEqual([false, false]);
    expect(host.phase.poolSeed).not.toBe(guest.phase.poolSeed);
    expect(host.phase.poolSeed).not.toContain('seed-of-the-match');
    expect(JSON.stringify(host)).not.toContain(guest.phase.poolSeed);
    expect(await table.submitDeck(0, HOST_DECK)).toBeNull();
    expect(table.frameFor(1)).toMatchObject({
      deck: null,
      phase: { kind: 'seating', submitted: [true, false] },
    });
    expect(table.frameFor(0).deck).toEqual(HOST_DECK);
    expect(await table.submitDeck(0, HOST_DECK)).toEqual({
      refused: 'this seat already submitted a deck',
      at: 1,
    });
    expect(await table.submitDeck(1, GUEST_DECK)).toBeNull();
    const phase = playing(table, 0);
    expect(phase.decision?.seat).toBe(0);
    expect(playing(table, 1).decision).toBeNull();
    expect(backend.current?.table.seats.map((seat) => seat.deck.name)).toEqual(['Host deck', 'Guest deck']);
  });

  it('relays a move from the deciding seat only and finishes on the result', async () => {
    const backend = counting(scriptBackend({ clock: 2 }));
    const finished: ObservedTableCapture[] = [];
    const dealer = createObservedDealer({
      backend,
      formats: ['toy'],
      clock: fakeClock(),
      onFinished: (capture) => finished.push(capture),
    });
    const { table } = await seated(dealer);
    expect(await table.submit(1, 'advance')).toEqual({ refused: "it is not this seat's decision", at: 3 });
    expect(await table.submit(0, 'fly')).toMatchObject({ refused: expect.stringContaining('fly') });
    expect(table.phase).toBe('playing');
    expect(await table.submit(0, 'advance')).toBeNull();
    expect(playing(table, 1).decision?.seat).toBe(1);
    expect(playing(table, 1).transcriptLength).toBe(2);
    expect(await table.submit(1, 'advance')).toBeNull();
    const done = table.frameFor(0).phase;
    expect(done.kind).toBe('finished');
    if (done.kind !== 'finished') return;
    expect(done.result.reason).toBe('the clock ran out');
    expect(done.events).toHaveLength(2);
    expect(finished).toHaveLength(1);
    expect(finished[0]?.backend).toBe(backend.id);
    expect(finished[0]?.table.seats.map((seat) => seat.deck)).toEqual([HOST_DECK, GUEST_DECK]);
    expect(rulesOf(finished[0]!.table)).toEqual({ variant: 'standard', startingLife: 20 });
    expect(finished[0]?.localSeats).toEqual([0, 1]);
    expect(finished[0]?.result).toEqual(done.result);
    expect(finished[0]?.transcript).toHaveLength(3);
    expect(
      finished[0]?.transcript.every((frame) => frame.view.seats.every((seat) => seat.hand !== null)),
    ).toBe(true);
    expect(backend.closes).toBe(1);
    expect(dealer.live).toBe(0);
    expect(await table.submit(0, 'advance')).toEqual({ refused: 'the table is not in play', at: 6 });
  });

  it('ends on the seating timer, the disconnect timer, and a seat leaving', async () => {
    const backend = counting(scriptBackend({ clock: 2 }));
    const clock = fakeClock();
    const dealer = createObservedDealer({ backend, formats: ['toy'], clock });
    const idle = await dealer.open(REQUEST);
    if (!idle.ok) throw new Error(idle.refused);
    clock.advance(OBSERVED_SEATING_MS - 1);
    expect(idle.table.phase).toBe('seating');
    clock.advance(1);
    expect(idle.table.frameFor(1).phase).toMatchObject({ kind: 'ended', reason: 'seating-timeout' });

    const { table } = await seated(dealer);
    clock.advance(OBSERVED_DISCONNECT_MS - 1);
    table.touch(0);
    clock.advance(1);
    expect(table.frameFor(0).phase).toMatchObject({
      kind: 'ended',
      reason: 'disconnected',
      message: expect.stringContaining('Guest'),
    });
    expect(backend.closes).toBe(1);
    await table.close();
    expect(backend.closes).toBe(1);

    const left = await seated(dealer);
    const revision = left.table.revision;
    await left.table.leave(1);
    const phase = left.table.frameFor(0).phase;
    expect(phase).toMatchObject({ kind: 'finished', result: { winner: 0, reason: 'Guest left the table' } });
    expect(left.table.revision).toBe(revision + 1);
    expect(backend.closes).toBe(2);
    expect(dealer.live).toBe(0);
    clock.advance(OBSERVED_DISCONNECT_MS);
    expect(dealer.find(left.tokens[0])).toBeNull();
  });

  it('ends with the backend failure when the backend refuses the table', async () => {
    const backend: ObservedBackend = {
      ...scriptBackend({ clock: 2 }),
      open: () =>
        Promise.resolve({ ok: false, error: { kind: 'backend-failure', message: 'the JVM did not answer' } }),
    };
    const dealer = createObservedDealer({ backend, formats: ['toy'], clock: fakeClock() });
    const opened = await dealer.open(REQUEST);
    if (!opened.ok) throw new Error(opened.refused);
    await opened.table.submitDeck(1, GUEST_DECK);
    await opened.table.submitDeck(0, HOST_DECK);
    expect(opened.table.frameFor(0).phase).toEqual({
      kind: 'ended',
      reason: 'backend-failure',
      message: 'backend-failure: the JVM did not answer',
    });
    expect(dealer.live).toBe(0);
  });

  it('ends both seats visibly, and calls onEnded, when a mid-game move throws a fatal backend error', async () => {
    // mtg-72fjo: the reported wedge was a bridge exception on a submit made
    // mid-game (playing Fortified Village), not one at table-open time (the
    // case above). Nothing exercised that path before this test.
    const view = await toyView();
    const submit = vi.fn<ObservedSession['submit']>(() =>
      Promise.resolve({
        ok: false,
        error: { kind: 'backend-failure', message: 'Forge match failed: IllegalStateException' },
      }),
    );
    const session = fakeSession(view, 0, submit);
    const backend: ObservedBackend = {
      ...scriptBackend({ clock: 2 }),
      open: () => Promise.resolve({ ok: true, session }),
    };
    const ended: Array<{ reason: string; message: string }> = [];
    const dealer = createObservedDealer({
      backend,
      formats: ['toy'],
      clock: fakeClock(),
      onEnded: (_table, reason, message) => ended.push({ reason, message }),
    });
    const { table } = await seated(dealer);
    const refusal = await table.submit(0, 'pass');
    expect(refusal).toBeNull();
    expect(submit).toHaveBeenCalledWith('pass');
    for (const seat of [0, 1] as const) {
      expect(table.frameFor(seat).phase).toEqual({
        kind: 'ended',
        reason: 'backend-failure',
        message: 'backend-failure: Forge match failed: IllegalStateException',
      });
    }
    expect(ended).toEqual([
      { reason: 'backend-failure', message: 'backend-failure: Forge match failed: IllegalStateException' },
    ]);
    expect(dealer.live).toBe(0);
  });
});

const PLAY: PlayInteraction = {
  turnStep: 'precombatMain',
  passPriority: 'pass',
  concede: 'concede',
  objectActions: [{ oid: 'card-0-a', move: 'play-a', category: 'play' }],
};

/** A session carrying a play interaction and a concede move, which the toy does not. */
function fakeSession(
  view: TableView,
  decisionSeat: SeatId,
  submit: ObservedSession['submit'],
): ObservedSession {
  const projection: SeatProjection = {
    view: (seat) => ({
      ...view,
      seats:
        seat === 0
          ? [view.seats[0], { ...view.seats[1], hand: null }]
          : [{ ...view.seats[0], hand: null }, view.seats[1]],
    }),
    events: () => [],
    decision: (seat) => (seat === decisionSeat ? decision : null),
  };
  const decision = {
    seat: decisionSeat,
    kind: 'priority',
    prompt: 'go',
    options: [{ id: 'pass', text: 'Pass', targets: [] }],
    complete: true,
  } as const;
  return {
    backend: 'fake',
    determinism: 'observed',
    table: {
      content: REQUEST.content,
      seats: [
        { name: 'Host', controller: 'local', deck: HOST_DECK },
        { name: 'Guest', controller: 'local', deck: GUEST_DECK },
      ],
      seed: null,
      maximumTurns: null,
    },
    status: 'awaiting',
    view,
    events: [],
    decision,
    play: PLAY,
    seats: projection,
    result: null,
    submitted: 0,
    localSeats: [0, 1],
    transcript: [{ seq: 0, view, events: [], move: null }],
    submit,
    close: () => Promise.resolve(),
  };
}

async function toyView(): Promise<TableView> {
  const opened = await scriptBackend({ clock: 2 }).open({
    content: REQUEST.content,
    seats: [
      { name: 'Host', controller: 'local', deck: HOST_DECK },
      { name: 'Guest', controller: 'local', deck: GUEST_DECK },
    ],
    seed: null,
    maximumTurns: null,
  });
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.session.view;
}

describe('ObservedTable over a session with a play interaction', () => {
  it('strips the play interaction for the seat without the decision', async () => {
    const submit = vi.fn<ObservedSession['submit']>();
    const session = fakeSession(await toyView(), 0, submit);
    const backend: ObservedBackend = {
      ...scriptBackend({ clock: 2 }),
      open: () => Promise.resolve({ ok: true, session }),
    };
    const dealer = createObservedDealer({ backend, formats: ['toy'], clock: fakeClock() });
    const { table } = await seated(dealer);
    expect(playing(table, 0).play).toBe(PLAY);
    expect(playing(table, 1).play).toEqual({
      turnStep: 'precombatMain',
      passPriority: null,
      concede: null,
      objectActions: [],
      seatActions: [],
      promptRole: null,
      automatic: null,
    });
  });

  it('concedes through the backend when the leaving seat holds the decision', async () => {
    const view = await toyView();
    const conceded: ObservedSession = {
      ...fakeSession(view, 0, () => Promise.reject(new Error('unreachable'))),
      status: 'finished',
      decision: null,
      result: { winner: 1, reason: 'concession', endedOnTurn: 1 },
      transcript: [
        { seq: 0, view, events: [], move: null },
        { seq: 1, view, events: [], move: 'concede' },
      ],
    };
    const submit = vi.fn<ObservedSession['submit']>(() => Promise.resolve({ ok: true, session: conceded }));
    const session = fakeSession(view, 0, submit);
    const backend: ObservedBackend = {
      ...scriptBackend({ clock: 2 }),
      open: () => Promise.resolve({ ok: true, session }),
    };
    const captures: ObservedTableCapture[] = [];
    const dealer = createObservedDealer({
      backend,
      formats: ['toy'],
      clock: fakeClock(),
      onFinished: (capture) => captures.push(capture),
    });
    const { table } = await seated(dealer);
    await table.leave(0);
    expect(submit).toHaveBeenCalledWith('concede');
    expect(table.frameFor(1).phase).toMatchObject({
      kind: 'finished',
      result: { winner: 1, reason: 'concession' },
    });
    expect(captures).toHaveLength(1);
    expect(captures[0]?.transcript).toHaveLength(2);
    expect(captures[0]?.result).toEqual({ winner: 1, reason: 'concession', endedOnTurn: 1 });
  });
});

describe('the recorder seam', () => {
  it('fires exactly once per finished table, and never again for a close after it', async () => {
    const backend = counting(scriptBackend({ clock: 2 }));
    const captures: ObservedTableCapture[] = [];
    const dealer = createObservedDealer({
      backend,
      formats: ['toy'],
      clock: fakeClock(),
      onFinished: (capture) => captures.push(capture),
    });
    const first = await seated(dealer);
    // The guest walks away while the host holds the decision: a declared result.
    await first.table.leave(1);
    expect(first.table.phase).toBe('finished');
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      backend: backend.id,
      localSeats: [0, 1],
      result: { winner: 0, reason: 'Guest left the table' },
    });
    await first.table.close();
    await first.table.leave(0);
    expect(captures).toHaveLength(1);
    // A second table is a second capture; a table that ends without a result is none.
    const second = await seated(dealer);
    expect(await second.table.submit(0, 'advance')).toBeNull();
    expect(await second.table.submit(1, 'advance')).toBeNull();
    expect(captures).toHaveLength(2);
    expect(captures[1]?.transcript.length).toBe(3);
    const third = await dealer.open(REQUEST);
    if (!third.ok) throw new Error(third.refused);
    await third.table.leave(0);
    expect(third.table.phase).toBe('ended');
    expect(captures).toHaveLength(2);
  });
});

describe('what each seat is sent', () => {
  it('carries neither the other hand nor the other decision, by the engine audit and by search', async () => {
    const backend = counting(scriptBackend({ clock: 4 }));
    const dealer = createObservedDealer({ backend, formats: ['toy'], clock: fakeClock() });
    const { table } = await seated(dealer);
    for (let move = 0; move < 3; move += 1) {
      const current = backend.current;
      if (current === null) throw new Error('no session');
      const seats: SeatProjection = {
        view: (seat) => playing(table, seat).view,
        events: (seat) => playing(table, seat).events,
        decision: (seat) => playing(table, seat).decision,
      };
      const audit = auditSeatPayloads(
        seats,
        current.view,
        current.decision,
        `move ${String(move)}`,
        REQUEST.seed,
        null,
      );
      expect(audit.findings).toEqual([]);
      expect(audit.searched).toBe(2);
      const decider: LobbySeat = current.decision?.seat === 1 ? 1 : 0;
      const other: LobbySeat = decider === 0 ? 1 : 0;
      const wire = JSON.stringify(table.frameFor(other));
      for (const card of seatViewOf(current.view, decider).hand ?? [])
        expect(wire).not.toContain(JSON.stringify(card.oid));
      expect(wire).not.toContain(JSON.stringify(seatSpecOf(current.table, decider).deck.name));
      expect(wire).not.toContain(current.decision?.prompt ?? 'unreachable');
      expect(wire).not.toContain(REQUEST.seed);
      expect(await table.submit(decider, 'advance')).toBeNull();
    }
  });
});
