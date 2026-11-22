import { describe, expect, it } from 'vitest';
import type { Action, GameState, Target } from '@mtg/kernel';
import { eventsOfType, getObject, playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { creature, FOREST, instant, PLAINS } from './cards';

const COMMON_BOND = instant(
  'Common Bond',
  [
    { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
    { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
  ],
  { generic: 1, G: 1, W: 1 },
);

const FIRST = creature('Common Bond First Target', 2, 2);
const SECOND = creature('Common Bond Second Target', 3, 3);

function pass(state: GameState): Action {
  const player = state.turn.priority;
  if (player === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player };
}

function oidNamed(state: GameState, name: string): string {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`no battlefield object named ${name}`);
  return oid;
}

function board() {
  return scenario({
    active: 0,
    hands: [[COMMON_BOND], []],
    battlefield: [
      { card: FOREST, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: FIRST, controller: 0 },
      { card: SECOND, controller: 1 },
    ],
  });
}

function cast(state: GameState, targets: readonly (Target | null)[]) {
  const oid = playerOf(state, 0).hand.find(
    (candidate) => state.objects[candidate]?.card.name === COMMON_BOND.name,
  );
  if (oid === undefined) throw new Error('Common Bond is not in hand');
  return reduce(state, { type: 'castSpell', player: 0, oid, targets });
}

function resolve(state: GameState) {
  const first = reduce(state, pass(state));
  return reduceAll(first.state, [{ type: 'passPriority', player: 1 }]);
}

describe('RTR #151 Common Bond', () => {
  it('lets its independent target slots name two creatures', () => {
    const start = board();
    const first = oidNamed(start.state, FIRST.name);
    const second = oidNamed(start.state, SECOND.name);
    const done = resolve(
      cast(start.state, [
        { kind: 'permanent', oid: first },
        { kind: 'permanent', oid: second },
      ]).state,
    );

    expect(getObject(done.state, first).counters.plusOnePlusOne).toBe(1);
    expect(getObject(done.state, second).counters.plusOnePlusOne).toBe(1);
    expect(eventsOfType(done.events, 'countersChanged')).toHaveLength(2);
  });

  it('lets both target slots name the same creature', () => {
    const start = board();
    const first = oidNamed(start.state, FIRST.name);
    const target = { kind: 'permanent', oid: first } as const;
    const done = resolve(cast(start.state, [target, target]).state);

    expect(getObject(done.state, first).counters.plusOnePlusOne).toBe(2);
    expect(eventsOfType(done.events, 'countersChanged')).toHaveLength(2);
  });

  it('resolves the surviving target slot when the other target leaves first', () => {
    const start = board();
    const first = oidNamed(start.state, FIRST.name);
    const second = oidNamed(start.state, SECOND.name);
    const stacked = cast(start.state, [
      { kind: 'permanent', oid: first },
      { kind: 'permanent', oid: second },
    ]).state;
    const departing = getObject(stacked, first);
    const changed: GameState = {
      ...stacked,
      battlefield: stacked.battlefield.filter((oid) => oid !== first),
      objects: { ...stacked.objects, [first]: { ...departing, zone: 'graveyard' } },
    };
    const done = resolve(changed);

    expect(getObject(done.state, first).counters.plusOnePlusOne ?? 0).toBe(0);
    expect(getObject(done.state, second).counters.plusOnePlusOne).toBe(1);
    expect(eventsOfType(done.events, 'effectSkipped')).toHaveLength(1);
    expect(eventsOfType(done.events, 'countersChanged')).toHaveLength(1);
  });
});
