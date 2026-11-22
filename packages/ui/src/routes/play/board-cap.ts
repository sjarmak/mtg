/**
 * The board-size cap on the play screen (issue 302).
 *
 * A runaway token engine (Krenko, Mob Boss on reduced M13) made one turn cost
 * 1.5s at 1,038 permanents and 27.8s at 4,112, and the play screen settles bot
 * turns synchronously inside a click, so the tab froze. `@mtg/engine`'s
 * `board-cap.ts` holds the one number every runner reads; this file is what the
 * play screen says about it.
 *
 * Two things, both read off the position alone so a local table and a
 * networked seat draw them the same way. Past half the cap the table warns,
 * because a board that doubles each turn reaches the cap within one more turn.
 * Past the cap the game stops as a draw: `PlayView` draws this panel where the
 * result would be, offers no move, and the session holder refuses to advance.
 * The kernel never ends a game for being large, so this is a stop the surface
 * declares, not a `GameResult`, and nothing is recorded for it.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { DEFAULT_BOARD_CAP } from '@mtg/engine';

export const BOARD_CAP_TITLE = 'Game stopped';
export const BOARD_CAP_WARNING_LABEL = 'Board size';

export function boardCapStopText(permanents: number, cap: number = DEFAULT_BOARD_CAP): string {
  return `The battlefield holds ${String(permanents)} permanents, past the lab's limit of ${String(cap)}. The game stops here as a draw, because every turn past this size takes seconds longer than the last.`;
}

export function boardCapWarningText(permanents: number, cap: number = DEFAULT_BOARD_CAP): string {
  return `The battlefield holds ${String(permanents)} permanents. Past ${String(cap)} the game stops as a draw.`;
}

/** What the ask column holds once the board has passed the cap. */
export function boardCapPanel(
  permanents: number,
  cap: number,
  decisions: number,
  onNewGame?: (() => void) | undefined,
): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel mtg-prompt' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, BOARD_CAP_TITLE),
      createElement('span', { className: 'mtg-panel__note' }, `${String(decisions)} decisions`),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement(
        'p',
        { className: 'mtg-prompt__explain', role: 'status' },
        boardCapStopText(permanents, cap),
      ),
      onNewGame === undefined
        ? null
        : createElement('button', { type: 'button', className: 'mtg-btn', onClick: onNewGame }, 'New game'),
    ),
  );
}

/** The warning above the table while the board is past half the cap. */
export function boardCapWarning(permanents: number, cap: number): ReactElement {
  return createElement(
    'p',
    { className: 'mtg-board-cap-note', role: 'status', 'aria-label': BOARD_CAP_WARNING_LABEL },
    boardCapWarningText(permanents, cap),
  );
}
