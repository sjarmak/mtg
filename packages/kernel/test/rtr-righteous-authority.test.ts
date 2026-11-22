/** Live hand-size and draw-step probes for RTR #189, Righteous Authority. */
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

const AUTHORITY = parseCard({
  kind: 'enchantment',
  id: 'rtr-189-righteous-authority-kernel',
  name: 'Righteous Authority',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 189 },
  manaCost: { generic: 3, W: 1, U: 1 },
  colors: ['W', 'U'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [],
    enchantedControllerHandSizeBonus: true,
    printedModificationsBeforeAbilities: true,
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsEnchantedCreatureController: true,
      enchantedControllerDrawStepAdditionalDraw: true,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'triggeringPlayer' } }],
    },
  ],
});

const HOST = creature('Authority Host', 2, 2);
const OWN_HAND_A = creature('Authority Hand A', 1, 1);
const OWN_HAND_B = creature('Authority Hand B', 1, 1);
const DRAW = creature('Authority Draw', 1, 1);

function attachedBoard(): { readonly state: GameState; readonly aura: ObjectId; readonly host: ObjectId } {
  const start = scenario({
    battlefield: [{ card: HOST, controller: 1 }],
    hands: [[AUTHORITY], [OWN_HAND_A, OWN_HAND_B]],
    libraries: [[], [DRAW]],
  }).state;
  const aura = handOidOf(start, 0, AUTHORITY.name);
  const host = oidOf(start, HOST.name);
  return { state: moveObject(beginTrace(start), aura, 'battlefield', { auraHost: host }).state, aura, host };
}

function stepTriggers(state: GameState, active: 0 | 1, step: 'upkeep' | 'draw') {
  const event: GameEvent = { type: 'stepBegan', turn: state.turn.number, active, step };
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return collectTriggers(trace, 0);
}

describe('Righteous Authority in the kernel', () => {
  it('reads the live hand of only the enchanted creature controller', () => {
    const { state, host } = attachedBoard();
    expect([powerOf(state, host), toughnessOf(state, host)]).toEqual([4, 4]);

    const drawn = moveObject(beginTrace(state), state.players[1].library[0]!, 'hand').state;
    expect([powerOf(drawn, host), toughnessOf(drawn, host)]).toEqual([5, 5]);

    const changed: GameState = {
      ...drawn,
      objects: { ...drawn.objects, [host]: { ...drawn.objects[host]!, controller: 0 } },
    };
    expect([powerOf(changed, host), toughnessOf(changed, host)]).toEqual([2, 2]);
  });

  it('fires at the host controllers draw step, draws for that player, and not at upkeep', () => {
    const { state, aura } = attachedBoard();
    expect(stepTriggers(state, 1, 'upkeep')).toEqual([]);
    expect(stepTriggers(state, 0, 'draw')).toEqual([]);

    const fired = stepTriggers(state, 1, 'draw');
    expect(
      fired.map(({ sourceOid, controller, triggeringPlayer }) => ({
        sourceOid,
        controller,
        triggeringPlayer,
      })),
    ).toEqual([{ sourceOid: aura, controller: 0, triggeringPlayer: 1 }]);
    const resolved = resolveTop(putTriggersOnStack(beginTrace(state), fired));
    expect(resolved.state.players.map(({ hand }) => hand.length)).toEqual([0, 3]);
  });

  it('loses both capabilities when the Aura leaves', () => {
    const { state, aura, host } = attachedBoard();
    const gone = moveObject(beginTrace(state), aura, 'graveyard').state;
    expect([powerOf(gone, host), toughnessOf(gone, host)]).toEqual([2, 2]);
    expect(stepTriggers(gone, 1, 'draw')).toEqual([]);
  });
});
