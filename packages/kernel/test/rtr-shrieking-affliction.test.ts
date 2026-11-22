/** Opponent-upkeep, intervening-if, and retained-player proofs for Shrieking Affliction. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  moveObject,
  putTriggersOnStack,
  resolveTop,
  scenario,
  type GameState,
  type PlayerId,
  type Trace,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { oidOf } from './helpers';

const SHRIEKING_AFFLICTION = parseCard({
  kind: 'enchantment',
  id: 'rtr-76-shrieking-affliction-kernel',
  name: 'Shrieking Affliction',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 76 },
  manaCost: { B: 1 },
  colors: ['B'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsOpponent: true,
      triggeringPlayerHandAtMost: 1,
      effects: [{ kind: 'loseLife', amount: 3, target: { kind: 'triggeringPlayer' } }],
    },
  ],
});

const HELD = creature('Affliction Held Card', 1, 1);
const DRAWN = creature('Affliction Drawn Card', 1, 1);

function copies(card: Card, count: number): readonly Card[] {
  return Array.from({ length: count }, () => card);
}

function position(active: PlayerId, activeHand: number, controller: PlayerId = 0): GameState {
  return scenario({
    battlefield: [{ card: SHRIEKING_AFFLICTION, controller }],
    active,
    step: 'upkeep',
    hands: active === 0 ? [copies(HELD, activeHand), []] : [[], copies(HELD, activeHand)],
    libraries: active === 0 ? [[DRAWN], []] : [[], [DRAWN]],
  }).state;
}

function upkeepTriggers(state: GameState, active: PlayerId): ReturnType<typeof collectTriggers> {
  const event = {
    type: 'stepBegan',
    turn: state.turn.number,
    step: 'upkeep',
    active,
  } as const;
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return collectTriggers(trace, 0);
}

function stackUpkeep(state: GameState, active: PlayerId): Trace {
  return putTriggersOnStack(beginTrace(state), upkeepTriggers(state, active));
}

describe('Shrieking Affliction in the kernel', () => {
  it('fires only on an opponent upkeep at the inclusive zero/one-card boundary', () => {
    expect(upkeepTriggers(position(1, 0), 1)).toHaveLength(1);
    expect(upkeepTriggers(position(1, 1), 1)).toHaveLength(1);
    expect(upkeepTriggers(position(1, 2), 1)).toEqual([]);
    expect(upkeepTriggers(position(0, 0), 0)).toEqual([]);
  });

  it('rechecks the active players hand as the intervening-if trigger resolves', () => {
    const stacked = stackUpkeep(position(1, 1), 1);
    const drawn = stacked.state.players[1].library[0];
    if (drawn === undefined) throw new Error('Affliction test library is empty');
    const refilled = moveObject(stacked, drawn, 'hand');
    const done = resolveTop(refilled);

    expect(done.state.players[1].hand).toHaveLength(2);
    expect(done.state.players[1].life).toBe(20);
  });

  it('retains the upkeep player as a non-target recipient through source control change', () => {
    const stacked = stackUpkeep(position(1, 1), 1);
    const source = oidOf(stacked.state, SHRIEKING_AFFLICTION.name);
    const changed: Trace = {
      ...stacked,
      state: {
        ...stacked.state,
        objects: {
          ...stacked.state.objects,
          [source]: { ...stacked.state.objects[source]!, controller: 1 as PlayerId },
        },
      },
    };
    const done = resolveTop(changed);

    expect(done.state.players.map(({ life }) => life)).toEqual([20, 17]);
    expect(stacked.state.stack.at(-1)?.targets).toEqual([]);
  });
});
