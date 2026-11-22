/**
 * The two columns every Play section opens on: a bot, or the person next to you.
 *
 * `mtg-a982g.1`. Play used to stack everything it could deal on one page, the
 * decks, the sealed offer and the LAN section in a column, and which of them
 * dealt a game against whom was something a person worked out by reading all
 * three. Now the section says the format and this says the opponent: two
 * cells, one open, the chosen one's body drawn beneath them.
 *
 * A cell that cannot be dealt is drawn disabled with its reason beside it
 * (`./availability.ts` says the sentence), rather than left out. A column that
 * is there and dark says what would have to change; a column that is missing
 * says nothing, and on a page about choosing that is the worse of the two.
 *
 * The body of the open column stays mounted while a game is on and the cells
 * go, because the game *is* the body: a precon table lives inside the decks
 * section, and a chooser drawn above a board is furniture over a game.
 */
import { createElement, Fragment, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { availability } from './availability';
import type { Availability, AvailabilityFacts, Opponent, PlayFormat, SetKind } from './availability';

/**
 * The group's name for a screen reader. Not `Opponent`: that is the deck across
 * the table in `./PreconPicker.ts`, and the two groups share a page.
 */
export const OPPONENT_CHOICE_LABEL = 'Play against';
export const OPPONENT_BOT_LABEL = 'Against a bot';
export const OPPONENT_LAN_LABEL = 'Over this network';

export interface OpponentChoiceProps {
  readonly setKind: SetKind;
  readonly format: PlayFormat;
  readonly opponent: Opponent;
  readonly facts: AvailabilityFacts;
  readonly onOpponent: (opponent: Opponent) => void;
  /** The bot column's body, drawn when it is the open column and it can deal. */
  readonly bot: ReactElement | null;
  /** The network column's body, on the same terms. */
  readonly lan: ReactElement | null;
  /** A game is on in the open column: the cells go and the body stays. */
  readonly playing?: boolean;
}

/**
 * The column, held in the hash when the page writes one there and in state
 * when it does not. A route rendered alone still has two cells that do
 * something when pressed, which is what a control is for.
 */
export function useOpponent(
  controlled: Opponent | undefined,
  onChange: ((opponent: Opponent) => void) | undefined,
): readonly [Opponent, (opponent: Opponent) => void] {
  const [own, setOwn] = useState<Opponent>('bot');
  const choose = useCallback(
    (opponent: Opponent): void => {
      if (onChange === undefined) setOwn(opponent);
      else onChange(opponent);
    },
    [onChange],
  );
  return [controlled ?? (onChange === undefined ? own : 'bot'), choose];
}

interface CellProps {
  readonly label: string;
  readonly chosen: boolean;
  readonly can: Availability;
  readonly onPress: () => void;
}

function Cell(props: CellProps): ReactElement {
  const dark = props.can.status === 'unavailable';
  return createElement(
    'div',
    { className: 'mtg-opponents__cell' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        ...(props.chosen ? { 'data-variant': 'primary' } : {}),
        'aria-pressed': props.chosen,
        disabled: dark,
        onClick: props.onPress,
      },
      props.label,
    ),
    props.can.status === 'unavailable'
      ? createElement(
          'div',
          { className: 'mtg-printed-pool-status' },
          createElement('span', null, props.can.reason),
        )
      : null,
  );
}

export function OpponentChoice(props: OpponentChoiceProps): ReactElement {
  const { onOpponent } = props;
  const bot = availability(props.setKind, props.format, 'bot', props.facts);
  const lan = availability(props.setKind, props.format, 'lan', props.facts);
  const chooseBot = useCallback((): void => onOpponent('bot'), [onOpponent]);
  const chooseLan = useCallback((): void => onOpponent('lan'), [onOpponent]);
  const open = props.opponent === 'bot' ? bot : lan;
  const body = open.status === 'ready' ? (props.opponent === 'bot' ? props.bot : props.lan) : null;
  return createElement(
    Fragment,
    null,
    props.playing === true
      ? null
      : createElement(
          'div',
          { className: 'mtg-opponents', role: 'group', 'aria-label': OPPONENT_CHOICE_LABEL },
          createElement(Cell, {
            label: OPPONENT_BOT_LABEL,
            chosen: props.opponent === 'bot',
            can: bot,
            onPress: chooseBot,
          }),
          createElement(Cell, {
            label: OPPONENT_LAN_LABEL,
            chosen: props.opponent === 'lan',
            can: lan,
            onPress: chooseLan,
          }),
        ),
    body,
  );
}
