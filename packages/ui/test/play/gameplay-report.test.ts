// @vitest-environment jsdom
/**
 * `LiveGame` reports a finished game once through the sender it was handed,
 * and says on its root what came of it. The game is finished at mount by
 * replaying a recorded choice list, which is the state a page reaches the
 * moment the last decision lands.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { botSeat, choose, createSession, humanSeat } from '@mtg/kernel';
import type { Choice, GameResult, GameSetup, Seat } from '@mtg/kernel';
import { FIXTURE_DECK_RW, FIXTURE_DECK_UB, greedyBot } from '@mtg/sim';
import type { FinishedKernelGame, GameplayReport, GameplaySender } from '../../src/net/gameplay';
import { LiveGame } from '../../src/routes/play/LiveGame';
import type { PlayConfig } from '../../src/routes/play/use-session';

afterEach(cleanup);

const SETUP: GameSetup = {
  seed: 'gameplay/report/human-vs-greedy',
  decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
  startingPlayer: 0,
  maximumTurns: 4,
};
const SEATS: readonly [Seat, Seat] = [humanSeat('One'), botSeat(greedyBot('greedy-ub'))];

function played(): { readonly choices: readonly Choice[]; readonly result: GameResult } {
  let session = createSession(SETUP, SEATS);
  for (let guard = 0; session.result === null; guard += 1) {
    if (guard > 2000) throw new Error('the played game did not end');
    session = choose(session, 0);
  }
  if (session.result === null) throw new Error('unreachable');
  return { choices: session.choices, result: session.result };
}

const PLAYED = played();

function config(choices: readonly Choice[]): PlayConfig {
  return { setup: SETUP, seats: SEATS, viewer: 0, names: ['One', 'Bot'], choices };
}

function fakeSender(
  finish: (
    game: FinishedKernelGame,
  ) => Promise<{ status: 'recorded'; id: string } | { status: 'refused'; reason: string }>,
): GameplaySender & {
  readonly open: ReturnType<typeof vi.fn<() => Promise<{ ok: true; token: string }>>>;
  readonly finish: ReturnType<typeof vi.fn<GameplaySender['finish']>>;
} {
  return {
    open: vi.fn(() => Promise.resolve({ ok: true as const, token: 'tok' })),
    finish: vi.fn((_token: string, game: FinishedKernelGame) => finish(game)),
  };
}

/** What these tests need of a rendered node; the workspace tsconfig has no `lib: dom`. */
interface NodeLike {
  readonly querySelector: (selector: string) => NodeLike | null;
  readonly getAttribute: (name: string) => string | null;
  readonly hasAttribute: (name: string) => boolean;
}

function root(container: unknown): NodeLike {
  const live = (container as NodeLike).querySelector('.mtg-live');
  if (live === null) throw new Error('no live root');
  return live;
}

describe('reporting a finished game', () => {
  it('sends the game once when the result lands and says the id on the root', async () => {
    const sender = fakeSender(() => Promise.resolve({ status: 'recorded', id: 'game-7' }));
    const report: GameplayReport = { format: 'sealed', sender };
    const { container, rerender } = render(h(LiveGame, { config: config(PLAYED.choices), report }));
    await waitFor(() => {
      expect(root(container).getAttribute('data-mtg-gameplay')).toBe('recorded');
    });
    expect(root(container).getAttribute('data-mtg-gameplay-id')).toBe('game-7');
    expect(sender.open).toHaveBeenCalledTimes(1);
    expect(sender.finish).toHaveBeenCalledTimes(1);
    const [token, game] = sender.finish.mock.calls[0] ?? [];
    expect(token).toBe('tok');
    expect(game?.format).toBe('sealed');
    expect(game?.result).toEqual(PLAYED.result);
    expect(game?.choices).toEqual(PLAYED.choices);
    expect(game?.config.setup.seed).toBe(SETUP.seed);

    // A re-render with the same finished game does not send it again.
    rerender(h(LiveGame, { config: config(PLAYED.choices), report }));
    await Promise.resolve();
    expect(sender.finish).toHaveBeenCalledTimes(1);
  });

  it('says why when the lab refused, and sends nothing for a game still being played', async () => {
    const sender = fakeSender(() =>
      Promise.resolve({ status: 'refused', reason: 'this lab is not recording games' }),
    );
    const report: GameplayReport = { format: 'draft', sender };
    const { container } = render(h(LiveGame, { config: config(PLAYED.choices), report }));
    await waitFor(() => {
      expect(root(container).getAttribute('data-mtg-gameplay')).toBe('refused');
    });
    expect(root(container).getAttribute('data-mtg-gameplay-reason')).toBe('this lab is not recording games');
    expect(root(container).hasAttribute('data-mtg-gameplay-id')).toBe(false);
    cleanup();

    const quiet = fakeSender(() => Promise.resolve({ status: 'recorded', id: 'never' }));
    const unfinished = render(
      h(LiveGame, { config: config(PLAYED.choices.slice(0, 1)), report: { format: 'draft', sender: quiet } }),
    );
    await Promise.resolve();
    expect(quiet.open).not.toHaveBeenCalled();
    expect(root(unfinished.container).hasAttribute('data-mtg-gameplay')).toBe(false);
  });

  it('records nothing for a surface that hands it no report', async () => {
    const { container } = render(h(LiveGame, { config: config(PLAYED.choices), report: null }));
    await Promise.resolve();
    expect(root(container).hasAttribute('data-mtg-gameplay')).toBe(false);
  });
});
