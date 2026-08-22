/**
 * A hand-built event log, for the states a recorded game cannot reach.
 *
 * The committed fixture is a real kernel game and is the right input for
 * everything the engine can produce. It is the wrong input for a permanent
 * whose controller is not its owner: no effect kind in the DSL changes control
 * today, so no recording will ever hold one, and the sentence that would be
 * wrong is exactly the sentence a control change makes wrong (`mtg-fyo`).
 *
 * So the log is written record by record here and goes in through
 * `readEventLog` like any other file. Nothing is stubbed: what these tests read
 * is a log that satisfies every schema in `log-schema.ts`, which is the same
 * gate a recorded one passes.
 */
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { EVENT_LOG_SCHEMA_VERSION } from '../../../src/routes/replay/log-schema';
import type { LogEvent, LogPlayerId, LogSnapshot } from '../../../src/routes/replay/log-schema';
import { readEventLog } from '../../../src/routes/replay/read-log';
import type { EventLog } from '../../../src/routes/replay/read-log';

export const SEAT_LABELS = ['Alpha', 'Beta'] as const;

function creature(index: number): Card {
  const card = EXAMPLE_CARDS.filter((entry) => entry.power !== undefined)[index];
  if (card === undefined) throw new Error('the DSL example set has too few creatures');
  return card;
}

/** The two cards these logs are built out of, named once so tests can read them. */
export const HOST_CARD = creature(0);
export const OTHER_CARD = creature(1);

/**
 * The card `x1` is, which is the object these logs put in exile.
 *
 * A third card and a third object rather than a reuse of the two above, because
 * exile is the one zone whose seat has to be derived from the object's OWNER
 * (the snapshot keeps one game-wide list, the way the kernel does), and a check
 * of that derivation needs an object whose owner is seat 1 while everything else
 * here is owned by seat 0.
 */
export const EXILED_CARD = creature(2);

const EMPTY_POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } as const;

function seat(): unknown {
  return { life: 20, hand: [], library: 30, graveyard: [], pool: { ...EMPTY_POOL }, lost: false };
}

function permanent(oid: string, card: Card, controller: LogPlayerId): unknown {
  return {
    oid,
    controller,
    tapped: false,
    summoningSick: false,
    damage: 0,
    plusCounters: 0,
    minusCounters: 0,
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    attachedTo: null,
    attacking: false,
    blocking: false,
  };
}

function board(controllers: readonly (LogPlayerId | null)[], exiled: readonly string[]): unknown {
  const cards: readonly [string, Card][] = [
    ['o1', HOST_CARD],
    ['o2', OTHER_CARD],
  ];
  return {
    seats: [seat(), seat()],
    battlefield: cards.flatMap(([oid, card], index) => {
      const controller = controllers[index];
      return controller === undefined || controller === null ? [] : [permanent(oid, card, controller)];
    }),
    exile: [...exiled],
    stack: [],
  };
}

export interface SyntheticStep {
  /**
   * Who controls `o1` and `o2` on the board this step leaves behind, in that
   * order. `null` puts the permanent in no zone at all, which is how a step
   * says the thing it is narrating has already left the battlefield.
   */
  readonly controllers: readonly (LogPlayerId | null)[];
  /**
   * Object ids in the game-wide exile after this step. `x1` is the one owned by
   * seat 1; everything else in these logs is owned by seat 0.
   */
  readonly exiled?: readonly string[];
  readonly events: readonly LogEvent[];
}

/**
 * A one-game log with two permanents, `o1` and `o2`, both owned by seat 0.
 *
 * Owner is fixed and controller is per step, which is the whole shape of the
 * bug: a book built from the object table can only ever say seat 0.
 */
export function syntheticLog(steps: readonly SyntheticStep[]): EventLog {
  const lines: string[] = [
    JSON.stringify({
      record: 'header',
      schema: EVENT_LOG_SCHEMA_VERSION,
      source: 'synthetic-log.ts',
      games: 1,
    }),
    JSON.stringify({
      record: 'game',
      game: 0,
      seed: 'synthetic/1',
      startingPlayer: 0,
      maximumTurns: 40,
      seats: [
        { bot: 'none', deck: SEAT_LABELS[0] },
        { bot: 'none', deck: SEAT_LABELS[1] },
      ],
      cards: {
        [HOST_CARD.id]: HOST_CARD,
        [OTHER_CARD.id]: OTHER_CARD,
        [EXILED_CARD.id]: EXILED_CARD,
      },
      objects: {
        o1: { card: HOST_CARD.id, owner: 0, token: false },
        o2: { card: OTHER_CARD.id, owner: 0, token: false },
        x1: { card: EXILED_CARD.id, owner: 1, token: false },
      },
      steps: steps.length,
      result: { winner: 0, loser: 1, reason: 'lifeZero', endedOnTurn: 1 },
    }),
  ];
  for (const [index, step] of steps.entries()) {
    lines.push(
      JSON.stringify({
        record: 'step',
        game: 0,
        seq: index,
        turn: 1,
        step: 'precombatMain',
        active: 0,
        decision: null,
        action: null,
        events: step.events,
        state: board(step.controllers, step.exiled ?? []) as LogSnapshot,
      }),
    );
  }
  return readEventLog(`${lines.join('\n')}\n`);
}
