// @vitest-environment jsdom
/**
 * The live table under the StrictMode the app is actually mounted in.
 *
 * `mtg-bc2.154.4.30`. Every other suite over `BackendGame` renders it bare, and
 * bare is not how anybody runs it: `../../src/mount.ts` wraps the whole app in
 * `StrictMode`, whose development double-effect unmounts and remounts in one
 * commit. A close made straight from the effect cleanup therefore closed the
 * match the press had just started, so `Play drafted deck` drew `Game closed`
 * in the browser while the Forge integration run and this package's own suites
 * were green. A rig that never mounts the component the way the page does can
 * only ever be green about that.
 *
 * So both halves are asserted here: the discarded development effect never
 * starts a backend session, and a real unmount still closes the one live
 * session, because the second is what keeps a Forge subprocess from outliving
 * the route that started it.
 */
import { createElement, StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObservedBackend, ObservedSession, SessionSpec } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import { BackendGame, CLOSED_SESSION_LABEL } from '@mtg/ui';

afterEach(cleanup);

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'ui/backend-game-strict',
  maximumTurns: null,
};

async function openedScript(): Promise<ObservedSession> {
  const opened = await scriptBackend({ clock: 3 }).open(TABLE);
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.session;
}

function backendOf(session: ObservedSession): ObservedBackend {
  return {
    id: 'strict-mode-backend',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
    supports: (): Promise<readonly string[]> => Promise.resolve([]),
    open: (): Promise<{ readonly ok: true; readonly session: ObservedSession }> =>
      Promise.resolve({ ok: true, session }),
  };
}

describe('the live table inside StrictMode', () => {
  it('is still playable after the development double-effect', async () => {
    render(
      createElement(
        StrictMode,
        null,
        createElement(BackendGame, { backend: scriptBackend({ clock: 3 }), table: TABLE }),
      ),
    );

    // The move the script backend offers: present only if the session survived.
    await screen.findByRole('button', { name: 'Advance the clock' });
    expect(screen.queryByText(CLOSED_SESSION_LABEL)).toBeNull();
  });

  it('opens once and closes the live session on real unmount', async () => {
    const closes: Array<ReturnType<typeof vi.fn<() => Promise<void>>>> = [];
    const open = vi.fn(async () => {
      const session = await openedScript();
      const close = vi.fn<() => Promise<void>>(() => Promise.resolve());
      closes.push(close);
      return { ok: true as const, session: { ...session, close } };
    });
    const backend: ObservedBackend = {
      ...backendOf(await openedScript()),
      open,
    };
    const rendered = render(
      createElement(StrictMode, null, createElement(BackendGame, { backend, table: TABLE })),
    );
    await screen.findByRole('button', { name: 'Advance the clock' });
    expect(open).toHaveBeenCalledOnce();
    expect(closes[0]).not.toHaveBeenCalled();

    rendered.unmount();
    await waitFor(() => {
      expect(closes[0]).toHaveBeenCalledOnce();
    });
  });

  it('closes the live session when the page is left, and keeps it when the page is only set aside', async () => {
    const close = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const session = await openedScript();
    const backend: ObservedBackend = {
      ...backendOf(session),
      open: () => Promise.resolve({ ok: true as const, session: { ...session, close } }),
    };
    render(createElement(StrictMode, null, createElement(BackendGame, { backend, table: TABLE })));
    await screen.findByRole('button', { name: 'Advance the clock' });
    const page = (globalThis as { readonly window?: { dispatchEvent(event: Event): boolean } }).window;
    if (page === undefined) throw new Error('this suite needs a window to leave');
    const leaving = (persisted: boolean): Event => Object.assign(new Event('pagehide'), { persisted });

    page.dispatchEvent(leaving(true));
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByText(CLOSED_SESSION_LABEL)).toBeNull();

    page.dispatchEvent(leaving(false));
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });
});
