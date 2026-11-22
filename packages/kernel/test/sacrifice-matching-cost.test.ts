/** Native payment for “Sacrifice a creature,” including the source. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  legalActions,
  pendingDecision,
  powerOf,
  reduce,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { creature } from './cards';
import { oidOf } from './helpers';

const BLOODTHRONE = parseCard({
  kind: 'creature',
  id: 'tst-bloodthrone-vampire',
  name: 'Bloodthrone Vampire',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 85 },
  colors: ['B'],
  manaCost: { generic: 1, B: 1 },
  subtypes: ['Vampire'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 2,
          toughness: 2,
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
});

const VISCERA = parseCard({
  kind: 'creature',
  id: 'tst-viscera-seer',
  name: 'Viscera Seer',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 120 },
  colors: ['B'],
  manaCost: { B: 1 },
  subtypes: ['Vampire', 'Wizard'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
      effects: [{ kind: 'scry', count: 1 }],
    },
  ],
});

const ALLY = creature('Allied Bear', 2, 2);
const ENEMY = creature('Enemy Bear', 2, 2);

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
    if (decision?.kind !== 'priority') throw new Error('ability lost priority while resolving');
    next = apply(next, { type: 'passPriority', player: decision.player });
  }
  return next;
}

describe('a filtered sacrifice payment', () => {
  it('offers every matching creature the player controls, including the source, and never an opponent creature', () => {
    const start = scenario({
      battlefield: [
        { card: BLOODTHRONE, controller: 0 },
        { card: ALLY, controller: 0 },
        { card: ENEMY, controller: 1 },
      ],
    }).state;
    const source = oidOf(start, BLOODTHRONE.name);
    const ally = oidOf(start, ALLY.name);
    const enemy = oidOf(start, ENEMY.name);

    expect(activations(start, source).map((action) => action.sacrifices)).toEqual([[source], [ally]]);
    expect(
      validateAction(start, {
        type: 'activateAbility',
        player: 0,
        oid: source,
        abilityIndex: 0,
        targets: [null],
        sacrifices: [enemy],
      }),
    ).toBe(`${enemy} does not match a permanent you control permitted by this sacrifice cost`);
  });

  it('pays with another creature before the stack, then resolves the self-pump', () => {
    let current = scenario({
      battlefield: [
        { card: BLOODTHRONE, controller: 0 },
        { card: ALLY, controller: 0 },
      ],
    });
    const source = oidOf(current.state, BLOODTHRONE.name);
    const ally = oidOf(current.state, ALLY.name);
    const action = activations(current.state, source).find((option) => option.sacrifices[0] === ally);
    if (action === undefined) throw new Error('ally sacrifice was not offered');

    current = apply(current, action);
    expect(current.state.objects[ally]?.zone).toBe('graveyard');
    expect(current.state.stack).toHaveLength(1);
    expect(powerOf(current.state, source)).toBe(1);

    current = resolveTop(current);
    expect(powerOf(current.state, source)).toBe(3);
  });

  it('lets the source pay and keeps its scry ability alive on the stack', () => {
    const library = [creature('Top Card', 1, 1), creature('Bottom Card', 1, 1)];
    let current = scenario({
      battlefield: [{ card: VISCERA, controller: 0 }],
      libraries: [library, library],
    });
    const source = oidOf(current.state, VISCERA.name);
    const action = activations(current.state, source).find((option) => option.sacrifices[0] === source);
    if (action === undefined) throw new Error('source sacrifice was not offered');

    current = apply(current, action);
    expect(current.state.objects[source]?.zone).toBe('graveyard');
    expect(current.state.stack).toHaveLength(1);
    current = resolveTop(current);

    const decision = pendingDecision(current.state);
    expect(decision?.kind).toBe('scry');
    if (decision?.kind !== 'scry') throw new Error('Viscera Seer did not resolve to scry 1');
    expect(decision.cards).toEqual([current.state.players[0].library[0]]);
  });
});
