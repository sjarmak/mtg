/**
 * One simulated game, walked turn by turn.
 *
 * The detail half of `mtg-2ayr`, and it reads `@mtg/sim`'s statistics JSONL —
 * the same log `RunSummaryPanels` aggregates directly above it. That is the
 * distinction the bead exists to keep: this is NOT the kernel decision replay.
 * The Replay tab (`../replay/ReplayViewer.ts`) reads an event log and can show
 * you the action that was taken; this file reads per-turn aggregates and can
 * show you counts and the board at end of turn, and nothing between them. Two
 * surfaces named "replay" over two different files is how they drift, so the
 * copy here says `statistics` and never says `replay`.
 *
 * A column the log does not record is drawn as absent rather than as a
 * confident zero. That rule came from the route this replaces, and it is the
 * reason the seat panels list library and graveyard as null: the sim writes
 * neither.
 *
 * Addressing is the route's, not this component's: `game` is the 0-based index
 * in the file and `turn` is the printed turn number, both clamped on read, so a
 * link to a game and a turn survives a reload and a shared URL.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { PlayerStatus } from '../../board/PlayerStatus';
import { Zone } from '../../board/Zone';
import { lifeSeries, matchupLabel, winningSide } from '../../replay/timeline';
import type { ReplayGame, ReplayLog, TimelineTurn } from '../../replay/types';
import type { ReplaySide } from '../../replay/columns';

export interface GameDetailProps {
  readonly log: ReplayLog;
  /** 0-based position in the file. Out-of-range values are clamped. */
  readonly gameIndex: number;
  /**
   * The printed turn number to open. `null` means the last recorded turn,
   * which is the end of the game and the state most people are looking for.
   */
  readonly turn: number | null;
  readonly onSelectGame: (index: number) => void;
  readonly onSelectTurn: (turn: number) => void;
}

/** The `game` param, read and clamped. Exported because the route addresses it. */
export function clampGameIndex(log: ReplayLog, requested: number): number {
  if (!Number.isInteger(requested)) return 0;
  return Math.max(0, Math.min(log.games.length - 1, requested));
}

/** The turn a `turn` param selects, or the last one when it names none of them. */
export function selectTurn(game: ReplayGame, requested: number | null): TimelineTurn | undefined {
  const last = game.turns[game.turns.length - 1];
  if (requested === null) return last;
  return game.turns.find((turn) => turn.turn === requested) ?? last;
}

function fact(label: string, value: string | number): ReactElement {
  return createElement(
    'span',
    { key: label, className: 'mtg-fact' },
    createElement('span', { className: 'mtg-fact__label' }, label),
    createElement('span', { className: 'mtg-fact__value' }, String(value)),
  );
}

function lifeBar(side: ReplaySide, life: number, ceiling: number): ReactElement {
  const percent = ceiling === 0 ? 0 : Math.max(0, Math.min(100, (life / ceiling) * 100));
  return createElement(
    'span',
    { key: side, className: 'mtg-lifebar', 'data-side': side, title: `${side} life ${life}` },
    createElement(
      'span',
      { className: 'mtg-lifebar__track' },
      createElement('span', { className: 'mtg-lifebar__fill', style: { width: `${percent}%` } }),
    ),
    createElement('span', { className: 'mtg-lifebar__value' }, String(life)),
  );
}

function turnRow(turn: TimelineTurn, ceiling: number, selected: boolean, onSelect: () => void): ReactElement {
  return createElement(
    'button',
    {
      key: turn.turn,
      type: 'button',
      className: 'mtg-turn',
      'data-selected': selected,
      'aria-label': `Turn ${turn.turn}`,
      'aria-pressed': selected,
      onClick: onSelect,
    },
    createElement(
      'span',
      { className: 'mtg-turn__no' },
      createElement('span', { className: 'mtg-turn__no-value' }, String(turn.turn)),
      createElement('span', { className: 'mtg-turn__owner' }, turn.owner),
    ),
    createElement(
      'span',
      { className: 'mtg-turn__facts' },
      fact('drew', turn.cards_drawn),
      fact('lands', turn.lands_played),
      fact('cast', turn.creatures_cast + turn.non_creatures_cast),
      fact('attacked', turn.creatures_attacked),
      lifeBar('user', turn.user.eot_life, ceiling),
      lifeBar('oppo', turn.oppo.eot_life, ceiling),
    ),
  );
}

function seatPanel(game: ReplayGame, turn: TimelineTurn, side: ReplaySide): ReactElement {
  const stats = turn[side];
  const deck = side === 'user' ? game.extras.sim_user_deck : game.extras.sim_oppo_deck;
  return createElement(
    'div',
    { key: side, className: 'mtg-board__side' },
    createElement(PlayerStatus, {
      name: `${side} · ${deck}`,
      life: stats.eot_life,
      handCount: stats.eot_cards_in_hand,
      // The statistics log records neither, and a zero here would read as an
      // empty library rather than as a column that was never written.
      libraryCount: null,
      graveyardCount: null,
      active: turn.owner === side,
    }),
    createElement(Zone, {
      label: `${side} battlefield at end of turn ${turn.turn}`,
      count: stats.eot_lands_in_play + stats.eot_creatures_in_play + stats.eot_non_creatures_in_play,
      items: [
        fact('lands', stats.eot_lands_in_play),
        fact('creatures', stats.eot_creatures_in_play),
        fact('other', stats.eot_non_creatures_in_play),
        fact('damage taken', stats.combat_damage_taken),
        fact('mana spent', stats.mana_spent),
      ],
      emptyText: 'nothing in play',
    }),
  );
}

function gamePicker(log: ReplayLog, index: number, onPick: (index: number) => void): ReactElement {
  return createElement(
    'label',
    { className: 'mtg-field' },
    createElement('span', { className: 'mtg-field__label' }, 'Game'),
    createElement(
      'select',
      {
        className: 'mtg-select',
        value: String(index),
        onChange: (event: { target: { value: string } }) => {
          onPick(Number.parseInt(event.target.value, 10));
        },
      },
      ...log.games.map((game) =>
        createElement(
          'option',
          { key: game.index, value: String(game.index) },
          `${game.index + 1}. ${matchupLabel(game)} · ${game.metadata.num_turns} turns`,
        ),
      ),
    ),
  );
}

function panel(title: string, note: string, body: ReactElement): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, title),
      createElement('span', { className: 'mtg-panel__note' }, note),
    ),
    createElement('div', { className: 'mtg-panel__body' }, body),
  );
}

/**
 * A game the log holds no turns for.
 *
 * `appendReplayJsonl` writes a row per game whether or not the game recorded a
 * turn, so this is reachable from a real file and drawing an empty rail for it
 * would look like the reader failing.
 */
function noTurns(game: ReplayGame): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, 'This game recorded no turns'),
    createElement(
      'span',
      { className: 'mtg-empty__body' },
      `Game ${game.index + 1} ended as ${game.extras.sim_end_reason} with no per-turn rows in the statistics log.`,
    ),
  );
}

/**
 * The drill-down, drawn under the run summary.
 *
 * Headless in the same sense `RunSummaryPanels` is: no page heading, so the
 * Analysis surface keeps its one `h1`.
 */
export function GameDetailPanels(props: GameDetailProps): ReactElement {
  const { log } = props;
  const index = clampGameIndex(log, props.gameIndex);
  const game = log.games[index];
  if (game === undefined) {
    return createElement(
      'div',
      { className: 'mtg-empty' },
      createElement('span', { className: 'mtg-empty__title' }, 'No games in this statistics log'),
      createElement(
        'span',
        { className: 'mtg-empty__body' },
        'The file carries a header but no game rows, so there is nothing to walk.',
      ),
    );
  }

  const winner = winningSide(game);
  const toolbar = createElement(
    'div',
    { className: 'mtg-toolbar' },
    gamePicker(log, index, props.onSelectGame),
    createElement('span', { className: 'mtg-badge' }, game.extras.sim_end_reason),
    createElement(
      'span',
      { className: 'mtg-badge', 'data-tone': winner === null ? 'pending' : 'positive' },
      winner === null ? 'draw' : `${winner} won`,
    ),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement('span', { className: 'mtg-page-note' }, game.extras.sim_game_seed),
  );

  if (game.turns.length === 0) {
    return createElement('div', null, toolbar, noTurns(game));
  }

  const series = lifeSeries(game);
  const ceiling = series.reduce((max, point) => Math.max(max, point.user, point.oppo), 20);
  const selected = selectTurn(game, props.turn);
  const rail = createElement(
    'div',
    { className: 'mtg-timeline' },
    ...game.turns.map((turn) =>
      turnRow(turn, ceiling, selected !== undefined && turn.turn === selected.turn, () => {
        props.onSelectTurn(turn.turn);
      }),
    ),
  );

  return createElement(
    'div',
    null,
    toolbar,
    createElement(
      'div',
      { className: 'mtg-grid' },
      panel('Turns', `${game.turns.length} recorded`, rail),
      selected === undefined
        ? null
        : panel(
            `End of turn ${selected.turn}`,
            `${selected.owner}'s turn`,
            createElement(
              'div',
              { className: 'mtg-board__lanes' },
              seatPanel(game, selected, 'oppo'),
              createElement('div', { className: 'mtg-board__divider' }),
              seatPanel(game, selected, 'user'),
            ),
          ),
    ),
  );
}
