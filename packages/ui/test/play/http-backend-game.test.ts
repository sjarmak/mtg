// @vitest-environment jsdom
/** A complete browser component journey through the real HTTP gateway. */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoveId, ObservedBackend, ObservedSession, SessionSpec, SubmitResult } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import type { RunningBackendGateway } from '@mtg/netplay';
import { serveBackendGateway } from '@mtg/netplay';
import { BackendGame, httpObservedBackend } from '@mtg/ui';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'http-backend-game',
  maximumTurns: null,
};

let running: RunningBackendGateway | null = null;

afterEach(async () => {
  cleanup();
  if (running !== null) await running.close();
  running = null;
});

function forgeDouble(close: () => Promise<void>): ObservedBackend {
  const toy = scriptBackend({ clock: 1 });
  const wrap = (session: ObservedSession): ObservedSession => ({
    ...session,
    backend: 'forge',
    seats: null,
    submit: async (move: MoveId): Promise<SubmitResult<ObservedSession>> => {
      const result = await session.submit(move);
      return result.ok ? { ok: true, session: wrap(result.session) } : result;
    },
    close,
  });
  return {
    ...toy,
    id: 'forge',
    supports: () => Promise.resolve([]),
    open: async (
      table,
    ): Promise<ReturnType<ObservedBackend['open']> extends Promise<infer R> ? R : never> => {
      const result = await toy.open(table);
      return result.ok ? { ok: true, session: wrap(result.session) } : result;
    },
  };
}

describe('BackendGame over the observed HTTP adapter', () => {
  it('opens the routed backend, submits its rendered MoveId, reaches terminal state, and disposes it', async () => {
    const close = vi.fn<() => Promise<void>>(() => Promise.resolve());
    running = await serveBackendGateway({
      host: '127.0.0.1',
      port: 0,
      installed: [forgeDouble(close)],
      routes: {
        generated: 'kernel',
        printed: { 'legacy-cube-2021-08': 'forge' },
      },
    });
    const backend = httpObservedBackend({
      id: 'forge',
      baseUrl: `http://127.0.0.1:${String(running.port)}/engine-api`,
    });
    const rendered = render(createElement(BackendGame, { backend, table: TABLE }));

    fireEvent.click(await screen.findByRole('button', { name: 'Advance the clock' }));
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('status')
          .map((status) => (status as unknown as { readonly textContent: string | null }).textContent),
      ).toContain('Game drawn on turn 1: the clock ran out');
    });

    rendered.unmount();
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });
});
