/**
 * The backend-neutral session gateway over real loopback HTTP.
 *
 * A browser owns only the capability token and revision returned here.  The
 * installed backend stays behind the server, selection happens once before
 * open, and every later request is an opaque move against that selected match.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  MoveId,
  ObservedBackend,
  ObservedSession,
  OpenResult,
  SessionSpec,
  SubmitResult,
} from '@mtg/engine';
import { COMMANDER_RULES, scriptBackend } from '@mtg/engine';
import type { GameplayCapture, GameplayRecorder, RunningBackendGateway } from '@mtg/netplay';
import {
  BACKEND_GATEWAY_ABANDONED_AFTER_MS,
  BACKEND_GATEWAY_PROTOCOL,
  MAX_BACKEND_GATEWAY_SESSIONS,
  serveBackendGateway,
} from '@mtg/netplay';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'backend-gateway',
  maximumTurns: null,
};

const ROUTES = {
  generated: 'kernel',
  printed: { 'legacy-cube-2021-08': 'forge' },
} as const;

interface FakeBackend {
  readonly backend: ObservedBackend;
  readonly supports: ReturnType<typeof vi.fn<(table: SessionSpec) => Promise<readonly string[]>>>;
  readonly open: ReturnType<typeof vi.fn<(table: SessionSpec) => Promise<OpenResult<ObservedSession>>>>;
  readonly submit: ReturnType<typeof vi.fn<(move: MoveId) => void>>;
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function fakeBackend(id: string, clock = 3): FakeBackend {
  const toy = scriptBackend({ clock });
  const supports = vi.fn<(table: SessionSpec) => Promise<readonly string[]>>(() => Promise.resolve([]));
  const submit = vi.fn<(move: MoveId) => void>();
  const close = vi.fn<() => Promise<void>>(() => Promise.resolve());

  const wrap = (session: ObservedSession): ObservedSession => ({
    ...session,
    backend: id,
    seats: null,
    submit: async (move: MoveId): Promise<SubmitResult<ObservedSession>> => {
      submit(move);
      const result = await session.submit(move);
      return result.ok ? { ok: true, session: wrap(result.session) } : result;
    },
    close,
  });
  const open = vi.fn<(table: SessionSpec) => Promise<OpenResult<ObservedSession>>>(async (table) => {
    const result = await toy.open(table);
    return result.ok ? { ok: true, session: wrap(result.session) } : result;
  });
  return {
    backend: { ...toy, id, supports, open },
    supports,
    open,
    submit,
    close,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      if (settle === undefined) throw new Error('deferred promise was not initialized');
      settle(value);
    },
  };
}

let running: RunningBackendGateway | null = null;

afterEach(async () => {
  if (running !== null) await running.close();
  running = null;
});

async function start(
  installed: readonly ObservedBackend[],
  recorder?: GameplayRecorder,
  now?: () => number,
): Promise<string> {
  running = await serveBackendGateway({
    host: '127.0.0.1',
    port: 0,
    installed,
    routes: ROUTES,
    ...(recorder === undefined ? {} : { recorder }),
    ...(now === undefined ? {} : { now }),
  });
  return `http://127.0.0.1:${String(running.port)}`;
}

/** A recorder that keeps what it is handed and answers nothing else. */
function fakeRecorder(): GameplayRecorder & { readonly captures: GameplayCapture[] } {
  const captures: GameplayCapture[] = [];
  return {
    captures,
    record: vi.fn((capture: GameplayCapture) => {
      captures.push(capture);
      return Promise.resolve({ ok: true as const, id: 'recorded' });
    }),
    index: () => Promise.resolve([]),
    read: () => Promise.resolve(null),
  };
}

async function playOut(
  base: string,
  token: string,
  from: number,
  moves: number,
): Promise<Record<string, unknown>> {
  let revision: unknown = from;
  let body: Record<string, unknown> = {};
  for (let taken = 0; taken < moves; taken += 1) {
    const response = await fetch(`${base}/engine-api/sessions/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, revision, move: 'advance' }),
    });
    body = await reply(response);
    revision = body['revision'];
  }
  return body;
}

async function reply(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function openAt(base: string, table: SessionSpec = TABLE): Promise<Record<string, unknown>> {
  return reply(
    await fetch(`${base}/engine-api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, table }),
    }),
  );
}

describe('the backend session gateway', () => {
  it('reports readiness for each exact printed-format route', async () => {
    const forge = fakeBackend('forge');
    const base = await start([forge.backend]);

    const ready = await fetch(
      `${base}/engine-api/readiness?format=${encodeURIComponent('legacy-cube-2021-08')}`,
    );
    expect(ready.status).toBe(200);
    expect(await reply(ready)).toEqual({
      protocol: BACKEND_GATEWAY_PROTOCOL,
      ok: true,
      format: 'legacy-cube-2021-08',
      ready: true,
    });

    const absent = await fetch(`${base}/engine-api/readiness?format=commander`);
    expect(absent.status).toBe(200);
    expect(await reply(absent)).toEqual({
      protocol: BACKEND_GATEWAY_PROTOCOL,
      ok: true,
      format: 'commander',
      ready: false,
    });
  });

  it('refuses malformed readiness probes without probing a backend', async () => {
    const forge = fakeBackend('forge');
    const base = await start([forge.backend]);

    const missing = await fetch(`${base}/engine-api/readiness`);
    expect(missing.status).toBe(400);
    expect(await reply(missing)).toMatchObject({
      protocol: BACKEND_GATEWAY_PROTOCOL,
      ok: false,
      error: { code: 'malformed-request' },
    });
    expect(forge.supports).not.toHaveBeenCalled();
  });

  it('selects the canonical legacy route once before open and plays the selected backend to a result', async () => {
    const forge = fakeBackend('forge', 3);
    const fallback = fakeBackend('kernel', 3);
    const base = await start([fallback.backend, forge.backend]);

    const opened = await openAt(base);
    expect(opened['ok']).toBe(true);
    expect(forge.supports).toHaveBeenCalledOnce();
    expect(forge.supports).toHaveBeenCalledWith(TABLE);
    expect(forge.open).toHaveBeenCalledOnce();
    expect(forge.open).toHaveBeenCalledWith(TABLE);
    expect(fallback.supports).not.toHaveBeenCalled();
    expect(fallback.open).not.toHaveBeenCalled();

    const token = opened['token'];
    expect(typeof token).toBe('string');
    if (typeof token !== 'string') return;
    let revision = opened['revision'];
    expect(revision).toBe(0);
    for (const move of ['advance', 'advance', 'advance']) {
      const response = await fetch(`${base}/engine-api/sessions/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, revision, move }),
      });
      expect(response.status).toBe(200);
      const body = await reply(response);
      expect(body['ok']).toBe(true);
      revision = body['revision'];
    }

    expect(revision).toBe(3);
    expect(forge.submit).toHaveBeenCalledTimes(3);
    expect(forge.submit.mock.calls.map(([move]) => move)).toEqual(['advance', 'advance', 'advance']);
  });

  it('hands a commander table to the backend whole and answers with its command zone', async () => {
    // The reader rebuilds the table from the fields it knows, so the rules and
    // the command zone's cards have to be fields it knows: a backend handed the
    // main deck alone would refuse a commander table the browser had filled in.
    const forge = fakeBackend('forge', 3);
    const base = await start([forge.backend]);
    const commander: SessionSpec = {
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
    const opened = await openAt(base, commander);
    expect(opened['ok']).toBe(true);
    expect(forge.supports).toHaveBeenCalledWith(commander);
    expect(forge.open).toHaveBeenCalledWith(commander);
    const session = opened['session'] as Record<string, unknown>;
    expect(session['table']).toEqual(commander);
    const view = session['view'] as { seats: readonly Record<string, unknown>[] };
    expect(view.seats.map((seat) => seat['life'])).toEqual([40, 40]);
    expect(view.seats[1]?.['commandZone']).toMatchObject([{ name: 'general-south' }]);

    const invented = await fetch(`${base}/engine-api/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        protocol: BACKEND_GATEWAY_PROTOCOL,
        table: { ...TABLE, rules: { variant: 'archenemy', startingLife: 40 } },
      }),
    });
    expect(invented.status).toBe(400);
    expect(await reply(invented)).toMatchObject({
      ok: false,
      error: {
        code: 'malformed-request',
        message: expect.stringContaining('standard, commander, or momir') as string,
      },
    });
  });

  it('seats a pod of four, and refuses one seat', async () => {
    const forge = fakeBackend('forge', 3);
    const base = await start([forge.backend]);
    const seat = (name: string): SessionSpec['seats'][number] => ({
      name,
      controller: 'local',
      deck: { name: name.toLowerCase(), cards: [] },
    });
    const pod: SessionSpec = {
      ...TABLE,
      seats: [seat('North'), seat('East'), seat('South'), seat('West')],
    };
    const opened = await openAt(base, pod);
    expect(opened['ok']).toBe(true);
    const view = (opened['session'] as { view: { seats: readonly unknown[] } }).view;
    expect(view.seats).toHaveLength(4);

    const alone = await openAt(base, { ...TABLE, seats: [TABLE.seats[0]] } as unknown as SessionSpec);
    expect(alone).toMatchObject({ ok: false, error: { message: 'the request must name at least 2 seats' } });
  });

  it('rejects malformed, oversized, unknown-move, unknown-session, and stale requests explicitly', async () => {
    const forge = fakeBackend('forge');
    const base = await start([forge.backend]);

    const malformedJson = await fetch(`${base}/engine-api/sessions`, { method: 'POST', body: '{' });
    expect(malformedJson.status).toBe(400);
    expect(await reply(malformedJson)).toMatchObject({
      ok: false,
      error: { code: 'malformed-request' },
    });

    const malformedTable = await fetch(`${base}/engine-api/sessions`, {
      method: 'POST',
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, table: {} }),
    });
    expect(malformedTable.status).toBe(400);
    expect(await reply(malformedTable)).toMatchObject({
      ok: false,
      error: { code: 'malformed-request' },
    });

    const oversized = await fetch(`${base}/engine-api/sessions`, {
      method: 'POST',
      body: JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
    });
    expect(oversized.status).toBe(413);
    expect(await reply(oversized)).toMatchObject({
      ok: false,
      error: { code: 'request-too-large' },
    });

    const unknownSession = await fetch(`${base}/engine-api/sessions/not-a-capability`, {
      method: 'POST',
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, revision: 0, move: 'advance' }),
    });
    expect(unknownSession.status).toBe(404);
    expect(await reply(unknownSession)).toMatchObject({
      ok: false,
      error: { code: 'unknown-session' },
    });

    const opened = await openAt(base);
    const token = opened['token'];
    expect(typeof token).toBe('string');
    if (typeof token !== 'string') return;
    const unknownMove = await fetch(`${base}/engine-api/sessions/${token}`, {
      method: 'POST',
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, revision: 0, move: 'invented' }),
    });
    expect(unknownMove.status).toBe(409);
    expect(await reply(unknownMove)).toMatchObject({
      ok: false,
      error: { code: 'unknown-move' },
    });
    expect(forge.submit).not.toHaveBeenCalled();

    const moved = await fetch(`${base}/engine-api/sessions/${token}`, {
      method: 'POST',
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, revision: 0, move: 'advance' }),
    });
    expect(moved.status).toBe(200);
    const stale = await fetch(`${base}/engine-api/sessions/${token}`, {
      method: 'POST',
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, revision: 0, move: 'advance' }),
    });
    expect(stale.status).toBe(409);
    expect(await reply(stale)).toMatchObject({
      ok: false,
      error: { code: 'stale-revision' },
    });
    expect(forge.submit).toHaveBeenCalledOnce();
  });

  it('bounds live sessions and refuses rather than evicting one already being played', async () => {
    const forge = fakeBackend('forge');
    const base = await start([forge.backend]);

    for (let count = 0; count < MAX_BACKEND_GATEWAY_SESSIONS; count += 1) {
      expect((await openAt(base))['ok']).toBe(true);
    }
    const refused = await fetch(`${base}/engine-api/sessions`, {
      method: 'POST',
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, table: TABLE }),
    });
    expect(refused.status).toBe(429);
    expect(await reply(refused)).toMatchObject({
      ok: false,
      error: { code: 'session-limit' },
    });
    expect(forge.open).toHaveBeenCalledTimes(MAX_BACKEND_GATEWAY_SESSIONS);
  });

  it('makes room at the bound by closing the game left unused the longest, and keeps the ones being played', async () => {
    const minute = 60_000;
    const forge = fakeBackend('forge');
    let clock = 0;
    const base = await start([forge.backend], undefined, () => clock);

    const unused = (await openAt(base))['token'];
    clock = minute;
    const played = (await openAt(base))['token'];
    clock = 10 * minute;
    for (let count = 2; count < MAX_BACKEND_GATEWAY_SESSIONS; count += 1) {
      expect((await openAt(base))['ok']).toBe(true);
    }
    if (typeof unused !== 'string' || typeof played !== 'string') throw new Error('no token');

    clock = minute + BACKEND_GATEWAY_ABANDONED_AFTER_MS;
    expect((await playOut(base, played, 0, 1))['ok']).toBe(true);
    expect((await openAt(base))['ok']).toBe(true);
    expect(forge.close).toHaveBeenCalledOnce();

    const gone = await fetch(`${base}/engine-api/sessions/${unused}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, revision: 0, move: 'advance' }),
    });
    expect(gone.status).toBe(404);
    expect(await reply(gone)).toMatchObject({
      ok: false,
      error: { code: 'unknown-session', message: expect.stringContaining('to make room') },
    });
    expect((await playOut(base, played, 1, 1))['ok']).toBe(true);

    expect(await openAt(base)).toMatchObject({ ok: false, error: { code: 'session-limit' } });
    expect(forge.close).toHaveBeenCalledOnce();
  });

  it('closes a finished game before any other when the bound is reached, and records it once', async () => {
    const forge = fakeBackend('forge', 1);
    const recorder = fakeRecorder();
    const base = await start([forge.backend], recorder, () => 0);
    const tokens: string[] = [];
    for (let count = 0; count < MAX_BACKEND_GATEWAY_SESSIONS; count += 1) {
      const token = (await openAt(base))['token'];
      if (typeof token !== 'string') throw new Error('no token');
      tokens.push(token);
    }
    const [first] = tokens;
    const last = tokens.at(-1);
    if (first === undefined || last === undefined) throw new Error('no token');
    const finished = await playOut(base, last, 0, 1);
    expect((finished['session'] as Record<string, unknown>)['status']).toBe('finished');

    expect((await openAt(base))['ok']).toBe(true);
    expect(forge.close).toHaveBeenCalledOnce();
    expect(recorder.record).toHaveBeenCalledTimes(1);
    const gone = await fetch(`${base}/engine-api/sessions/${last}`, { method: 'DELETE' });
    expect(gone.status).toBe(404);

    const open = await fetch(`${base}/engine-api/sessions/${first}`, { method: 'DELETE' });
    expect(await reply(open)).toMatchObject({ ok: true, closed: true });
  });

  it('reserves capacity before asynchronous opens so simultaneous requests cannot cross the bound', async () => {
    const forge = fakeBackend('forge');
    const opened = await scriptBackend().open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    const openings: Array<(value: OpenResult<ObservedSession>) => void> = [];
    forge.open.mockImplementation(
      () =>
        new Promise((resolve) => {
          openings.push(resolve);
        }),
    );
    const base = await start([forge.backend]);

    const requests = Array.from({ length: MAX_BACKEND_GATEWAY_SESSIONS + 1 }, () =>
      fetch(`${base}/engine-api/sessions`, {
        method: 'POST',
        body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, table: TABLE }),
      }),
    );
    for (let spin = 0; spin < 100 && openings.length < MAX_BACKEND_GATEWAY_SESSIONS; spin += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const openedCount = openings.length;
    for (const resolve of openings) {
      resolve({
        ok: true,
        session: { ...opened.session, backend: 'forge', seats: null, close: forge.close },
      });
    }
    const responses = await Promise.all(requests);
    expect(openedCount).toBe(MAX_BACKEND_GATEWAY_SESSIONS);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      MAX_BACKEND_GATEWAY_SESSIONS,
    );
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it('accepts the mixed content envelope far enough to let the selected backend name its refusal', async () => {
    const forge = fakeBackend('forge');
    forge.supports.mockResolvedValue(['custom set CSTM is deliberately unavailable']);
    const base = await start([forge.backend]);
    const mixed: SessionSpec = {
      ...TABLE,
      content: {
        kind: 'mixed',
        format: 'legacy-cube-2021-08',
        customSetCodes: ['CSTM'],
      },
      seats: [
        {
          ...TABLE.seats[0],
          deck: {
            name: 'mixed',
            cards: [
              { name: 'Mountain', count: 1, origin: { kind: 'printed' } },
              {
                name: 'Shared Spark',
                count: 1,
                origin: { kind: 'custom', setCode: 'CSTM', cardId: 'cstm-shared-spark' },
              },
            ],
          },
        },
        TABLE.seats[1],
      ],
    };

    const response = await fetch(`${base}/engine-api/sessions`, {
      method: 'POST',
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, table: mixed }),
    });

    expect(response.status).toBe(422);
    expect(await reply(response)).toMatchObject({ ok: false, error: { code: 'route-refused' } });
    expect(forge.supports).toHaveBeenCalledWith(mixed);
    expect(forge.open).not.toHaveBeenCalled();

    const bare = {
      ...mixed,
      seats: [
        {
          ...mixed.seats[0],
          deck: { name: 'ambiguous', cards: [{ name: 'Shared Spark', count: 1 }] },
        },
        mixed.seats[1],
      ],
    };
    const malformed = await fetch(`${base}/engine-api/sessions`, {
      method: 'POST',
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, table: bare }),
    });
    expect(malformed.status).toBe(400);
    expect(await reply(malformed)).toMatchObject({
      ok: false,
      error: { code: 'malformed-request', message: expect.stringContaining('origin') },
    });
    expect(forge.supports).toHaveBeenCalledOnce();
  });

  it('closes a successful session returned after DELETE won a submit race', async () => {
    const toy = await scriptBackend().open(TABLE);
    if (!toy.ok) throw new Error(toy.error.message);
    const completion = deferred<SubmitResult<ObservedSession>>();
    const closeCurrent = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeLate = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const submit = vi.fn<(move: MoveId) => Promise<SubmitResult<ObservedSession>>>(() => completion.promise);
    const current: ObservedSession = {
      ...toy.session,
      backend: 'forge',
      seats: null,
      submit,
      close: closeCurrent,
    };
    const backend: ObservedBackend = {
      ...scriptBackend(),
      id: 'forge',
      supports: () => Promise.resolve([]),
      open: () => Promise.resolve({ ok: true, session: current }),
    };
    const base = await start([backend]);
    const opened = await openAt(base);
    const token = opened['token'];
    expect(typeof token).toBe('string');
    if (typeof token !== 'string') return;

    const submitting = fetch(`${base}/engine-api/sessions/${token}`, {
      method: 'POST',
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, revision: 0, move: 'advance' }),
    });
    for (let spin = 0; spin < 100 && submit.mock.calls.length === 0; spin += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const closing = await fetch(`${base}/engine-api/sessions/${token}`, { method: 'DELETE' });
    expect(closing.status).toBe(200);
    expect(closeCurrent).toHaveBeenCalledOnce();

    completion.resolve({
      ok: true,
      session: { ...toy.session, backend: 'forge', seats: null, close: closeLate },
    });
    expect((await submitting).status).toBe(404);
    expect(closeLate).toHaveBeenCalledOnce();
  });

  it('closes an owned backend session once on client close or server shutdown', async () => {
    const forge = fakeBackend('forge');
    const base = await start([forge.backend]);
    const first = await openAt(base);
    const firstToken = first['token'];
    expect(typeof firstToken).toBe('string');
    if (typeof firstToken !== 'string') return;

    const closed = await fetch(`${base}/engine-api/sessions/${firstToken}`, { method: 'DELETE' });
    expect(closed.status).toBe(200);
    expect(await reply(closed)).toMatchObject({ ok: true, closed: true });
    expect(forge.close).toHaveBeenCalledOnce();

    const closedAgain = await fetch(`${base}/engine-api/sessions/${firstToken}`, { method: 'DELETE' });
    expect(closedAgain.status).toBe(404);
    expect(forge.close).toHaveBeenCalledOnce();

    expect((await openAt(base))['ok']).toBe(true);
    await running?.close();
    running = null;
    expect(forge.close).toHaveBeenCalledTimes(2);
  });

  it('drains an open and its returned session before shutting each backend down once', async () => {
    const toy = await scriptBackend().open(TABLE);
    if (!toy.ok) throw new Error(toy.error.message);
    const completion = deferred<OpenResult<ObservedSession>>();
    const order: string[] = [];
    const closeSession = vi.fn<() => Promise<void>>(async () => {
      order.push('session-close');
    });
    const shutdown = vi.fn<() => Promise<void>>(async () => {
      order.push('backend-shutdown');
    });
    const open = vi.fn<() => Promise<OpenResult<ObservedSession>>>(() => completion.promise);
    const backend: ObservedBackend = {
      ...scriptBackend(),
      id: 'forge',
      supports: () => Promise.resolve([]),
      open,
      shutdown,
    };
    const base = await start([backend]);
    const opening = openAt(base);
    for (let spin = 0; spin < 100 && open.mock.calls.length === 0; spin += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(open).toHaveBeenCalledOnce();

    const firstClose = running!.close();
    const secondClose = running!.close();
    expect(shutdown).not.toHaveBeenCalled();
    completion.resolve({
      ok: true,
      session: { ...toy.session, backend: 'forge', seats: null, close: closeSession },
    });

    await expect(opening).resolves.toMatchObject({ ok: false, error: { code: 'server-closing' } });
    await Promise.all([firstClose, secondClose]);
    running = null;
    expect(order).toEqual(['session-close', 'backend-shutdown']);
    expect(shutdown).toHaveBeenCalledOnce();
  });
});

describe('recording a finished session', () => {
  it('hands the whole transcript to the recorder once, from the submit that finished it', async () => {
    const forge = fakeBackend('forge', 2);
    const recorder = fakeRecorder();
    const base = await start([forge.backend], recorder);
    const opened = await openAt(base);
    const token = opened['token'];
    if (typeof token !== 'string') throw new Error('no token');
    await playOut(base, token, 0, 1);
    expect(recorder.record).not.toHaveBeenCalled();
    const finished = await playOut(base, token, 1, 1);
    const session = finished['session'] as Record<string, unknown>;
    expect(session['status']).toBe('finished');
    expect(recorder.record).toHaveBeenCalledTimes(1);
    const [capture] = recorder.captures;
    expect(capture?.source).toBe('gateway-forge');
    if (capture?.source !== 'gateway-forge') return;
    expect(capture.backend).toBe('forge');
    expect(capture.table).toEqual(TABLE);
    expect(capture.localSeats).toEqual([0]);
    expect(capture.transcript.length).toBe(3);
    expect(capture.result).toEqual(session['result']);

    // Closing the finished session is the ordinary end of a game and records nothing more.
    const closed = await fetch(`${base}/engine-api/sessions/${token}`, { method: 'DELETE' });
    expect(await reply(closed)).toMatchObject({ ok: true, closed: true });
    expect(recorder.record).toHaveBeenCalledTimes(1);
  });

  it('records nothing for a session closed before it finished, and nothing without a recorder', async () => {
    const recorder = fakeRecorder();
    const base = await start([fakeBackend('forge', 3).backend], recorder);
    const token = (await openAt(base))['token'];
    if (typeof token !== 'string') throw new Error('no token');
    await playOut(base, token, 0, 1);
    await fetch(`${base}/engine-api/sessions/${token}`, { method: 'DELETE' });
    expect(recorder.record).not.toHaveBeenCalled();
    await running?.close();

    const silent = await start([fakeBackend('forge', 1).backend]);
    const other = (await openAt(silent))['token'];
    if (typeof other !== 'string') throw new Error('no token');
    const finished = await playOut(silent, other, 0, 1);
    expect((finished['session'] as Record<string, unknown>)['status']).toBe('finished');
  });
});
