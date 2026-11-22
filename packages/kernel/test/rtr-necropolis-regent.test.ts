/** Retained damage source and amount probes for RTR Necropolis Regent. */
import { parseCard } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  collectTriggers,
  getObject,
  moveObject,
  putTriggersOnStack,
  resolveTop,
  scenario,
  type DamageInstance,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { damageToPlayer, replacement, withReplacements } from './continuous-helpers';
import { oidOf } from './helpers';

const NECROPOLIS_REGENT = parseCard({
  kind: 'creature',
  id: 'rtr-071-necropolis-regent-kernel',
  name: 'Necropolis Regent',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 71 },
  manaCost: { generic: 3, B: 3 },
  colors: ['B'],
  subtypes: ['Vampire'],
  power: 6,
  toughness: 5,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'controlledCreatureDealsCombatDamageToPlayer',
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: { kind: 'triggeringDamageAmount' },
          target: { kind: 'triggeringCreature' },
        },
      ],
    },
  ],
});

const STRIKER = creature('Regent Striker', 3, 3);
const ENEMY = creature('Enemy Striker', 2, 2);

function setup(): ReduceResult {
  return scenario({
    battlefield: [
      { card: NECROPOLIS_REGENT, controller: 0 },
      { card: STRIKER, controller: 0 },
      { card: ENEMY, controller: 1 },
    ],
  });
}

function damage(
  sourceOid: ObjectId,
  combat = true,
  recipient: DamageInstance['recipient'] = { kind: 'player', player: 1 },
  controller: 0 | 1 = 0,
): DamageInstance {
  return {
    sourceOid,
    controller,
    recipient,
    amount: 3,
    deathtouch: false,
    lifelink: false,
    preventable: true,
    combat,
  };
}

function combatDamage(start: ReduceResult, sourceOid: ObjectId, amount = 3): ReduceResult {
  return applyDamage(beginTrace(start.state), [{ ...damage(sourceOid), amount }]);
}

describe('Necropolis Regent combat-damage trigger', () => {
  it('retains each controlled damage source incarnation and final amount without targeting', () => {
    const start = setup();
    const striker = oidOf(start.state, STRIKER.name);
    const damaged = combatDamage(start, striker);
    const triggers = collectTriggers(damaged, 0);
    const stacked = putTriggersOnStack(damaged, triggers);

    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      condition: 'controlledCreatureDealsCombatDamageToPlayer',
      triggeringCreature: striker,
      triggeringDamageAmount: 3,
    });
    expect(stacked.state.stack.at(-1)).toMatchObject({
      targets: [],
      triggerContext: {
        kind: 'controlledCreatureDealsCombatDamageToPlayer',
        triggeringCreature: striker,
        triggeringDamageAmount: 3,
      },
    });
    expect(getObject(resolveTop(stacked).state, striker).counters.plusOnePlusOne).toBe(3);
  });

  it('ignores opposing sources, noncombat damage, and combat damage to a permanent', () => {
    const start = setup();
    const own = oidOf(start.state, STRIKER.name);
    const enemy = oidOf(start.state, ENEMY.name);
    const regent = oidOf(start.state, NECROPOLIS_REGENT.name);

    expect(
      collectTriggers(applyDamage(beginTrace(start.state), [damage(enemy, true, undefined, 1)]), 0),
    ).toEqual([]);
    expect(collectTriggers(applyDamage(beginTrace(start.state), [{ ...damage(own, false) }]), 0)).toEqual([]);
    expect(
      collectTriggers(
        applyDamage(beginTrace(start.state), [
          { ...damage(own, true, { kind: 'permanent', oid: regent }), amount: 1 },
        ]),
        0,
      ),
    ).toEqual([]);
  });

  it('uses the final post-replacement amount and ignores fully prevented or zero damage', () => {
    const start = setup();
    const striker = oidOf(start.state, STRIKER.name);
    const partial = withReplacements(start.state, [
      replacement(damageToPlayer(1), { kind: 'preventDamage', amount: 1 }),
    ]);
    const damaged = applyDamage(beginTrace(partial), [{ ...damage(striker), amount: 4 }]);
    const stacked = putTriggersOnStack(damaged, collectTriggers(damaged, 0));
    expect(getObject(resolveTop(stacked).state, striker).counters.plusOnePlusOne).toBe(3);

    const full = withReplacements(start.state, [
      replacement(damageToPlayer(1), { kind: 'preventDamage', amount: 'all' }),
    ]);
    expect(collectTriggers(applyDamage(beginTrace(full), [{ ...damage(striker), amount: 4 }]), 0)).toEqual(
      [],
    );
    expect(
      collectTriggers(applyDamage(beginTrace(start.state), [{ ...damage(striker), amount: 0 }]), 0),
    ).toEqual([]);
  });

  it('resolves after Regent leaves but does not follow a departed damage source incarnation', () => {
    const start = setup();
    const striker = oidOf(start.state, STRIKER.name);
    const regent = oidOf(start.state, NECROPOLIS_REGENT.name);
    const damaged = combatDamage(start, striker, 2);
    const stacked = putTriggersOnStack(damaged, collectTriggers(damaged, 0));
    const sourceGone = moveObject(stacked, regent, 'graveyard');
    expect(getObject(resolveTop(sourceGone).state, striker).counters.plusOnePlusOne).toBe(2);

    const strikerGone = moveObject(stacked, striker, 'graveyard');
    const strikerReturned = moveObject(strikerGone, striker, 'battlefield');
    expect(getObject(resolveTop(strikerReturned).state, striker).counters.plusOnePlusOne ?? 0).toBe(0);
  });
});
