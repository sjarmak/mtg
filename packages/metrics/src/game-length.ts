/**
 * A1 — game-length distribution.
 *
 * Metrics report §7 tier A: "Histogram + mean/median of `num_turns`; cumulative
 * %-finished-by-turn curve", calibrated against 17lands' `/data/play_draw`
 * `turns` histogram and `average_game_length` (§2.5) and against Sierkovitz's
 * format-speed methodology (§4.1), which reads formats off exactly these two
 * curves: where the histogram peaks, and how much of the field is done by turn
 * eight.
 *
 * Reported in rounds, because that is the unit both of those sources use. The
 * raw player-turn summary is kept alongside so nothing has to be un-converted
 * to compare against a kernel `GameResult`.
 */
import type { SimGameLog } from '@mtg/sim';
import type { MetricsConfig } from './config';
import { DEFAULT_METRICS_CONFIG } from './config';
import { gameFacts } from './game';
import type { Sampled } from './sample';
import { countGames, sampled } from './sample';
import type { Summary } from './stats';
import { cumulativeShare, histogram, share, summarize } from './stats';

export interface GameLengthDistribution {
  /** Length in rounds: the 17lands-comparable unit. */
  readonly rounds: Summary;
  /** Length in raw kernel player turns. */
  readonly playerTurns: Summary;
  /** Games ending on each round; index is the round, index 0 unused. */
  readonly roundHistogram: readonly number[];
  /** Share of games finished by each round. */
  readonly finishedByRound: readonly number[];
  /** The mode of `roundHistogram`, i.e. the format's most common length. */
  readonly modalRound: number;
  /** Share of games at or past `config.length.longGameRound`: the tail. */
  readonly longGameShare: number;
  /** Share of games decided in four rounds or fewer: the other tail. */
  readonly blowoutShare: number;
}

const BLOWOUT_ROUND = 4;

export function gameLengthDistribution(
  logs: readonly SimGameLog[],
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): Sampled<GameLengthDistribution> {
  const count = countGames(logs);
  return sampled(count, config.floors.gameLength, () => {
    const facts = logs.map(gameFacts);
    const rounds = facts.map((fact) => fact.rounds);
    const playerTurns = facts.map((fact) => fact.playerTurns);
    const roundSummary = summarize(rounds);
    const turnSummary = summarize(playerTurns);
    if (roundSummary === null || turnSummary === null) {
      throw new Error('game-length: summary of a non-empty sample came back null');
    }
    const counts = histogram(rounds);
    return {
      rounds: roundSummary,
      playerTurns: turnSummary,
      roundHistogram: counts,
      finishedByRound: cumulativeShare(counts, rounds.length),
      modalRound: modeOf(counts),
      longGameShare: share(
        rounds.filter((round) => round >= config.length.longGameRound).length,
        rounds.length,
      ),
      blowoutShare: share(rounds.filter((round) => round <= BLOWOUT_ROUND).length, rounds.length),
    };
  });
}

function modeOf(counts: readonly number[]): number {
  let bestIndex = 0;
  let bestCount = -1;
  for (const [index, count] of counts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/**
 * A2 — on-the-play win rate.
 *
 * Metrics report §7 tier A: `P(win | on_play) - 0.5`, calibrated against
 * 17lands' `win_rate_on_play` (AFR TradDraft 52.6%) and mtgds' regression
 * estimate of about +4.0 points (§2.5, §3.3 item 7). Draws are excluded from
 * the denominator: a game nobody won says nothing about who moved first.
 */
export interface OnPlayResult {
  readonly decided: number;
  readonly onPlayWins: number;
  readonly winRate: number;
  /** `winRate - 0.5`, the number the human sources quote. */
  readonly advantage: number;
}

export function onPlayWinRate(
  logs: readonly SimGameLog[],
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): Sampled<OnPlayResult> {
  const decided = logs.filter((log) => log.extras.sim_winner !== null);
  const count = countGames(decided);
  return sampled(count, config.floors.onPlay, () => {
    let wins = 0;
    for (const log of decided) {
      const facts = gameFacts(log);
      if (facts.winner === facts.onPlay) wins += 1;
    }
    const rate = share(wins, decided.length);
    return { decided: decided.length, onPlayWins: wins, winRate: rate, advantage: rate - 0.5 };
  });
}
