/**
 * Condemn, through public target enumeration and stack resolution.
 *
 * The amount is last-known information rather than a live board read: the
 * creature is already in its owner's library when the life gain applies. The
 * board also separates owner from controller and changes the layered toughness
 * so a printed-stat shortcut cannot pass.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard, validateCards } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { reduce, reduceAll, scenario, targetChoicesFor } from '@mtg/kernel';
import { creature, PLAINS } from './cards';
import { handOidOf, oidOf } from './helpers';

const CONDEMN: Card = parseCard({
  kind: 'instant',
  id: 'm11-011',
  name: 'Condemn',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 11 },
  manaCost: { W: 1 },
  colors: ['W'],
  effects: [
    {
      kind: 'putOnLibrary',
      position: 'bottom',
      target: { kind: 'targetCreature', filter: { combat: 'attacking' } },
    },
    {
      kind: 'gainLife',
      amount: { kind: 'thatCreatureToughness' },
      target: { kind: 'thatCreaturesController' },
    },
  ],
} as unknown as CardInput);

const ATTACKER = creature('Condemned Raider', 2, 3);
const WATCHER = creature('Home Watcher', 1, 1);
const LORD = creature('Raider Captain', 2, 2, {
  subtypes: ['Raider'],
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
  ],
});

function attackingBoard(): { readonly state: GameState; readonly attacker: ObjectId } {
  const built = scenario({
    active: 1,
    life: [20, 10],
    battlefield: [
      { card: ATTACKER, controller: 1 },
      { card: WATCHER, controller: 1 },
      { card: LORD, controller: 1 },
      { card: PLAINS, controller: 0 },
    ],
    hands: [[CONDEMN], []],
  }).state;
  const attacker = oidOf(built, ATTACKER.name);
  return {
    attacker,
    state: {
      ...built,
      combat: {
        ...built.combat,
        attacks: [{ oid: attacker, defender: 0 }],
      },
      turn: { ...built.turn, priority: 0 },
    },
  };
}

function cast(state: GameState, attacker: ObjectId): ReduceResult {
  return reduce(state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(state, 0, CONDEMN.name),
    targets: [{ kind: 'permanent', oid: attacker }, null],
  });
}

function settle(state: GameState): ReduceResult {
  return reduceAll(state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
}

describe('Condemn target selection', () => {
  it('validates and offers only the creature currently attacking', () => {
    expect(validateCards([CONDEMN])).toEqual([]);
    const { state, attacker } = attackingBoard();
    expect(targetChoicesFor(state, CONDEMN, 0)).toEqual([[{ kind: 'permanent', oid: attacker }], [null]]);
  });

  it('fizzles both clauses when the creature stops attacking before resolution', () => {
    const { state, attacker } = attackingBoard();
    const onStack = cast(state, attacker);
    const noLongerAttacking: GameState = {
      ...onStack.state,
      combat: { ...onStack.state.combat, attacks: [] },
    };
    const done = settle(noLongerAttacking);
    expect(done.state.objects[attacker]?.zone).toBe('battlefield');
    expect(done.state.players[1].life).toBe(10);
  });
});

describe('Condemn linked values at resolution', () => {
  it('gains the layered toughness after the creature has changed zones', () => {
    const { state, attacker } = attackingBoard();
    const done = settle(cast(state, attacker).state);
    expect(done.state.objects[attacker]?.zone).toBe('library');
    expect(done.state.players[1].library.at(-1)).toBe(attacker);
    expect(done.state.players[1].life).toBe(14);
  });

  it('uses the controller at resolution while returning the card to its owner', () => {
    const { state, attacker } = attackingBoard();
    const onStack = cast(state, attacker);
    const object = onStack.state.objects[attacker];
    if (object === undefined) throw new Error('attacker disappeared while Condemn was on the stack');
    const changed: GameState = {
      ...onStack.state,
      objects: {
        ...onStack.state.objects,
        [attacker]: { ...object, controller: 0 },
      },
    };
    const done = settle(changed);
    expect(done.state.objects[attacker]?.zone).toBe('library');
    expect(done.state.players[1].library.at(-1)).toBe(attacker);
    // The control change also removes Raider Captain's +1/+1 from the target,
    // so its toughness at resolution is the printed 3 rather than the earlier 4.
    expect(done.state.players[0].life).toBe(23);
    expect(done.state.players[1].life).toBe(10);
  });
});
