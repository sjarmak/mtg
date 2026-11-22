import { describe, expect, it } from 'vitest';
import type { ObservedBackend, ObservedSession, OpenResult, SessionSpec, SubmitResult } from '@mtg/engine';
import {
  isolatedObservedBackend,
  SNAPSHOT_FORGE_REMOVED_MESSAGE,
} from '../../tools/isolated-observed-backend';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'You', controller: 'local', deck: { name: 'You', cards: [{ name: 'Plains', count: 40 }] } },
    { name: 'Bot', controller: 'engine', deck: { name: 'Bot', cards: [{ name: 'Island', count: 40 }] } },
  ],
  seed: 'isolated-backend-test/v1',
  maximumTurns: 100,
};

function session(
  backend: string,
  close: () => Promise<void>,
  submit?: () => Promise<SubmitResult<ObservedSession>>,
): ObservedSession {
  return {
    backend,
    determinism: 'observed',
    table: TABLE,
    status: 'awaiting',
    view: {
      version: 4,
      turn: { number: 1, active: 0, phase: 'precombatMain', step: 'main' },
      priority: 0,
      seats: [
        {
          id: 0,
          name: 'You',
          life: 20,
          hand: null,
          handSize: 7,
          librarySize: 33,
          graveyard: [],
          exile: [],
          battlefield: [],
        },
        {
          id: 1,
          name: 'Bot',
          life: 20,
          hand: null,
          handSize: 7,
          librarySize: 33,
          graveyard: [],
          exile: [],
          battlefield: [],
        },
      ],
      stack: [],
    },
    events: [],
    decision: {
      seat: 0,
      kind: 'priority',
      prompt: 'You has priority',
      options: [{ id: 'pass', text: 'Pass', targets: [] }],
      complete: true,
    },
    seats: null,
    result: null,
    submitted: 0,
    localSeats: [0],
    transcript: [],
    submit:
      submit ??
      (async (): Promise<SubmitResult<ObservedSession>> => ({
        ok: false,
        error: { kind: 'unknown-move', message: 'no move', offered: 1 },
      })),
    close,
  };
}

function backend(
  id: string,
  open: () => Promise<OpenResult<ObservedSession>>,
  shutdown: () => Promise<void>,
): ObservedBackend {
  return {
    id,
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => open(),
    shutdown,
  };
}

describe('isolated observed backend', () => {
  it('closes the latest submitted session and refuses moves after shutdown', async () => {
    const events: string[] = [];
    const latest = session('forge-2.0.14', async () => {
      events.push('latest close');
    });
    const initial = session(
      'forge-2.0.14',
      async () => {
        events.push('stale close');
      },
      async () => ({ ok: true, session: latest }),
    );
    const probe = backend(
      'forge-2.0.14',
      async () => {
        throw new Error('probe must not open');
      },
      async () => {
        events.push('probe shutdown');
      },
    );
    const isolated = isolatedObservedBackend(probe, () =>
      backend(
        'forge-2.0.14',
        async () => ({ ok: true, session: initial }),
        async () => {
          events.push('child shutdown');
        },
      ),
    );
    await expect(isolated.supports(TABLE)).resolves.toEqual([]);
    const opened = await isolated.open(TABLE);
    if (!opened.ok) throw new Error('expected open session');
    const submitted = await opened.session.submit('pass');
    if (!submitted.ok) throw new Error('expected submitted session');
    await expect(submitted.session.submit('pass')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unknown-move' },
    });
    await isolated.shutdown!();
    await expect(submitted.session.submit('pass')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'no-decision-pending' },
    });
    expect(events).toEqual(['latest close', 'child shutdown', 'probe shutdown']);
  });

  it('drains every owner and the probe before reporting shutdown failures', async () => {
    const events: string[] = [];
    const firstError = new Error('first session close failed');
    const secondError = new Error('second backend shutdown failed');
    const probeError = new Error('probe shutdown failed');
    let releaseSecond!: () => void;
    const secondReady = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const probe = backend(
      'forge-2.0.14',
      async () => {
        throw new Error('probe must not open');
      },
      async () => {
        events.push('probe shutdown');
        throw probeError;
      },
    );
    let sequence = 0;
    const isolated = isolatedObservedBackend(probe, () => {
      const index = ++sequence;
      return backend(
        'forge-2.0.14',
        async () => ({
          ok: true,
          session: session('forge-2.0.14', async () => {
            events.push(`close ${String(index)}`);
            if (index === 1) throw firstError;
          }),
        }),
        async () => {
          if (index === 2) await secondReady;
          events.push(`shutdown ${String(index)}`);
          if (index === 2) throw secondError;
        },
      );
    });
    expect((await isolated.open(TABLE)).ok).toBe(true);
    expect((await isolated.open(TABLE)).ok).toBe(true);
    const closing = isolated.shutdown!();
    let settled = false;
    const result = closing.then(
      () => {
        settled = true;
        return null;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    try {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(settled).toBe(false);
      expect(events).not.toContain('probe shutdown');
      expect(isolated.shutdown!()).toBe(closing);
    } finally {
      releaseSecond();
      await result;
    }
    expect(await result).toMatchObject({ errors: [firstError, secondError, probeError] });
    expect(events).toEqual(['close 1', 'close 2', 'shutdown 1', 'shutdown 2', 'probe shutdown']);
    await expect(isolated.supports(TABLE)).resolves.toEqual(['isolated backend forge-2.0.14 has shut down']);
    await expect(isolated.open(TABLE)).resolves.toMatchObject({ ok: false });
  });

  it('uses and destroys a fresh backend instance for every sequential session', async () => {
    const events: string[] = [];
    let sequence = 0;
    const probe = backend(
      'forge-2.0.14',
      async () => {
        throw new Error('probe must not open');
      },
      async () => {
        events.push('probe shutdown');
      },
    );
    const isolated = isolatedObservedBackend(probe, () => {
      sequence += 1;
      const at = sequence;
      return backend(
        'forge-2.0.14',
        async () => {
          events.push(`open ${String(at)}`);
          return {
            ok: true,
            session: session('forge-2.0.14', async () => {
              events.push(`close ${String(at)}`);
            }),
          };
        },
        async () => {
          events.push(`shutdown ${String(at)}`);
        },
      );
    });

    const first = await isolated.open(TABLE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await first.session.close();
    const second = await isolated.open(TABLE);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await second.session.close();
    await isolated.shutdown?.();

    expect(events).toEqual([
      'open 1',
      'close 1',
      'shutdown 1',
      'open 2',
      'close 2',
      'shutdown 2',
      'probe shutdown',
    ]);
  });

  it('destroys an instance whose open is refused or throws', async () => {
    const events: string[] = [];
    const outcomes: Array<'refuse' | 'throw'> = ['refuse', 'throw'];
    const probe = backend(
      'forge-2.0.14',
      async () => {
        throw new Error('probe must not open');
      },
      async () => undefined,
    );
    const isolated = isolatedObservedBackend(probe, () => {
      const outcome = outcomes.shift();
      return backend(
        'forge-2.0.14',
        async () => {
          if (outcome === 'throw') throw new Error('spawn failed');
          return { ok: false, error: { kind: 'backend-failure', message: 'refused' } };
        },
        async () => {
          events.push(`shutdown ${String(outcome)}`);
        },
      );
    });

    await expect(isolated.open(TABLE)).resolves.toMatchObject({ ok: false });
    await expect(isolated.open(TABLE)).resolves.toEqual({
      ok: false,
      error: { kind: 'backend-failure', message: 'isolated backend open failed: spawn failed' },
    });
    expect(events).toEqual(['shutdown refuse', 'shutdown throw']);
  });

  it('reports the caller-provided recovery when a fresh backend copy is missing', async () => {
    const probe = backend(
      'forge-2.0.14',
      async () => {
        throw new Error('probe must not open');
      },
      async () => undefined,
    );
    const isolated = isolatedObservedBackend(probe, () => null, SNAPSHOT_FORGE_REMOVED_MESSAGE);

    await expect(isolated.open(TABLE)).resolves.toEqual({
      ok: false,
      error: {
        kind: 'backend-failure',
        message: SNAPSHOT_FORGE_REMOVED_MESSAGE,
      },
    });
  });

  it('shuts down the instance once even when session close fails', async () => {
    const events: string[] = [];
    const probe = backend(
      'forge-2.0.14',
      async () => {
        throw new Error('probe must not open');
      },
      async () => undefined,
    );
    const isolated = isolatedObservedBackend(probe, () =>
      backend(
        'forge-2.0.14',
        async () => ({
          ok: true,
          session: session('forge-2.0.14', async () => {
            events.push('close');
            throw new Error('already dead');
          }),
        }),
        async () => {
          events.push('shutdown');
        },
      ),
    );

    const opened = await isolated.open(TABLE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await expect(opened.session.close()).rejects.toThrow('already dead');
    await expect(opened.session.close()).rejects.toThrow('already dead');
    expect(events).toEqual(['close', 'shutdown']);
  });

  it('closes live sessions during shutdown and refuses later opens', async () => {
    const events: string[] = [];
    const probe = backend(
      'forge-2.0.14',
      async () => {
        throw new Error('probe must not open');
      },
      async () => {
        events.push('probe shutdown');
      },
    );
    const isolated = isolatedObservedBackend(probe, () =>
      backend(
        'forge-2.0.14',
        async () => ({
          ok: true,
          session: session('forge-2.0.14', async () => {
            events.push('close');
          }),
        }),
        async () => {
          events.push('shutdown');
        },
      ),
    );

    expect((await isolated.open(TABLE)).ok).toBe(true);
    await isolated.shutdown?.();
    await expect(isolated.open(TABLE)).resolves.toEqual({
      ok: false,
      error: { kind: 'backend-failure', message: 'isolated backend forge-2.0.14 has shut down' },
    });
    expect(events).toEqual(['close', 'shutdown', 'probe shutdown']);
  });
});
