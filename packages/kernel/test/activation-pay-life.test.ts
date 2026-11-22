/** Legality and atomic payment for life in an ordinary activation cost. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  eventsOfType,
  legalActions,
  pendingDecision,
  reduce,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { oidOf } from './helpers';

const BLOOD_LEDGER = parseCard({
  kind: 'artifact',
  id: 'tst-blood-ledger',
  name: 'Blood Ledger',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 1 },
  colors: [],
  manaCost: { generic: 4 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, payLife: 1 },
      effects: [{ kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } }],
    },
  ],
} as CardInput);

const BLOOD_LEDGER_TWO = parseCard({
  ...BLOOD_LEDGER,
  id: 'tst-blood-ledger-two',
  name: 'Blood Ledger Two',
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, payLife: 2 },
      effects: [{ kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } }],
    },
  ],
} as CardInput);

function apply(current: ReduceResult, action: Action): ReduceResult {
  const next = reduce(current.state, action);
  return { state: next.state, events: [...current.events, ...next.events] };
}

function activation(
  state: GameState,
  source: string,
): Extract<Action, { type: 'activateAbility' }> | undefined {
  return legalActions(state).find(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source,
  );
}

function submitted(source: string): Extract<Action, { type: 'activateAbility' }> {
  return {
    type: 'activateAbility',
    player: 0,
    oid: source,
    abilityIndex: 0,
    targets: [null],
    sacrifices: [],
  };
}

function resolveTop(current: ReduceResult): ReduceResult {
  let next = current;
  for (let guard = 0; guard < 4 && next.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(next.state);
    if (decision?.kind !== 'priority') throw new Error('ability lost priority while resolving');
    next = apply(next, { type: 'passPriority', player: decision.player });
  }
  return next;
}

describe('paying life to activate an ability', () => {
  it('pays before the ability reaches the stack and reports life loss rather than damage', () => {
    let current = scenario({ life: [2, 20], battlefield: [{ card: BLOOD_LEDGER, controller: 0 }] });
    const source = oidOf(current.state, BLOOD_LEDGER.name);
    const action = activation(current.state, source);
    if (action === undefined) throw new Error('payable life-cost activation was not offered');

    const mark = current.events.length;
    current = apply(current, action);
    expect(current.state.players[0].life).toBe(1);
    expect(current.state.stack).toHaveLength(1);
    expect(eventsOfType(current.events.slice(mark), 'lifeChanged')).toEqual([
      expect.objectContaining({ player: 0, delta: -1, life: 1, reason: 'lifeLoss' }),
    ]);

    current = resolveTop(current);
    expect(current.state.players[0].life).toBe(5);
  });

  it('allows paying the last life but never offers an amount greater than the total', () => {
    const exact = scenario({ life: [1, 20], battlefield: [{ card: BLOOD_LEDGER, controller: 0 }] });
    const source = oidOf(exact.state, BLOOD_LEDGER.name);
    expect(activation(exact.state, source)).toBeDefined();
    expect(validateAction(exact.state, submitted(source))).toBeNull();

    const short = scenario({ life: [1, 20], battlefield: [{ card: BLOOD_LEDGER_TWO, controller: 0 }] });
    const shortSource = oidOf(short.state, BLOOD_LEDGER_TWO.name);
    expect(activation(short.state, shortSource)).toBeUndefined();
    expect(validateAction(short.state, submitted(shortSource))).toBe('you cannot pay 2 life');
  });

  it('does not pay when the submitted activation is otherwise illegal', () => {
    const start = scenario({ life: [2, 20], battlefield: [{ card: BLOOD_LEDGER, controller: 0 }] });
    const source = oidOf(start.state, BLOOD_LEDGER.name);
    const invalid = { ...submitted(source), targets: [] };
    expect(validateAction(start.state, invalid)).toBe('one target slot per effect is required');
    expect(() => reduce(start.state, invalid)).toThrow('one target slot per effect is required');
    expect(start.state.players[0].life).toBe(2);
  });
});
