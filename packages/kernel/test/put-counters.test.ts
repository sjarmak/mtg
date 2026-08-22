/**
 * `putCounters` resolving for real: a card places a counter, and the counter's
 * declaration takes effect on the creature it landed on.
 *
 * This is the half of Fuse the DSL owed. The cost half ("Sacrifice this") is a
 * separate slice; what is asserted here is that a printed effect puts a named
 * counter on a target creature and the layers pick it up from there.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState, Target } from '@mtg/kernel';
import {
  eventsOfType,
  getObject,
  hasKeyword,
  playerOf,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { creature, FOREST, sorcery } from './cards';

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

function castAndResolve(start: GameState, targets: readonly (Target | null)[]): GameState {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const cast = reduce(start, { type: 'castSpell', player: 0, oid, targets });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
}

function oidNamed(state: GameState, name: string): string {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

function forests(count: number): { card: typeof FOREST; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: FOREST, controller: 0 as const }));
}

const bear = creature('Graft Bear', 2, 2, { cost: { generic: 1, G: 1 } });

const graft = sorcery(
  'Heartwood Graft',
  [{ kind: 'putCounters', counter: 'plusOnePlusOne', count: 2, target: { kind: 'targetCreature' } }],
  { generic: 3, G: 1 },
);

const horn = sorcery(
  'Fused Trophy Horn',
  [{ kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } }],
  { generic: 1, G: 1 },
);

describe('putCounters', () => {
  it('puts the named counters on the targeted creature and reports the change', () => {
    const start = scenario({
      battlefield: [...forests(4), { card: bear, controller: 0 }],
      hands: [[graft], []],
    });
    const target = oidNamed(start.state, 'Graft Bear');
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: playerOf(start.state, 0).hand[0] ?? '',
      targets: [{ kind: 'permanent', oid: target }],
    });
    const after = reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]);

    expect(getObject(after.state, target).counters.plusOnePlusOne).toBe(2);
    expect(powerOf(after.state, target)).toBe(4);
    expect(toughnessOf(after.state, target)).toBe(4);
    expect(eventsOfType(after.events, 'countersChanged')).toHaveLength(1);
  });

  it('places a part counter, whose declaration reaches two layers at once', () => {
    const start = scenario({
      battlefield: [...forests(2), { card: bear, controller: 0 }],
      hands: [[horn], []],
    });
    const target = oidNamed(start.state, 'Graft Bear');
    const after = castAndResolve(start.state, [{ kind: 'permanent', oid: target }]);

    expect(getObject(after, target).counters.horn).toBe(1);
    expect(powerOf(after, target)).toBe(3);
    expect(hasKeyword(after, target, 'firstStrike')).toBe(true);
  });

  it('does nothing when its target has left the battlefield', () => {
    const start = scenario({
      battlefield: [...forests(2), { card: bear, controller: 0 }],
      hands: [[horn], []],
    });
    const target = oidNamed(start.state, 'Graft Bear');
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: playerOf(start.state, 0).hand[0] ?? '',
      targets: [{ kind: 'permanent', oid: target }],
    });
    const object = getObject(cast.state, target);
    const gone: GameState = {
      ...cast.state,
      battlefield: cast.state.battlefield.filter((oid) => oid !== target),
      objects: { ...cast.state.objects, [target]: { ...object, zone: 'graveyard' } },
    };
    const after = reduceAll(gone, [pass(gone), { type: 'passPriority', player: 1 }]);

    expect(getObject(after.state, target).counters.horn ?? 0).toBe(0);
    expect(eventsOfType(after.events, 'countersChanged')).toHaveLength(0);
  });
});
