import { describe, expect, it } from 'vitest';
import type { Effect } from '@mtg/dsl';
import type { GameState, ObjectId } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, scoreEffectTargets } from '@mtg/sim';
import { creature } from './cards';

const config = DEFAULT_GREEDY_CONFIG;

function gloom(count: number): Effect {
  return { kind: 'putCounters', counter: 'gloom', count, target: { kind: 'targetCreature' } };
}

const GROWTH: Effect = {
  kind: 'putCounters',
  counter: 'plusOnePlusOne',
  count: 2,
  target: { kind: 'targetCreature' },
};

const KILL: Effect = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };

function board(): GameState {
  return scenario({
    seed: 'sim/target/counter-kill',
    battlefield: [
      { card: creature('Thin Scout', 2, 1), controller: 1 },
      { card: creature('Camp Guard', 2, 2), controller: 1 },
      { card: creature('Stone Warden', 3, 3), controller: 1 },
      { card: creature('Own Recruit', 2, 2), controller: 0 },
    ],
    hands: [[], []],
  }).state;
}

function oidOf(state: GameState, name: string): ObjectId {
  const found = Object.values(state.objects).find((object) => object.card.name === name);
  if (found === undefined) throw new Error(`${name} is not on the board`);
  return found.oid;
}

function score(state: GameState, effect: Effect, name: string): number {
  return scoreEffectTargets(
    state,
    0,
    [effect],
    [{ kind: 'permanent', oid: oidOf(state, name) }],
    config.cast,
    config.target,
    config.race,
  );
}

describe('how the greedy bot prices several counters placed at once', () => {
  it('reads two gloom counters as a kill on a creature with two toughness', () => {
    const state = board();
    expect(score(state, gloom(2), 'Camp Guard')).toBe(score(state, KILL, 'Camp Guard'));
  });

  it('prices the kill once, however many counters are left over', () => {
    const state = board();
    expect(score(state, gloom(2), 'Thin Scout')).toBe(score(state, gloom(1), 'Thin Scout'));
  });

  it('refuses the creature the counters do not kill', () => {
    const state = board();
    expect(score(state, gloom(2), 'Stone Warden')).toBeLessThan(0);
  });

  it('refuses to kill its own creature with them', () => {
    const state = board();
    expect(score(state, gloom(2), 'Own Recruit')).toBeLessThan(0);
  });

  it('still prices a growing counter per counter', () => {
    const state = board();
    const one: Effect = { ...GROWTH, count: 1 };
    expect(score(state, GROWTH, 'Own Recruit')).toBe(2 * score(state, one, 'Own Recruit'));
  });
});
