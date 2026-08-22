/**
 * Aggregates over a parsed replay log, for the analysis dashboard.
 *
 * Every figure here carries its denominator: a win rate without a game count is
 * the kind of number the brief's "balance is a CI assertion, not a vibe" rule
 * exists to stop. Rates are returned as fractions and formatted at the edge.
 */
import type { EndReason, ReplaySide } from './columns';
import { END_REASONS, SIDES } from './columns';
import type { ReplayGame, ReplayLog } from './types';
import { winningSide } from './timeline';

export interface Spread {
  readonly min: number;
  readonly median: number;
  readonly mean: number;
  readonly max: number;
}

export interface ReplaySummary {
  readonly games: number;
  readonly turns: Spread;
  readonly winsBySide: Readonly<Record<ReplaySide, number>>;
  readonly draws: number;
  readonly endReasons: Readonly<Record<EndReason, number>>;
  /** Games won by whichever seat was on the play. */
  readonly onPlayWins: number;
  readonly meanDecisions: number;
}

function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { min: 0, median: 0, mean: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1] ?? 0;
  const high = sorted[mid] ?? 0;
  return {
    min: sorted[0] ?? 0,
    median: sorted.length % 2 === 0 ? (low + high) / 2 : high,
    mean: total / sorted.length,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

/** True when the seat that was on the play is the seat that won. */
export function onPlayWon(game: ReplayGame): boolean {
  const winner = winningSide(game);
  if (winner === null) return false;
  return game.metadata.on_play === 1 ? winner === 'user' : winner === 'oppo';
}

export function summarizeGames(games: readonly ReplayGame[]): ReplaySummary {
  const wins: Record<ReplaySide, number> = { user: 0, oppo: 0 };
  const reasons: Record<EndReason, number> = {
    lifeZero: 0,
    emptyLibrary: 0,
    concede: 0,
    turnLimit: 0,
  };
  let draws = 0;
  let onPlayWins = 0;
  let decisions = 0;
  for (const game of games) {
    const winner = winningSide(game);
    if (winner === null) draws += 1;
    else wins[winner] += 1;
    reasons[game.extras.sim_end_reason] += 1;
    if (onPlayWon(game)) onPlayWins += 1;
    decisions += game.extras.sim_decisions;
  }
  return {
    games: games.length,
    turns: spread(games.map((game) => game.metadata.num_turns)),
    winsBySide: wins,
    draws,
    endReasons: reasons,
    onPlayWins,
    meanDecisions: games.length === 0 ? 0 : decisions / games.length,
  };
}

export function summarizeLog(log: ReplayLog): ReplaySummary {
  return summarizeGames(log.games);
}

export interface MatchupRow {
  readonly key: string;
  readonly userDeck: string;
  readonly oppoDeck: string;
  readonly games: number;
  readonly userWins: number;
}

/** One row per deck pairing, in first-seen order. */
export function matchupRows(games: readonly ReplayGame[]): readonly MatchupRow[] {
  const order: string[] = [];
  const byKey = new Map<string, { userDeck: string; oppoDeck: string; games: number; userWins: number }>();
  for (const game of games) {
    const userDeck = game.extras.sim_user_deck;
    const oppoDeck = game.extras.sim_oppo_deck;
    const key = `${userDeck}/${oppoDeck}`;
    let row = byKey.get(key);
    if (row === undefined) {
      row = { userDeck, oppoDeck, games: 0, userWins: 0 };
      byKey.set(key, row);
      order.push(key);
    }
    row.games += 1;
    if (winningSide(game) === 'user') row.userWins += 1;
  }
  return order.map((key) => {
    const row = byKey.get(key);
    if (row === undefined) throw new Error(`matchup ${key} vanished while aggregating`);
    return { key, userDeck: row.userDeck, oppoDeck: row.oppoDeck, games: row.games, userWins: row.userWins };
  });
}

/** Percentage string with one decimal, or `n/a` when the denominator is zero. */
export function ratePercent(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export { END_REASONS, SIDES };
