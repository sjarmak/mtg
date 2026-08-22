/**
 * The driver: ask whoever owes a decision, apply it, repeat until the game ends.
 *
 * This is the whole control loop. It holds no rules knowledge — every rule
 * lives in the reducer — so a different driver (a UI, a search, a referee
 * harness) can replace it without touching the engine.
 */
import type { PlayerAgent } from './agent';
import type { GameEvent } from './events';
import { pendingDecision } from './legal';
import { reduce } from './reduce';
import { createGame } from './setup';
import type { GameSetup } from './setup';
import type { GameResult, GameState } from './state';

export interface PlayOptions {
  /** Safety valve against a bot that never advances the game. */
  readonly maxDecisions?: number | undefined;
}

export interface GameRun {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly result: GameResult | null;
  readonly decisions: number;
}

const DEFAULT_MAX_DECISIONS = 200_000;

/** Plays from a position to the end of the game. */
export function playOut(
  state: GameState,
  agents: readonly [PlayerAgent, PlayerAgent],
  options: PlayOptions = {},
): GameRun {
  const limit = options.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  const events: GameEvent[] = [];
  let current = state;
  let decisions = 0;

  for (;;) {
    const decision = pendingDecision(current);
    if (decision === null) break;
    if (decisions >= limit) {
      throw new Error(`playOut: exceeded ${limit} decisions without finishing the game`);
    }
    const agent = agents[decision.player];
    const action = agent.decide({ state: current, player: decision.player, decision });
    if (action.player !== decision.player) {
      throw new Error(
        `agent ${agent.name} answered for player ${action.player} but player ${decision.player} was asked`,
      );
    }
    const step = reduce(current, action);
    current = step.state;
    events.push(...step.events);
    decisions += 1;
  }

  return { state: current, events, result: current.result, decisions };
}

/** Builds a game from a setup and plays it to completion. */
export function playGame(
  setup: GameSetup,
  agents: readonly [PlayerAgent, PlayerAgent],
  options: PlayOptions = {},
): GameRun {
  const created = createGame(setup);
  const played = playOut(created.state, agents, options);
  return {
    state: played.state,
    events: [...created.events, ...played.events],
    result: played.result,
    decisions: played.decisions,
  };
}
