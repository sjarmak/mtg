/** CR 700.2 choices announced while activating an ability. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput } from '@mtg/dsl';
import {
  legalActions,
  powerOf,
  reduce,
  scenario,
  validateAction,
  type Action,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, planeswalker } from './cards';
import { apply, oidOf } from './helpers';

const MODAL: readonly AbilityInput[] = [
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: -3,
    effects: [],
    modes: [
      {
        effects: [
          {
            kind: 'pumpUntilEndOfTurn',
            power: 2,
            toughness: 2,
            target: { kind: 'targetCreature' },
          },
        ],
      },
      {
        effects: [
          {
            kind: 'pumpUntilEndOfTurn',
            power: -2,
            toughness: -2,
            target: { kind: 'targetCreature' },
          },
        ],
      },
    ],
  },
];

function board(): ReduceResult {
  return scenario({
    battlefield: [
      { card: planeswalker('Modal Walker', 4, MODAL), controller: 0 },
      { card: creature('Modal Subject', 4, 4), controller: 0 },
    ],
  });
}

function modalActions(start: ReduceResult): readonly Extract<Action, { type: 'activateAbility' }>[] {
  const walker = oidOf(start.state, 'Modal Walker');
  const subject = oidOf(start.state, 'Modal Subject');
  return legalActions(start.state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' &&
      action.oid === walker &&
      action.targets[0]?.kind === 'permanent' &&
      action.targets[0].oid === subject,
  );
}

function resolve(start: ReduceResult, action: Extract<Action, { type: 'activateAbility' }>): ReduceResult {
  return apply(apply(reduce(start.state, action), { type: 'passPriority', player: 0 }), {
    type: 'passPriority',
    player: 1,
  });
}

describe('modal activated abilities', () => {
  it('offers one activation per mode and retains the chosen mode on the stack', () => {
    const start = board();
    const actions = modalActions(start);
    expect(actions.map((action) => action.mode)).toEqual([0, 1]);

    const first = actions[0];
    if (first === undefined) throw new Error('mode zero was not offered');
    const activated = reduce(start.state, first);
    expect(activated.state.stack.at(-1)?.mode).toBe(0);
  });

  it('resolves only the selected mode', () => {
    const grownStart = board();
    const grownAction = modalActions(grownStart).find((action) => action.mode === 0);
    if (grownAction === undefined) throw new Error('growth mode was not offered');
    const grown = resolve(grownStart, grownAction);
    expect(powerOf(grown.state, oidOf(grown.state, 'Modal Subject'))).toBe(6);

    const shrunkStart = board();
    const shrunkAction = modalActions(shrunkStart).find((action) => action.mode === 1);
    if (shrunkAction === undefined) throw new Error('shrink mode was not offered');
    const shrunk = resolve(shrunkStart, shrunkAction);
    expect(powerOf(shrunk.state, oidOf(shrunk.state, 'Modal Subject'))).toBe(2);
  });

  it('rejects an omitted, extraneous, or out-of-range mode', () => {
    const start = board();
    const action = modalActions(start)[0];
    if (action === undefined) throw new Error('modal activation was not offered');
    const { mode: _mode, ...omitted } = action;
    expect(validateAction(start.state, omitted as Action)).toBe(
      'this ability is modal and needs a chosen mode',
    );
    expect(validateAction(start.state, { ...action, mode: 2 })).toBe('mode is out of range');

    const fixed = planeswalker('Fixed Walker', 4, [
      {
        kind: 'activated',
        cost: { mana: {} },
        loyaltyCost: 1,
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ]);
    const fixedStart = scenario({ battlefield: [{ card: fixed, controller: 0 }] });
    const fixedAction = legalActions(fixedStart.state).find(
      (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
        candidate.type === 'activateAbility',
    );
    if (fixedAction === undefined) throw new Error('fixed activation was not offered');
    expect(validateAction(fixedStart.state, { ...fixedAction, mode: 0 })).toBe(
      'this ability has no modes to choose',
    );
  });
});
