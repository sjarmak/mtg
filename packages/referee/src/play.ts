/**
 * The driver for a game with a refereed seat.
 *
 * The kernel's own `playOut` is synchronous and stays that way: the balance
 * sweep plays 10,035 games and must never pay an await per decision for the
 * benefit of a seat that asks a model. `session.ts` makes the same argument for
 * human seats and answers it by inverting control. A referee needs neither — it
 * answers on its own, just not immediately — so it gets the third arrangement
 * the kernel's `game.ts` header anticipates: another driver over the same
 * `pendingDecision` / `reduce` pair, with no rules knowledge of its own.
 *
 * A refereed run is therefore an ordinary kernel game with a transcript of
 * rulings beside it, and it is deliberately not reachable from the sim package:
 * refereed games are excluded from balance CI (ADR-0001 §2.4).
 */
import type { Action, AgentView, GameEvent, GameResult, GameState, PlayerAgent } from '@mtg/kernel';
import { pendingDecision, reduce } from '@mtg/kernel';
import type { Referee, RulingRecord } from './referee';

export type RefereedSeat =
  | { readonly kind: 'agent'; readonly agent: PlayerAgent }
  | { readonly kind: 'referee'; readonly referee: Referee };

export function agentSeat(agent: PlayerAgent): RefereedSeat {
  return { kind: 'agent', agent };
}

export function refereeSeat(referee: Referee): RefereedSeat {
  return { kind: 'referee', referee };
}

export interface RefereedPlayOptions {
  /** Safety valve against a seat that never advances the game. */
  readonly maxDecisions?: number | undefined;
}

export interface RefereedRun {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly result: GameResult | null;
  readonly decisions: number;
  /** Every ruling made by a refereed seat, in the order they were made. */
  readonly rulings: readonly RulingRecord[];
}

/**
 * An order of magnitude below the kernel's own valve, because a refereed
 * decision costs a call and a wait rather than a microsecond: a stall here is
 * spend, so it is caught sooner.
 */
const DEFAULT_MAX_DECISIONS = 20_000;

/** Plays from a position to the end of the game, asking each seat in turn. */
export async function playRefereed(
  state: GameState,
  seats: readonly [RefereedSeat, RefereedSeat],
  options: RefereedPlayOptions = {},
): Promise<RefereedRun> {
  const limit = options.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  const events: GameEvent[] = [];
  const rulings: RulingRecord[] = [];
  let current = state;
  let decisions = 0;

  for (;;) {
    const decision = pendingDecision(current);
    if (decision === null) break;
    if (decisions >= limit) {
      throw new Error(`playRefereed: exceeded ${String(limit)} decisions without finishing the game`);
    }
    const seat = seats[decision.player];
    const view: AgentView = { state: current, player: decision.player, decision };
    let action: Action;
    if (seat.kind === 'agent') {
      action = seat.agent.decide(view);
    } else {
      const outcome = await seat.referee.rule(view);
      rulings.push(outcome.record);
      action = outcome.action;
    }

    if (action.player !== decision.player) {
      throw new Error(
        `playRefereed: ${nameOf(seat)} answered for player ${String(action.player)} ` +
          `but player ${String(decision.player)} was asked`,
      );
    }
    const step = reduce(current, action);
    current = step.state;
    events.push(...step.events);
    decisions += 1;
  }

  return { state: current, events, result: current.result, decisions, rulings };
}

function nameOf(seat: RefereedSeat): string {
  return seat.kind === 'agent' ? seat.agent.name : seat.referee.name;
}
