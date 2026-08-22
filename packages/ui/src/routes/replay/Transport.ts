/**
 * Playback transport: step, jump, play.
 *
 * The control set is deliberately the one a debugger needs rather than the one
 * a video player has — single-step both ways is the primary control, because
 * the question "what changed between these two frames" is the one an engine bug
 * is found with. Playback is the secondary control, and it is a convenience for
 * watching a game's shape, not the main event.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { PLAYBACK_SPEEDS } from './steps';
import type { ReplayTurn } from './steps';

export interface TransportProps {
  readonly seq: number;
  readonly stepCount: number;
  readonly turns: readonly ReplayTurn[];
  readonly currentTurn: number;
  readonly playing: boolean;
  readonly speedId: string;
  readonly onSeq: (seq: number) => void;
  readonly onTurn: (turn: number) => void;
  readonly onTogglePlay: () => void;
  readonly onSpeed: (id: string) => void;
}

function button(label: string, disabled: boolean, onClick: () => void, primary = false): ReactElement {
  return createElement(
    'button',
    {
      key: label,
      type: 'button',
      className: 'mtg-btn',
      'data-variant': primary ? 'primary' : undefined,
      disabled,
      onClick,
    },
    label,
  );
}

function select(
  label: string,
  value: string,
  options: readonly { readonly value: string; readonly label: string }[],
  onChange: (value: string) => void,
): ReactElement {
  return createElement(
    'label',
    { className: 'mtg-field' },
    createElement('span', { className: 'mtg-field__label' }, label),
    createElement(
      'select',
      {
        className: 'mtg-select',
        'aria-label': label,
        value,
        onChange: (event: { target: { value: string } }) => {
          onChange(event.target.value);
        },
      },
      ...options.map((option) =>
        createElement('option', { key: option.value, value: option.value }, option.label),
      ),
    ),
  );
}

export function Transport(props: TransportProps): ReactElement {
  const last = Math.max(0, props.stepCount - 1);
  const atStart = props.seq <= 0;
  const atEnd = props.seq >= last;
  return createElement(
    'div',
    { className: 'mtg-toolbar' },
    button('First', atStart, () => {
      props.onSeq(0);
    }),
    button('Prev', atStart, () => {
      props.onSeq(props.seq - 1);
    }),
    button(props.playing ? 'Pause' : 'Play', atEnd && !props.playing, props.onTogglePlay, true),
    button('Next', atEnd, () => {
      props.onSeq(props.seq + 1);
    }),
    button('Last', atEnd, () => {
      props.onSeq(last);
    }),
    select(
      'Turn',
      String(props.currentTurn),
      props.turns.map((turn) => ({ value: String(turn.turn), label: `Turn ${turn.turn}` })),
      (value) => {
        const turn = Number.parseInt(value, 10);
        if (Number.isInteger(turn)) props.onTurn(turn);
      },
    ),
    select(
      'Speed',
      props.speedId,
      PLAYBACK_SPEEDS.map((speed) => ({ value: speed.id, label: speed.label })),
      props.onSpeed,
    ),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement(
      'span',
      { className: 'mtg-page-note' },
      createElement('span', { className: 'mtg-num' }, `step ${props.seq + 1}`),
      ` of ${props.stepCount}`,
    ),
  );
}
