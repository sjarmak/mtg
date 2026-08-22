/**
 * Replay view: pick a game, walk its turns.
 *
 * A sim log records per-turn aggregates, not per-action events, so this shows
 * what the log actually holds — counts and end-of-turn board state — and says
 * `—` for the things it does not record rather than printing a confident zero.
 * The richer viewer built on this foundation replaces the detail panel; the
 * game picker, the turn rail and the reader underneath it stay.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { PlayerStatus } from '../board/PlayerStatus';
import { renderCopy } from '../copy';
import { Zone } from '../board/Zone';
import { lifeSeries, matchupLabel, winningSide } from '../replay/timeline';
import type { ReplayGame, ReplayLog, TimelineTurn } from '../replay/types';
import type { ReplaySide } from '../replay/columns';
import type { UiRoute } from '../app/router';

export interface ReplayRouteProps {
  readonly log: ReplayLog | null;
  readonly route: UiRoute;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
  /** Shown when there is no log: where one would come from. */
  readonly sourceHint?: string;
}

function intParam(route: UiRoute, key: string, fallback: number): number {
  const raw = route.params[key];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) ? value : fallback;
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

/** The page title, in every state. See the note in `AnalysisRoute`. */
function pageHead(note: string | null): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-page-head' },
    createElement('h1', { className: 'mtg-page-title' }, 'Replay'),
    note === null ? null : createElement('span', { className: 'mtg-page-note' }, note),
  );
}

function emptyState(hint: string): ReactElement {
  return createElement(
    'div',
    null,
    pageHead(null),
    createElement(
      'div',
      { className: 'mtg-empty' },
      createElement('span', { className: 'mtg-empty__title' }, 'No replay loaded'),
      createElement('span', { className: 'mtg-empty__body' }, renderCopy(hint)),
    ),
  );
}

export function ReplayRoute(props: ReplayRouteProps): ReactElement {
  const { log, route, onSetParams } = props;
  const hint =
    props.sourceHint ??
    'Point this view at a replay JSONL written by `@mtg/sim`: `out/slice/logs/replay.jsonl` after `npm run slice`.';
  if (log === null || log.games.length === 0) return emptyState(hint);

  const gameIndex = Math.max(0, Math.min(log.games.length - 1, intParam(route, 'game', 0)));
  const game = log.games[gameIndex];
  if (game === undefined) return emptyState(hint);

  const series = lifeSeries(game);
  const ceiling = series.reduce((max, point) => Math.max(max, point.user, point.oppo), 20);
  const turnNumber = intParam(route, 'turn', game.turns.length);
  const selected = game.turns.find((turn) => turn.turn === turnNumber) ?? game.turns[game.turns.length - 1];
  const winner = winningSide(game);

  const head: ReactNode = createElement(
    'div',
    { className: 'mtg-toolbar' },
    gamePicker(log, gameIndex, (index) => {
      onSetParams({ game: String(index), turn: '' });
    }),
    createElement('span', { className: 'mtg-badge' }, game.extras.sim_end_reason),
    createElement(
      'span',
      { className: 'mtg-badge', 'data-tone': winner === null ? 'pending' : 'positive' },
      winner === null ? 'draw' : `${winner} won`,
    ),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement('span', { className: 'mtg-page-note' }, game.extras.sim_game_seed),
  );

  const rail = createElement(
    'div',
    { className: 'mtg-timeline' },
    ...game.turns.map((turn) =>
      turnRow(turn, ceiling, selected !== undefined && turn.turn === selected.turn, () => {
        onSetParams({ turn: String(turn.turn) });
      }),
    ),
  );

  return createElement(
    'div',
    null,
    pageHead(`${log.games.length} games · schema ${log.schemaVersion}`),
    head,
    createElement(
      'div',
      { className: 'mtg-grid' },
      createElement(
        'section',
        { className: 'mtg-panel' },
        createElement(
          'div',
          { className: 'mtg-panel__head' },
          createElement('span', { className: 'mtg-panel__title' }, 'Turns'),
          createElement('span', { className: 'mtg-panel__note' }, `${game.turns.length} recorded`),
        ),
        createElement('div', { className: 'mtg-panel__body' }, rail),
      ),
      selected === undefined
        ? null
        : createElement(
            'section',
            { className: 'mtg-panel' },
            createElement(
              'div',
              { className: 'mtg-panel__head' },
              createElement('span', { className: 'mtg-panel__title' }, `End of turn ${selected.turn}`),
              createElement('span', { className: 'mtg-panel__note' }, `${selected.owner}'s turn`),
            ),
            createElement(
              'div',
              { className: 'mtg-panel__body mtg-board__lanes' },
              seatPanel(game, selected, 'oppo'),
              createElement('div', { className: 'mtg-board__divider' }),
              seatPanel(game, selected, 'user'),
            ),
          ),
    ),
  );
}
