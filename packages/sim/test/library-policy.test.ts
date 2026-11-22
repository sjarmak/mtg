import { describe, expect, it } from 'vitest';
import { basicLand } from '@mtg/dsl';
import type { Action, GameState, ReduceResult } from '@mtg/kernel';
import { pendingDecision, reduce, scenario, validateAction } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, decideGreedy } from '@mtg/sim';
import { creature, FOREST, MOUNTAIN, PLAINS, SWAMP, instant, sorcery } from './cards';

const ISLAND = basicLand('Island', 'TST', 505);

function apply(current: ReduceResult, action: Action): ReduceResult {
  const result = reduce(current.state, action);
  return { state: result.state, events: [...current.events, ...result.events] };
}

function handOidOf(state: GameState, player: 0 | 1, name: string): string {
  const oid = state.players[player].hand.find((entry) => state.objects[entry]?.card.name === name);
  if (oid === undefined) throw new Error(`player ${String(player)} has no ${name}`);
  return oid;
}

function untilDecision(
  player: 0 | 1,
  source: GameState['objects'][string]['card'],
  library: readonly GameState['objects'][string]['card'][],
  hand: readonly GameState['objects'][string]['card'][] = [],
  opponentHand: readonly GameState['objects'][string]['card'][] = [],
  opponentLibrary: readonly GameState['objects'][string]['card'][] = [creature('Filler', 1, 1)],
): ReduceResult {
  let current = scenario({
    active: player,
    battlefield: Array.from({ length: 6 }, () => ({ card: FOREST, controller: player })),
    hands: player === 0 ? [[source, ...hand], opponentHand] : [opponentHand, [source, ...hand]],
    libraries: player === 0 ? [library, opponentLibrary] : [opponentLibrary, library],
  });
  current = apply(current, {
    type: 'castSpell',
    player,
    oid: handOidOf(current.state, player, source.name),
    targets: source.effects.map(() => null),
  });
  current = apply(current, { type: 'passPriority', player });
  current = apply(current, { type: 'passPriority', player: player === 0 ? 1 : 0 });
  return current;
}

function decideActual(current: ReduceResult, player: 0 | 1): Action {
  const decision = pendingDecision(current.state);
  if (decision === null || decision.player !== player)
    throw new Error('expected a decision for the active player');
  const action = decideGreedy(
    { state: observeState(current.state, player, 'test/library-policy.test.ts:50'), player, decision },
    DEFAULT_GREEDY_CONFIG,
  );
  expect(validateAction(current.state, action)).toBeNull();
  return action;
}

describe('native scry policy', () => {
  it('bottoms a land in a flooded scry one using the real kernel decision', () => {
    const source = sorcery('Scry one', [{ kind: 'scry', count: 1 }], { generic: 1 });
    const current = untilDecision(0, source, [FOREST]);
    const action = decideActual(current, 0);
    if (action.type !== 'scry') throw new Error('expected scry action');
    expect(current.state.objects[action.bottom[0] ?? '']?.card.name).toBe('Forest');
    const resolved = apply(current, action);
    expect(resolved.state.players[0].library).toHaveLength(1);
    const bottomOid = resolved.state.players[0].library[0];
    if (bottomOid === undefined) throw new Error('expected bottomed card in library');
    expect(resolved.state.objects[bottomOid]?.card.name).toBe('Forest');
  });

  it('keeps a needed blue source on top when the hand is color-screwed', () => {
    const source = sorcery('Scry two', [{ kind: 'scry', count: 2 }], { generic: 1 });
    const blueSpell = instant(
      'Blue Spell',
      [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      { U: 1 },
      ['U'],
    );
    const current = untilDecision(0, source, [ISLAND, PLAINS], [blueSpell]);
    const action = decideActual(current, 0);
    if (action.type !== 'scry') throw new Error('expected scry action');
    expect(current.state.objects[action.top[0] ?? '']?.card.name).toBe('Island');
  });

  it('uses marginal value over the replacement draw baseline', () => {
    const source = sorcery('Scry marginal', [{ kind: 'scry', count: 1 }], { generic: 1 });
    const current = untilDecision(0, source, [creature('Small', 1, 1)]);
    const config = {
      ...DEFAULT_GREEDY_CONFIG,
      cast: {
        ...DEFAULT_GREEDY_CONFIG.cast,
        creatureBaseValue: 0.2,
        powerWeight: 0.1,
        toughnessWeight: 0.1,
        spellBaseValue: 0.3,
      },
    };
    const decision = pendingDecision(current.state);
    if (decision === null || decision.player !== 0) throw new Error('expected scry decision');
    const action = decideGreedy(
      { state: observeState(current.state, 0, 'test/library-policy.test.ts:98'), player: 0, decision },
      config,
    );
    if (action.type !== 'scry') throw new Error('expected scry action');
    expect(current.state.objects[action.top[0] ?? '']?.card.name).toBe('Small');
  });

  it('does not change with unrelated opponent hand or hidden library cards', () => {
    const source = sorcery('Scry hidden-state', [{ kind: 'scry', count: 2 }], { generic: 1 });
    const first = untilDecision(0, source, [PLAINS, FOREST, creature('Tail A', 1, 1)]);
    const second = untilDecision(
      0,
      source,
      [PLAINS, FOREST, creature('Tail B', 5, 5)],
      [],
      [creature('Opponent Secret', 9, 9)],
      [creature('Opponent Tail', 8, 8)],
    );
    const firstAction = decideActual(first, 0);
    const secondAction = decideActual(second, 0);
    if (firstAction.type !== 'scry' || secondAction.type !== 'scry') throw new Error('expected scry actions');
    const names = (current: ReduceResult, ids: readonly string[]) =>
      ids.map((oid) => current.state.objects[oid]?.card.name);
    expect(names(first, firstAction.top)).toEqual(names(second, secondAction.top));
    expect(names(first, firstAction.bottom)).toEqual(names(second, secondAction.bottom));
  });

  it('orders scry three by quality and includes the real keep-all choice', () => {
    const source = sorcery('Scry three', [{ kind: 'scry', count: 3 }], { generic: 1 });
    const current = untilDecision(0, source, [creature('Strong', 5, 5), creature('Weak', 1, 1), FOREST]);
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'scry') throw new Error('expected scry decision');
    expect(decision.options).toContainEqual({
      type: 'scry',
      player: 0,
      top: decision.cards,
      bottom: [],
    });
    expect(decision.options).toContainEqual({
      type: 'scry',
      player: 0,
      top: [],
      bottom: decision.cards,
    });
    const action = decideActual(current, 0);
    if (action.type !== 'scry') throw new Error('expected scry action');
    expect(action.bottom).toHaveLength(1);
    expect(current.state.objects[action.bottom[0] ?? '']?.card.name).toBe('Forest');
    expect(current.state.objects[action.top[0] ?? '']?.card.name).toBe('Strong');
  });

  it('uses the same real scry policy for seat one', () => {
    const source = sorcery('Scry one', [{ kind: 'scry', count: 1 }], { generic: 1 });
    const current = untilDecision(1, source, [FOREST]);
    const action = decideActual(current, 1);
    if (action.type !== 'scry') throw new Error('expected scry action');
    expect(current.state.objects[action.bottom[0] ?? '']?.card.name).toBe('Forest');
  });
});

describe('native tutor policy', () => {
  it('chooses the strongest card from the real land and spell options', () => {
    const source = sorcery('Tutor', [{ kind: 'searchLibrary', filter: {}, destination: 'hand' }], {
      generic: 1,
    });
    const current = untilDecision(0, source, [FOREST, creature('Strong', 5, 5)]);
    const action = decideActual(current, 0);
    if (action.type !== 'searchLibrary') throw new Error('expected search action');
    expect(current.state.objects[action.found ?? '']?.card.name).toBe('Strong');
    const resolved = apply(current, action);
    expect(resolved.state.players[0].hand.map((oid) => resolved.state.objects[oid]?.card.name)).toContain(
      'Strong',
    );
  });

  it('prefers a weaker castable spell over a stronger spell with no visible color source', () => {
    const source = sorcery(
      'Tutor color check',
      [{ kind: 'searchLibrary', filter: {}, destination: 'hand' }],
      {
        generic: 1,
      },
    );
    const strongBlue = creature('Strong Blue', 5, 5, [], { U: 1 }, ['U']);
    const weakGeneric = creature('Weak Generic', 1, 1);
    const current = untilDecision(0, source, [strongBlue, weakGeneric]);
    const action = decideActual(current, 0);
    if (action.type !== 'searchLibrary') throw new Error('expected search action');
    expect(current.state.objects[action.found ?? '']?.card.name).toBe('Weak Generic');
  });

  it('chooses a missing color source for seat one and does not count hand lands as future need', () => {
    const source = sorcery('Tutor', [{ kind: 'searchLibrary', filter: {}, destination: 'hand' }], {
      generic: 1,
    });
    const blackSpell = instant(
      'Black Spell',
      [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      { B: 1 },
      ['B'],
    );
    const current = untilDecision(1, source, [MOUNTAIN, SWAMP], [blackSpell, FOREST, FOREST, FOREST, FOREST]);
    const action = decideActual(current, 1);
    if (action.type !== 'searchLibrary') throw new Error('expected search action');
    expect(current.state.objects[action.found ?? '']?.card.name).toBe('Swamp');
  });

  it('keeps an optional failure only when the real search has no matches', () => {
    const source = sorcery(
      'Optional Tutor',
      [{ kind: 'searchLibrary', filter: { cardTypes: ['battle'] }, destination: 'hand' }],
      { generic: 1 },
    );
    const current = untilDecision(0, source, [FOREST]);
    expect(decideActual(current, 0)).toEqual({ type: 'searchLibrary', player: 0, found: null });
  });
});
