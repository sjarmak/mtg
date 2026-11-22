/**
 * Every player at the table, one row each: the seat rail of a pod.
 *
 * `mtg-bc2.154.6.5.4`. A Commander turn hinges on what every other player has
 * out and how close each of them is to losing, and neither fits in the two-pod
 * column a duel gets. This is that column for four: a row per seat carrying the
 * three numbers a pod player scans for, life, poison, and the commander damage
 * the seat has taken from each opponent's commanders (CR 903.10a, twenty-one from
 * one commander loses the game).
 *
 * **Commander damage is one chip per dealer, not one number.** The rule is per
 * commander, so seven from Ana and fourteen from Bo is a seat two turns from
 * losing to Bo and not fourteen-and-seven summed to twenty-one. Each chip names
 * its dealer and reads as a fraction of the lethal amount, and turns to the
 * warning tone from two-thirds of the way there so the seat about to die is the
 * one the eye lands on. A chip at zero is drawn quiet rather than left out: the
 * absence of a chip and a chip that says nothing has happened are different
 * facts, and a rail whose rows changed length as damage was dealt would move
 * every row under the one being read.
 *
 * **Poison is drawn on every row, and on every table.** The engine reports it
 * only where the backend does (`SeatView.poison`, absent meaning unreported), so
 * a seat with no figure draws a dash and not a zero: none and unknown are not
 * the same claim (`../styles/board/pod.ts`).
 *
 * The rail is a control while the table is asking a question that names a seat:
 * a spell being aimed presses a seat here the way the pod does, and a pod
 * declaring attackers picks its defender in the combat band beside the cards
 * that go at them (`../routes/play/attack-targets.ts`), so this file holds no
 * attack state and only marks which seat is being attacked. Props only.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { seatPossessive } from '../seat';

/** Commander damage from one dealer that loses the game (CR 903.10a). */
export const COMMANDER_DAMAGE_LETHAL = 21;

/** Poison counters that lose the game (CR 704.5c). */
export const POISON_LETHAL = 10;

/** The share of lethal at which a chip turns to the warning tone. */
const WARN_SHARE = 2 / 3;

/** What one dealer's commanders have done to one seat. */
export interface CommanderDamageFrom {
  readonly dealer: number;
  readonly name: string;
  /** The dealer's total across every commander it has. */
  readonly amount: number;
  /**
   * The most any single one of them has dealt, when the backend splits it.
   *
   * The rule reads this and not `amount`: two partners at ten apiece are twenty
   * from one dealer and safe from both. Absent means the backend states the
   * dealer's total only, and the total is then the best figure there is, so the
   * tone reads it rather than staying quiet.
   */
  readonly peak?: number;
}

export interface SeatRailEntry {
  /** Table position; the key a row is filed under. */
  readonly seat: number;
  readonly name: string;
  /** The viewer's own seat, marked so the player finds themselves without reading names. */
  readonly you: boolean;
  readonly life: number;
  /** Null when the backend does not report poison, which is not the same as none. */
  readonly poison: number | null;
  /** One entry per other seat, in table order, zero included. */
  readonly damage: readonly CommanderDamageFrom[];
  readonly active?: boolean;
  readonly priority?: boolean;
  /** This seat is a legal target for the spell being aimed; the row is then a button. */
  readonly aim?: { readonly onAim: () => void };
  /** The seat the combat band's picker currently has chosen to attack. */
  readonly attacked?: boolean;
}

export interface SeatRailProps {
  readonly seats: readonly SeatRailEntry[];
  /** Life at or under which a total is drawn in the low tone. Five, as the pod's. */
  readonly lowLifeAt?: number;
}

function lethalTone(amount: number, lethal: number): 'none' | 'warn' | 'lethal' {
  if (amount >= lethal) return 'lethal';
  return amount >= lethal * WARN_SHARE ? 'warn' : 'none';
}

function damageChip(entry: SeatRailEntry, from: CommanderDamageFrom): ReactElement {
  return createElement(
    'li',
    {
      key: from.dealer,
      className: 'mtg-seat-rail__damage',
      'data-tone': lethalTone(from.peak ?? from.amount, COMMANDER_DAMAGE_LETHAL),
      'data-amount': String(from.amount),
      'data-dealer': String(from.dealer),
      title: `Commander damage ${entry.name} has taken from ${from.name}: ${String(from.amount)}, lethal at ${String(COMMANDER_DAMAGE_LETHAL)} from one commander`,
    },
    createElement('span', { className: 'mtg-seat-rail__damage-from' }, from.name),
    createElement('span', { className: 'mtg-seat-rail__damage-amount' }, String(from.amount)),
  );
}

function seatRow(props: SeatRailProps, entry: SeatRailEntry): ReactElement {
  const lowAt = props.lowLifeAt ?? 5;
  const aim = entry.aim;
  const poison = entry.poison;
  const row = createElement(
    aim === undefined ? 'div' : 'button',
    {
      className: 'mtg-seat-rail__seat',
      ...(aim === undefined ? {} : { type: 'button' as const, 'data-aimable': true, onClick: aim.onAim }),
      'aria-label': `${seatPossessive(entry.name)} status`,
    },
    createElement(
      'span',
      { className: 'mtg-seat-rail__life', 'data-low': entry.life <= lowAt, title: 'life total' },
      String(entry.life),
    ),
    createElement(
      'span',
      { className: 'mtg-seat-rail__name' },
      entry.name,
      entry.you ? createElement('span', { className: 'mtg-seat-rail__you' }, 'you') : null,
    ),
    createElement(
      'span',
      {
        className: 'mtg-seat-rail__poison',
        'data-tone': poison === null ? 'none' : lethalTone(poison, POISON_LETHAL),
        'data-amount': poison === null ? 'unreported' : String(poison),
        title:
          poison === null
            ? 'poison counters not reported'
            : `poison counters: ${String(poison)} of ${String(POISON_LETHAL)}`,
      },
      createElement('span', { className: 'mtg-seat-rail__poison-label' }, 'poison'),
      createElement(
        'span',
        { className: 'mtg-seat-rail__poison-amount' },
        poison === null ? '—' : String(poison),
      ),
    ),
  );
  return createElement(
    'li',
    {
      key: entry.seat,
      className: 'mtg-seat-rail__item',
      'data-seat-index': String(entry.seat),
      'data-you': entry.you,
      'data-active': entry.active === true,
      'data-priority': entry.priority === true,
      'data-attacked': entry.attacked === true,
    },
    row,
    entry.damage.length === 0
      ? null
      : createElement(
          'ul',
          {
            className: 'mtg-seat-rail__damage-list',
            'aria-label': `Commander damage ${entry.name} has taken`,
          },
          ...entry.damage.map((from) => damageChip(entry, from)),
        ),
  );
}

export function SeatRail(props: SeatRailProps): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-seat-rail', 'aria-label': 'Players', 'data-seats': String(props.seats.length) },
    createElement(
      'ul',
      { className: 'mtg-seat-rail__list' },
      ...props.seats.map((entry) => seatRow(props, entry)),
    ),
  );
}
