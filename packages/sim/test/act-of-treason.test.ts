/** The greedy cast policy aims temporary control across the table. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { pendingDecision, scenario, validateAction, type GameState, type ObjectId } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { chooseCast, DEFAULT_GREEDY_CONFIG, scoreTargets } from '@mtg/sim';
import { creature, MOUNTAIN } from './cards';

const ACT = parseCard({
  kind: 'sorcery',
  id: 'm11-121',
  name: 'Act of Treason',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 121 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  effects: [
    { kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } },
    { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
    { kind: 'grantKeywordUntilEndOfTurn', keyword: 'haste', target: { kind: 'thatCreature' } },
  ],
});

function named(state: GameState, name: string): ObjectId {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`no ${name}`);
  return oid;
}

function board(): GameState {
  return scenario({
    seed: 'sim/act-of-treason',
    battlefield: [
      ...Array.from({ length: 3 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      { card: creature('Runeclaw Bear', 2, 2), controller: 0 },
      { card: creature('Opposing Ogre', 6, 6), controller: 1 },
    ],
    hands: [[ACT], []],
  }).state;
}

function score(state: GameState, oid: ObjectId): number {
  const config = DEFAULT_GREEDY_CONFIG;
  return scoreTargets(
    state,
    0,
    ACT,
    [{ kind: 'permanent', oid }, null, null],
    config.cast,
    config.target,
    config.race,
  );
}

describe('Act of Treason target policy', () => {
  it('rejects the own-goal target and chooses the opposing creature', () => {
    const state = board();
    const mine = named(state, 'Runeclaw Bear');
    const theirs = named(state, 'Opposing Ogre');
    expect(score(state, mine)).toBeLessThan(0);
    expect(score(state, theirs)).toBeGreaterThan(0);

    const decision = pendingDecision(state, 512);
    if (decision === null) throw new Error('no decision pending');
    const action = chooseCast(
      { state: observeState(state, 0, 'test/act-of-treason.test.ts:64'), player: 0, decision },
      DEFAULT_GREEDY_CONFIG,
    );
    expect(action).not.toBeNull();
    if (action === null) return;
    expect(validateAction(state, action)).toBeNull();
    expect(action.targets).toEqual([{ kind: 'permanent', oid: theirs }, null, null]);
  });
});
