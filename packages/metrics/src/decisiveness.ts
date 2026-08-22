/**
 * A5 — stall and decisiveness guards.
 *
 * Metrics report §7 tier A5: "% games hitting turn cap or ending in draws; %
 * turns with no state-advancing action", against the Forge precedent (its `sim`
 * mode ships a clock that calls a draw, and its own wiki reports complex boards
 * making games "almost unbearably long" — §6.1) and Browne's decisiveness and
 * duration criteria from Ludi (§4.5).
 *
 * Four numbers, each answering a different failure:
 *
 *  - `stallRate`: games that hit the turn cap. The format cannot finish.
 *  - `deckOutRate`: games decided by an empty library. The format finishes, but
 *    by attrition of the library rather than of the player — a design smell in
 *    Limited, so it is measured separately rather than folded into wins.
 *  - `decidedByRound`: Browne's decisiveness. Most games should be over well
 *    before the cap; a format whose mass sits against the cap is a stall
 *    format even when every individual game technically resolves.
 *  - `inertTurnRate`: turns where nobody played a land, cast anything, or
 *    attacked. This is the fine-grained version of the same question and is the
 *    one that catches a board stall inside an otherwise normal-length game.
 */
import type { SimGameLog } from '@mtg/sim';
import type { MetricsConfig } from './config';
import { DEFAULT_METRICS_CONFIG } from './config';
import { gameFacts, isInertTurn } from './game';
import type { Sampled } from './sample';
import { countGames, sampled } from './sample';
import { share } from './stats';

export interface DecisivenessResult {
  readonly stallRate: number;
  readonly deckOutRate: number;
  /** Games with no winner for any reason, including simultaneous loss. */
  readonly drawRate: number;
  /** Share of all games that were decided at or before `config.decisiveRound`. */
  readonly decidedByRound: number;
  readonly decisiveRound: number;
  readonly inertTurns: number;
  readonly totalTurns: number;
  readonly inertTurnRate: number;
  /** Mean inert turns per game; the "how much of the game was nothing" number. */
  readonly inertTurnsPerGame: number;
}

export function decisiveness(
  logs: readonly SimGameLog[],
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): Sampled<DecisivenessResult> {
  const count = countGames(logs);
  return sampled(count, config.floors.decisiveness, () => {
    const bands = config.decisiveness;
    let stalls = 0;
    let deckOuts = 0;
    let draws = 0;
    let decidedEarly = 0;
    let inertTurns = 0;
    let totalTurns = 0;

    for (const log of logs) {
      const facts = gameFacts(log);
      if (facts.endReason === 'turnLimit') stalls += 1;
      if (facts.endReason === 'emptyLibrary') deckOuts += 1;
      if (facts.winner === null) draws += 1;
      if (facts.winner !== null && facts.rounds <= bands.decisiveRound) decidedEarly += 1;
      for (const record of log.turns) {
        totalTurns += 1;
        if (isInertTurn(record)) inertTurns += 1;
      }
    }

    return {
      stallRate: share(stalls, logs.length),
      deckOutRate: share(deckOuts, logs.length),
      drawRate: share(draws, logs.length),
      decidedByRound: share(decidedEarly, logs.length),
      decisiveRound: bands.decisiveRound,
      inertTurns,
      totalTurns,
      inertTurnRate: share(inertTurns, totalTurns),
      inertTurnsPerGame: share(inertTurns, logs.length),
    };
  });
}
