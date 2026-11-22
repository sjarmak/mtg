/** Gobbling Ooze pays with another creature before its ability reaches the stack. */
import { parseCard } from '@mtg/dsl';
import {
  counterCount,
  legalActions,
  pendingDecision,
  reduce,
  scenario,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, FOREST } from './cards';
import { oidOf } from './helpers';

const GOBBLING_OOZE = parseCard({
  kind: 'creature',
  id: 'rtr-126-gobbling-ooze-kernel',
  name: 'Gobbling Ooze',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 126 },
  colors: ['G'],
  manaCost: { generic: 4, G: 1 },
  subtypes: ['Ooze'],
  power: 3,
  toughness: 3,
  abilities: [
    {
      kind: 'activated',
      cost: {
        mana: { G: 1 },
        sacrificeMatching: {
          count: 1,
          filter: { cardTypes: ['creature'] },
          excludeSource: true,
        },
      },
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
});

const ALLY = creature('Gobbling Ooze Allied Creature', 2, 2);
const ENEMY = creature('Gobbling Ooze Enemy Creature', 2, 2);

function apply(current: ReduceResult, action: Action): ReduceResult {
  const next = reduce(current.state, action);
  return { state: next.state, events: [...current.events, ...next.events] };
}

function activations(
  state: GameState,
  source: string,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source,
  );
}

function resolveTop(current: ReduceResult): ReduceResult {
  let next = current;
  for (let guard = 0; guard < 4 && next.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(next.state);
    if (decision?.kind !== 'priority') throw new Error('Gobbling Ooze lost priority while resolving');
    next = apply(next, { type: 'passPriority', player: decision.player });
  }
  return next;
}

function board(): ReduceResult {
  return scenario({
    battlefield: [
      { card: GOBBLING_OOZE, controller: 0 },
      { card: ALLY, controller: 0 },
      { card: ENEMY, controller: 1 },
      { card: FOREST, controller: 0 },
    ],
  });
}

describe('Gobbling Ooze source-excluding sacrifice payment', () => {
  it('offers only another creature its controller controls', () => {
    const start = board();
    const source = oidOf(start.state, GOBBLING_OOZE.name);
    const ally = oidOf(start.state, ALLY.name);
    const enemy = oidOf(start.state, ENEMY.name);
    const payments = activations(start.state, source).map((action) => action.sacrifices);

    expect(payments).toEqual([[ally]]);
    expect(payments).not.toContainEqual([source]);
    expect(payments).not.toContainEqual([enemy]);
  });

  it('sacrifices before stacking, then puts exactly one counter on the surviving source', () => {
    let current = board();
    const source = oidOf(current.state, GOBBLING_OOZE.name);
    const ally = oidOf(current.state, ALLY.name);
    const action = activations(current.state, source).find((candidate) => candidate.sacrifices[0] === ally);
    if (action === undefined) throw new Error('Gobbling Ooze ally payment was not offered');

    current = apply(current, action);
    expect(current.state.objects[ally]?.zone).toBe('graveyard');
    expect(current.state.objects[source]?.zone).toBe('battlefield');
    expect(current.state.stack).toHaveLength(1);
    expect(counterCount(current.state.objects[source]!.counters, 'plusOnePlusOne')).toBe(0);

    current = resolveTop(current);
    expect(current.state.stack).toHaveLength(0);
    expect(counterCount(current.state.objects[source]!.counters, 'plusOnePlusOne')).toBe(1);
  });
});
