/**
 * The play client owns an asynchronous backend session without learning which
 * engine is behind it.
 *
 * User journey: a player opens a match, answers only moves the backend offered,
 * sees each pending operation and the terminal result, and may leave at any
 * point without keeping a backend process alive.  The test subjects include an
 * observed backend and the generated-card kernel adapter because the controller
 * has to be the same object for both halves of the seam.
 */
import { describe, expect, it, vi } from 'vitest';
import { BASIC_LANDS } from '@mtg/dsl';
import type { ObservedBackend, ObservedSession, OpenResult, SessionSpec, SubmitResult } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import type { ContentResolver, GameSetup } from '@mtg/kernel';
import { kernelBackend } from '@mtg/kernel';
import {
  createPlaySessionController,
  type PlaySessionController,
  type PlaySessionControllerState,
  type SessionFeed,
} from '@mtg/ui';

const PRINTED: SessionSpec = {
  content: { kind: 'printed', format: 'legacy' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'ui/session-controller',
  maximumTurns: null,
};

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

function backendOpening(open: () => Promise<OpenResult<ObservedSession>>): ObservedBackend {
  return {
    id: 'observed-ui-test',
    determinism: 'observed',
    capabilities: {
      undo: false,
      fork: false,
      perSeatProjection: true,
      engineSeats: true,
    },
    supports: (): Promise<readonly string[]> => Promise.resolve([]),
    open,
  };
}

async function scriptSession(clock = 3): Promise<ObservedSession> {
  const opened = await scriptBackend({ clock }).open(PRINTED);
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.session;
}

async function atPhase<P extends PlaySessionControllerState['phase']>(
  controller: PlaySessionController,
  phase: P,
): Promise<Extract<PlaySessionControllerState, { readonly phase: P }>> {
  const current = controller.getSnapshot();
  if (current.phase === phase) {
    return current as Extract<PlaySessionControllerState, { readonly phase: P }>;
  }
  return new Promise((resolve) => {
    const unsubscribe = controller.subscribe(() => {
      const next = controller.getSnapshot();
      if (next.phase !== phase) return;
      unsubscribe();
      resolve(next as Extract<PlaySessionControllerState, { readonly phase: P }>);
    });
  });
}

describe('a backend-neutral play session controller', () => {
  it('opens and completes a match against an observed backend using its issued move ids', async () => {
    const controller = createPlaySessionController(scriptBackend({ clock: 3 }), PRINTED);
    const submitted: string[] = [];

    await atPhase(controller, 'awaiting');
    for (let step = 0; step < 4 && controller.getSnapshot().phase === 'awaiting'; step += 1) {
      const state = controller.getSnapshot();
      if (state.phase !== 'awaiting') break;
      const offered = state.session.decision?.options[0];
      expect(offered).toBeDefined();
      if (offered === undefined) break;
      submitted.push(offered.id);
      await controller.submit(offered.id);
    }

    const finished = controller.getSnapshot();
    expect(finished.phase).toBe('finished');
    if (finished.phase !== 'finished') return;
    expect(submitted).toEqual(['advance', 'advance', 'advance']);
    expect(finished.session.submitted).toBe(3);
    expect(finished.session.determinism).toBe('observed');
    if (finished.session.determinism !== 'observed') return;
    expect(finished.session.transcript.map((frame) => frame.move)).toEqual([null, ...submitted]);
    expect(finished.session.result?.reason).toBe('the clock ran out');
  });

  it('surfaces opening and submission failures as values while retaining a playable position', async () => {
    const openingFailure = createPlaySessionController(
      backendOpening(() =>
        Promise.resolve({
          ok: false,
          error: { kind: 'backend-failure', message: 'bridge did not start' },
        }),
      ),
      PRINTED,
    );
    const failedOpen = await atPhase(openingFailure, 'error');
    expect(failedOpen.session).toBeNull();
    expect(failedOpen.error).toEqual({
      kind: 'backend-failure',
      message: 'bridge did not start',
    });

    const base = await scriptSession();
    const refused: ObservedSession = {
      ...base,
      submit: (): Promise<SubmitResult<ObservedSession>> =>
        Promise.resolve({
          ok: false,
          error: { kind: 'timeout', message: 'bridge took too long', millis: 250 },
        }),
    };
    const controller = createPlaySessionController(
      backendOpening(() => Promise.resolve({ ok: true, session: refused })),
      PRINTED,
    );
    const awaiting = await atPhase(controller, 'awaiting');
    const move = awaiting.session.decision?.options[0];
    expect(move).toBeDefined();
    if (move === undefined) return;

    const submitting = controller.submit(move.id);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'submitting', session: refused, move: move.id });
    await submitting;

    const failedSubmit = controller.getSnapshot();
    expect(failedSubmit).toMatchObject({
      phase: 'error',
      session: refused,
      error: { kind: 'timeout', millis: 250 },
    });
  });

  it('reopens the table on retryOpen after an open failure, and ignores it once playable', async () => {
    let attempts = 0;
    const controller = createPlaySessionController(
      backendOpening(async (): Promise<OpenResult<ObservedSession>> => {
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: false,
            error: { kind: 'backend-failure', message: 'gateway-starting: still running startup checks' },
          };
        }
        return { ok: true, session: await scriptSession() };
      }),
      PRINTED,
    );

    const failed = await atPhase(controller, 'error');
    expect(failed.session).toBeNull();

    controller.retryOpen();
    expect(controller.getSnapshot().phase).toBe('opening');

    const awaiting = await atPhase(controller, 'awaiting');
    expect(attempts).toBe(2);
    expect(awaiting.session.submitted).toBe(0);

    controller.retryOpen();
    expect(controller.getSnapshot()).toBe(awaiting);
  });

  it('keeps a disposed controller closed when a stale submit completes and closes both handles', async () => {
    const base = await scriptSession();
    const next = await scriptSession();
    const completion = deferred<SubmitResult<ObservedSession>>();
    const closeCurrent = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeStale = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const current: ObservedSession = {
      ...base,
      submit: (): Promise<SubmitResult<ObservedSession>> => completion.promise,
      close: closeCurrent,
    };
    const stale: ObservedSession = { ...next, close: closeStale };
    const controller = createPlaySessionController(
      backendOpening(() => Promise.resolve({ ok: true, session: current })),
      PRINTED,
    );
    const awaiting = await atPhase(controller, 'awaiting');
    const move = awaiting.session.decision?.options[0];
    expect(move).toBeDefined();
    if (move === undefined) return;

    const submitted = controller.submit(move.id);
    expect(controller.getSnapshot().phase).toBe('submitting');
    const closed = controller.close();
    expect(controller.getSnapshot()).toEqual({ phase: 'closed', session: null, error: null });
    completion.resolve({ ok: true, session: stale });
    await Promise.all([submitted, closed]);

    expect(controller.getSnapshot()).toEqual({ phase: 'closed', session: null, error: null });
    expect(closeCurrent).toHaveBeenCalledOnce();
    expect(closeStale).toHaveBeenCalledOnce();
    await controller.close();
    expect(closeCurrent).toHaveBeenCalledOnce();
    expect(closeStale).toHaveBeenCalledOnce();
  });

  it('closes a session whose open finishes after disposal instead of publishing it', async () => {
    const opening = deferred<OpenResult<ObservedSession>>();
    const closeLate = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const late: ObservedSession = { ...(await scriptSession()), close: closeLate };
    const controller = createPlaySessionController(
      backendOpening(() => opening.promise),
      PRINTED,
    );
    expect(controller.getSnapshot().phase).toBe('opening');

    const closed = controller.close();
    opening.resolve({ ok: true, session: late });
    await closed;

    expect(controller.getSnapshot().phase).toBe('closed');
    expect(closeLate).toHaveBeenCalledOnce();
  });

  it('finishes disposal when the backend rejects close instead of leaking an unhandled rejection', async () => {
    const base = await scriptSession();
    const close = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('process already exited')));
    const session: ObservedSession = { ...base, close };
    const controller = createPlaySessionController(
      backendOpening(() => Promise.resolve({ ok: true, session })),
      PRINTED,
    );
    await atPhase(controller, 'awaiting');

    await expect(controller.close()).resolves.toBeUndefined();

    expect(controller.getSnapshot()).toEqual({ phase: 'closed', session: null, error: null });
    expect(close).toHaveBeenCalledOnce();
  });

  it('drives generated DSL cards through the kernel adapter with the same controller', async () => {
    const mountain = BASIC_LANDS[0];
    if (mountain === undefined) throw new Error('the DSL fixture has no basic land');
    const content: ContentResolver = {
      resolve: (reference, decks, seed) => {
        if (reference.kind !== 'dsl-set') return { ok: false, unresolved: [reference.format] };
        const setup: GameSetup = {
          seed,
          decks: [
            { name: decks[0].name, cards: Array.from({ length: 8 }, () => mountain) },
            { name: decks[1].name, cards: Array.from({ length: 8 }, () => mountain) },
          ],
          maximumTurns: 1,
        };
        return { ok: true, setup };
      },
    };
    const table: SessionSpec = {
      ...PRINTED,
      content: { kind: 'dsl-set', setCode: 'SLC' },
      seed: 'ui/session-controller/kernel',
      maximumTurns: 1,
    };
    const controller = createPlaySessionController(kernelBackend({ content }), table);

    await atPhase(controller, 'awaiting');
    for (let step = 0; step < 100 && controller.getSnapshot().phase === 'awaiting'; step += 1) {
      const state = controller.getSnapshot();
      if (state.phase !== 'awaiting') break;
      const offered = state.session.decision?.options[0];
      expect(offered).toBeDefined();
      if (offered === undefined) break;
      await controller.submit(offered.id);
    }

    const finished = controller.getSnapshot();
    expect(finished.phase).toBe('finished');
    if (finished.phase !== 'finished') return;
    expect(finished.session.backend).toBe('kernel');
    expect(finished.session.table.content.kind).toBe('dsl-set');
    expect(finished.session.result?.reason).toBe('turnLimit');
  });
});

/** A feed the test pushes by hand, counting who is listening. */
function feedOf(): {
  readonly feed: SessionFeed;
  readonly push: (session: ObservedSession) => void;
  readonly listening: () => number;
} {
  const listeners = new Set<(session: ObservedSession) => void>();
  return {
    feed: {
      subscribe: (listener) => {
        listeners.add(listener);
        return (): void => {
          listeners.delete(listener);
        };
      },
    },
    push: (session) => {
      for (const listener of [...listeners]) listener(session);
    },
    listening: () => listeners.size,
  };
}

describe('a play session controller fed positions it did not ask for', () => {
  it('ignores a push while opening, then draws each pushed position as the current one', async () => {
    const session = await scriptSession();
    const moved = await session.submit('advance');
    if (!moved.ok) throw new Error(moved.error.message);
    const opening = deferred<OpenResult<ObservedSession>>();
    const { feed, push } = feedOf();
    const controller = createPlaySessionController(
      backendOpening(() => opening.promise),
      PRINTED,
      { feed },
    );

    expect(controller.getSnapshot().phase).toBe('opening');
    push(moved.session);
    expect(controller.getSnapshot().phase).toBe('opening');

    opening.resolve({ ok: true, session });
    const awaiting = await atPhase(controller, 'awaiting');
    expect(awaiting.session.submitted).toBe(0);

    push(moved.session);
    const pushed = controller.getSnapshot();
    expect(pushed.phase).toBe('awaiting');
    if (pushed.phase !== 'awaiting') return;
    expect(pushed.session.submitted).toBe(1);
  });

  it('finishes on a pushed finished session and stops listening once closed', async () => {
    const session = await scriptSession(1);
    const ended = await session.submit('advance');
    if (!ended.ok) throw new Error(ended.error.message);
    expect(ended.session.status).toBe('finished');
    const { feed, push, listening } = feedOf();
    const controller = createPlaySessionController(
      backendOpening(() => scriptSession(1).then((opened) => ({ ok: true, session: opened }))),
      PRINTED,
      { feed },
    );

    await atPhase(controller, 'awaiting');
    expect(listening()).toBe(1);
    push(ended.session);
    const finished = controller.getSnapshot();
    expect(finished.phase).toBe('finished');
    if (finished.phase !== 'finished') return;
    expect(finished.session.result?.reason).toBe('the clock ran out');

    await controller.close();
    expect(listening()).toBe(0);
    push(session);
    expect(controller.getSnapshot().phase).toBe('closed');
  });
});
