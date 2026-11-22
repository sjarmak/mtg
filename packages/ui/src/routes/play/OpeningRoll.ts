import { createElement, useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { PlayerId } from '@mtg/kernel';
import { d20Face, D20_FACE_LIST } from './d20';
import type { OpeningRoll } from './opening-roll';
import { finalRound, openingRollText, tieText } from './opening-roll';
import type { SeatNames } from './position';

export const ROLL_LABEL = 'Roll for first';
export const SKIP_ROLL_LABEL = 'Skip the roll';
export const BEGIN_LABEL = 'Begin';
export const ROLL_MS = 1800;
export const ROLL_SETTLE_GRACE_MS = 250;
export const REROLL_PAUSE_MS = 900;
export const REARM_MS = 50;
export const TUMBLE_START = 'rotateX(-700deg) rotateY(-1050deg) rotateZ(-330deg)';

type Phase = 'ready' | 'rolling' | 'rearm' | 'settled';

interface RollState {
  readonly phase: Phase;
  readonly round: number;
}

export interface OpeningRollProps {
  readonly roll: OpeningRoll;
  readonly names: SeatNames;
  readonly viewer: PlayerId;
  readonly onDone: () => void;
}

type Tint = 'purple' | 'pink';

function after(ms: number, then: () => void): () => void {
  const timer = setTimeout(then, ms);
  return (): void => {
    clearTimeout(timer);
  };
}

export function die(value: number, tint: Tint, phase: Phase, onSettle: () => void): ReactElement {
  const rest = d20Face(value).rest;
  const spin = phase === 'ready' || phase === 'rearm' ? TUMBLE_START : 'none';
  return createElement(
    'div',
    { className: 'mtg-d20-stage', 'data-tint': tint, 'data-phase': phase, 'aria-hidden': true },
    createElement('div', { className: 'mtg-d20__glow' }),
    createElement('div', { className: 'mtg-d20__sparkle' }),
    createElement(
      'div',
      {
        className: 'mtg-d20__spin',
        style: { transform: spin },
        onTransitionEnd: (event: { propertyName: string }): void => {
          if (event.propertyName === 'transform') onSettle();
        },
      },
      createElement(
        'div',
        { className: 'mtg-d20', style: { transform: rest } },
        ...D20_FACE_LIST.map((face) =>
          createElement(
            'div',
            { key: face.value, className: 'mtg-d20__face', style: { transform: face.placement } },
            createElement('span', { className: 'mtg-d20__pip' }, String(face.value)),
          ),
        ),
      ),
    ),
  );
}

export function OpeningRollBeat(props: OpeningRollProps): ReactElement {
  const { roll, names, viewer, onDone } = props;
  const last = roll.rounds.length - 1;
  const [state, setState] = useState<RollState>({ phase: 'ready', round: 0 });
  const pair = roll.rounds[state.round] ?? finalRound(roll);
  const opponent: PlayerId = viewer === 0 ? 1 : 0;
  const final = state.round === last;

  const settle = useCallback((): void => {
    setState((was) => (was.phase === 'rolling' ? { ...was, phase: 'settled' } : was));
  }, []);
  const skip = useCallback((): void => {
    setState({ phase: 'settled', round: last });
  }, [last]);
  const begin = useCallback((): void => {
    setState({ phase: 'rolling', round: 0 });
  }, []);

  useEffect(() => {
    if (state.phase === 'rolling') return after(ROLL_MS + ROLL_SETTLE_GRACE_MS, settle);
    if (state.phase === 'settled' && !final) {
      return after(REROLL_PAUSE_MS, (): void => {
        setState({ phase: 'rearm', round: state.round + 1 });
      });
    }
    if (state.phase === 'rearm') {
      return after(REARM_MS, (): void => {
        setState({ phase: 'rolling', round: state.round });
      });
    }
    return undefined;
  }, [state, final, settle]);

  const sentence =
    state.phase === 'ready'
      ? 'Roll a twenty-sided die against the bot. The higher roll plays first.'
      : state.phase === 'rolling' || state.phase === 'rearm'
        ? 'Rolling.'
        : final
          ? openingRollText(roll, names)
          : tieText(pair);

  return createElement(
    'section',
    {
      className: 'mtg-opening-roll',
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': 'mtg-opening-roll-title',
      'data-phase': state.phase,
      onClick: state.phase === 'rolling' || state.phase === 'rearm' ? skip : undefined,
    },
    createElement(
      'h2',
      { id: 'mtg-opening-roll-title', className: 'mtg-opening-roll__title' },
      'Who plays first',
    ),
    createElement(
      'div',
      { className: 'mtg-opening-roll__table' },
      createElement(
        'div',
        { className: 'mtg-opening-roll__seat', 'data-seat': 'opponent' },
        createElement('p', { className: 'mtg-opening-roll__name' }, names[opponent]),
        die(pair[opponent], 'pink', state.phase, settle),
      ),
      createElement(
        'div',
        { className: 'mtg-opening-roll__seat', 'data-seat': 'viewer' },
        die(pair[viewer], 'purple', state.phase, settle),
        createElement('p', { className: 'mtg-opening-roll__name' }, names[viewer]),
      ),
    ),
    createElement('p', { className: 'mtg-opening-roll__sentence', role: 'status' }, sentence),
    createElement(
      'div',
      { className: 'mtg-opening-roll__actions' },
      state.phase === 'ready'
        ? createElement(
            'button',
            { type: 'button', className: 'mtg-btn', 'data-variant': 'primary', onClick: begin },
            ROLL_LABEL,
          )
        : state.phase === 'settled' && final
          ? createElement(
              'button',
              { type: 'button', className: 'mtg-btn', 'data-variant': 'primary', onClick: onDone },
              BEGIN_LABEL,
            )
          : createElement('button', { type: 'button', className: 'mtg-btn', onClick: skip }, SKIP_ROLL_LABEL),
    ),
  );
}
