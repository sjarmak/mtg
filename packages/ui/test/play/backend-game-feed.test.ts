// @vitest-environment jsdom
/**
 * A position the board did not ask for.
 *
 * Over the LAN the other seat moves too, and its move reaches this page as a
 * pushed session rather than as the answer to a submit. `BackendGame` takes
 * that feed and draws each pushed position as the current one, so a board
 * whose owner has done nothing still shows the other seat's move; and it lets
 * the feed go on close, so nothing arrives at a board that is no longer drawn.
 */
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ObservedBackend, ObservedSession, SessionSpec } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import { BackendGame, CLOSED_SESSION_LABEL, CLOSE_GAME_LABEL } from '../../src/routes/play/BackendGame';
import type { SessionFeed } from '../../src/routes/play/session-controller';

afterEach(cleanup);

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'local', deck: { name: 'south', cards: [] } },
  ],
  seed: 'ui/backend-game-feed',
  maximumTurns: null,
};

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

/** A feed the test pushes by hand, counting who is listening. */
function feedOf(): { feed: SessionFeed; push: (session: ObservedSession) => void; listening: () => number } {
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

function backendOpening(session: ObservedSession): ObservedBackend {
  return {
    ...scriptBackend({ clock: 3 }),
    open: () => Promise.resolve({ ok: true, session }),
  };
}

describe('BackendGame over a session feed', () => {
  it('draws a pushed position as the current one and lets the feed go on close', async () => {
    const opened = await scriptBackend({ clock: 3 }).open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    const moved = await opened.session.submit('advance');
    if (!moved.ok) throw new Error(moved.error.message);
    const { feed, push, listening } = feedOf();
    render(createElement(BackendGame, { backend: backendOpening(opened.session), table: TABLE, feed }));

    await screen.findByRole('button', { name: 'Advance the clock' });
    expect(screen.getByText('0 choices made')).not.toBeNull();
    expect(listening()).toBe(1);
    act(() => push(moved.session));
    expect(await screen.findByText('1 choices made')).not.toBeNull();
    expect(screen.getByText('South, advance the clock or concede')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: CLOSE_GAME_LABEL }));
    // The table mounts other live regions (Priority changes), so pick this one out by what it says.
    expect((await screen.findAllByRole('status')).map(textOf)).toContain(CLOSED_SESSION_LABEL);
    expect(listening()).toBe(0);
  });
});
