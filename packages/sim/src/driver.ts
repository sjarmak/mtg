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
import type { BotEvidenceEpisode } from '@mtg/bot-evidence';
import { boardCapStanding, DEFAULT_BOARD_CAP } from '@mtg/engine';
import type { Card } from '@mtg/dsl';
import type { DeckList, GameEvent, GameState, PlayerAgent, PlayerId } from '@mtg/kernel';
import {
  agentView,
  createGame,
  IllegalActionError,
  pendingDecision,
  reduce,
  settleAgentAction,
} from '@mtg/kernel';
import { buildGameLog } from './log/collect';
import { buildExtras, buildMetadata } from './log/metadata';
import type { SimEndReason, SimGameLog } from './log/schema';
import type { ActivationCensus } from './activation-census';
import { censusGameActivations } from './activation-census';
import type { TriggerCensus } from './trigger-census';
import { censusGameTriggers } from './trigger-census';
import { withPrivilegedRolloutPreview, withRolloutPreview } from './rollout-bot';
import type { NativeGameplayEvidenceRequest, NativeGameplayFailureStatus } from './native-game-evidence';
import {
  completedNativeGameplayEvidence,
  failedNativeGameplayEvidence,
  NativeGameplayEvidenceError,
  nativeGameplayEvidenceIdentity,
} from './native-game-evidence';
import type { NativeGameplayDecisionEvidence, ObservationRetention } from './native-evidence';
import { nativeGameplayDecision, nativeGameplayFailedDecision } from './native-evidence';

/** Per-game safety valve. Both limits abort the game with a loud error. */
export interface GameBudget {
  readonly maxDecisions: number;
  readonly maxMillis: number;
}

export const DEFAULT_BUDGET: GameBudget = { maxDecisions: 20_000, maxMillis: 30_000 };

/**
 * How many permanents the battlefield may hold, both seats together, before the
 * driver stops the game as a draw with reason `boardCap`.
 *
 * The number is `@mtg/engine`'s, shared with the play screen and the netplay
 * table, and `board-cap.ts` there carries the measurement behind it. Without
 * it a runaway eats the whole `DEFAULT_BUDGET` and throws
 * `GameBudgetExceededError`, which ends the run.
 *
 * A capped game is a draw: `winner` is `null`, it counts in `draws`, and
 * `decidedWinRate` leaves it out exactly as it leaves out a turn-limit draw. It
 * is reported under its own reason so a run that capped games says how many.
 */
export { DEFAULT_BOARD_CAP };

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
  /** Public format distribution used to sample an opponent's concealed cards during rollout. */
  readonly rolloutPool?: readonly Card[];
  /** Explicit diagnostic ceiling that permits rollout to inspect real hidden cards. */
  readonly rolloutWorld?: 'fair' | 'privileged';
  readonly startingPlayer: PlayerId;
  readonly maximumTurns?: number;
  /** `DEFAULT_BOARD_CAP` when absent; `null` lets the board grow without limit. */
  readonly boardCap?: number | null;
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
  /** Opt-in safe decision and outcome evidence with caller-owned provenance. */
  readonly evidence?: NativeGameplayEvidenceRequest | null;
  /**
   * Whether recorded decisions keep the observation value or only its digest.
   * Defaults to `retained`, which a learned dataset needs; a strength campaign
   * asks for `digest`, because it reads outcomes and choices and nothing else.
   */
  readonly observations?: ObservationRetention;
}

/** Everything a run needs from one game; plain data, so it crosses a worker boundary. */
export interface GameOutcome {
  readonly index: number;
  readonly seed: string;
  readonly startingPlayer: PlayerId;
  readonly winner: PlayerId | null;
  readonly reason: SimEndReason;
  readonly turns: number;
  readonly decisions: number;
  readonly log: SimGameLog | null;
  /** Raw kernel evidence, or `null` when the caller did not request it. */
  readonly events: readonly GameEvent[] | null;
  /** Per-condition trigger chances and takings, or `null` when not requested. */
  readonly triggerCensus: TriggerCensus | null;
  /** Per-arm activation chances and takings, or `null` when not requested. */
  readonly activationCensus: ActivationCensus | null;
  /** Present only when `PlayGameOptions.evidence` requested collection. */
  readonly evidence?: BotEvidenceEpisode;
}

/** Check the clock every this many decisions; `Date.now` is not free. */
const CLOCK_INTERVAL = 128;

interface EvidenceDecisionNode {
  readonly value: NativeGameplayDecisionEvidence;
  readonly previous: EvidenceDecisionNode | null;
}

function collectedEvidenceDecisions(
  latest: EvidenceDecisionNode | null,
): readonly NativeGameplayDecisionEvidence[] {
  function* newestFirst(): Generator<NativeGameplayDecisionEvidence> {
    let node = latest;
    while (node !== null) {
      yield node.value;
      node = node.previous;
    }
  }
  return Array.from(newestFirst()).toSorted((left, right) => left.sequence - right.sequence);
}

class AgentSeatMismatchError extends Error {}

function failureStatus(error: unknown): NativeGameplayFailureStatus {
  if (error instanceof GameBudgetExceededError) {
    return error.limit === 'time' ? 'timeout' : 'incomplete';
  }
  return error instanceof IllegalActionError || error instanceof AgentSeatMismatchError
    ? 'illegal-action'
    : 'engine-failure';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function playSimGame(options: PlayGameOptions): GameOutcome {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const caps = options.caps ?? DEFAULT_CAPS;
  const boardCap = options.boardCap === undefined ? DEFAULT_BOARD_CAP : options.boardCap;
  const started = Date.now();
  const evidenceRequest = options.evidence ?? null;
  const evidenceIdentity =
    evidenceRequest === null ? null : nativeGameplayEvidenceIdentity(evidenceRequest, options.seed);
  const retention: ObservationRetention = options.observations ?? 'retained';
  let evidenceDecisions: EvidenceDecisionNode | null = null;

  try {
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
    let capped = false;

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
      const baseView = agentView(state, decision.player, decision, `sim:${String(decisions)}`, (candidate) =>
        settleAgentAction(state, candidate),
      );
      const view =
        options.rolloutWorld === 'privileged'
          ? withPrivilegedRolloutPreview(baseView, state)
          : withRolloutPreview(
              baseView,
              state,
              options.rolloutPool === undefined
                ? undefined
                : {
                    ownDeck: options.decks[decision.player].cards,
                    opponentPool: options.rolloutPool,
                    previewSeed: `${options.seed}/decision/${String(decisions)}/preview`,
                  },
            );
      const action = agent.decide(view);
      if (action.player !== decision.player) {
        const mismatch = new AgentSeatMismatchError(
          `agent ${agent.name} answered for player ${action.player} but player ${decision.player} was asked`,
        );
        if (evidenceIdentity !== null) {
          evidenceDecisions = {
            value: nativeGameplayFailedDecision(view, action, decisions, mismatch.message, retention),
            previous: evidenceDecisions,
          };
        }
        throw mismatch;
      }

      const before = state.turn.number;
      let stepped: ReturnType<typeof reduce>;
      try {
        stepped = reduce(state, action);
      } catch (error) {
        if (evidenceIdentity !== null && error instanceof IllegalActionError) {
          evidenceDecisions = {
            value: nativeGameplayFailedDecision(view, action, decisions, error.message, retention),
            previous: evidenceDecisions,
          };
        }
        throw error;
      }
      if (evidenceIdentity !== null) {
        evidenceDecisions = {
          value: nativeGameplayDecision(view, action, decisions, retention),
          previous: evidenceDecisions,
        };
      }
      state = stepped.state;
      if (keepsEvents) events.push(...stepped.events);
      decisions += 1;
      if (state.turn.number !== before && !endOfTurnStates.has(before)) {
        endOfTurnStates.set(before, state);
      }
      if (
        boardCap !== null &&
        state.result === null &&
        boardCapStanding(state.battlefield.length, boardCap) === 'passed'
      ) {
        capped = true;
        break;
      }
    }

    const result = endOf(state, capped, options.seed);
    if (!endOfTurnStates.has(state.turn.number)) endOfTurnStates.set(state.turn.number, state);

    const outcome: GameOutcome = {
      index: options.index,
      seed: options.seed,
      startingPlayer: options.startingPlayer,
      winner: result.winner,
      reason: result.reason,
      turns: result.endedOnTurn,
      decisions,
      log: wantsLog ? buildLog(options, state, result, events, endOfTurnStates, decisions) : null,
      events: wantsEvents ? events : null,
      triggerCensus: wantsCensus ? censusGameTriggers(events, state) : null,
      activationCensus: wantsCensus ? censusGameActivations(events, state) : null,
    };
    return evidenceIdentity === null
      ? outcome
      : {
          ...outcome,
          evidence: completedNativeGameplayEvidence(
            evidenceIdentity,
            collectedEvidenceDecisions(evidenceDecisions),
            outcome,
          ),
        };
  } catch (error) {
    if (evidenceIdentity === null || error instanceof NativeGameplayEvidenceError) throw error;
    const evidence = failedNativeGameplayEvidence(
      evidenceIdentity,
      collectedEvidenceDecisions(evidenceDecisions),
      failureStatus(error),
      errorMessage(error),
    );
    throw new NativeGameplayEvidenceError(evidence, error);
  }
}

/** How a game ended, as the sim reports it. */
interface SimResult {
  readonly winner: PlayerId | null;
  readonly reason: SimEndReason;
  readonly endedOnTurn: number;
}

/**
 * The kernel's result, or the board-cap draw the driver stopped the game at.
 *
 * A capped game has no kernel result because the kernel never ended it, so the
 * draw is stated here rather than written into `GameState`, which the kernel
 * owns.
 */
function endOf(state: GameState, capped: boolean, seed: string): SimResult {
  if (capped) return { winner: null, reason: 'boardCap', endedOnTurn: state.turn.number };
  if (state.result === null) {
    throw new Error(`game ${seed} stopped owing no decision but with no result`);
  }
  return state.result;
}

function buildLog(
  options: PlayGameOptions,
  finalState: GameState,
  result: SimResult,
  events: readonly GameEvent[],
  endOfTurnStates: ReadonlyMap<number, GameState>,
  decisions: number,
): SimGameLog {
  const request = options.log ?? null;
  if (request === null) {
    throw new Error('buildLog called without a log request');
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
    extras: buildExtras(inputs, result.reason),
    userDeck: options.decks[0],
  });
}
