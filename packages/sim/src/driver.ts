/**
 * The single-game driver.
 *
 * `@mtg/kernel` ships `playOut`, which is the minimal loop. This one exists
 * because a mass-sim run needs three things it does not have: a hard budget
 * that fails loudly instead of hanging, an enumeration cap the caller controls
 * (the blocker cartesian is the most expensive thing in the loop, and the tier-1
 * bots construct their own declarations so they never read it), and an
 * end-of-turn state snapshot per turn for the replay log.
 *
 * The loop itself holds no rules knowledge: ask who owes a decision, ask that
 * seat's agent, reduce, repeat.
 */
import type { DeckList, GameEndReason, GameEvent, GameState, PlayerAgent, PlayerId } from '@mtg/kernel';
import { createGame, pendingDecision, reduce } from '@mtg/kernel';
import { buildGameLog } from './log/collect';
import { buildExtras, buildMetadata } from './log/metadata';
import type { SimGameLog } from './log/schema';
import type { ActivationCensus } from './activation-census';
import { censusGameActivations } from './activation-census';
import type { TriggerCensus } from './trigger-census';
import { censusGameTriggers } from './trigger-census';

/** Per-game safety valve. Both limits abort the game with a loud error. */
export interface GameBudget {
  readonly maxDecisions: number;
  readonly maxMillis: number;
}

export const DEFAULT_BUDGET: GameBudget = { maxDecisions: 20_000, maxMillis: 30_000 };

/** How many turns a game may run before the kernel calls it a draw. */
export const DEFAULT_MAXIMUM_TURNS = 40;

/**
 * Priority decisions need the enumerated cast options; the four declaration
 * decisions do not, because both shipped bots construct their own.
 *
 * The default enumerates both fully, so a policy that samples
 * `decision.options` is never handed a degraded list by surprise. `FAST_CAPS`
 * is the opt-in throughput lever for policies that build their own
 * declarations: it skips the attack/block/order/discard enumeration entirely.
 * The two produce identical games for the shipped bots — only the work done
 * before the bot is asked differs.
 */
export interface EnumerationCaps {
  readonly priority: number;
  readonly declaration: number;
}

export const DEFAULT_CAPS: EnumerationCaps = { priority: 512, declaration: 512 };

export const FAST_CAPS: EnumerationCaps = { priority: 512, declaration: 1 };

/** Raised when a game blows its budget. Carries everything needed to replay it. */
export class GameBudgetExceededError extends Error {
  constructor(
    readonly limit: 'decisions' | 'time',
    readonly seed: string,
    readonly turn: number,
    readonly decisions: number,
    readonly elapsedMillis: number,
  ) {
    super(
      `game ${seed} exceeded its ${limit} budget on turn ${turn} ` +
        `(${decisions} decisions, ${elapsedMillis}ms)`,
    );
    this.name = 'GameBudgetExceededError';
  }
}

/** What the log exporter needs that the game itself does not carry. */
export interface LogRequest {
  readonly runSeed: string;
  readonly expansion: string;
  readonly eventType: string;
  readonly gameTime: string;
  readonly botNames: readonly [string, string];
}

export interface PlayGameOptions {
  readonly index: number;
  readonly seed: string;
  readonly decks: readonly [DeckList, DeckList];
  readonly agents: readonly [PlayerAgent, PlayerAgent];
  readonly startingPlayer: PlayerId;
  readonly maximumTurns?: number;
  readonly budget?: GameBudget;
  readonly caps?: EnumerationCaps;
  /** `null` skips log construction entirely, which is the fast path for benchmarks. */
  readonly log?: LogRequest | null;
  /** Return the kernel event stream on the outcome. Independent from the aggregate replay log. */
  readonly collectEvents?: boolean;
  /**
   * Count what each trigger condition fired and what each activated ability
   * was used for, and out of how many arrivals apiece.
   *
   * Opt-in for the same reason `collectEvents` is: it needs the event stream
   * retained. It returns two fixed-size records rather than the stream itself,
   * so unlike `collectEvents` it is cheap to carry back across a worker
   * boundary.
   *
   * One flag rather than two, because the cost is the retained stream and both
   * censuses read the same one. A caller that wanted only half would pay the
   * whole price and save two records the size of a sentence.
   */
  readonly censusAbilities?: boolean;
}

/** Everything a run needs from one game; plain data, so it crosses a worker boundary. */
export interface GameOutcome {
  readonly index: number;
  readonly seed: string;
  readonly startingPlayer: PlayerId;
  readonly winner: PlayerId | null;
  readonly reason: GameEndReason;
  readonly turns: number;
  readonly decisions: number;
  readonly log: SimGameLog | null;
  /** Raw kernel evidence, or `null` when the caller did not request it. */
  readonly events: readonly GameEvent[] | null;
  /** Per-condition trigger chances and takings, or `null` when not requested. */
  readonly triggerCensus: TriggerCensus | null;
  /** Per-arm activation chances and takings, or `null` when not requested. */
  readonly activationCensus: ActivationCensus | null;
}

/** Check the clock every this many decisions; `Date.now` is not free. */
const CLOCK_INTERVAL = 128;

export function playSimGame(options: PlayGameOptions): GameOutcome {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const caps = options.caps ?? DEFAULT_CAPS;
  const started = Date.now();

  const created = createGame({
    seed: options.seed,
    decks: options.decks,
    startingPlayer: options.startingPlayer,
    maximumTurns: options.maximumTurns ?? DEFAULT_MAXIMUM_TURNS,
  });

  let state: GameState = created.state;
  const wantsLog = (options.log ?? null) !== null;
  const wantsEvents = options.collectEvents ?? false;
  const wantsCensus = options.censusAbilities ?? false;
  const keepsEvents = wantsLog || wantsEvents || wantsCensus;
  const events: GameEvent[] = keepsEvents ? [...created.events] : [];
  const endOfTurnStates = new Map<number, GameState>();
  let decisions = 0;

  for (;;) {
    const awaiting = state.turn.awaiting;
    const cap = awaiting === null ? caps.priority : caps.declaration;
    const decision = pendingDecision(state, cap);
    if (decision === null) break;

    if (decisions >= budget.maxDecisions) {
      throw new GameBudgetExceededError(
        'decisions',
        options.seed,
        state.turn.number,
        decisions,
        Date.now() - started,
      );
    }
    if (decisions % CLOCK_INTERVAL === 0) {
      const elapsed = Date.now() - started;
      if (elapsed > budget.maxMillis) {
        throw new GameBudgetExceededError('time', options.seed, state.turn.number, decisions, elapsed);
      }
    }

    const agent = options.agents[decision.player];
    const action = agent.decide({ state, player: decision.player, decision });
    if (action.player !== decision.player) {
      throw new Error(
        `agent ${agent.name} answered for player ${action.player} but player ${decision.player} was asked`,
      );
    }

    const before = state.turn.number;
    const stepped = reduce(state, action);
    state = stepped.state;
    if (keepsEvents) events.push(...stepped.events);
    decisions += 1;
    if (state.turn.number !== before && !endOfTurnStates.has(before)) {
      endOfTurnStates.set(before, state);
    }
  }

  const result = state.result;
  if (result === null) {
    throw new Error(`game ${options.seed} stopped owing no decision but with no result`);
  }
  if (!endOfTurnStates.has(state.turn.number)) endOfTurnStates.set(state.turn.number, state);

  return {
    index: options.index,
    seed: options.seed,
    startingPlayer: options.startingPlayer,
    winner: result.winner,
    reason: result.reason,
    turns: result.endedOnTurn,
    decisions,
    log: wantsLog ? buildLog(options, state, events, endOfTurnStates, decisions, result.reason) : null,
    events: wantsEvents ? events : null,
    triggerCensus: wantsCensus ? censusGameTriggers(events, state) : null,
    activationCensus: wantsCensus ? censusGameActivations(events, state) : null,
  };
}

function buildLog(
  options: PlayGameOptions,
  finalState: GameState,
  events: readonly GameEvent[],
  endOfTurnStates: ReadonlyMap<number, GameState>,
  decisions: number,
  reason: GameEndReason,
): SimGameLog {
  const request = options.log ?? null;
  const result = finalState.result;
  if (request === null || result === null) {
    throw new Error('buildLog called without a log request or a finished game');
  }
  const inputs = {
    expansion: request.expansion,
    eventType: request.eventType,
    gameTime: request.gameTime,
    runSeed: request.runSeed,
    gameSeed: options.seed,
    index: options.index,
    decks: options.decks,
    botNames: request.botNames,
    startingPlayer: options.startingPlayer,
    result,
    decisions,
    // Read off the finished position rather than counted out of the event
    // stream: the kernel keeps the count on the seat precisely so a log does not
    // have to reconstruct it.
    mulligans: [finalState.players[0].mulligans, finalState.players[1].mulligans] as const,
  };
  return buildGameLog({
    events,
    finalState,
    endOfTurnStates,
    metadata: buildMetadata(inputs),
    extras: buildExtras(inputs, reason),
  });
}
