/**
 * `{owner}_turn_{N}_{side}_abilities`, counted rather than declared zero.
 *
 * The column is 17lands' and it counts activated abilities. Before slice C the
 * kernel had none to count, so `schema.ts` listed it beside `cards_tutored` as
 * structurally zero and `@mtg/metrics`' join contract told a reader to exclude
 * it from any pooled statistic. Both sentences stopped being true the moment a
 * bot could pay for a printed ability, and a zero that looks structural and is
 * merely uncounted is the worst shape a joined column can take: the reader has
 * been told, in the shipped report, to trust it.
 *
 * So the count is asserted off the event log rather than off a policy. One
 * `abilityActivated` event is one activation, attributed to the seat that paid;
 * a mana ability produces no such event, which is the exclusion 17lands makes
 * too (CR 605.1: it does not use the stack).
 */
import { describe, expect, it } from 'vitest';
import { mana } from '@mtg/dsl';
import type { GameEvent, GameResult } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import type { MetadataInputs, SimGameLog } from '@mtg/sim';
import { buildExtras, buildGameLog, buildMetadata, FIXTURE_DECK_RW, FIXTURE_DECK_UB } from '@mtg/sim';

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
  runSeed: 'log-activations',
  gameSeed: 'log-activations/0',
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

function activation(player: 0 | 1, oid: string): GameEvent {
  return {
    type: 'abilityActivated',
    player,
    oid,
    source: 'o1',
    index: 0,
    targets: [null],
    chosenX: null,
  };
}

describe('the abilities column', () => {
  it('counts one per activation, on the side that paid', () => {
    const log = logOver([
      { type: 'turnBegan', turn: 1, active: 0 },
      { type: 'stepBegan', turn: 1, step: 'precombatMain', active: 0 },
      activation(0, 'ab7'),
      activation(0, 'ab8'),
      activation(1, 'ab9'),
    ]);
    const [turn] = log.turns;
    expect(turn?.user.abilities).toBe(2);
    expect(turn?.oppo.abilities).toBe(1);
  });

  it('agrees with the event log it was built from', () => {
    const events: readonly GameEvent[] = [
      { type: 'turnBegan', turn: 1, active: 0 },
      activation(0, 'ab2'),
      { type: 'turnBegan', turn: 2, active: 1 },
      activation(0, 'ab4'),
      activation(1, 'ab5'),
      activation(1, 'ab6'),
    ];
    const log = logOver(events);
    const emitted = events.filter((event) => event.type === 'abilityActivated').length;
    const counted = log.turns.reduce((sum, turn) => sum + turn.user.abilities + turn.oppo.abilities, 0);
    expect(counted).toBe(emitted);
    expect(counted).toBe(4);
  });

  it('leaves the intrinsic mana ability out, as 17lands does', () => {
    const log = logOver([
      { type: 'turnBegan', turn: 1, active: 0 },
      { type: 'manaProduced', player: 0, sourceOid: 'o3', color: 'R', amount: 1 },
      { type: 'manaPaid', player: 0, cost: mana({ generic: 1 }) },
    ]);
    const [turn] = log.turns;
    expect(turn?.user.abilities).toBe(0);
    expect(turn?.user.mana_spent).toBe(1);
  });
});
