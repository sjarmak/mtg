/**
 * The opponents of a pod, side by side in one row, each compressed to a tile.
 *
 * `mtg-bc2.154.6.5.4`, and the playtester's ruling on it (dec-nh7i, 2026-09-20): all
 * three opponents' boards are on screen at once, compressed to fit, and where
 * compressing forces a choice, keep what another player's turn depends on. A
 * Commander turn hinges on what every other player has out, so a tile that drew
 * only the opponent across the table and scrolled the other two away would hide
 * exactly the permanents that decide whether a play is safe. What gets cheaper
 * instead is everything about a tile that is not a permanent:
 *
 *  - **The vitals are a line, not a pod.** `./SeatPod.ts` is a column block built
 *    for a column of its own; three of them side by side would spend the row's
 *    height on a number and a name. The head here is one line: name, life, hand
 *    and library counts, the turn badges, and the mana pool when there is one.
 *    Poison and commander damage are the rail's (`./SeatRail.ts`), one place for
 *    every seat, so a tile does not repeat them.
 *  - **The command zone stays, and stays a card.** It is the second thing a
 *    Commander player reads about an opponent after their battlefield, and the
 *    tax under it says what the next cast costs. Compressing it is a sheet's job
 *    (`../styles/board/pod.ts`); dropping it to a count would be a choice made
 *    against the ruling.
 *  - **The graveyard and exile stay one strip each**, the strips they already
 *    were, because recursion is what the other players' turns are about.
 *
 * A tile holds the seat's battlefield and zones exactly as a duel's opponent
 * lane does, so the click gestures, the arrival marks and the inspect zoom that
 * reach that lane reach a tile with no second wiring: the caller hands over
 * `body`, already built by the same function that builds a duel's side.
 *
 * Props only, and it owns no state.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { DEFAULT_SYMBOL_SET } from '../card/symbols';
import { poolPips } from './PlayerStatus';
import type { SeatPodProps } from './SeatPod';

export interface PodTileProps {
  /** Table position of the seat; the key the rail row for the same seat is filed under. */
  readonly seat: number;
  readonly status: SeatPodProps;
  /**
   * The opponent whose attackers and blockers the combat band lifts out of the
   * row. One tile is, and it is the one a `Board` was handed as `opponent`.
   */
  readonly primary: boolean;
  /** The seat's battlefield, command zone and revealed cards, as a duel's lane draws them. */
  readonly body: ReactElement;
  /** The seat's graveyard and exile strips, in that order, each present only when drawn. */
  readonly zones: readonly ReactElement[];
}

/** A `null` is a count the view cannot know, drawn as a dash the way the pod's chip is. */
function count(label: string, value: number | null): ReactElement {
  return createElement(
    'span',
    { key: label, className: 'mtg-pod-tile__count', title: value === null ? 'not recorded' : label },
    createElement('span', { className: 'mtg-pod-tile__count-label' }, label),
    createElement('span', { className: 'mtg-pod-tile__count-value' }, value === null ? '—' : String(value)),
  );
}

function head(status: SeatPodProps): ReactElement {
  const lowAt = status.lowLifeAt ?? 5;
  const pool = status.mana ?? null;
  return createElement(
    'header',
    { className: 'mtg-pod-tile__head' },
    createElement('span', { className: 'mtg-pod-tile__name' }, status.name),
    createElement(
      'span',
      { className: 'mtg-pod-tile__life', 'data-low': status.life <= lowAt, title: 'life total' },
      String(status.life),
    ),
    count('hand', status.handCount),
    count('library', status.libraryCount),
    status.active === true
      ? createElement('span', { key: 'active', className: 'mtg-badge' }, 'Active')
      : null,
    status.priority === true
      ? createElement('span', { key: 'priority', className: 'mtg-badge' }, 'Priority')
      : null,
    pool === null ? null : poolPips(pool, status.symbols ?? DEFAULT_SYMBOL_SET),
  );
}

export function podTile(props: PodTileProps): ReactElement {
  return createElement(
    'div',
    {
      key: `seat-${String(props.seat)}`,
      className: 'mtg-pod-tile',
      'data-seat-index': String(props.seat),
      'data-primary': props.primary,
      'data-active': props.status.active === true,
      role: 'group',
      'aria-label': `${props.status.name}, opponent`,
    },
    head(props.status),
    props.body,
    ...props.zones,
  );
}

/** The row itself: one column per opponent, in the order they sit. */
export function podRow(tiles: readonly ReactElement[]): ReactElement {
  return createElement(
    'div',
    {
      className: 'mtg-board__opponents',
      'data-opponents': String(tiles.length),
      role: 'group',
      'aria-label': 'Opponents',
    },
    ...tiles,
  );
}
