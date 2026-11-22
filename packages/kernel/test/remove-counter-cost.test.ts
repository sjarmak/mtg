/** Native payment and exhaustion of Triskelion's +1/+1 counters. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  counterCount,
  eventsOfType,
  legalActions,
  pendingDecision,
  reduce,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { oidOf } from './helpers';

const TRISKELION = parseCard({
  kind: 'creature',
  artifact: true,
  id: 'tst-triskelion',
  name: 'Triskelion',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 218 },
  colors: [],
  manaCost: {},
  power: 1,
  toughness: 1,
  entryReplacement: { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 3 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, removeCounter: { counter: 'plusOnePlusOne', count: 1 } },
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
    },
  ],
});

const LOYALTY_BATTERY = parseCard({
  kind: 'artifact',
  id: 'tst-loyalty-battery',
  name: 'Loyalty Battery',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 219 },
  colors: [],
  manaCost: {},
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, removeCounter: { counter: 'loyalty', count: 1 } },
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

function apply(current: ReduceResult, action: Action): ReduceResult {
  const next = reduce(current.state, action);
  return { state: next.state, events: [...current.events, ...next.events] };
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

function playerActivation(state: GameState, source: string): Extract<Action, { type: 'activateAbility' }> {
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
      candidate.type === 'activateAbility' &&
      candidate.oid === source &&
      candidate.targets[0]?.kind === 'player' &&
      candidate.targets[0].player === 1,
  );
  if (action === undefined) throw new Error('Triskelion offered no player activation');
  return action;
}

function plusOnePlusOneCounters(state: GameState, source: ObjectId): number {
  const object = state.objects[source];
  if (object === undefined) throw new Error(`unknown source ${source}`);
  return counterCount(object.counters, 'plusOnePlusOne');
}

describe('removing a counter as an activation cost', () => {
  it('enters with three, pays each before the stack, and stops at zero', () => {
    let current = scenario({ hands: [[TRISKELION], []] });
    const cast = legalActions(current.state).find((action) => action.type === 'castSpell');
    if (cast === undefined) throw new Error('Triskelion was not castable');
    current = resolveTop(apply(current, cast));
    const source = oidOf(current.state, TRISKELION.name);
    expect(plusOnePlusOneCounters(current.state, source)).toBe(3);

    for (const remaining of [2, 1, 0]) {
      const mark = current.events.length;
      current = apply(current, playerActivation(current.state, source));
      expect(plusOnePlusOneCounters(current.state, source)).toBe(remaining);
      expect(current.state.stack).toHaveLength(1);
      expect(eventsOfType(current.events.slice(mark), 'countersChanged')).toHaveLength(1);
      current = resolveTop(current);
    }

    expect(current.state.players[1].life).toBe(17);
    expect(
      legalActions(current.state).some(
        (action) => action.type === 'activateAbility' && action.oid === source,
      ),
    ).toBe(false);
    expect(
      validateAction(current.state, {
        type: 'activateAbility',
        player: 0,
        oid: source,
        abilityIndex: 0,
        targets: [{ kind: 'player', player: 1 }],
        sacrifices: [],
        discards: [],
      }),
    ).toBe('the cost removes 1 plusOnePlusOne counter and this permanent has 0');
  });

  it('reports a loyalty payment reaching zero as loyalty rather than unchanged combat counters', () => {
    const start = scenario({ battlefield: [{ card: LOYALTY_BATTERY, controller: 0, loyalty: 1 }] });
    const action = legalActions(start.state).find(
      (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
        candidate.type === 'activateAbility',
    );
    if (action === undefined) throw new Error('loyalty battery offered no activation');
    const activated = apply(start, action);
    expect(eventsOfType(activated.events, 'countersChanged')).toEqual([
      expect.objectContaining({ oid: action.oid, loyalty: 0 }),
    ]);
  });
});
