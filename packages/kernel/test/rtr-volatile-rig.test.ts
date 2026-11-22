/** Native deterministic coin branches for RTR Volatile Rig. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  collectTriggers,
  eventsOfType,
  moveObject,
  nextBelow,
  putTriggersOnStack,
  resolveTop,
  scenario,
  type DamageInstance,
  type GameState,
  type ObjectId,
  type ReduceResult,
  type Trace,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { oidOf } from './helpers';

const DAMAGE_EVERYTHING = {
  kind: 'dealDamage',
  amount: 4,
  scope: 'allPermanents',
  scopeFilter: { cardTypes: ['creature'] },
  players: 'eachPlayer',
  target: { kind: 'noTarget' },
} as const;

const VOLATILE_RIG = parseCard({
  kind: 'creature',
  id: 'rtr-236-volatile-rig-kernel',
  name: 'Volatile Rig',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 236 },
  manaCost: { generic: 4 },
  colors: [],
  artifact: true,
  subtypes: ['Construct'],
  keywords: ['trample'],
  power: 4,
  toughness: 4,
  abilities: [
    { kind: 'static', scope: 'self', modification: { kind: 'attacksEachCombatIfAble' } },
    {
      kind: 'triggered',
      condition: 'selfIsDealtDamage',
      effects: [
        {
          kind: 'flipCoin',
          loseEffects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [{ kind: 'flipCoin', loseEffects: [DAMAGE_EVERYTHING] }],
    },
  ],
} as CardInput);

const SURVIVOR = creature('Damage Sweep Survivor', 5, 5);

function board(seed: string): ReduceResult {
  return scenario({
    seed,
    active: 0,
    step: 'precombatMain',
    battlefield: [
      { card: VOLATILE_RIG, controller: 0 },
      { card: SURVIVOR, controller: 0 },
      { card: SURVIVOR, controller: 1 },
    ],
  });
}

function seedFor(result: 'win' | 'loss'): string {
  for (let index = 0; index < 200; index += 1) {
    const seed = `volatile-rig/${result}/${String(index)}`;
    const [pick] = nextBelow(board(seed).state.rng, 2);
    if ((pick === 1 ? 'win' : 'loss') === result) return seed;
  }
  throw new Error(`no deterministic ${result} seed found`);
}

function damage(rig: ObjectId, amount = 1): DamageInstance {
  return {
    sourceOid: 'volatile-rig-test-source',
    controller: 1,
    recipient: { kind: 'permanent', oid: rig },
    amount,
    deathtouch: false,
    lifelink: false,
    preventable: true,
    combat: false,
  };
}

function stackTriggers(trace: Trace, since = 0): Trace {
  return putTriggersOnStack(trace, collectTriggers(trace, since));
}

function damageTrigger(state: GameState, rig: ObjectId): Trace {
  return stackTriggers(applyDamage(beginTrace(state), [damage(rig)]));
}

describe('Volatile Rig damage trigger', () => {
  it('fires without a chosen-player entry link and sacrifices only on a loss', () => {
    const loss = board(seedFor('loss'));
    const lossRig = oidOf(loss.state, VOLATILE_RIG.name);
    const stackedLoss = damageTrigger(loss.state, lossRig);
    const lost = resolveTop(stackedLoss);

    expect(eventsOfType(lost.events, 'coinFlipped')).toEqual([
      { type: 'coinFlipped', player: 0, sourceOid: lossRig, result: 'loss' },
    ]);
    expect(lost.state.objects[lossRig]?.zone).toBe('graveyard');
    expect(collectTriggers(lost, stackedLoss.events.length).map((trigger) => trigger.condition)).toEqual([
      'selfDies',
    ]);

    const win = board(seedFor('win'));
    const winRig = oidOf(win.state, VOLATILE_RIG.name);
    const won = resolveTop(damageTrigger(win.state, winRig));
    expect(eventsOfType(won.events, 'coinFlipped')[0]?.result).toBe('win');
    expect(won.state.objects[winRig]?.zone).toBe('battlefield');
    expect(eventsOfType(won.events, 'permanentSacrificed')).toEqual([]);
  });

  it('creates one trigger per positive damage event and none for zero damage', () => {
    const start = board('volatile-rig/event-count');
    const rig = oidOf(start.state, VOLATILE_RIG.name);
    const twice = applyDamage(beginTrace(start.state), [damage(rig, 1), damage(rig, 2)]);
    expect(collectTriggers(twice, 0).map((trigger) => trigger.condition)).toEqual([
      'selfIsDealtDamage',
      'selfIsDealtDamage',
    ]);
    expect(collectTriggers(applyDamage(beginTrace(start.state), [damage(rig, 0)]), 0)).toEqual([]);
  });
});

describe('Volatile Rig death trigger', () => {
  it('on a loss deals one simultaneous batch of four to each creature and player from LKI', () => {
    const start = board(seedFor('loss'));
    const rig = oidOf(start.state, VOLATILE_RIG.name);
    const departed = moveObject(beginTrace(start.state), rig, 'graveyard');
    const stacked = stackTriggers(departed);
    const resolved = resolveTop(beginTrace(stacked.state));

    expect(eventsOfType(resolved.events, 'coinFlipped')).toEqual([
      { type: 'coinFlipped', player: 0, sourceOid: rig, result: 'loss' },
    ]);
    expect(resolved.state.players.map((player) => player.life)).toEqual([16, 16]);
    expect(eventsOfType(resolved.events, 'damageDealt').map((event) => event.amount)).toEqual([4, 4, 4, 4]);
    expect(eventsOfType(resolved.events, 'damageDealt').map((event) => event.sourceOid)).toEqual([
      rig,
      rig,
      rig,
      rig,
    ]);
  });

  it('on a win leaves every creature and player untouched', () => {
    const start = board(seedFor('win'));
    const rig = oidOf(start.state, VOLATILE_RIG.name);
    const departed = moveObject(beginTrace(start.state), rig, 'graveyard');
    const resolved = resolveTop(beginTrace(stackTriggers(departed).state));

    expect(eventsOfType(resolved.events, 'coinFlipped')[0]?.result).toBe('win');
    expect(resolved.state.players.map((player) => player.life)).toEqual([20, 20]);
    expect(eventsOfType(resolved.events, 'damageDealt')).toEqual([]);
  });
});
