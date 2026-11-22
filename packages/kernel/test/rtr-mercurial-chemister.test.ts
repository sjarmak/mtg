/** Mercurial Chemister retains the mana value of its discarded activation cost. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  legalActions,
  moveObject,
  pendingDecision,
  scenario,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, MOUNTAIN, SWAMP } from './cards';
import { apply, oidOf } from './helpers';

const CHEMISTER = parseCard({
  kind: 'creature',
  id: 'rtr-180-mercurial-chemister-kernel',
  name: 'Mercurial Chemister',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 180 },
  colors: ['U', 'R'],
  manaCost: { generic: 3, U: 1, R: 1 },
  subtypes: ['Human', 'Wizard'],
  power: 2,
  toughness: 3,
  abilities: [
    {
      kind: 'activated',
      printedSourceReference: 'thisCreature',
      cost: { mana: { U: 1 }, tapSelf: true },
      effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      cost: { mana: { R: 1 }, tapSelf: true, discard: 1 },
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'paidDiscardManaValue' },
          target: { kind: 'targetCreature' },
        },
      ],
    },
  ],
} as CardInput);

const CHEAP = creature('Cheap Thought', 1, 1, { cost: { U: 1 } });
const EXPENSIVE = creature('Expensive Thought', 4, 4, { cost: { generic: 4, U: 1 } });
const TARGET = creature('Damage Target', 8, 8);

function board(): GameState {
  return scenario({
    battlefield: [
      { card: CHEMISTER, controller: 0 },
      { card: TARGET, controller: 1 },
      { card: MOUNTAIN, controller: 0 },
      { card: SWAMP, controller: 0 },
    ],
    hands: [[CHEAP, EXPENSIVE], []],
  }).state;
}

function damageActivations(state: GameState): readonly Extract<Action, { type: 'activateAbility' }>[] {
  const source = oidOf(state, CHEMISTER.name);
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source && action.abilityIndex === 1,
  );
}

function passStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 4 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('stack did not stop for priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

describe('Mercurial Chemister activation', () => {
  it('offers each held card as a distinct paid discard and only creature targets', () => {
    const state = board();
    const target = oidOf(state, TARGET.name);
    const actions = damageActivations(state);
    expect(actions).toHaveLength(4);
    expect(new Set(actions.map((action) => state.objects[action.discards?.[0] ?? '']?.card.name))).toEqual(
      new Set([CHEAP.name, EXPENSIVE.name]),
    );
    expect(
      new Set(
        actions.map((action) =>
          action.targets[0]?.kind === 'permanent' ? state.objects[action.targets[0].oid]?.card.name : null,
        ),
      ),
    ).toEqual(new Set([CHEMISTER.name, TARGET.name]));
    expect(actions.some((action) => action.targets[0]?.kind !== 'permanent')).toBe(false);
    expect(
      actions.some((action) => action.targets[0]?.kind === 'permanent' && action.targets[0].oid === target),
    ).toBe(true);
  });

  it.each([
    { name: CHEAP.name, retained: 1 },
    { name: EXPENSIVE.name, retained: 5 },
  ])('retains $retained after discarding $name and deals that much', (example) => {
    const state = board();
    const action = damageActivations(state).find(
      (candidate) =>
        state.objects[candidate.discards?.[0] ?? '']?.card.name === example.name &&
        candidate.targets[0]?.kind === 'permanent' &&
        candidate.targets[0].oid === oidOf(state, TARGET.name),
    );
    if (action === undefined) throw new Error('missing paid-discard activation');
    const paid = apply({ state, events: [] }, action);
    const discarded = action.discards?.[0];
    if (discarded === undefined) throw new Error('activation retained no discarded card');
    expect(paid.state.objects[discarded]?.zone).toBe('graveyard');
    expect(paid.state.stack.at(-1)?.paidDiscardManaValue).toBe(example.retained);
    const done = passStack(paid);
    expect(done.state.objects[oidOf(done.state, TARGET.name)]?.damage).toBe(example.retained);
  });

  it('fizzles when its creature target leaves without refunding the discarded card', () => {
    const state = board();
    const action = damageActivations(state)[0];
    if (action === undefined) throw new Error('missing paid-discard activation');
    const paid = apply({ state, events: [] }, action);
    const departed = moveObject(paid, oidOf(paid.state, TARGET.name), 'graveyard');
    expect(passStack(departed).state.stack).toHaveLength(0);
    expect(paid.state.objects[action.discards?.[0] ?? '']?.zone).toBe('graveyard');
  });
});
