/**
 * A seat as a block you read down, rather than a line you read across.
 *
 * `mtg-rgc.1`. Magic Online puts each player in a vertical pod on the far left —
 * a row of chips on top, a large life total, the name under it — with the
 * opponent's pod at the top of that column and yours at the bottom. Both
 * players' vitals then sit in one column the eye scans without crossing the
 * board. Ours printed the same facts as a horizontal strip above each
 * battlefield ("Bot 20 … 5 HAND 30 LIBRARY 0 GRAVEYARD"), which cost a row of
 * the one axis the table is short of and read as a table header rather than as
 * a player.
 *
 * This is the arrangement and not the skin. No beveled chrome, no gradient, no
 * ten-pixel type: the surface, the keyline and the type scale are the same
 * tokens `./PlayerStatus.ts` uses, and the largest thing in the pod is
 * `--mtg-text-xl`, which is the largest size this lab has.
 *
 * **The avatar is deliberately absent.** Magic Online hangs the life number over
 * a picture of the player, and this lab has no such picture and no place to get
 * one. A frame drawn around nothing would be a placeholder in the most-looked-at
 * block on the screen, so the life total is the picture instead.
 *
 * **The graveyard is not a chip, and that is a decision rather than an
 * omission.** The pod counts the two zones nobody can look through — the library
 * and, for the seat across the table, the hand — and stops. A graveyard is a
 * pile you open: `./ZoneBrowser.ts` prints its depth on the strip you click, so
 * a chip here would be the same number in two places, which is the argument
 * `../styles/board/fit.ts` already made when it took the zone heads off the
 * lanes and left the rail's alone. Magic Online agrees by construction — its pod
 * has no graveyard chip either. Both boards this repository builds hand `Board`
 * a graveyard zone per seat, so a chip switched on for the boards that do not
 * would have been a branch nothing takes. The count is still on
 * `PlayerStatusProps`, and the replay timeline's line still prints it.
 *
 * **And the counters row is absent too.** Magic Online's pod carries poison,
 * energy and experience under the name; `@mtg/kernel`'s `PlayerState` has none
 * of the three and no card in the DSL can create one, so a row of three zeroes
 * would be three facts about a game nobody is playing. When a counter kind
 * arrives in the kernel it arrives here, under the name, where that reference
 * puts it.
 *
 * Props only, and the same props `./PlayerStatus.ts` takes, so the two
 * arrangements are two readings of one projection rather than two projections.
 * `../routes/play/position.ts` is where those numbers are derived, and it reads
 * them from the state the *viewer* holds — under `@mtg/netplay` the other seat's
 * hidden objects are removed from the payload rather than merely undrawn, so a
 * count taken from anywhere else would disagree between a hot seat and a wire.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { DEFAULT_SYMBOL_SET } from '../card/symbols';
import { seatPossessive } from '../seat';
import { poolPips } from './PlayerStatus';
import type { PlayerStatusProps } from './PlayerStatus';

export interface SeatPodProps extends PlayerStatusProps {
  /** Named on the element, so a sheet can tell the two ends of the column apart. */
  readonly seat?: 'opponent' | 'you';
}

/**
 * One chip: the zone, then how deep it runs.
 *
 * Named first, which is the other way round from `./PlayerStatus.ts`'s count and
 * is the pod's width paying for it. The strip has room to put a large number
 * over a small caption; a chip in a column this narrow is one line, and a line
 * that reads "library 30" is a sentence where "30 library" is a puzzle.
 */
function chip(label: string, value: number | null): ReactElement {
  return createElement(
    'div',
    { key: label, className: 'mtg-pod__chip' },
    createElement('span', { className: 'mtg-pod__chip-label' }, label),
    createElement(
      'span',
      { className: 'mtg-pod__chip-value', title: value === null ? 'not recorded' : label },
      value === null ? '—' : String(value),
    ),
  );
}

export function SeatPod(props: SeatPodProps): ReactElement {
  const lowAt = props.lowLifeAt ?? 5;
  const pool = props.mana ?? null;
  const tags: ReactElement[] = [];
  if (props.active === true) {
    tags.push(createElement('span', { key: 'active', className: 'mtg-badge' }, 'Active'));
  }
  if (props.priority === true) {
    tags.push(createElement('span', { key: 'priority', className: 'mtg-badge' }, 'Priority'));
  }
  return createElement(
    'div',
    {
      className: 'mtg-pod',
      'data-active': props.active === true,
      // The same accessible name the strip carries, because it is the same
      // block and a screen reader that finds one must find the other. Said as
      // the seat's, for the reason `PlayerStatus` says it that way.
      'aria-label': `${seatPossessive(props.name)} status`,
      ...(props.seat === undefined ? {} : { 'data-seat': props.seat }),
    },
    createElement(
      'div',
      { className: 'mtg-pod__chips' },
      chip('library', props.libraryCount),
      chip('hand', props.handCount),
    ),
    createElement(
      'span',
      { className: 'mtg-pod__life', 'data-low': props.life <= lowAt, title: 'life total' },
      String(props.life),
    ),
    createElement('span', { className: 'mtg-pod__name' }, props.name),
    tags.length === 0 ? null : createElement('div', { className: 'mtg-pod__tags' }, ...tags),
    pool === null ? null : poolPips(pool, props.symbols ?? DEFAULT_SYMBOL_SET),
  );
}
