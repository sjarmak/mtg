/**
 * Give every observed match its own resource-owning backend instance.
 *
 * The backend gateway remains generic and sees one ordinary `ObservedBackend`.
 * This adapter is for launchers whose installed backend creates a writable
 * runtime at construction time: `supports` stays on one read-only probe, while
 * every `open` receives a fresh runtime that is shut down with that session.
 */
import type {
  ObservedBackend,
  ObservedSession,
  OpenResult,
  SessionError,
  SessionSpec,
  SubmitResult,
} from '@mtg/engine';

interface SessionOwner {
  readonly backend: ObservedBackend;
  current: ObservedSession;
  closing: Promise<void> | null;
}

export const SNAPSHOT_FORGE_REMOVED_MESSAGE =
  "The lab's Forge copy was removed; restart the lab with `npm run play`.";

function failure(message: string): OpenResult<ObservedSession> {
  return { ok: false, error: { kind: 'backend-failure', message } };
}

async function shutdown(backend: ObservedBackend): Promise<void> {
  await (backend.shutdown?.() ?? Promise.resolve());
}

function compatible(probe: ObservedBackend, candidate: ObservedBackend): string | null {
  if (candidate.id !== probe.id) {
    return `isolated backend factory changed identity from ${probe.id} to ${candidate.id}`;
  }
  const expected = probe.capabilities;
  const found = candidate.capabilities;
  if (
    found.undo !== expected.undo ||
    found.fork !== expected.fork ||
    found.perSeatProjection !== expected.perSeatProjection ||
    found.engineSeats !== expected.engineSeats
  ) {
    return `isolated backend factory changed ${probe.id} capabilities`;
  }
  return null;
}

function closeOwner(owner: SessionOwner, owners: Set<SessionOwner>): Promise<void> {
  if (owner.closing !== null) return owner.closing;
  owner.closing = (async (): Promise<void> => {
    const failures: unknown[] = [];
    try {
      await owner.current.close();
    } catch (cause) {
      failures.push(cause);
    }
    try {
      await shutdown(owner.backend);
    } catch (cause) {
      failures.push(cause);
    } finally {
      owners.delete(owner);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'isolated backend session cleanup failed');
  })();
  return owner.closing;
}

function closedError(backend: string): SessionError {
  return { kind: 'no-decision-pending', message: `isolated backend ${backend} session is closed` };
}

function wrapSession(owner: SessionOwner, owners: Set<SessionOwner>): ObservedSession {
  const source = owner.current;
  return {
    ...source,
    submit: async (move): Promise<SubmitResult<ObservedSession>> => {
      if (owner.closing !== null) return { ok: false, error: closedError(source.backend) };
      const submitted = await source.submit(move);
      if (!submitted.ok) return submitted;
      owner.current = submitted.session;
      return { ok: true, session: wrapSession(owner, owners) };
    },
    close: (): Promise<void> => closeOwner(owner, owners),
  };
}

/**
 * Present one stable backend identity while isolating every opened session.
 *
 * `probe` owns capability checks and no match. `create` must return a new
 * backend instance; a missing or incompatible later instance fails explicitly.
 */
export function isolatedObservedBackend(
  probe: ObservedBackend,
  create: () => ObservedBackend | null,
  missingMessage = `isolated backend ${probe.id} is no longer installed`,
): ObservedBackend {
  let state: 'open' | 'shutting-down' | 'shut-down' = 'open';
  let closing: Promise<void> | null = null;
  const owners = new Set<SessionOwner>();
  const openings = new Set<Promise<void>>();

  const open = async (table: SessionSpec): Promise<OpenResult<ObservedSession>> => {
    if (state !== 'open') return failure(`isolated backend ${probe.id} has shut down`);
    let candidate: ObservedBackend | null;
    try {
      candidate = create();
    } catch (cause) {
      return failure(
        `isolated backend creation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (candidate === null) return failure(missingMessage);

    const mismatch = compatible(probe, candidate);
    if (mismatch !== null) {
      await shutdown(candidate);
      return failure(mismatch);
    }

    let finishOpening = (): void => undefined;
    const pending = new Promise<void>((done) => {
      finishOpening = done;
    });
    openings.add(pending);
    try {
      let opened: OpenResult<ObservedSession>;
      try {
        opened = await candidate.open(table);
      } catch (cause) {
        await shutdown(candidate);
        return failure(
          `isolated backend open failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      if (!opened.ok) {
        await shutdown(candidate);
        return opened;
      }
      if (state !== 'open') {
        try {
          await opened.session.close();
        } finally {
          await shutdown(candidate);
        }
        return failure(`isolated backend ${probe.id} has shut down`);
      }
      const owner: SessionOwner = { backend: candidate, current: opened.session, closing: null };
      owners.add(owner);
      return { ok: true, session: wrapSession(owner, owners) };
    } finally {
      openings.delete(pending);
      finishOpening();
    }
  };

  return {
    id: probe.id,
    determinism: 'observed',
    capabilities: probe.capabilities,
    supports: (table): Promise<readonly string[]> =>
      state === 'open'
        ? probe.supports(table)
        : Promise.resolve([`isolated backend ${probe.id} has shut down`]),
    open,
    shutdown: (): Promise<void> => {
      if (closing !== null) return closing;
      state = 'shutting-down';
      closing = (async (): Promise<void> => {
        await Promise.all([...openings]);
        const results = await Promise.allSettled([...owners].map((owner) => closeOwner(owner, owners)));
        const failures: unknown[] = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        try {
          await shutdown(probe);
        } catch (cause) {
          failures.push(cause);
        }
        state = 'shut-down';
        if (failures.length > 0) {
          throw new AggregateError(failures, 'isolated backend shutdown failed');
        }
      })();
      return closing;
    },
  };
}
