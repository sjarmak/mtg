/** Native execution proofs for all three M11 Ajani Goldmane loyalty abilities. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput, type TokenSpec } from '@mtg/dsl';
import {
  beginTrace,
  checkStateBasedActions,
  cleanupTurnEffects,
  controllerOf,
  counterCount,
  eventsOfType,
  hasKeyword,
  legalActions,
  moveObject,
  objectFilter,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  setLife,
  toughnessOf,
  type Action,
  type ControlEffect,
  type GameState,
} from '@mtg/kernel';
import { creature } from './cards';
import { oidOf } from './helpers';

const AVATAR = {
  identity: 'avatar-life-total',
  name: 'Avatar',
  power: 0,
  toughness: 0,
  characteristicPowerToughness: { kind: 'controllerLifeTotal' },
  colors: ['W'],
  subtypes: ['Avatar'],
  keywords: [],
} satisfies TokenSpec;

const AJANI = parseCard({
  kind: 'planeswalker',
  id: 'm11-ajani-goldmane',
  name: 'Ajani Goldmane',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 1 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  supertypes: ['legendary'],
  subtypes: ['Ajani'],
  startingLoyalty: 4,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -1,
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          keyword: 'vigilance',
          target: { kind: 'noTarget' },
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -6,
      effects: [{ kind: 'createToken', count: 1, token: AVATAR }],
    },
  ],
} satisfies CardInput);

const PLATINUM_ANGEL = parseCard({
  kind: 'creature',
  id: 'm11-ajani-probe-platinum-angel',
  name: 'Ajani Probe Platinum Angel',
  rarity: 'mythic',
  set: { code: 'PRB', collectorNumber: 1 },
  colors: [],
  manaCost: { generic: 7 },
  artifact: true,
  power: 4,
  toughness: 4,
  subtypes: ['Angel'],
  keywords: ['flying'],
  abilities: [{ kind: 'staticGameRule', rule: 'controllerCantLoseAndOpponentsCantWin' }],
});

const PASSES: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function activation(state: GameState, abilityIndex: number) {
  const found = legalActions(state).find(
    (action) => action.type === 'activateAbility' && action.abilityIndex === abilityIndex,
  );
  if (found === undefined || found.type !== 'activateAbility') {
    throw new Error(`Ajani ability ${String(abilityIndex)} was not offered`);
  }
  return found;
}

function resolve(state: GameState, abilityIndex: number): GameState {
  return reduceAll(reduce(state, activation(state, abilityIndex)).state, PASSES).state;
}

function loyalty(state: GameState): number {
  const oid = oidOf(state, AJANI.name);
  const counters = state.objects[oid]?.counters;
  if (counters === undefined) throw new Error('Ajani left the probe unexpectedly');
  return counterCount(counters, 'loyalty');
}

describe('Ajani Goldmane', () => {
  it('gains two life and adds one loyalty', () => {
    const start = scenario({ life: [7, 20], battlefield: [{ card: AJANI, controller: 0 }] }).state;
    const done = resolve(start, 0);
    expect(done.players[0].life).toBe(9);
    expect(loyalty(done)).toBe(5);
  });

  it('puts permanent counters and temporary vigilance on exactly the resolution cohort', () => {
    const ally = creature('Ajani Probe Ally', 2, 2);
    const rival = creature('Ajani Probe Rival', 2, 2);
    const lateCard = creature('Ajani Probe Latecomer', 2, 2);
    const start = scenario({
      battlefield: [
        { card: AJANI, controller: 0, loyalty: 8 },
        { card: ally, controller: 0 },
        { card: rival, controller: 1 },
      ],
      hands: [[lateCard], []],
    }).state;
    const allyOid = oidOf(start, ally.name);
    const rivalOid = oidOf(start, rival.name);
    const lateOid = start.players[0].hand[0];
    if (lateOid === undefined) throw new Error('Ajani probe lost its late creature');

    const resolved = resolve(start, 1);
    expect(counterCount(resolved.objects[allyOid]!.counters, 'plusOnePlusOne')).toBe(1);
    expect(hasKeyword(resolved, allyOid, 'vigilance')).toBe(true);
    expect(counterCount(resolved.objects[rivalOid]!.counters, 'plusOnePlusOne')).toBe(0);
    expect(hasKeyword(resolved, rivalOid, 'vigilance')).toBe(false);

    const withLatecomer = moveObject(beginTrace(resolved), lateOid, 'battlefield', { controller: 0 }).state;
    expect(counterCount(withLatecomer.objects[lateOid]!.counters, 'plusOnePlusOne')).toBe(0);
    expect(hasKeyword(withLatecomer, lateOid, 'vigilance')).toBe(false);

    const cleaned = cleanupTurnEffects(beginTrace(resolved)).state;
    expect(counterCount(cleaned.objects[allyOid]!.counters, 'plusOnePlusOne')).toBe(1);
    expect(hasKeyword(cleaned, allyOid, 'vigilance')).toBe(false);

    const left = moveObject(beginTrace(resolved), allyOid, 'hand');
    const returned = moveObject(left, allyOid, 'battlefield', { controller: 0 }).state;
    expect(counterCount(returned.objects[allyOid]!.counters, 'plusOnePlusOne')).toBe(0);
    expect(hasKeyword(returned, allyOid, 'vigilance')).toBe(false);
  });

  it('creates a life-linked Avatar that follows life and control, then dies at zero toughness', () => {
    const start = scenario({
      life: [7, 13],
      battlefield: [
        { card: AJANI, controller: 0, loyalty: 8 },
        { card: PLATINUM_ANGEL, controller: 1 },
      ],
    }).state;
    const created = resolve(start, 2);
    const avatar = oidOf(created, AVATAR.name);
    expect([powerOf(created, avatar), toughnessOf(created, avatar)]).toEqual([7, 7]);

    const control: ControlEffect = {
      id: 'ajani-avatar-control',
      kind: 'control',
      layer: '2',
      affects: objectFilter({ oids: [avatar] }),
      controller: 1,
      duration: 'permanent',
      timestamp: created.nextId,
      sourceOid: avatar,
      enabledWhile: null,
    };
    const stolen = { ...created, continuous: [...created.continuous, control] };
    expect(controllerOf(stolen, avatar)).toBe(1);
    expect([powerOf(stolen, avatar), toughnessOf(stolen, avatar)]).toEqual([13, 13]);

    const wounded = setLife(beginTrace(stolen), 1, 5).state;
    expect([powerOf(wounded, avatar), toughnessOf(wounded, avatar)]).toEqual([5, 5]);

    const zero = setLife(beginTrace(wounded), 1, 0);
    const settled = checkStateBasedActions(zero);
    expect(settled.state.battlefield).not.toContain(avatar);
    expect(eventsOfType(settled.events, 'permanentDestroyed')).toEqual([
      expect.objectContaining({ oid: avatar, reason: 'zeroToughness' }),
    ]);
  });
});
