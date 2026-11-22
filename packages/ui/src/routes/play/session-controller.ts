/**
 * A backend-neutral game held outside React.
 *
 * `GameBackend` is used once, to open the table.  Every move after that goes
 * through the immutable `EngineSession` snapshot the backend returned.  The
 * controller does not inspect a backend id, decision kind, turn-step spelling,
 * or object id; those values belong to the backend and are either drawn or sent
 * back unchanged.
 *
 * The operation states are explicit because a subprocess does have a clock of
 * its own.  Unlike the synchronous kernel hook, opening and submitting can be
 * visible waits, failures are values a view must draw, and disposal can race an
 * answer already on the wire.  A late successful answer is closed rather than
 * published, so changing routes cannot leave the process behind that answer
 * alive.
 */
import type { EngineSession, GameBackend, MoveId, SessionError, SessionSpec } from '@mtg/engine';

export type PlaySessionControllerState =
  | {
      readonly phase: 'opening';
      readonly session: null;
      readonly error: null;
    }
  | {
      readonly phase: 'awaiting';
      readonly session: EngineSession;
      readonly error: null;
    }
  | {
      readonly phase: 'submitting';
      readonly session: EngineSession;
      readonly error: null;
      readonly move: MoveId;
    }
  | {
      readonly phase: 'finished';
      readonly session: EngineSession;
      readonly error: null;
    }
  | {
      readonly phase: 'error';
      /** Null when opening failed; the last playable position when submit failed. */
      readonly session: EngineSession | null;
      readonly error: SessionError;
    }
  | {
      readonly phase: 'closed';
      /** Present only when a backend itself returned an already-closed snapshot. */
      readonly session: EngineSession | null;
      readonly error: null;
    };

/**
 * Positions the table reaches without this seat moving.
 *
 * A request-and-answer backend only ever hands back the position its own
 * submit produced. Over the LAN the other seat moves too, and its moves reach
 * this page as pushed positions; the controller applies each as the current
 * one, in every phase but `opening` (there is no session to replace yet) and
 * after `close` (nothing is drawn any more).
 */
export interface SessionFeed {
  readonly subscribe: (listener: (session: EngineSession) => void) => () => void;
}

export interface PlaySessionControllerOptions {
  readonly feed?: SessionFeed;
}

export interface PlaySessionController {
  readonly getSnapshot: () => PlaySessionControllerState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Sends a backend-issued id back to the session that issued it. */
  readonly submit: (move: MoveId) => Promise<void>;
  /** Immediately publishes `closed`, then releases every session that arrives. */
  readonly close: () => Promise<void>;
  readonly retryOpen: () => void;
}

type Listener = () => void;

function backendFailure(operation: 'open' | 'submit', cause: unknown): SessionError {
  return {
    kind: 'backend-failure',
    message: `${operation} rejected outside the backend result channel: ${cause instanceof Error ? cause.message : String(cause)}`,
  };
}

function settledState(session: EngineSession): PlaySessionControllerState {
  switch (session.status) {
    case 'awaiting':
      return { phase: 'awaiting', session, error: null };
    case 'finished':
      return { phase: 'finished', session, error: null };
    case 'closed':
      return { phase: 'closed', session, error: null };
  }
}

async function release(session: EngineSession): Promise<void> {
  try {
    await session.close();
  } catch {
    // Disposal has no consumer for a recovery action.  The controller is
    // already closed, so a dead subprocess must not become an unhandled
    // rejection in React's effect cleanup.
  }
}

export function createPlaySessionController(
  backend: GameBackend,
  table: SessionSpec,
  options: PlaySessionControllerOptions = {},
): PlaySessionController {
  let state: PlaySessionControllerState = { phase: 'opening', session: null, error: null };
  let current: EngineSession | null = null;
  let revision = 0;
  let operation: Promise<void> | null = null;
  let closing: Promise<void> | null = null;
  const listeners = new Set<Listener>();

  const publish = (next: PlaySessionControllerState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const arrived = (session: EngineSession): void => {
    if (closing !== null || state.phase === 'opening') return;
    current = session;
    publish(settledState(session));
  };
  const unfeed = options.feed?.subscribe(arrived) ?? null;

  const open = async (at: number): Promise<void> => {
    try {
      const opened = await backend.open(table);
      if (at !== revision) {
        if (opened.ok) await release(opened.session);
        return;
      }
      if (!opened.ok) {
        publish({ phase: 'error', session: null, error: opened.error });
        return;
      }
      current = opened.session;
      publish(settledState(opened.session));
    } catch (cause) {
      if (at === revision) {
        publish({ phase: 'error', session: null, error: backendFailure('open', cause) });
      }
    }
  };

  operation = open(revision);

  const retryOpen = (): void => {
    if (closing !== null || state.phase !== 'error' || state.session !== null) return;
    const at = revision + 1;
    revision = at;
    publish({ phase: 'opening', session: null, error: null });
    operation = open(at);
  };

  const submit = async (move: MoveId): Promise<void> => {
    if (closing !== null) return;
    if (state.phase !== 'awaiting' && state.phase !== 'error') return;
    const session = state.session;
    if (session === null || session.status !== 'awaiting') return;

    const at = revision + 1;
    revision = at;
    publish({ phase: 'submitting', session, error: null, move });
    const submitting = async (): Promise<void> => {
      try {
        const submitted = await session.submit(move);
        if (at !== revision) {
          if (submitted.ok && submitted.session !== current) await release(submitted.session);
          return;
        }
        if (!submitted.ok) {
          publish({ phase: 'error', session, error: submitted.error });
          return;
        }
        current = submitted.session;
        publish(settledState(submitted.session));
      } catch (cause) {
        if (at === revision) {
          publish({ phase: 'error', session, error: backendFailure('submit', cause) });
        }
      }
    };
    operation = submitting();
    await operation;
  };

  const close = (): Promise<void> => {
    if (closing !== null) return closing;
    unfeed?.();
    revision += 1;
    const held = current;
    current = null;
    const pending = operation;
    publish({ phase: 'closed', session: null, error: null });
    closing = (async (): Promise<void> => {
      if (held !== null) await release(held);
      await pending;
    })();
    return closing;
  };

  return {
    getSnapshot: (): PlaySessionControllerState => state,
    subscribe: (listener: Listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    submit,
    close,
    retryOpen,
  };
}
