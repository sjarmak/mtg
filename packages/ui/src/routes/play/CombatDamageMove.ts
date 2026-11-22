import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { PlayCombatDamageAssignment, TextDecisionInput } from '@mtg/engine';
import { textSubmission } from '@mtg/engine';
import {
  combatDamageAmountsAfterChange,
  combatDamageAssignmentState,
  combatDamageSubmission,
  deferredCombatDamageSubmission,
} from './combat-damage-assignment';

export function CombatDamageMove(props: {
  readonly assignment: PlayCombatDamageAssignment;
  readonly input: TextDecisionInput;
  readonly submitting: boolean;
  readonly submit: (id: string) => void;
}): ReactElement {
  const [amounts, setAmounts] = useState<readonly number[]>(props.assignment.defaultAmounts);
  const state = combatDamageAssignmentState(props.assignment, amounts);
  return createElement(
    'form',
    {
      className: 'mtg-damage-assignment',
      role: 'group',
      'aria-label': `Assign ${String(props.assignment.total)} damage from ${props.assignment.source.name}`,
      onSubmit: (event: { preventDefault(): void }): void => {
        event.preventDefault();
        if (state.valid && !props.submitting) {
          props.submit(textSubmission(props.input, combatDamageSubmission(props.assignment, amounts)));
        }
      },
    },
    createElement(
      'div',
      { className: 'mtg-damage-assignment__summary' },
      createElement('strong', null, props.assignment.source.name),
      createElement(
        'span',
        null,
        `${String(props.assignment.total)} damage · power ${String(props.assignment.source.power)} · ${String(state.remaining)} remaining`,
      ),
    ),
    ...props.assignment.recipients.map((recipient, index) => {
      const detail =
        recipient.kind === 'defender'
          ? recipient.name
          : `Toughness ${String(recipient.toughness)} · marked ${String(recipient.damage)} · lethal ${String(recipient.lethal)}`;
      return createElement(
        'label',
        { className: 'mtg-damage-assignment__row', key: recipient.oid },
        createElement(
          'span',
          { className: 'mtg-damage-assignment__recipient' },
          createElement('strong', null, recipient.name),
          createElement('span', null, detail),
        ),
        createElement('input', {
          className: 'mtg-input mtg-damage-assignment__amount',
          type: 'number',
          min: 0,
          max: props.assignment.total,
          step: 1,
          value: amounts[index] ?? 0,
          disabled: state.locked[index] || props.submitting,
          'aria-label': `Damage assigned to ${recipient.name}`,
          onChange: (event: { currentTarget: { value: string } }): void => {
            setAmounts(
              combatDamageAmountsAfterChange(
                props.assignment,
                amounts,
                index,
                Number(event.currentTarget.value),
              ),
            );
          },
        }),
      );
    }),
    createElement(
      'div',
      { className: 'mtg-damage-assignment__actions' },
      props.assignment.canDefer
        ? createElement(
            'button',
            {
              type: 'button',
              className: 'mtg-btn',
              disabled: props.submitting,
              onClick: (): void =>
                props.submit(textSubmission(props.input, deferredCombatDamageSubmission(props.assignment))),
            },
            'Assign another attacker first',
          )
        : null,
      createElement(
        'button',
        { type: 'submit', className: 'mtg-btn', disabled: !state.valid || props.submitting },
        'Confirm damage',
      ),
    ),
  );
}
