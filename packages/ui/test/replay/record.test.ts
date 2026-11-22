/**
 * The fixture is the contract between the kernel and this viewer, so it is
 * asserted three ways.
 *
 *  1. Re-recording the pinned seeds reproduces the committed file byte for
 *     byte. A kernel change that alters play, event order, or an event's fields
 *     turns this red instead of silently changing what the viewer shows.
 *  2. The schemas cover the kernel's unions exactly, checked at compile time —
 *     an added `GameEvent` variant fails `npm run typecheck`, not a test run.
 *  3. Nothing under `src/routes/replay/` imports the kernel or the sim. The
 *     "no engine re-run" property is structural: a view that cannot reach the
 *     engine cannot accidentally call it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCard, type MutuallyAssignable } from '@mtg/dsl';
import {
  beginTrace,
  botSeat,
  choose,
  createRegenerationShield,
  createSession,
  destroyPermanent,
  eventsOfType,
  humanSeat,
  scenario,
  type ActionType,
  type CastingCostChoice,
  type Choice,
  type Decision,
  type GameEventType,
  type GameSetup,
  type Seat,
  type Step,
} from '@mtg/kernel';
import { FIXTURE_DECK_RW, FIXTURE_DECK_UB, greedyBot } from '@mtg/sim';
import {
  GameRecordSchema,
  type LogAction,
  type LogCastingCostChoice,
  type LogDecisionKind,
  type LogEventType,
  type LogStep,
} from '../../src/routes/replay/log-schema';
import { readEventLog } from '../../src/routes/replay/read-log';
import {
  ReplayDivergedError,
  recordChoices,
  recordGame,
  snapshotOf,
  stepRecord,
  writeEventLog,
  type StackEntryKeysCovered,
} from '../../tools/record-replay';
import { FIXTURE_GAMES, FIXTURE_SOURCE } from './support/fixture-games';
import { fixtureText } from './support/log-fixture';

const eventsCovered: MutuallyAssignable<GameEventType, LogEventType> = true;
const actionsCovered: MutuallyAssignable<ActionType, LogAction['type']> = true;
const stepsCovered: MutuallyAssignable<Step, LogStep> = true;
const decisionsCovered: MutuallyAssignable<Decision['kind'], LogDecisionKind> = true;
const stackEntryKeysCovered: StackEntryKeysCovered = true;
/**
 * The kernel's ways of paying for a spell against the log's own list of them.
 * `log-schema.ts` may not import the kernel, so this is where the two meet;
 * `overload` reached `CastingCostChoice` with the Return to Ravnica work while
 * the log still named three, which this would have caught the day it landed.
 */
const castingCostsCovered: MutuallyAssignable<CastingCostChoice, LogCastingCostChoice> = true;

const REPLAY_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'routes', 'replay');

describe('the committed fixture', () => {
  it('is exactly what re-recording the pinned seeds produces', () => {
    const recorded = FIXTURE_GAMES.map((options) => recordGame(options));
    expect(writeEventLog(FIXTURE_SOURCE, recorded)).toBe(fixtureText());
  });

  it('holds one decided game and one draw', () => {
    const recorded = FIXTURE_GAMES.map((options) => recordGame(options));
    const winners = recorded.map((entry) => entry.game.result.winner);
    expect(winners).toContain(null);
    expect(winners.filter((winner) => winner !== null).length).toBe(1);
  });

  it('records the same bytes twice from the same seed', () => {
    const [first] = FIXTURE_GAMES;
    if (first === undefined) throw new Error('no fixture games are configured');
    const once = JSON.stringify(recordGame(first));
    const twice = JSON.stringify(recordGame(first));
    expect(once).toBe(twice);
  });
});

describe('schema coverage', () => {
  it('mirrors every kernel union the log carries', () => {
    expect([
      eventsCovered,
      actionsCovered,
      stepsCovered,
      decisionsCovered,
      stackEntryKeysCovered,
      castingCostsCovered,
    ]).toEqual([true, true, true, true, true, true]);
  });

  it('strict-records and reads a real regeneration-shield consumption', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'replay-regenerator',
      name: 'Replay Regenerator',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { G: 1 },
      colors: ['G'],
      subtypes: ['Troll'],
      power: 2,
      toughness: 2,
      abilities: [{ kind: 'activated', cost: { mana: { G: 1 } }, regenerateSelf: true, effects: [] }],
    });
    const start = scenario({ battlefield: [{ card, controller: 0 }] }).state;
    const oid = start.battlefield[0];
    if (oid === undefined) throw new Error('regenerator did not enter');
    const shielded = createRegenerationShield(beginTrace(start), oid, 0);
    const saved = destroyPermanent(shielded, oid, 'destroyEffect');
    expect(eventsOfType(saved.events, 'replacementApplied')).toContainEqual(
      expect.objectContaining({ event: 'destroy' }),
    );
    expect(eventsOfType(saved.events, 'permanentRegenerated')).toHaveLength(1);

    const step = stepRecord(0, 0, saved.state, saved.events, snapshotOf(saved.state), null, null);
    const game = GameRecordSchema.parse({
      record: 'game',
      game: 0,
      seed: 'replay/regeneration-consumption',
      startingPlayer: 0,
      maximumTurns: 1,
      seats: [
        { bot: 'test', deck: 'regeneration' },
        { bot: 'test', deck: 'empty' },
      ],
      cards: { [card.id]: card },
      objects: { [oid]: { card: card.id, owner: 0, token: false } },
      steps: 1,
      result: { winner: 0, loser: 1, reason: 'concede', endedOnTurn: 1 },
    });
    const log = readEventLog(writeEventLog('record.test.ts', [{ game, steps: [step] }]));
    expect(log.games[0]?.steps[0]?.events).toContainEqual(
      expect.objectContaining({ type: 'replacementApplied', event: 'destroy' }),
    );
  });
});

/**
 * A game a person played against the greedy bot, kept the way the session layer
 * keeps it: the setup and the list of what the person chose. Always the first
 * option, which is not a strategy, and ends at the turn cap, which is a result.
 */
function playedGame(): {
  readonly setup: GameSetup;
  readonly seats: readonly [Seat, Seat];
  readonly choices: readonly Choice[];
} {
  const setup: GameSetup = {
    seed: 'replay/v0/human-vs-greedy',
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    startingPlayer: 0,
    maximumTurns: 4,
  };
  const seats: readonly [Seat, Seat] = [humanSeat('One'), botSeat(greedyBot('greedy-ub'))];
  let session = createSession(setup, seats);
  for (let guard = 0; session.result === null; guard += 1) {
    if (guard > 2000) throw new Error('the played game did not end');
    session = choose(session, 0);
  }
  return { setup, seats, choices: session.choices };
}

describe('re-recording a played game from its choices', () => {
  it('reproduces the result, one step per human choice, and the same bytes twice', () => {
    const played = playedGame();
    const once = recordChoices({ index: 0, ...played });
    expect(once.steps.length).toBe(played.choices.length + 1);
    expect(once.game.result.winner).toBe(null);
    expect(once.game.seats).toEqual([
      { bot: 'One', deck: FIXTURE_DECK_RW.name },
      { bot: 'greedy-ub', deck: FIXTURE_DECK_UB.name },
    ]);
    expect(once.game.steps).toBe(once.steps.length);
    expect(JSON.stringify(recordChoices({ index: 0, ...played }))).toBe(JSON.stringify(once));
    // The rows are the viewer's rows: the log reads back whole.
    const log = readEventLog(writeEventLog('record.test.ts', [once]));
    expect(log.games[0]?.steps.length).toBe(once.steps.length);
  });

  it('refuses a list that runs on after the game, runs out before it, or names an option never offered', () => {
    const played = playedGame();
    expect(() => recordChoices({ index: 0, ...played, choices: [...played.choices, 0] })).toThrow(
      ReplayDivergedError,
    );
    expect(() => recordChoices({ index: 0, ...played, choices: played.choices.slice(0, -1) })).toThrow(
      /ran out before the game ended/,
    );
    expect(() => recordChoices({ index: 0, ...played, choices: [999, ...played.choices.slice(1)] })).toThrow(
      /choice 0: index 999/,
    );
  });
});

describe('the view cannot reach the engine', () => {
  it('imports neither @mtg/kernel nor @mtg/sim anywhere under the route', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(REPLAY_SRC)) {
      if (!name.endsWith('.ts')) continue;
      const source = readFileSync(join(REPLAY_SRC, name), 'utf8');
      if (/from '@mtg\/(kernel|sim)'/.test(source)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
