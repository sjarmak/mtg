import { describe, expect, it } from 'vitest';
import { deepCopy, fork, reduce, restore, scenario, snapshot, stateFingerprint } from '@mtg/kernel';
import { creature, instant, MOUNTAIN } from './cards';
import { handOidOf, oidOf } from './helpers';

const bolt = instant('Fork Bolt', [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }], {
  generic: 1,
  R: 1,
});
const bear = creature('Fork Bear', 2, 2);

function position() {
  return scenario({
    battlefield: [
      { card: bear, controller: 1 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
    ],
    hands: [[bolt], []],
    life: [20, 20],
  });
}

describe('snapshot and fork', () => {
  it('forks two independent lines of play from one position', () => {
    const start = position();
    const taken = snapshot(start.state, 'before-bolt');
    const before = stateFingerprint(start.state);

    const boltOid = handOidOf(start.state, 0, 'Fork Bolt');
    const bearOid = oidOf(start.state, 'Fork Bear');

    const atFace = reduce(fork(taken.state), {
      type: 'castSpell',
      player: 0,
      oid: boltOid,
      targets: [{ kind: 'player', player: 1 }],
    });
    const atCreature = reduce(fork(taken.state), {
      type: 'castSpell',
      player: 0,
      oid: boltOid,
      targets: [{ kind: 'permanent', oid: bearOid }],
    });

    expect(stateFingerprint(atFace.state)).not.toBe(stateFingerprint(atCreature.state));
    // Neither line disturbed the snapshot they both branched from.
    expect(stateFingerprint(restore(taken))).toBe(before);
    expect(stateFingerprint(start.state)).toBe(before);
  });

  it('shares structure: a fork is the same object, and an untouched branch is untouched', () => {
    const start = position();
    const forked = fork(start.state);
    expect(forked).toBe(start.state);

    const boltOid = handOidOf(start.state, 0, 'Fork Bolt');
    const after = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: boltOid,
      targets: [{ kind: 'player', player: 1 }],
    });
    // The battlefield was not touched by the cast, so it is literally reused.
    expect(after.state.battlefield).toBe(start.state.battlefield);
    expect(after.state.config).toBe(start.state.config);
    expect(after.state.objects[oidOf(start.state, 'Fork Bear')]).toBe(
      start.state.objects[oidOf(start.state, 'Fork Bear')],
    );
  });

  it('deep copies to an equal but detached state', () => {
    const start = position();
    const copy = deepCopy(start.state);
    expect(copy).not.toBe(start.state);
    expect(stateFingerprint(copy)).toBe(stateFingerprint(start.state));
  });
});
