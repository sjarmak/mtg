/**
 * Game construction: decks in, a settled turn-1 state out.
 *
 * Everything random here — the two shuffles — draws from the seeded RNG in
 * state, so `createGame` with the same seed and decks always produces the same
 * opening position and the same opening event log.
 */
import type { Card } from '@mtg/dsl';
import type { GameEvent } from './events';
import { NO_COUNTERS } from './continuous';
import type { ObjectId, PlayerId } from './ids';
import { objectId, opponentOf } from './ids';
import { askMulligan } from './mulligan';
import { createRng } from './rng';
import type { ReduceResult } from './reduce';
import { settle } from './reduce';
import type { GameConfig, GameObject, GameState, PlayerState } from './state';
import { EMPTY_COMBAT, EMPTY_MANA_POOL } from './state';
import type { Trace } from './trace';
import { beginTrace, emit } from './trace';
import { drawCards, shuffleLibrary } from './zones';

export interface DeckList {
  readonly name: string;
  /** Cards in deck order; the library is shuffled from this list. */
  readonly cards: readonly Card[];
}

export interface GameSetup {
  readonly seed: string;
  readonly decks: readonly [DeckList, DeckList];
  readonly startingLife?: number | undefined;
  readonly openingHandSize?: number | undefined;
  readonly maximumHandSize?: number | undefined;
  readonly maximumTurns?: number | undefined;
  readonly startingPlayer?: PlayerId | undefined;
  readonly startingPlayerSkipsFirstDraw?: boolean | undefined;
}

export const DEFAULT_CONFIG = {
  startingLife: 20,
  openingHandSize: 7,
  maximumHandSize: 7,
  maximumTurns: 60,
  startingPlayer: 0,
  startingPlayerSkipsFirstDraw: true,
} as const;

function buildConfig(setup: GameSetup): GameConfig {
  return {
    seed: setup.seed,
    startingLife: setup.startingLife ?? DEFAULT_CONFIG.startingLife,
    openingHandSize: setup.openingHandSize ?? DEFAULT_CONFIG.openingHandSize,
    maximumHandSize: setup.maximumHandSize ?? DEFAULT_CONFIG.maximumHandSize,
    maximumTurns: setup.maximumTurns ?? DEFAULT_CONFIG.maximumTurns,
    startingPlayer: setup.startingPlayer ?? DEFAULT_CONFIG.startingPlayer,
    startingPlayerSkipsFirstDraw:
      setup.startingPlayerSkipsFirstDraw ?? DEFAULT_CONFIG.startingPlayerSkipsFirstDraw,
  };
}

interface BuiltLibraries {
  readonly objects: Record<ObjectId, GameObject>;
  readonly libraries: readonly [readonly ObjectId[], readonly ObjectId[]];
  readonly nextId: number;
}

function buildLibraries(decks: readonly [DeckList, DeckList]): BuiltLibraries {
  const objects: Record<ObjectId, GameObject> = {};
  const libraries: [ObjectId[], ObjectId[]] = [[], []];
  let counter = 0;
  for (const player of [0, 1] as const) {
    for (const card of decks[player].cards) {
      const oid = objectId(counter);
      counter += 1;
      objects[oid] = {
        oid,
        card,
        owner: player,
        controller: player,
        zone: 'library',
        token: false,
        tapped: false,
        summoningSick: false,
        damage: 0,
        deathtouched: false,
        counters: NO_COUNTERS,
      };
      libraries[player].push(oid);
    }
  }
  return { objects, libraries, nextId: counter };
}

function emptySeat(id: PlayerId, library: readonly ObjectId[], life: number): PlayerState {
  return {
    id,
    life,
    library,
    hand: [],
    graveyard: [],
    pool: EMPTY_MANA_POOL,
    lost: false,
    attemptedDrawFromEmptyLibrary: false,
    mulligans: 0,
    keptHand: false,
  };
}

function shuffleLibraries(trace: Trace): Trace {
  let current = trace;
  for (const player of [0, 1] as const) {
    current = shuffleLibrary(current, player);
  }
  return current;
}

/**
 * Builds a game and runs it up to the first decision, which is a mulligan.
 *
 * Both players are dealt a full opening hand and then asked whether to keep it
 * (CR 103.4, `mulligan.ts`), so the first thing `pendingDecision` returns is a
 * `mulligan` and turn 1 does not begin until both seats have kept. That is the
 * reason `createGame` returns a position with `turn.number === 0`: a game that
 * has been dealt but not yet accepted is a real state, and it is one an agent
 * has to answer for.
 */
export function createGame(setup: GameSetup): ReduceResult {
  const config = buildConfig(setup);
  if (setup.decks[0].cards.length === 0 || setup.decks[1].cards.length === 0) {
    throw new Error('createGame: both decks must contain at least one card');
  }
  const built = buildLibraries(setup.decks);
  const initial: GameState = {
    objects: built.objects,
    players: [
      emptySeat(0, built.libraries[0], config.startingLife),
      emptySeat(1, built.libraries[1], config.startingLife),
    ],
    battlefield: [],
    exile: [],
    stack: [],
    continuous: [],
    costModifiers: [],
    turnCombatRules: [],
    replacements: [],
    turn: {
      number: 0,
      active: config.startingPlayer,
      step: 'untap',
      priority: null,
      passes: 0,
      landsPlayed: 0,
      damagedPlayers: [],
      awaiting: null,
      awaitingPlayer: null,
    },
    combat: EMPTY_COMBAT,
    rng: createRng(config.seed),
    nextId: built.nextId,
    result: null,
    config,
  };

  const started: GameEvent = {
    type: 'gameStarted',
    seed: config.seed,
    startingPlayer: config.startingPlayer,
  };
  let trace = emit(beginTrace(initial), started);
  trace = shuffleLibraries(trace);
  const first = config.startingPlayer;
  trace = drawCards(trace, first, config.openingHandSize);
  trace = drawCards(trace, opponentOf(first), config.openingHandSize);
  trace = askMulligan(trace);
  const settled = settle(trace);
  return { state: settled.state, events: settled.events };
}
