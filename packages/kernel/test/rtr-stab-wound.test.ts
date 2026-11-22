/** Dynamic Aura-host controller semantics for RTR #78, Stab Wound. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import type { GameEvent, GameState, ObjectId, Trace } from '@mtg/kernel';
import {
  beginTrace,
  collectTriggers,
  moveObject,
  powerOf,
  putTriggersOnStack,
  resolveTop,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { creature } from './cards';
import { handOidOf, oidOf } from './helpers';

const STAB_WOUND = parseCard({
  kind: 'enchantment',
  id: 'rtr-078-stab-wound-kernel',
  name: 'Stab Wound',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 78 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'statBonus', power: -2, toughness: -2 }],
    printedModificationsBeforeAbilities: true,
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsEnchantedCreatureController: true,
      effects: [{ kind: 'loseLife', amount: 2, target: { kind: 'triggeringPlayer' } }],
    },
  ],
});

const HOST = creature('Stab Wound Host', 5, 5);
const OTHER = creature('Stab Wound Control', 3, 3);

function attachedBoard(): { readonly state: GameState; readonly aura: ObjectId; readonly host: ObjectId } {
  const start = scenario({
    life: [17, 19],
    battlefield: [
      { card: HOST, controller: 1 },
      { card: OTHER, controller: 0 },
    ],
    hands: [[STAB_WOUND], []],
  }).state;
  const aura = handOidOf(start, 0, STAB_WOUND.name);
  const host = oidOf(start, HOST.name);
  return { state: moveObject(beginTrace(start), aura, 'battlefield', { auraHost: host }).state, aura, host };
}

function triggersFor(state: GameState, active: 0 | 1) {
  const event: GameEvent = {
    type: 'stepBegan',
    turn: state.turn.number,
    active,
    step: 'upkeep',
  };
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return collectTriggers(trace, 0);
}

describe('Stab Wound in the kernel', () => {
  it('shrinks only its live host and fires only on that creatures controller upkeep', () => {
    const { state, aura, host } = attachedBoard();
    const other = oidOf(state, OTHER.name);
    expect([powerOf(state, host), toughnessOf(state, host)]).toEqual([3, 3]);
    expect([powerOf(state, other), toughnessOf(state, other)]).toEqual([3, 3]);
    expect(triggersFor(state, 0)).toEqual([]);

    const fired = triggersFor(state, 1);
    expect(
      fired.map(({ sourceOid, controller, triggeringPlayer }) => ({
        sourceOid,
        controller,
        triggeringPlayer,
      })),
    ).toEqual([{ sourceOid: aura, controller: 0, triggeringPlayer: 1 }]);
    const resolved = resolveTop(putTriggersOnStack(beginTrace(state), fired));
    expect(resolved.state.players.map(({ life }) => life)).toEqual([17, 17]);
  });

  it('re-reads host control independently of Aura control before the upkeep begins', () => {
    const { state, aura, host } = attachedBoard();
    const changed: GameState = {
      ...state,
      objects: {
        ...state.objects,
        [aura]: { ...state.objects[aura]!, controller: 1 },
        [host]: { ...state.objects[host]!, controller: 0 },
      },
    };
    expect(triggersFor(changed, 1)).toEqual([]);
    const fired = triggersFor(changed, 0);
    expect(fired.map(({ controller, triggeringPlayer }) => ({ controller, triggeringPlayer }))).toEqual([
      { controller: 1, triggeringPlayer: 0 },
    ]);
    const resolved = resolveTop(putTriggersOnStack(beginTrace(changed), fired));
    expect(resolved.state.players.map(({ life }) => life)).toEqual([15, 19]);
  });

  it('does not fire after the Aura becomes unattached', () => {
    const { state, aura } = attachedBoard();
    const current = state.objects[aura];
    if (current === undefined) throw new Error('Stab Wound disappeared');
    const { attachedTo: _attachedTo, ...unattachedAura } = current;
    const unattached: GameState = {
      ...state,
      objects: { ...state.objects, [aura]: unattachedAura },
    };
    expect(triggersFor(unattached, 1)).toEqual([]);
  });
});
