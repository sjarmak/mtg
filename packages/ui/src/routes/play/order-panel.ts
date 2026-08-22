/**
 * The damage assignment order being built, drawn in the rail where the flat move
 * list was.
 *
 * `order.ts` holds the model and the argument; this is the inside of the box, and
 * it is `declare-panel.ts`'s box on purpose — same three parts in the same order,
 * same classes, same rules about which of them announces what. A player who has
 * declared attackers and blockers has already been taught this panel twice by the
 * time combat asks them to order anything.
 *
 *  1. **The confirm, first.** The only control here that submits, carrying the
 *     index of the enumerated ordering the sequence names, wearing that
 *     enumeration's own sentence as its accessible name. First for
 *     `declare-panel.ts`'s reasons, which hold unchanged: a driver or a keyboard
 *     player tabbing in must land on the commit rather than on a toggle they can
 *     press forever.
 *  2. **One group per multiply-blocked attacker**, holding its blockers as rows
 *     that say where in the order they sit. A group each rather than one flat
 *     roster, because two attackers' orders are two independent sequences and a
 *     row saying "2 of 3" means nothing without the attacker it counts under.
 *  3. **Clear**, once anything is placed. Nothing here has reached the kernel, so
 *     there is nothing to take back.
 *
 * **Until every blocker is placed there is no confirm and the panel says so.**
 * That is the half-built state rather than an error: CR 509.2 orders all of a
 * creature's blockers, so a sequence short of one names no move at all. Every
 * blocker stays pressable throughout, which is what makes a wrong press cost one
 * more press instead of a Clear.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement } from 'react';
import type { Choice, ObjectId } from '@mtg/kernel';
import { choiceLabel, submitButton } from './choice-button';
import { blockerCount, placeOf, placedCount } from './order';
import type { OrderBlocker, OrderGroup, OrderPlan, Ordering } from './order';

/** The control that drops every placement without touching the kernel. */
export const ORDER_CLEAR_LABEL = 'Clear the order';

/** The accessible name of the group holding one attacker's blockers. */
export function orderGroupLabel(group: OrderGroup): string {
  return `Damage order for ${group.attackerName}`;
}

/**
 * What one row says about itself, which is also half its accessible name.
 *
 * The place is said as a count against the group's own total rather than as an
 * ordinal word, because the number is the thing a player is checking — "3 of 5"
 * answers both "where is this one" and "how much is left" in the glance the rail
 * gets, and it needs no table of ordinals to reach the eighth blocker.
 */
function blockerStatus(group: OrderGroup, ordering: Ordering, oid: ObjectId): string {
  const place = placeOf(ordering, group, oid);
  if (place === null) return 'not in the order';
  return `damage ${String(place)} of ${String(group.blockers.length)}`;
}

/**
 * What the confirm submits and what it announces.
 *
 * `declare-panel.ts`'s `DeclarationConfirm` for the same two reasons: `choice` is
 * an index where the enumeration has one and the ordering itself where it does
 * not, and `name` is the whole sentence either way because the button is folded
 * and the accessible name must not move when the visible text does.
 */
export interface OrderConfirm {
  readonly choice: Choice;
  readonly name: string;
}

export interface OrderPanelInput {
  readonly plan: OrderPlan;
  readonly ordering: Ordering;
  /** What confirming submits, or null while any blocker is unplaced. */
  readonly confirm: OrderConfirm | null;
  /** Places a blocker next, or takes it back out. */
  readonly onPress: (group: OrderGroup, blocker: OrderBlocker) => void;
  /** Drops every placement. */
  readonly onClear: () => void;
  /** Submits the finished ordering. */
  readonly onSubmit: (choice: Choice) => void;
}

function blockerRow(
  group: OrderGroup,
  blocker: OrderBlocker,
  ordering: Ordering,
  onPress: (group: OrderGroup, blocker: OrderBlocker) => void,
): ReactElement {
  const status = blockerStatus(group, ordering, blocker.oid);
  const place = placeOf(ordering, group, blocker.oid);
  return createElement(
    'button',
    {
      key: blocker.oid,
      type: 'button',
      className: 'mtg-choice mtg-declare__row',
      // The same attribute the declaration rows carry, so the styled state of "I
      // have said something about this creature" is one rule in one stylesheet.
      'data-declared': place === null ? 'false' : 'true',
      // The whole row in one announcement, comma'd for `declare-panel.ts`'s
      // reason: without it a reader hears the status as part of the name.
      'aria-label': `${blocker.name}, ${status}`,
      onClick: () => {
        onPress(group, blocker);
      },
    },
    choiceLabel(blocker.name),
    createElement('span', { className: 'mtg-choice__detail' }, status),
  );
}

function orderGroupBody(
  group: OrderGroup,
  ordering: Ordering,
  onPress: (group: OrderGroup, blocker: OrderBlocker) => void,
): ReactElement {
  return createElement(
    'div',
    {
      key: group.attacker,
      className: 'mtg-declare__roster',
      role: 'group',
      'aria-label': orderGroupLabel(group),
    },
    // Which attacker this sequence is for, said once above its rows. The group's
    // own `aria-label` already carries those words, so the visible line is hidden
    // from the reader rather than announced twice — `rail.ts` hides a run's
    // shared line for exactly this reason.
    createElement('p', { className: 'mtg-declare__ask', 'aria-hidden': true }, group.attackerName),
    ...group.blockers.map((blocker) => blockerRow(group, blocker, ordering, onPress)),
  );
}

/** The visible text on the confirm, folded because the sentence lists every blocker. */
function confirmText(plan: OrderPlan): string {
  const attackers = plan.groups.length;
  return attackers === 1
    ? 'Assign damage in this order'
    : `Assign damage in these ${String(attackers)} orders`;
}

export function orderPanel(input: OrderPanelInput): ReactElement {
  const { plan, ordering, confirm, onPress, onClear, onSubmit } = input;
  const placed = placedCount(plan, ordering);
  return createElement(
    'div',
    { key: 'order', className: 'mtg-declare' },
    createElement(
      Fragment,
      null,
      confirm === null
        ? createElement(
            'p',
            { className: 'mtg-declare__note', role: 'note' },
            `${String(placed)} of ${String(blockerCount(plan))} blockers placed. Every blocker needs a place before this order can be confirmed.`,
          )
        : submitButton({
            key: 'order-confirm',
            kind: 'orderBlockers',
            text: confirmText(plan),
            detail: null,
            name: confirm.name,
            takeFocus: false,
            onSubmit: () => {
              onSubmit(confirm.choice);
            },
          }),
      ...plan.groups.map((group) => orderGroupBody(group, ordering, onPress)),
      placed === 0
        ? null
        : createElement(
            'button',
            { type: 'button', className: 'mtg-btn mtg-declare__clear', onClick: onClear },
            ORDER_CLEAR_LABEL,
          ),
    ),
  );
}
