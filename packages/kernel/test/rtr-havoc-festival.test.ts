/** Live retained-player half-life and static prohibition proofs for Havoc Festival. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  gainLife,
  loseLife,
  moveObject,
  putTriggersOnStack,
  resolveTop,
  scenario,
  type GameState,
  type PlayerId,
  type Step,
  type Trace,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { oidOf } from './helpers';

const HAVOC_FESTIVAL = parseCard({
  kind: 'enchantment',
  id: 'rtr-166-havoc-festival-kernel',
  name: 'Havoc Festival',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 166 },
  manaCost: { generic: 4, B: 1, R: 1 },
  colors: ['B', 'R'],
  abilities: [
    { kind: 'staticGameRule', rule: 'playersCantGainLife' },
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      effects: [
        {
          kind: 'loseLife',
          amount: 0,
          amountFrom: 'triggeringPlayerLifeHalfRoundedUp',
          target: { kind: 'triggeringPlayer' },
        },
      ],
    },
  ],
});

function position(active: PlayerId, life: readonly [number, number]): GameState {
  return scenario({
    active,
    step: 'upkeep',
    life,
    battlefield: [{ card: HAVOC_FESTIVAL, controller: 0 }],
  }).state;
}

function triggersAt(state: GameState, active: PlayerId, step: Step) {
  const event = { type: 'stepBegan', turn: state.turn.number, step, active } as const;
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return collectTriggers(trace, 0);
}

function resolveUpkeep(state: GameState, active: PlayerId): Trace {
  return resolveTop(putTriggersOnStack(beginTrace(state), triggersAt(state, active, 'upkeep')));
}

describe('Havoc Festival in the kernel', () => {
  it('fires once for the active player at each upkeep and nowhere else', () => {
    const first = position(0, [9, 8]);
    const second = position(1, [9, 8]);

    expect(triggersAt(first, 0, 'upkeep')).toHaveLength(1);
    expect(triggersAt(second, 1, 'upkeep')).toHaveLength(1);
    expect(triggersAt(first, 0, 'precombatMain')).toEqual([]);
    expect(resolveUpkeep(first, 0).state.players.map(({ life }) => life)).toEqual([4, 8]);
    expect(resolveUpkeep(second, 1).state.players.map(({ life }) => life)).toEqual([9, 4]);
  });

  it('rounds odd life up, takes the live total at resolution, and can reduce one to zero', () => {
    const odd = resolveUpkeep(position(0, [7, 20]), 0);
    const one = resolveUpkeep(position(1, [20, 1]), 1);
    const liveState = position(1, [20, 9]);
    const stacked = putTriggersOnStack(beginTrace(liveState), triggersAt(liveState, 1, 'upkeep'));
    const changed = loseLife(stacked, 1, 2);
    const live = resolveTop(changed);

    expect(odd.state.players[0].life).toBe(3);
    expect(one.state.players[1].life).toBe(0);
    expect(live.state.players[1].life).toBe(3);
  });

  it('retains the upkeep player and survives source departure after triggering', () => {
    const state = position(1, [20, 11]);
    const stacked = putTriggersOnStack(beginTrace(state), triggersAt(state, 1, 'upkeep'));
    const departed = moveObject(stacked, oidOf(stacked.state, HAVOC_FESTIVAL.name), 'graveyard');
    const done = resolveTop(departed);

    expect(done.state.players.map(({ life }) => life)).toEqual([20, 5]);
    expect(stacked.state.stack.at(-1)?.targets).toEqual([]);
  });

  it('prohibits either player gaining life only while the source remains active', () => {
    const state = position(0, [7, 9]);
    const denied = gainLife(beginTrace(state), 1, 4, false);
    const departed = moveObject(denied, oidOf(denied.state, HAVOC_FESTIVAL.name), 'graveyard');
    const allowed = gainLife(departed, 1, 4, false);

    expect(denied.state.players[1].life).toBe(9);
    expect(allowed.state.players[1].life).toBe(13);
  });
});
