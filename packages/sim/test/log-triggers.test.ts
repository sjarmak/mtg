/**
 * `{owner}_turn_{N}_{side}_sim_triggers`, the triggered half of the ability log.
 *
 * 17lands publishes no trigger column, so this one is ours and carries the
 * `sim_` marker the schema header requires of everything we invent. It is the
 * companion to `abilities`: that column counts what a seat chose to activate,
 * this one counts what the kernel put on the stack on that seat's behalf.
 *
 * The count is asserted off the event log rather than off a policy, exactly as
 * `log-activations.test.ts` asserts its half. One `abilityTriggered` event is
 * one trigger, attributed to the player the event names — who controlled the
 * source as it triggered (CR 603.3a), which a death trigger makes distinct from
 * whoever controls the permanent afterwards.
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent, GameResult } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import type { MetadataInputs, SimGameLog } from '@mtg/sim';
import {
  buildExtras,
  buildGameLog,
  buildMetadata,
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  replayRow,
} from '@mtg/sim';

const RESULT: GameResult = {
  winner: 0,
  loser: 1,
  reason: 'lifeZero',
  endedOnTurn: 1,
};

const METADATA: MetadataInputs = {
  expansion: 'TST',
  eventType: 'SelfPlay',
  gameTime: '2026-01-01T00:00:00.000Z',
  runSeed: 'log-triggers',
  gameSeed: 'log-triggers/0',
  index: 0,
  decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
  botNames: ['greedy-rw', 'greedy-ub'],
  startingPlayer: 0,
  result: RESULT,
  decisions: 4,
  mulligans: [0, 0],
};

function logOver(events: readonly GameEvent[]): SimGameLog {
  return buildGameLog({
    events,
    finalState: scenario().state,
    endOfTurnStates: new Map(),
    metadata: buildMetadata(METADATA),
    extras: buildExtras(METADATA, 'lifeZero'),
  });
}

function triggered(
  player: 0 | 1,
  oid: string,
  condition: 'selfEnters' | 'selfDies' = 'selfEnters',
): GameEvent {
  return { type: 'abilityTriggered', player, oid, source: 'o1', index: 0, condition };
}

describe('the sim_triggers column', () => {
  it('counts one per trigger, on the side that controlled the source', () => {
    const log = logOver([
      { type: 'turnBegan', turn: 1, active: 0 },
      { type: 'stepBegan', turn: 1, step: 'precombatMain', active: 0 },
      triggered(0, 'ab7'),
      triggered(0, 'ab8'),
      triggered(1, 'ab9', 'selfDies'),
    ]);
    const [turn] = log.turns;
    expect(turn?.user.sim_triggers).toBe(2);
    expect(turn?.oppo.sim_triggers).toBe(1);
  });

  it('agrees with the event log it was built from', () => {
    const events: readonly GameEvent[] = [
      { type: 'turnBegan', turn: 1, active: 0 },
      triggered(0, 'ab2'),
      { type: 'turnBegan', turn: 2, active: 1 },
      triggered(0, 'ab4', 'selfDies'),
      triggered(1, 'ab5'),
      triggered(1, 'ab6'),
    ];
    const log = logOver(events);
    const emitted = events.filter((event) => event.type === 'abilityTriggered').length;
    const counted = log.turns.reduce((sum, turn) => sum + turn.user.sim_triggers + turn.oppo.sim_triggers, 0);
    expect(counted).toBe(emitted);
    expect(counted).toBe(4);
  });

  it('keeps the two halves apart, so neither column absorbs the other', () => {
    const log = logOver([
      { type: 'turnBegan', turn: 1, active: 0 },
      {
        type: 'abilityActivated',
        player: 0,
        oid: 'ab1',
        source: 'o1',
        index: 0,
        targets: [null],
        chosenX: null,
      },
      triggered(0, 'ab2'),
    ]);
    const [turn] = log.turns;
    expect(turn?.user.abilities).toBe(1);
    expect(turn?.user.sim_triggers).toBe(1);
  });

  it('reaches the wide row under the marked name', () => {
    const log = logOver([{ type: 'turnBegan', turn: 1, active: 0 }, triggered(0, 'ab1')]);
    expect(replayRow(log)['user_turn_1_user_sim_triggers']).toBe(1);
    expect(replayRow(log)['user_turn_1_oppo_sim_triggers']).toBe(0);
  });
});
