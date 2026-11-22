/** Native Fling casting: pay a creature now and retain its layered power. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  legalActions,
  reduce,
  reduceAll,
  scenario,
  validateAction,
  type Action,
  type GameState,
} from '@mtg/kernel';
import { counterStackEntry } from '../src/counter';
import { creature, MOUNTAIN } from './cards';
import { handOidOf, oidOf } from './helpers';

const FLING = parseCard({
  kind: 'instant',
  id: 'm11-139-fling-kernel',
  name: 'Fling',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 139 },
  colors: ['R'],
  manaCost: { generic: 1, R: 1 },
  additionalCost: {
    sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
  },
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'paidSacrificePower' },
      target: { kind: 'anyTarget' },
    },
  ],
} as unknown as CardInput);

const BEAR = creature('Fling Bear', 2, 2, { subtypes: ['Bear'] });
const LORD = creature('Fling Captain', 2, 2, {
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: 'Bear',
      modification: { kind: 'statBonus', power: 2, toughness: 0 },
    },
  ],
});
const ENEMY = creature('Enemy Offering', 5, 5);

function board(): GameState {
  return scenario({
    life: [20, 20],
    battlefield: [
      { card: BEAR, controller: 0 },
      { card: LORD, controller: 0 },
      { card: ENEMY, controller: 1 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
    ],
    hands: [[FLING], []],
  }).state;
}

function casts(state: GameState): readonly Extract<Action, { type: 'castSpell' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> =>
      action.type === 'castSpell' && action.oid === handOidOf(state, 0, FLING.name),
  );
}

describe('Fling spell payment', () => {
  it('enumerates each controlled creature once and rejects missing or opposing payments', () => {
    const state = board();
    const spell = handOidOf(state, 0, FLING.name);
    const bear = oidOf(state, BEAR.name);
    const lord = oidOf(state, LORD.name);
    const enemy = oidOf(state, ENEMY.name);

    expect(casts(state).map((action) => action.sacrifices)).toEqual(expect.arrayContaining([[bear], [lord]]));
    expect(casts(state).some((action) => action.sacrifices?.[0] === enemy)).toBe(false);
    expect(
      validateAction(state, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [{ kind: 'player', player: 1 }],
        sacrifices: [],
      }),
    ).not.toBeNull();
    expect(
      validateAction(state, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [{ kind: 'player', player: 1 }],
        sacrifices: [enemy],
      }),
    ).not.toBeNull();
  });

  it('sacrifices before the spell reaches the stack and deals retained layered power', () => {
    const state = board();
    const bear = oidOf(state, BEAR.name);
    const action = casts(state).find(
      (candidate) =>
        candidate.sacrifices?.[0] === bear &&
        candidate.targets[0]?.kind === 'player' &&
        candidate.targets[0].player === 1,
    );
    if (action === undefined) throw new Error('Fling did not offer the Bear payment at the opponent');

    const cast = reduce(state, action);
    expect(cast.state.objects[bear]?.zone).toBe('graveyard');
    expect(cast.state.stack).toHaveLength(1);

    const resolved = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(resolved.state.players[1].life).toBe(16);
  });

  it('does not refund the sacrificed creature when the spell is countered', () => {
    const state = board();
    const bear = oidOf(state, BEAR.name);
    const action = casts(state).find((candidate) => candidate.sacrifices?.[0] === bear);
    if (action === undefined) throw new Error('Fling did not offer the Bear payment');

    const cast = reduce(state, action);
    const spell = handOidOf(state, 0, FLING.name);
    const countered = counterStackEntry(beginTrace(cast.state), spell, 'test-counter');

    expect(countered.state.objects[bear]?.zone).toBe('graveyard');
    expect(countered.state.objects[spell]?.zone).toBe('graveyard');
    expect(countered.state.stack).toHaveLength(0);
  });
});
