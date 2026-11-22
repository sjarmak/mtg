/**
 * The browser half of the observed-session gateway.
 *
 * Every response is external data: the adapter validates it before rebuilding
 * an immutable EngineSession, and sends only an id present in that snapshot at
 * the revision that issued it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { COMMANDER_RULES, scriptBackend } from '@mtg/engine';
import { BROWSER_BACKEND_PROTOCOL, httpObservedBackend } from '@mtg/ui';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'browser-backend',
  maximumTurns: null,
};

/** The same table on a 1v1 Commander board. */
const COMMANDER: SessionSpec = {
  ...TABLE,
  rules: COMMANDER_RULES,
  seats: [
    {
      ...TABLE.seats[0],
      deck: { ...TABLE.seats[0].deck, commanders: [{ name: 'general-north', count: 1 }] },
    },
    {
      ...TABLE.seats[1],
      deck: { ...TABLE.seats[1].deck, commanders: [{ name: 'general-south', count: 1 }] },
    },
  ],
};

async function scriptSession(clock = 2, table: SessionSpec = TABLE): Promise<ObservedSession> {
  const opened = await scriptBackend({ clock }).open(table);
  if (!opened.ok) throw new Error(opened.error.message);
  return { ...opened.session, backend: 'forge', seats: null };
}

function wireSession(session: ObservedSession): Record<string, unknown> {
  return {
    backend: session.backend,
    determinism: session.determinism,
    table: session.table,
    status: session.status,
    view: session.view,
    events: session.events,
    decision: session.decision,
    play: session.play ?? null,
    result: session.result,
    submitted: session.submitted,
    localSeats: session.localSeats,
    transcript: session.transcript,
  };
}

function success(session: ObservedSession, revision: number, token = 'opaque-capability'): Response {
  return Response.json({
    protocol: BROWSER_BACKEND_PROTOCOL,
    ok: true,
    token,
    revision,
    session: wireSession(session),
  });
}

describe('the browser observed backend', () => {
  it('accepts an explicit position with no currently declared play roles', async () => {
    const session = await scriptSession();
    const request = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true })
          : success(
              {
                ...session,
                play: {
                  turnStep: null,
                  passPriority: null,
                  concede: null,
                  objectActions: [],
                  promptRole: null,
                  automatic: null,
                },
              },
              0,
            ),
      ),
    );
    const opened = await httpObservedBackend({ id: 'forge', fetch: request }).open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.play).toEqual({
      turnStep: null,
      passPriority: null,
      concede: null,
      objectActions: [],
      seatActions: [],
      promptRole: null,
      automatic: null,
    });
    await opened.session.close();
  });

  it.each([
    ['card selection', { cardSelection: { origin: 'hand', destination: 'library' } }],
    ['card order', { cardOrder: { destination: 'library', first: 'top' } }],
  ] as const)('preserves an adapter-declared %s role', async (_name, role) => {
    const session = await scriptSession();
    const play = {
      turnStep: null,
      passPriority: null,
      concede: null,
      objectActions: [],
      ...role,
    };
    const request = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true })
          : success({ ...session, play }, 0),
      ),
    );

    const opened = await httpObservedBackend({ id: 'forge', fetch: request }).open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.play).toMatchObject(role);
    await opened.session.close();
  });

  it('preserves adapter-declared opening-hand and routine-move semantics', async () => {
    const session = await scriptSession();
    const automaticMove = session.decision?.options[0]?.id;
    if (automaticMove === undefined) throw new Error('script backend did not offer a move');
    const request = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true })
          : success(
              {
                ...session,
                play: {
                  turnStep: null,
                  passPriority: null,
                  concede: null,
                  objectActions: [],
                  promptRole: 'opening-hand',
                  automatic: { move: automaticMove, reason: 'local-starts' },
                },
              },
              0,
            ),
      ),
    );

    const opened = await httpObservedBackend({ id: 'forge', fetch: request }).open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.play).toMatchObject({
      promptRole: 'opening-hand',
      automatic: { move: automaticMove, reason: 'local-starts' },
    });
    await opened.session.close();
  });

  it('carries who a combat action attacks, a seat or an object the view shows', async () => {
    const session = await scriptSession();
    const [first, second] = session.decision?.options ?? [];
    const north = session.view.seats[0];
    const held = north.hand?.[0];
    if (first === undefined || second === undefined || held === undefined) {
      throw new Error('script backend did not offer two moves and a card');
    }
    const request = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true })
          : success(
              {
                ...session,
                play: {
                  turnStep: 'declareAttackers',
                  passPriority: null,
                  concede: null,
                  objectActions: [
                    { oid: held.oid, move: first.id, category: 'combat', defender: { seat: 1 } },
                    { oid: held.oid, move: second.id, category: 'combat', defender: { oid: held.oid } },
                  ],
                },
              },
              0,
            ),
      ),
    );

    const opened = await httpObservedBackend({ id: 'forge', fetch: request }).open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.play?.objectActions).toEqual([
      { oid: held.oid, move: first.id, category: 'combat', defender: { seat: 1 } },
      { oid: held.oid, move: second.id, category: 'combat', defender: { oid: held.oid } },
    ]);
    await opened.session.close();
  });

  it('opens, submits one offered id with its revision, reaches a result, and closes once', async () => {
    const first = await scriptSession(1);
    const advanced = await first.submit('advance');
    if (!advanced.ok) throw new Error(advanced.error.message);
    const terminal = { ...advanced.session, backend: 'forge', seats: null };
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === 'DELETE') {
        return Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true });
      }
      if (url.endsWith('/sessions')) return success(first, 0);
      return success(terminal, 1);
    });
    const backend = httpObservedBackend({
      id: 'forge',
      baseUrl: '/engine-api',
      fetch: request,
    });

    expect(await backend.supports(TABLE)).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    const opened = await backend.open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const refused = await opened.session.submit('invented-by-the-page');
    expect(refused).toMatchObject({ ok: false, error: { kind: 'unknown-move', offered: 2 } });
    expect(request).toHaveBeenCalledOnce();

    const submitted = await opened.session.submit('advance');
    expect(submitted.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    const moveRequest = request.mock.calls[1];
    expect(String(moveRequest?.[0])).toBe('/engine-api/sessions/opaque-capability');
    expect(moveRequest?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(moveRequest?.[1]?.body))).toEqual({
      protocol: BROWSER_BACKEND_PROTOCOL,
      revision: 0,
      move: 'advance',
    });
    if (!submitted.ok) return;
    expect(submitted.session.status).toBe('finished');
    expect(submitted.session.result?.reason).toBe('the clock ran out');

    await Promise.all([opened.session.close(), submitted.session.close(), submitted.session.close()]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]?.[1]?.method).toBe('DELETE');
  });

  it('carries a commander table, its command zone and commander damage across the wire', async () => {
    // Optional on the projection and on the table, so a reader that rebuilt
    // either from the fields it already knew would hand the board a standard
    // game the backend did not deal.
    const session = await scriptSession(2, COMMANDER);
    // A cast from the command zone is an object action on an object that is in
    // no hand and on no battlefield (CR 903.8), and the gateway admits it the
    // way it admits a hand cast rather than refusing the role as absent.
    const commanderCast =
      session.decision === null
        ? []
        : [{ oid: 'command-0-0', move: session.decision.options[0]!.id, category: 'cast' as const }];
    const request = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true })
          : success(
              {
                ...session,
                play: {
                  turnStep: null,
                  passPriority: null,
                  concede: null,
                  objectActions: commanderCast,
                  promptRole: null,
                  automatic: null,
                },
              },
              0,
            ),
      ),
    );
    const opened = await httpObservedBackend({ id: 'forge', fetch: request }).open(COMMANDER);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.table.rules).toEqual(COMMANDER_RULES);
    expect(opened.session.table.seats[0].deck.commanders).toEqual([{ name: 'general-north', count: 1 }]);
    expect(opened.session.view.seats.map((seat) => seat.life)).toEqual([40, 40]);
    expect(opened.session.view.seats[1].commandZone?.map((object) => object.name)).toEqual(['general-south']);
    expect(opened.session.view.seats[1].commanderDamage).toEqual({});
    expect(opened.session.view.seats[1].commanderCasts).toEqual({ 'command-1-0': 0 });
    expect(opened.session.transcript[0]?.view.seats[0].commandZone).toHaveLength(1);
    expect(commanderCast).toHaveLength(1);
    expect(opened.session.play?.objectActions).toEqual(commanderCast);
    await opened.session.close();
  });

  it('carries a public top card of the library and admits a play declared on it', async () => {
    // Oracle of Mul Daya: the card is in no hand and on no battlefield, and the
    // reader admits the object role on it the way it admits a hand play rather
    // than refusing the role as absent, and carries the field for the board.
    const session = await scriptSession();
    const wire = wireSession(session);
    const view = wire['view'] as Record<string, unknown>;
    const seats = view['seats'] as readonly Record<string, unknown>[];
    const north = seats[0] as Record<string, unknown>;
    const held = (north['hand'] as readonly Record<string, unknown>[])[0] as Record<string, unknown>;
    const top = { ...held, oid: 'library-0-top' };
    const revealed = { ...view, seats: [{ ...north, libraryTop: [top] }, seats[1]] };
    const transcript = wire['transcript'] as readonly Record<string, unknown>[];
    const lastFrame = transcript.at(-1) as Record<string, unknown>;
    const play = {
      turnStep: null,
      passPriority: null,
      concede: null,
      objectActions: [{ oid: 'library-0-top', move: session.decision!.options[0]!.id, category: 'play' }],
      promptRole: null,
      automatic: null,
    };
    const request = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true })
          : Response.json({
              protocol: BROWSER_BACKEND_PROTOCOL,
              ok: true,
              token: 'opaque-capability',
              revision: 0,
              session: {
                ...wire,
                view: revealed,
                transcript: [...transcript.slice(0, -1), { ...lastFrame, view: revealed }],
                play,
              },
            }),
      ),
    );
    const opened = await httpObservedBackend({ id: 'forge', fetch: request }).open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    expect(opened.session.view.seats[0].libraryTop?.map((object) => object.oid)).toEqual(['library-0-top']);
    expect(opened.session.view.seats[1]).not.toHaveProperty('libraryTop');
    expect(opened.session.play?.objectActions).toEqual(play.objectActions);
    await opened.session.close();
  });

  it('carries which blockers the engine assigned to an attacker', async () => {
    const session = await scriptSession();
    const wire = wireSession(session);
    const view = wire['view'] as Record<string, unknown>;
    const seats = view['seats'] as readonly Record<string, unknown>[];
    const north = seats[0] as Record<string, unknown>;
    const held = (north['hand'] as readonly Record<string, unknown>[])[0] as Record<string, unknown>;
    const attacker = { ...held, oid: 'attacker-1', attacking: true, blockedBy: ['blocker-1', 'blocker-2'] };
    const blocked = { ...view, seats: [{ ...north, battlefield: [attacker] }, seats[1]] };
    const transcript = wire['transcript'] as readonly Record<string, unknown>[];
    const lastFrame = transcript.at(-1) as Record<string, unknown>;
    const request = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true })
          : Response.json({
              protocol: BROWSER_BACKEND_PROTOCOL,
              ok: true,
              token: 'opaque-capability',
              revision: 0,
              session: {
                ...wire,
                view: blocked,
                transcript: [...transcript.slice(0, -1), { ...lastFrame, view: blocked }],
              },
            }),
      ),
    );
    const opened = await httpObservedBackend({ id: 'forge', fetch: request }).open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    expect(opened.session.view.seats[0].battlefield[0]?.blockedBy).toEqual(['blocker-1', 'blocker-2']);
    expect(opened.session.view.seats[0].hand?.[0]).not.toHaveProperty('blockedBy');
    await opened.session.close();
  });

  it('carries which permanent a soulbond pair is bonded to, on both members and on neither of a lone one', async () => {
    const session = await scriptSession();
    const wire = wireSession(session);
    const view = wire['view'] as Record<string, unknown>;
    const seats = view['seats'] as readonly Record<string, unknown>[];
    const north = seats[0] as Record<string, unknown>;
    const held = (north['hand'] as readonly Record<string, unknown>[])[0] as Record<string, unknown>;
    const left = { ...held, oid: 'pair-left', pairedWith: 'pair-right' };
    const right = { ...held, oid: 'pair-right', pairedWith: 'pair-left' };
    const alone = { ...held, oid: 'pair-alone' };
    const shown = { ...view, seats: [{ ...north, battlefield: [left, right, alone] }, seats[1]] };
    const transcript = wire['transcript'] as readonly Record<string, unknown>[];
    const lastFrame = transcript.at(-1) as Record<string, unknown>;
    const request = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true })
          : Response.json({
              protocol: BROWSER_BACKEND_PROTOCOL,
              ok: true,
              token: 'opaque-capability',
              revision: 0,
              session: {
                ...wire,
                view: shown,
                transcript: [...transcript.slice(0, -1), { ...lastFrame, view: shown }],
              },
            }),
      ),
    );
    const opened = await httpObservedBackend({ id: 'forge', fetch: request }).open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    const [first, second, third] = opened.session.view.seats[0].battlefield;
    expect(first?.pairedWith).toBe('pair-right');
    expect(second?.pairedWith).toBe('pair-left');
    expect(third).not.toHaveProperty('pairedWith');
    await opened.session.close();
  });

  it('carries the keywords a permanent currently has, and none where the backend reported none', async () => {
    const session = await scriptSession();
    const wire = wireSession(session);
    const view = wire['view'] as Record<string, unknown>;
    const seats = view['seats'] as readonly Record<string, unknown>[];
    const north = seats[0] as Record<string, unknown>;
    const held = (north['hand'] as readonly Record<string, unknown>[])[0] as Record<string, unknown>;
    const granted = { ...held, oid: 'granted-1', keywords: ['flying', 'first strike'] };
    const plain = { ...held, oid: 'plain-1', keywords: [] };
    const unreported = { ...held, oid: 'unreported-1' };
    const shown = { ...view, seats: [{ ...north, battlefield: [granted, plain, unreported] }, seats[1]] };
    const transcript = wire['transcript'] as readonly Record<string, unknown>[];
    const lastFrame = transcript.at(-1) as Record<string, unknown>;
    const request = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true })
          : Response.json({
              protocol: BROWSER_BACKEND_PROTOCOL,
              ok: true,
              token: 'opaque-capability',
              revision: 0,
              session: {
                ...wire,
                view: shown,
                transcript: [...transcript.slice(0, -1), { ...lastFrame, view: shown }],
              },
            }),
      ),
    );
    const opened = await httpObservedBackend({ id: 'forge', fetch: request }).open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    const [first, second, third] = opened.session.view.seats[0].battlefield;
    expect(first?.keywords).toEqual(['flying', 'first strike']);
    expect(second?.keywords).toEqual([]);
    expect(third).not.toHaveProperty('keywords');
    await opened.session.close();
  });

  it("carries a seat's poison and its other counters, and none where the backend reported none", async () => {
    const session = await scriptSession();
    const wire = wireSession(session);
    const view = wire['view'] as Record<string, unknown>;
    const seats = view['seats'] as readonly Record<string, unknown>[];
    const north = seats[0] as Record<string, unknown>;
    const south = seats[1] as Record<string, unknown>;
    const shown = {
      ...view,
      seats: [{ ...north, poison: 2, playerCounters: { ENERGY: 4, RAD: 1 } }, south],
    };
    const transcript = wire['transcript'] as readonly Record<string, unknown>[];
    const lastFrame = transcript.at(-1) as Record<string, unknown>;
    const request = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? Response.json({ protocol: BROWSER_BACKEND_PROTOCOL, ok: true, closed: true })
          : Response.json({
              protocol: BROWSER_BACKEND_PROTOCOL,
              ok: true,
              token: 'opaque-capability',
              revision: 0,
              session: {
                ...wire,
                view: shown,
                transcript: [...transcript.slice(0, -1), { ...lastFrame, view: shown }],
              },
            }),
      ),
    );
    const opened = await httpObservedBackend({ id: 'forge', fetch: request }).open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    const [held, empty] = opened.session.view.seats;
    expect(held).toMatchObject({ poison: 2, playerCounters: { ENERGY: 4, RAD: 1 } });
    expect(empty).not.toHaveProperty('poison');
    expect(empty).not.toHaveProperty('playerCounters');
    await opened.session.close();
  });

  it('rejects malformed external snapshots instead of casting them into sessions', async () => {
    const session = await scriptSession();
    const base = {
      protocol: BROWSER_BACKEND_PROTOCOL,
      ok: true,
      token: 'opaque-capability',
      revision: 0,
      session: wireSession(session),
    };
    const sessionWire = base.session;
    const view = sessionWire['view'] as Record<string, unknown>;
    const seats = view['seats'] as readonly Record<string, unknown>[];
    const north = seats[0] as Record<string, unknown>;
    const hand = north['hand'] as readonly Record<string, unknown>[];
    const held = hand[0] as Record<string, unknown>;
    const decision = sessionWire['decision'] as Record<string, unknown>;
    const options = decision['options'] as readonly Record<string, unknown>[];
    const transcript = sessionWire['transcript'] as readonly Record<string, unknown>[];
    const lastFrame = transcript.at(-1) as Record<string, unknown>;
    const firstMove = String(options[0]?.['id']);
    const secondMove = String(options[1]?.['id']);
    const validPlay = {
      turnStep: 'upkeep',
      passPriority: firstMove,
      concede: secondMove,
      objectActions: [],
      seatActions: [],
      attackers: null,
      promptRole: null,
      automatic: null,
    };
    const table = sessionWire['table'] as Record<string, unknown>;
    const tableSeats = table['seats'] as readonly Record<string, unknown>[];
    const northSeat = tableSeats[0] as Record<string, unknown>;
    const cases: readonly [string, unknown][] = [
      ['a foreign protocol', { ...base, protocol: BROWSER_BACKEND_PROTOCOL + 1 }],
      [
        'match rules naming an invented variant',
        {
          ...base,
          session: { ...sessionWire, table: { ...table, rules: { variant: 'archenemy', startingLife: 40 } } },
        },
      ],
      [
        'match rules with a life total nobody can start on',
        {
          ...base,
          session: { ...sessionWire, table: { ...table, rules: { variant: 'commander', startingLife: 0 } } },
        },
      ],
      [
        'a commander slot with no count',
        {
          ...base,
          session: {
            ...sessionWire,
            table: {
              ...table,
              seats: [
                {
                  ...northSeat,
                  deck: { ...(northSeat['deck'] as object), commanders: [{ name: 'general-north' }] },
                },
                tableSeats[1],
              ],
            },
          },
        },
      ],
      [
        'a library top that is not an object list',
        {
          ...base,
          session: {
            ...sessionWire,
            view: { ...view, seats: [{ ...north, libraryTop: 'Forest' }, seats[1]] },
          },
        },
      ],
      [
        'a command zone that is not an object list',
        {
          ...base,
          session: {
            ...sessionWire,
            view: { ...view, seats: [{ ...north, commandZone: 'general' }, seats[1]] },
          },
        },
      ],
      [
        'negative commander damage',
        {
          ...base,
          session: {
            ...sessionWire,
            view: { ...view, seats: [{ ...north, commanderDamage: { 'command-1-0': -1 } }, seats[1]] },
          },
        },
      ],
      [
        'a negative commander cast count',
        {
          ...base,
          session: {
            ...sessionWire,
            view: { ...view, seats: [{ ...north, commanderCasts: { 'command-1-0': -1 } }, seats[1]] },
          },
        },
      ],
      [
        'a negative poison count',
        {
          ...base,
          session: {
            ...sessionWire,
            view: { ...view, seats: [{ ...north, poison: -1 }, seats[1]] },
          },
        },
      ],
      [
        'a player counter that is not a count',
        {
          ...base,
          session: {
            ...sessionWire,
            view: { ...view, seats: [{ ...north, playerCounters: { ENERGY: 1.5 } }, seats[1]] },
          },
        },
      ],
      [
        'player counters that are not a map',
        {
          ...base,
          session: {
            ...sessionWire,
            view: { ...view, seats: [{ ...north, playerCounters: ['ENERGY'] }, seats[1]] },
          },
        },
      ],
      ['no capability', { ...base, token: '' }],
      ['a negative revision', { ...base, revision: -1 }],
      ['a revision beyond submitted moves', { ...base, revision: 1 }],
      ['another backend identity', { ...base, session: { ...sessionWire, backend: 'other' } }],
      ['the recorded arm', { ...base, session: { ...base.session, determinism: 'recorded' } }],
      [
        'an unknown standard turn step',
        { ...base, session: { ...sessionWire, play: { ...validPlay, turnStep: 'invented-step' } } },
      ],
      [
        'a play role that is not offered',
        { ...base, session: { ...sessionWire, play: { ...validPlay, passPriority: 'stale-pass' } } },
      ],
      [
        'a mana take-back role that is not offered',
        { ...base, session: { ...sessionWire, play: { ...validPlay, undo: 'stale-undo' } } },
      ],
      [
        'a negative floating mana count',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              ...validPlay,
              manaPools: [
                { W: 0, U: 0, B: 0, R: 0, G: -1, C: 0 },
                { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
              ],
            },
          },
        },
      ],
      [
        'an invented floating mana color',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              ...validPlay,
              manaPools: [
                { W: 0, U: 0, B: 0, R: 0, G: 0, purple: 0 },
                { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
              ],
            },
          },
        },
      ],
      [
        'two roles with one move',
        {
          ...base,
          session: { ...sessionWire, play: { ...validPlay, concede: firstMove } },
        },
      ],
      [
        'an extra play-role field',
        { ...base, session: { ...sessionWire, play: { ...validPlay, invented: true } } },
      ],
      [
        'an invented prompt role',
        { ...base, session: { ...sessionWire, play: { ...validPlay, promptRole: 'invented' } } },
      ],
      [
        'an invented card selection origin',
        {
          ...base,
          session: {
            ...sessionWire,
            play: { ...validPlay, cardSelection: { origin: 'graveyard', destination: 'library' } },
          },
        },
      ],
      [
        'an extra card selection field',
        {
          ...base,
          session: {
            ...sessionWire,
            play: { ...validPlay, cardSelection: { origin: 'hand', destination: 'library', count: 1 } },
          },
        },
      ],
      [
        'an invented card order direction',
        {
          ...base,
          session: {
            ...sessionWire,
            play: { ...validPlay, cardOrder: { destination: 'library', first: 'bottom' } },
          },
        },
      ],
      [
        'an attacker confirm move that is not offered',
        {
          ...base,
          session: {
            ...sessionWire,
            play: { ...validPlay, attackers: { confirm: 'stale-combat-confirm', staged: [] } },
          },
        },
      ],
      [
        'a staged attacker that has no exact combat toggle',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              ...validPlay,
              passPriority: null,
              attackers: { confirm: firstMove, staged: ['absent-attacker'] },
            },
          },
        },
      ],
      [
        'an automatic move with an invented reason',
        {
          ...base,
          session: {
            ...sessionWire,
            play: { ...validPlay, automatic: { move: firstMove, reason: 'invented' } },
          },
        },
      ],
      [
        'an automatic move that is not offered',
        {
          ...base,
          session: {
            ...sessionWire,
            play: { ...validPlay, automatic: { move: 'stale-automatic', reason: 'mana-payment' } },
          },
        },
      ],
      [
        'an object action for an absent object',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              turnStep: 'upkeep',
              passPriority: null,
              concede: null,
              objectActions: [{ oid: 'absent-object', move: firstMove }],
            },
          },
        },
      ],
      [
        'an object action for an unoffered move',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              turnStep: 'upkeep',
              passPriority: null,
              concede: null,
              objectActions: [{ oid: String(held['oid']), move: 'stale-object-action' }],
            },
          },
        },
      ],
      [
        'an object action with an invented category',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              turnStep: 'upkeep',
              passPriority: null,
              concede: null,
              objectActions: [{ oid: String(held['oid']), move: firstMove, category: 'invented-category' }],
            },
          },
        },
      ],
      [
        'an object action with an invented mana output',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              turnStep: 'upkeep',
              passPriority: null,
              concede: null,
              objectActions: [
                { oid: String(held['oid']), move: firstMove, category: 'mana', manaOutput: 'purple' },
              ],
            },
          },
        },
      ],
      [
        'a non-mana object action carrying a mana output',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              turnStep: 'upkeep',
              passPriority: null,
              concede: null,
              objectActions: [
                { oid: String(held['oid']), move: firstMove, category: 'ability', manaOutput: 'U' },
              ],
            },
          },
        },
      ],
      [
        'a non-combat object action naming a defender',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              turnStep: 'upkeep',
              passPriority: null,
              concede: null,
              objectActions: [
                { oid: String(held['oid']), move: firstMove, category: 'ability', defender: { seat: 1 } },
              ],
            },
          },
        },
      ],
      [
        'a combat action whose defender names an object the view does not show',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              turnStep: 'upkeep',
              passPriority: null,
              concede: null,
              objectActions: [
                {
                  oid: String(held['oid']),
                  move: firstMove,
                  category: 'combat',
                  defender: { oid: 'absent-walker' },
                },
              ],
            },
          },
        },
      ],
      [
        'a combat action whose defender names both a seat and an object',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              turnStep: 'upkeep',
              passPriority: null,
              concede: null,
              objectActions: [
                {
                  oid: String(held['oid']),
                  move: firstMove,
                  category: 'combat',
                  defender: { seat: 1, oid: String(held['oid']) },
                },
              ],
            },
          },
        },
      ],
      [
        'a combat action whose defender is an invalid seat',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              turnStep: 'upkeep',
              passPriority: null,
              concede: null,
              objectActions: [
                { oid: String(held['oid']), move: firstMove, category: 'combat', defender: { seat: 7 } },
              ],
            },
          },
        },
      ],
      [
        'a seat action for an invalid seat',
        {
          ...base,
          session: {
            ...sessionWire,
            play: {
              turnStep: 'upkeep',
              passPriority: null,
              concede: null,
              objectActions: [],
              seatActions: [{ seat: 7, move: firstMove }],
            },
          },
        },
      ],
      [
        'a stale projection',
        {
          ...base,
          session: {
            ...base.session,
            view: { ...(base.session['view'] as Record<string, unknown>), version: 99 },
          },
        },
      ],
      [
        'a malformed move',
        {
          ...base,
          session: {
            ...base.session,
            decision: {
              ...(base.session['decision'] as Record<string, unknown>),
              options: [{ id: '', text: 'not an id', targets: [] }],
            },
          },
        },
      ],
      [
        'duplicate move ids',
        {
          ...base,
          session: {
            ...sessionWire,
            decision: {
              ...decision,
              options: [options[0], { ...options[1], id: options[0]?.['id'] }],
            },
          },
        },
      ],
      [
        'an empty object id',
        {
          ...base,
          session: {
            ...sessionWire,
            view: {
              ...view,
              seats: [{ ...north, hand: [{ ...held, oid: '' }, ...hand.slice(1)] }, seats[1]],
            },
          },
        },
      ],
      [
        'negative damage',
        {
          ...base,
          session: {
            ...sessionWire,
            view: {
              ...view,
              seats: [{ ...north, hand: [{ ...held, damage: -1 }, ...hand.slice(1)] }, seats[1]],
            },
          },
        },
      ],
      [
        'a non-boolean attacking state',
        {
          ...base,
          session: {
            ...sessionWire,
            view: {
              ...view,
              seats: [{ ...north, hand: [{ ...held, attacking: 'maybe' }, ...hand.slice(1)] }, seats[1]],
            },
          },
        },
      ],
      [
        'a blocker list that is not a list of oids',
        {
          ...base,
          session: {
            ...sessionWire,
            view: {
              ...view,
              seats: [
                { ...north, hand: [{ ...held, blockedBy: ['', 'forge-card-9'] }, ...hand.slice(1)] },
                seats[1],
              ],
            },
          },
        },
      ],
      [
        'a negative counter count',
        {
          ...base,
          session: {
            ...sessionWire,
            view: {
              ...view,
              seats: [
                { ...north, hand: [{ ...held, counters: { charge: -1 } }, ...hand.slice(1)] },
                seats[1],
              ],
            },
          },
        },
      ],
      [
        'a keyword that is not a non-empty string',
        {
          ...base,
          session: {
            ...sessionWire,
            view: {
              ...view,
              seats: [
                { ...north, hand: [{ ...held, keywords: ['flying', ''] }, ...hand.slice(1)] },
                seats[1],
              ],
            },
          },
        },
      ],
      [
        'a pairing that is not a non-empty string',
        {
          ...base,
          session: {
            ...sessionWire,
            view: {
              ...view,
              seats: [{ ...north, hand: [{ ...held, pairedWith: '' }, ...hand.slice(1)] }, seats[1]],
            },
          },
        },
      ],
      ['the wrong local seats', { ...base, session: { ...sessionWire, localSeats: [1] } }],
      [
        'a malformed card origin',
        {
          ...base,
          session: {
            ...sessionWire,
            table: {
              ...(sessionWire['table'] as Record<string, unknown>),
              seats: [
                {
                  ...TABLE.seats[0],
                  deck: {
                    name: 'north',
                    cards: [
                      {
                        name: 'Shared Spark',
                        count: 1,
                        origin: { kind: 'custom', setCode: '', cardId: 'cstm-shared-spark' },
                      },
                    ],
                  },
                },
                TABLE.seats[1],
              ],
            },
          },
        },
      ],
      ['no transcript', { ...base, session: { ...sessionWire, transcript: null } }],
      ['a short transcript', { ...base, session: { ...sessionWire, transcript: [] } }],
      [
        'a final transcript view unlike the current view',
        {
          ...base,
          session: {
            ...sessionWire,
            transcript: [
              ...transcript.slice(0, -1),
              {
                ...lastFrame,
                view: {
                  ...(lastFrame['view'] as Record<string, unknown>),
                  turn: {
                    ...((lastFrame['view'] as Record<string, unknown>)['turn'] as Record<string, unknown>),
                    number: 99,
                  },
                },
              },
            ],
          },
        },
      ],
      [
        'final transcript events unlike the current events',
        {
          ...base,
          session: {
            ...sessionWire,
            transcript: [
              ...transcript.slice(0, -1),
              {
                ...lastFrame,
                events: [{ seq: 0, type: 'invented', text: 'invented', detail: {}, reveals: [] }],
              },
            ],
          },
        },
      ],
    ];

    for (const [name, body] of cases) {
      const backend = httpObservedBackend({
        id: 'forge',
        fetch: () => Promise.resolve(Response.json(body)),
      });
      const opened = await backend.open(TABLE);
      expect(opened.ok, name).toBe(false);
      if (opened.ok) continue;
      expect(opened.error.kind, name).toBe('backend-failure');
      expect(opened.error.message.length, name).toBeGreaterThan(0);
    }
  });

  it('turns explicit gateway and transport failures into renderable backend errors', async () => {
    const gateway = httpObservedBackend({
      id: 'forge',
      fetch: () =>
        Promise.resolve(
          Response.json(
            {
              protocol: BROWSER_BACKEND_PROTOCOL,
              ok: false,
              error: { code: 'route-refused', message: 'no backend route is configured' },
            },
            { status: 422 },
          ),
        ),
    });
    const refused = await gateway.open(TABLE);
    expect(refused).toEqual({
      ok: false,
      error: { kind: 'backend-failure', message: 'route-refused: no backend route is configured' },
    });

    const offline = httpObservedBackend({
      id: 'forge',
      fetch: () => Promise.reject(new Error('connection refused')),
    });
    const unavailable = await offline.open(TABLE);
    expect(unavailable).toEqual({
      ok: false,
      error: { kind: 'backend-failure', message: 'gateway request failed: connection refused' },
    });
  });
});
