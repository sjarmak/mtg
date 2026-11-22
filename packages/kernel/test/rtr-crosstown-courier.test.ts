/** Native retained-player and damage-amount probes for RTR Crosstown Courier. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  collectTriggers,
  eventsOfType,
  playerOf,
  putTriggersOnStack,
  moveObject,
  resolveTop,
  scenario,
  type DamageInstance,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { damageToPlayer, replacement, withReplacements } from './continuous-helpers';
import { oidOf, playCombat } from './helpers';

const CROSSTOWN_COURIER = parseCard({
  kind: 'creature',
  id: 'rtr-034-crosstown-courier-kernel',
  name: 'Crosstown Courier',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 34 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Vedalken'],
  power: 2,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'millCards',
          count: { kind: 'triggeringDamageAmount' },
          target: { kind: 'triggeringPlayer' },
        },
      ],
    },
  ],
});

function deck(prefix: string, count = 6): readonly Card[] {
  return Array.from({ length: count }, (_, index) => creature(`${prefix} ${String(index)}`, 1, 1));
}

function setup(): ReduceResult {
  return scenario({
    seed: 'rtr-crosstown-courier',
    active: 0,
    step: 'declareAttackers',
    battlefield: [{ card: CROSSTOWN_COURIER, controller: 0 }],
    libraries: [deck('Courier controller'), deck('Courier defender')],
  });
}

function noncombatDamage(sourceOid: ObjectId): DamageInstance {
  return {
    sourceOid,
    controller: 0,
    recipient: { kind: 'player', player: 1 },
    amount: 2,
    deathtouch: false,
    lifelink: false,
    preventable: true,
    combat: false,
  };
}

describe('Crosstown Courier combat-damage trigger', () => {
  it('retains the damaged player and final damage amount without choosing a target', () => {
    const start = setup();
    const courier = oidOf(start.state, CROSSTOWN_COURIER.name);
    const damage = applyDamage(beginTrace(start.state), [
      { ...noncombatDamage(courier), combat: true, amount: 3 },
    ]);
    const triggers = collectTriggers(damage, 0);
    const stacked = putTriggersOnStack(damage, triggers);

    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      condition: 'selfDealsCombatDamageToPlayer',
      triggeringPlayer: 1,
      triggeringDamageAmount: 3,
    });
    expect(stacked.state.stack.at(-1)).toMatchObject({
      targets: [],
      triggerContext: {
        kind: 'selfDealsCombatDamageToPlayer',
        triggeringPlayer: 1,
        triggeringDamageAmount: 3,
      },
    });
  });

  it('mills exactly the combat damage from the damaged player', () => {
    const start = setup();
    const courier = oidOf(start.state, CROSSTOWN_COURIER.name);
    const beforeLibrary = playerOf(start.state, 1).library.length;
    const beforeGraveyard = playerOf(start.state, 1).graveyard.length;
    const done = playCombat(start, { attackers: [courier], blocks: [] });

    expect(playerOf(done.state, 1).life).toBe(18);
    expect(playerOf(done.state, 1).library).toHaveLength(beforeLibrary - 2);
    expect(playerOf(done.state, 1).graveyard).toHaveLength(beforeGraveyard + 2);
    expect(eventsOfType(done.events, 'cardsMilled').at(-1)).toMatchObject({ player: 1 });
    expect(eventsOfType(done.events, 'cardsMilled').at(-1)?.oids).toHaveLength(2);
  });

  it('does not trigger or mill for noncombat damage from the same source', () => {
    const start = setup();
    const courier = oidOf(start.state, CROSSTOWN_COURIER.name);
    const beforeLibrary = playerOf(start.state, 1).library;
    const damaged = applyDamage(beginTrace(start.state), [noncombatDamage(courier)]);

    expect(collectTriggers(damaged, 0)).toEqual([]);
    expect(playerOf(damaged.state, 1).library).toEqual(beforeLibrary);
    expect(eventsOfType(damaged.events, 'cardsMilled')).toEqual([]);
  });

  it('uses the final post-replacement damage amount and ignores fully prevented damage', () => {
    const start = setup();
    const courier = oidOf(start.state, CROSSTOWN_COURIER.name);
    const partial = withReplacements(start.state, [
      replacement(damageToPlayer(1), { kind: 'preventDamage', amount: 1 }),
    ]);
    const damaged = applyDamage(beginTrace(partial), [
      { ...noncombatDamage(courier), combat: true, amount: 3 },
    ]);
    const triggers = collectTriggers(damaged, 0);
    const before = playerOf(damaged.state, 1).library.length;
    const resolved = resolveTop(putTriggersOnStack(damaged, triggers));

    expect(triggers[0]?.triggeringDamageAmount).toBe(2);
    expect(playerOf(resolved.state, 1).library).toHaveLength(before - 2);

    const full = withReplacements(start.state, [
      replacement(damageToPlayer(1), { kind: 'preventDamage', amount: 'all' }),
    ]);
    const prevented = applyDamage(beginTrace(full), [
      { ...noncombatDamage(courier), combat: true, amount: 3 },
    ]);
    expect(collectTriggers(prevented, 0)).toEqual([]);
  });

  it('keeps the event amount and player after the source leaves', () => {
    const start = setup();
    const courier = oidOf(start.state, CROSSTOWN_COURIER.name);
    const damaged = applyDamage(beginTrace(start.state), [
      { ...noncombatDamage(courier), combat: true, amount: 3 },
    ]);
    const stacked = putTriggersOnStack(damaged, collectTriggers(damaged, 0));
    const departed = moveObject(stacked, courier, 'graveyard');
    const before = playerOf(departed.state, 1).library.length;
    const resolved = resolveTop(departed);

    expect(playerOf(resolved.state, 1).library).toHaveLength(before - 3);
  });
});
