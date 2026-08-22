/**
 * Run aggregation.
 *
 * Everything here is a pure function of the ordered outcome list, and the
 * outcome list is sorted by game index before it gets here, so a sharded
 * worker-parallel run and a serial run produce byte-identical aggregates.
 * Wall-clock numbers are deliberately kept out of the aggregate for the same
 * reason — they live on `MatchRun`, which is not what the determinism test
 * compares.
 */
import type { GameEndReason, PlayerId } from '@mtg/kernel';
import type { GameOutcome } from './driver';

export const END_REASONS: readonly GameEndReason[] = ['lifeZero', 'emptyLibrary', 'concede', 'turnLimit'];

export interface MatchAggregate {
  readonly runSeed: string;
  readonly games: number;
  /** Wins by seat. Seat 0 always holds deck A, seat 1 deck B. */
  readonly wins: readonly [number, number];
  /** Games with no winner: the turn cap, or a simultaneous loss. */
  readonly draws: number;
  readonly winRate: readonly [number, number];
  readonly onPlayGames: number;
  readonly onPlayWins: number;
  /** P(the player on the play wins), over decided games only. */
  readonly onPlayWinRate: number;
  readonly meanTurns: number;
  readonly medianTurns: number;
  readonly minTurns: number;
  readonly maxTurns: number;
  /** Games ending on each turn; index is the turn number, index 0 unused. */
  readonly turnHistogram: readonly number[];
  readonly endReasons: Readonly<Record<GameEndReason, number>>;
  readonly meanDecisions: number;
  readonly totalDecisions: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function aggregateOutcomes(runSeed: string, outcomes: readonly GameOutcome[]): MatchAggregate {
  const wins: [number, number] = [0, 0];
  const endReasons: Record<GameEndReason, number> = {
    lifeZero: 0,
    emptyLibrary: 0,
    concede: 0,
    turnLimit: 0,
  };
  const turns: number[] = [];
  let draws = 0;
  let onPlayGames = 0;
  let onPlayWins = 0;
  let totalDecisions = 0;
  let maxTurn = 0;

  for (const outcome of outcomes) {
    endReasons[outcome.reason] += 1;
    turns.push(outcome.turns);
    totalDecisions += outcome.decisions;
    maxTurn = Math.max(maxTurn, outcome.turns);
    if (outcome.winner === null) {
      draws += 1;
      continue;
    }
    wins[outcome.winner] += 1;
    onPlayGames += 1;
    if (outcome.winner === outcome.startingPlayer) onPlayWins += 1;
  }

  const games = outcomes.length;
  const histogram = new Array<number>(maxTurn + 1).fill(0);
  for (const outcome of outcomes) {
    const slot = histogram[outcome.turns];
    if (slot !== undefined) histogram[outcome.turns] = slot + 1;
  }

  return {
    runSeed,
    games,
    wins,
    draws,
    winRate: [ratio(wins[0], games), ratio(wins[1], games)],
    onPlayGames,
    onPlayWins,
    onPlayWinRate: ratio(onPlayWins, onPlayGames),
    meanTurns: ratio(
      turns.reduce((sum, value) => sum + value, 0),
      games,
    ),
    medianTurns: median(turns),
    minTurns: turns.length === 0 ? 0 : Math.min(...turns),
    maxTurns: maxTurn,
    turnHistogram: histogram,
    endReasons,
    meanDecisions: ratio(totalDecisions, games),
    totalDecisions,
  };
}

/**
 * Stable string form of an aggregate. Two runs of the same seed must produce
 * the same fingerprint; that is the reproducibility assertion, not a vibe.
 */
export function aggregateFingerprint(aggregate: MatchAggregate): string {
  return JSON.stringify(aggregate);
}

/** Win rate of the seat holding deck A, over decided games. */
export function decidedWinRate(aggregate: MatchAggregate, seat: PlayerId): number {
  const decided = aggregate.wins[0] + aggregate.wins[1];
  return ratio(aggregate.wins[seat], decided);
}
