/**
 * The turn rail: the shape of the game at a glance, and the jump control.
 *
 * Every number here is folded out of the recorded events rather than read from
 * a separate statistics log, so the rail and the step detail can never
 * disagree — there is one source, and it is the thing being replayed.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { LogPlayerId } from './log-schema';
import type { ReplayNames } from './narrate';
import type { ReplayTurn } from './steps';

export interface TurnRailProps {
  readonly turns: readonly ReplayTurn[];
  readonly currentTurn: number;
  readonly names: ReplayNames;
  readonly onTurn: (turn: number) => void;
  /** Life ceiling for the bars; the starting total unless someone gained above it. */
  readonly lifeCeiling: number;
}

function fact(label: string, value: number): ReactElement {
  return createElement(
    'span',
    { key: label, className: 'mtg-fact' },
    createElement('span', { className: 'mtg-fact__label' }, label),
    createElement('span', { className: 'mtg-fact__value' }, String(value)),
  );
}

function lifeBar(seat: LogPlayerId, life: number, ceiling: number): ReactElement {
  const percent = ceiling <= 0 ? 0 : Math.max(0, Math.min(100, (life / ceiling) * 100));
  return createElement(
    'span',
    {
      key: `life${seat}`,
      className: 'mtg-lifebar',
      'data-side': seat === 0 ? 'user' : 'oppo',
      title: `seat ${seat} life ${life}`,
    },
    createElement(
      'span',
      { className: 'mtg-lifebar__track' },
      createElement('span', { className: 'mtg-lifebar__fill', style: { width: `${percent}%` } }),
    ),
    createElement('span', { className: 'mtg-lifebar__value' }, String(life)),
  );
}

function turnRow(props: TurnRailProps, turn: ReplayTurn): ReactElement {
  const [you, opponent] = turn.life;
  return createElement(
    'button',
    {
      key: turn.turn,
      type: 'button',
      className: 'mtg-turn',
      'data-selected': turn.turn === props.currentTurn,
      'aria-label': `Turn ${turn.turn}`,
      'aria-pressed': turn.turn === props.currentTurn,
      onClick: () => {
        props.onTurn(turn.turn);
      },
    },
    createElement(
      'span',
      { className: 'mtg-turn__no' },
      createElement('span', { className: 'mtg-turn__no-value' }, String(turn.turn)),
      createElement('span', { className: 'mtg-turn__owner' }, props.names.player(turn.active)),
    ),
    createElement(
      'span',
      { className: 'mtg-turn__facts' },
      fact('steps', turn.stepCount),
      fact('drew', turn.facts.drawn),
      fact('lands', turn.facts.lands),
      fact('cast', turn.facts.spells),
      fact('attacked', turn.facts.attackers),
      fact('face damage', turn.facts.damageToPlayers),
      lifeBar(0, you, props.lifeCeiling),
      lifeBar(1, opponent, props.lifeCeiling),
    ),
  );
}

export function TurnRail(props: TurnRailProps): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel', 'aria-label': 'Turns' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, 'Turns'),
      createElement('span', { className: 'mtg-panel__note' }, `${props.turns.length} recorded`),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement('div', { className: 'mtg-timeline' }, ...props.turns.map((turn) => turnRow(props, turn))),
    ),
  );
}
