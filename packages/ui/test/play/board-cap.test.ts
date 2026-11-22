// @vitest-environment jsdom
/**
 * The play screen stops a game at the board-size cap instead of freezing (#302).
 *
 * A runaway token engine makes every turn cost about four times the last, and
 * the play screen settles bot turns inside a click, so the tab froze. Past the
 * cap the table draws the game as stopped, a draw, with no move left to press;
 * past half of it the table warns first. A cap of a handful of permanents is
 * how an ordinary seeded game reaches both without a 500-permanent board; the
 * rule read is the same `boardCapStanding` the sim and the netplay table use.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { botSeat, choose, createSession, humanSeat, passIndex } from '@mtg/kernel';
import type { Choice, Decision, GameSetup, Seat } from '@mtg/kernel';
import { FIXTURE_DECK_RW, FIXTURE_DECK_UB, greedyBot } from '@mtg/sim';
import { BOARD_CAP_TITLE, BOARD_CAP_WARNING_LABEL } from '../../src/routes/play/board-cap';
import { LiveGame } from '../../src/routes/play/LiveGame';
import { CONTINUE_LABEL, LEGAL_MOVES_LABEL, PASS_LABEL } from '../../src/routes/play/PlayView';
import type { PlayConfig } from '../../src/routes/play/use-session';

afterEach(cleanup);

const SETUP: GameSetup = {
  seed: 'play/board-cap',
  decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
  startingPlayer: 0,
};
const SEATS: readonly [Seat, Seat] = [humanSeat('One'), botSeat(greedyBot('greedy-ub'))];

/** Plays a land when one is on offer and passes otherwise, so the board grows without a fight. */
function landOrPass(decision: Decision | null): number {
  if (decision === null) return 0;
  const land = decision.options.findIndex((option) => option.type === 'playLand');
  return land >= 0 ? land : (passIndex(decision) ?? 0);
}

/** The first recorded prefix after which the battlefield holds more than `size` permanents. */
function prefixPast(size: number): readonly Choice[] {
  let session = createSession(SETUP, SEATS);
  for (let guard = 0; session.result === null; guard += 1) {
    if (guard > 4000) throw new Error('the board never grew that large');
    if (session.state.battlefield.length > size) return session.choices;
    session = choose(session, landOrPass(session.pending));
  }
  throw new Error(`the game ended before the board passed ${String(size)}`);
}

function config(choices: readonly Choice[], boardCap: number): PlayConfig {
  return { setup: SETUP, seats: SEATS, viewer: 0, names: ['One', 'Bot'], choices, boardCap };
}

describe('the board-size cap on the play screen', () => {
  it('stops the game as a draw once a move takes the board past the cap', () => {
    render(h(LiveGame, { config: config(prefixPast(4), 6), report: null }));
    expect(screen.queryByText(BOARD_CAP_TITLE)).toBeNull();
    // Pass, and watch the other seat's lands land, until the stop is drawn.
    for (let presses = 0; screen.queryByText(BOARD_CAP_TITLE) === null; presses += 1) {
      if (presses > 400) throw new Error('the board never passed the cap');
      const next =
        screen.queryByRole('button', { name: CONTINUE_LABEL }) ??
        screen.getByRole('button', { name: PASS_LABEL });
      fireEvent.click(next);
    }
    expect(screen.getByText(/stops here as a draw/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: LEGAL_MOVES_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: PASS_LABEL })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    // A new game is the way out, and it opens below the cap again.
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.queryByText(BOARD_CAP_TITLE)).toBeNull();
    expect(screen.getByRole('button', { name: PASS_LABEL })).toBeTruthy();
  });

  it('warns past half the cap while the game is still played', () => {
    // Past 4 on a cap of 40: half is 20, so this board is clear and no warning
    // shows; the same board on a cap of 8 is past half and is warned about.
    const choices = prefixPast(4);
    render(h(LiveGame, { config: config(choices, 40), report: null }));
    expect(screen.queryByRole('status', { name: BOARD_CAP_WARNING_LABEL })).toBeNull();
    cleanup();

    render(h(LiveGame, { config: config(choices, 8), report: null }));
    expect(screen.getByRole('status', { name: BOARD_CAP_WARNING_LABEL })).toBeTruthy();
    expect(screen.getByText(/Past 8 the game stops as a draw/)).toBeTruthy();
    expect(screen.getByRole('group', { name: LEGAL_MOVES_LABEL })).toBeTruthy();
    expect(screen.queryByText(BOARD_CAP_TITLE)).toBeNull();
  });
});
