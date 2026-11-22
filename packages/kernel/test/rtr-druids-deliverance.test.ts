/** Druid's Deliverance through the state-aware damage replacement pipeline. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  eventsOfType,
  reduce,
  reduceAll,
  scenario,
  type DamageInstance,
  type ObjectId,
  type ReduceResult,
  type Target,
} from '@mtg/kernel';
import { creature, FOREST, instant } from './cards';
import { handOidOf, oidOf } from './helpers';

const DELIVERANCE: Card = instant("Druid's Deliverance", [{ kind: 'preventCombatDamageToYou' }], {
  generic: 1,
  G: 1,
});

const PASSES = [
  { type: 'passPriority' as const, player: 0 as const },
  { type: 'passPriority' as const, player: 1 as const },
];

function castAndResolve(start: ReduceResult, targets: readonly (Target | null)[]): ReduceResult {
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, DELIVERANCE.name),
    targets,
  });
  const resolved = reduceAll(cast.state, PASSES);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function damage(
  sourceOid: ObjectId,
  recipient: DamageInstance['recipient'],
  combat: boolean,
): DamageInstance {
  return {
    sourceOid,
    controller: 1,
    recipient,
    amount: 3,
    deathtouch: false,
    lifelink: false,
    preventable: true,
    combat,
  };
}

describe("Druid's Deliverance in the kernel", () => {
  it('prevents only combat damage to its controller', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Protected Bear', 2, 5), controller: 0 },
        { card: creature('Outside Bear', 2, 5), controller: 1 },
        { card: creature('Damage Source', 1, 1), controller: 1 },
        { card: FOREST, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
      hands: [[DELIVERANCE], []],
    });
    const shielded = castAndResolve(start, [null]);
    const source = oidOf(shielded.state, 'Damage Source');
    const protectedBear = oidOf(shielded.state, 'Protected Bear');
    const outsideBear = oidOf(shielded.state, 'Outside Bear');

    const done = applyDamage(beginTrace(shielded.state), [
      damage(source, { kind: 'player', player: 0 }, true),
      damage(source, { kind: 'player', player: 1 }, true),
      damage(source, { kind: 'permanent', oid: protectedBear }, true),
      damage(source, { kind: 'permanent', oid: outsideBear }, true),
      damage(source, { kind: 'player', player: 0 }, false),
    ]);

    expect(done.state.players.map((player) => player.life)).toEqual([17, 17]);
    expect(done.state.objects[protectedBear]?.damage).toBe(3);
    expect(done.state.objects[outsideBear]?.damage).toBe(3);
    expect(eventsOfType(done.events, 'damagePrevented')).toHaveLength(1);
    expect(eventsOfType(done.events, 'damageDealt')).toHaveLength(4);
  });
});
