/** Primal Cocoon watches its live attached creature through combat and upkeep. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { GameEvent, GameState, ObjectId, Trace } from '@mtg/kernel';
import {
  beginTrace,
  collectTriggers,
  moveObject,
  putTriggersOnStack,
  resolveTop,
  scenario,
} from '@mtg/kernel';
import { attachAuraTo } from '../src/attach';
import { creature } from './cards';
import { handOidOf, oidOf } from './helpers';

const PRIMAL_COCOON = parseCard({
  kind: 'enchantment',
  id: 'm11-primal-cocoon',
  name: 'Primal Cocoon',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 191 },
  manaCost: { G: 1 },
  colors: ['G'],
  subtypes: ['Aura'],
  aura: { enchant: 'creature', modifications: [] },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 1,
          target: { kind: 'enchantedCreature' },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'enchantedCreatureAttacksOrBlocks',
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfPermanent' } }],
    },
  ],
});

const HOST = creature('Cocoon Host', 2, 2);
const OTHER = creature('Other Creature', 2, 2);
const ATTACKER = creature('Attacking Creature', 2, 2);

function attachedBoard(): { readonly state: GameState; readonly aura: ObjectId; readonly host: ObjectId } {
  const start = scenario({
    battlefield: [
      { card: HOST, controller: 0, summoningSick: false },
      { card: OTHER, controller: 0, summoningSick: false },
      { card: ATTACKER, controller: 1, summoningSick: false },
    ],
    hands: [[PRIMAL_COCOON], []],
  }).state;
  const aura = handOidOf(start, 0, 'Primal Cocoon');
  const host = oidOf(start, 'Cocoon Host');
  const entered = moveObject(beginTrace(start), aura, 'battlefield', { auraHost: host });
  return { state: entered.state, aura, host };
}

function triggersFor(state: GameState, event: GameEvent) {
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return collectTriggers(trace, 0);
}

describe('Primal Cocoon in the kernel', () => {
  it('puts one counter on the current host at its controller upkeep', () => {
    const { state, host } = attachedBoard();
    const fired = triggersFor(state, {
      type: 'stepBegan',
      turn: state.turn.number,
      active: 0,
      step: 'upkeep',
    });
    expect(fired.map(({ index }) => index)).toEqual([0]);

    const resolved = resolveTop(putTriggersOnStack(beginTrace(state), fired));
    expect(resolved.state.objects[host]?.counters.plusOnePlusOne).toBe(1);
  });

  it('watches only its current host when attackers are declared', () => {
    const { state, aura, host } = attachedBoard();
    const other = oidOf(state, 'Other Creature');
    const hostTriggers = triggersFor(state, {
      type: 'attackersDeclared',
      player: 0,
      attacks: [{ oid: host, defender: 1 }],
    });
    const otherTriggers = triggersFor(state, {
      type: 'attackersDeclared',
      player: 0,
      attacks: [{ oid: other, defender: 1 }],
    });
    expect(hostTriggers.map(({ sourceOid, index }) => [sourceOid, index])).toEqual([[aura, 1]]);
    expect(otherTriggers).toEqual([]);
  });

  it('fires once when a host blocks more than one attacker', () => {
    const { state, aura, host } = attachedBoard();
    const first = oidOf(state, 'Attacking Creature');
    const second = oidOf(state, 'Other Creature');
    const fired = triggersFor(state, {
      type: 'blockersDeclared',
      player: 0,
      blocks: [
        { attacker: first, blockers: [host] },
        { attacker: second, blockers: [host] },
      ],
    });
    expect(fired.map(({ sourceOid, index }) => [sourceOid, index])).toEqual([[aura, 1]]);
  });

  it('follows reattachment and ignores an unattached Aura', () => {
    const { state, aura } = attachedBoard();
    const other = oidOf(state, 'Other Creature');
    const moved = attachAuraTo(beginTrace(state), aura, other).state;
    expect(
      triggersFor(moved, {
        type: 'attackersDeclared',
        player: 0,
        attacks: [{ oid: other, defender: 1 }],
      }),
    ).toHaveLength(1);

    const currentAura = moved.objects[aura];
    if (currentAura === undefined) throw new Error('Primal Cocoon object disappeared');
    const { attachedTo: _attachedTo, ...unattachedAura } = currentAura;
    const unattached: GameState = {
      ...moved,
      objects: { ...moved.objects, [aura]: unattachedAura },
    };
    expect(
      triggersFor(unattached, {
        type: 'attackersDeclared',
        player: 0,
        attacks: [{ oid: other, defender: 1 }],
      }),
    ).toEqual([]);
  });

  it('sacrifices after becoming unattached but not after returning as a new object', () => {
    const { state, aura, host } = attachedBoard();
    const fired = triggersFor(state, {
      type: 'attackersDeclared',
      player: 0,
      attacks: [{ oid: host, defender: 1 }],
    });
    const onStack = putTriggersOnStack(beginTrace(state), fired);
    const currentAura = onStack.state.objects[aura];
    if (currentAura === undefined) throw new Error('Primal Cocoon object disappeared');
    const { attachedTo: _attachedTo, ...unattachedAura } = currentAura;
    const unattached: GameState = {
      ...onStack.state,
      objects: {
        ...onStack.state.objects,
        [aura]: unattachedAura,
      },
    };
    expect(resolveTop(beginTrace(unattached)).state.objects[aura]?.zone).toBe('graveyard');

    const returned = moveObject(moveObject(onStack, aura, 'exile'), aura, 'battlefield', {
      auraHost: host,
    });
    expect(resolveTop(returned).state.objects[aura]?.zone).toBe('battlefield');
  });
});
