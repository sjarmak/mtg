import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  copySpellOnStack,
  legalActions,
  moveObject,
  playerOf,
  reduce,
  scenario,
  stateFingerprint,
  validateAction,
  type Action,
  type GameState,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { beginTurn } from '../src/turn';
import { handOidOf } from './helpers';

const AVENGER = parseCard({
  kind: 'creature',
  id: 'm13-serra-avenger-kernel',
  name: 'Serra Avenger',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 33 },
  manaCost: {},
  colors: [],
  subtypes: ['Angel'],
  power: 3,
  toughness: 3,
  keywords: ['flying', 'vigilance'],
  castingRestriction: { kind: 'prohibitedPlayerTurns', turns: [1, 2, 3] },
});

function castOf(state: GameState, player: 0 | 1): Extract<Action, { type: 'castSpell' }> {
  return { type: 'castSpell', player, oid: handOidOf(state, player, AVENGER.name), targets: [] };
}

function offered(state: GameState, player: 0 | 1): boolean {
  const oid = handOidOf(state, player, AVENGER.name);
  return legalActions(state).some(
    (action) => action.type === 'castSpell' && action.player === player && action.oid === oid,
  );
}

describe('card-level player-turn casting restrictions', () => {
  it.each([1, 2, 3])('refuses enumeration and a constructed cast during player 0 turn %i', (turnsBegun) => {
    const start = scenario({ active: 0, turn: 5, turnsBegun: [turnsBegun, 2], hands: [[AVENGER], []] });
    expect(offered(start.state, 0)).toBe(false);
    expect(validateAction(start.state, castOf(start.state, 0))).toContain('first, second, or third turns');
  });

  it('allows the fourth turn and reproduces the same state from the same action', () => {
    const start = scenario({ active: 0, turn: 7, turnsBegun: [4, 3], hands: [[AVENGER], []] });
    const action = castOf(start.state, 0);
    expect(offered(start.state, 0)).toBe(true);
    expect(validateAction(start.state, action)).toBeNull();
    expect(stateFingerprint(reduce(start.state, action).state)).toBe(
      stateFingerprint(reduce(structuredClone(start.state), structuredClone(action)).state),
    );
  });

  it('counts each seat separately and permits an extra-turn fourth turn on global turn 4', () => {
    const playerOne = scenario({ active: 1, turn: 6, turnsBegun: [3, 3], hands: [[], [AVENGER]] });
    expect(offered(playerOne.state, 1)).toBe(false);
    const beforeExtra = scenario({ active: 0, turn: 3, turnsBegun: [3, 0] });
    const begunExtra = beginTurn(beginTrace(beforeExtra.state), 0);
    expect(begunExtra.state.turn).toMatchObject({ number: 4, active: 0 });
    expect(playerOf(begunExtra.state, 0).turnsBegun).toBe(4);
    expect(playerOf(begunExtra.state, 1).turnsBegun).toBe(0);
    const extraTurn = scenario({ active: 0, turn: 4, turnsBegun: [4, 0], hands: [[AVENGER], []] });
    expect(offered(extraTurn.state, 0)).toBe(true);
  });

  it('applies before alternate-cost selection but not to non-cast entry', () => {
    const withAlternative = parseCard({
      ...AVENGER,
      id: 'restricted-alternative',
      alternativeCost: { payLife: 1, sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } } },
    });
    const start = scenario({ active: 0, turnsBegun: [1, 0], hands: [[withAlternative], []] });
    const oid = handOidOf(start.state, 0, withAlternative.name);
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid,
        targets: [],
        castingCost: 'alternative',
      }),
    ).toContain('first');
    expect(moveObject(beginTrace(start.state), oid, 'battlefield').state.objects[oid]?.zone).toBe(
      'battlefield',
    );
  });

  it('does not reapply the restriction to a copied spell', () => {
    const restrictedInstant = parseCard({
      kind: 'instant',
      id: 'restricted-copy-probe',
      name: 'Restricted Copy Probe',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: {},
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      castingRestriction: { kind: 'prohibitedPlayerTurns', turns: [1, 2, 3] },
    });
    const fourth = scenario({ active: 0, turn: 7, turnsBegun: [4, 3], hands: [[restrictedInstant], []] });
    const oid = handOidOf(fourth.state, 0, restrictedInstant.name);
    const cast = reduce(fourth.state, { type: 'castSpell', player: 0, oid, targets: [null] });
    const original = cast.state.stack.at(-1)?.oid;
    if (original === undefined) throw new Error('the original spell never reached the stack');
    const firstTurnState = {
      ...cast.state,
      players: [{ ...playerOf(cast.state, 0), turnsBegun: 1 }, playerOf(cast.state, 1)] as const,
    };
    expect(copySpellOnStack(beginTrace(firstTurnState), original).state.stack).toHaveLength(2);
  });
});
