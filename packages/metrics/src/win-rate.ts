/**
 * C1 — per-color-pair win rate, and the matchup matrix behind it.
 *
 * Metrics report §7 tier C1: "For each 2-color archetype: WR vs field; assert
 * max-min spread <= band; no-dominant-strategy guard (the prior project 40-70%
 * precedent)". The human counterpart is 17lands' `main_colors` win rate from
 * the game dataset (§2.4), which is why the pair key here is exactly the
 * `main_colors` / `opp_colors` string the log exporter already writes.
 *
 * Two decisions worth stating:
 *
 *  - **Draws are excluded from the denominator.** 17lands computes win rate at
 *    game granularity over decided games (§3.2); a turn-cap draw is not half a
 *    win for either pair. `draws` is reported separately, and the stall gate in
 *    `decisiveness.ts` is what actually fails when there are too many.
 *  - **Mirrors are excluded entirely.** A pair playing itself contributes one
 *    win and one loss to its own record, which drags every measured pair toward
 *    50% by an amount that depends on how many mirrors the schedule happened to
 *    contain. `mirrorGames` is reported so the exclusion is visible.
 */
import type { SimGameLog, Side } from '@mtg/sim';
import type { MetricsConfig } from './config';
import { DEFAULT_METRICS_CONFIG } from './config';
import type { GameFacts } from './game';
import { colorsOf, gameFacts, otherSide, SIDE_LIST } from './game';
import type { Sampled } from './sample';
import { countFingerprints, gameFingerprint, sampled } from './sample';
import type { Interval } from './stats';
import { quantileSorted, share, wilsonInterval } from './stats';

export interface ColorPairRecord {
  /** WUBRG color string, e.g. `"WU"`. */
  readonly pair: string;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** Wins over decided games. */
  readonly winRate: Sampled<number>;
  readonly interval: Sampled<Interval>;
  /** Median length in rounds of every game this pair played. */
  readonly medianRounds: number | null;
  /** Median length in rounds of the games it won. */
  readonly medianWinRounds: number | null;
  /** Share of its wins that landed by `config.balance.fastWinRound`. */
  readonly fastWinShare: number | null;
}

interface PairAccumulator {
  pair: string;
  fingerprints: string[];
  wins: number;
  losses: number;
  draws: number;
  rounds: number[];
  winRounds: number[];
}

function accumulator(pair: string): PairAccumulator {
  return { pair, fingerprints: [], wins: 0, losses: 0, draws: 0, rounds: [], winRounds: [] };
}

function record(accumulators: Map<string, PairAccumulator>, pair: string): PairAccumulator {
  const existing = accumulators.get(pair);
  if (existing !== undefined) return existing;
  const created = accumulator(pair);
  accumulators.set(pair, created);
  return created;
}

function addSide(
  accumulators: Map<string, PairAccumulator>,
  facts: GameFacts,
  fingerprint: string,
  side: Side,
): void {
  const entry = record(accumulators, colorsOf(facts, side));
  entry.fingerprints.push(`${fingerprint}#${side}`);
  entry.rounds.push(facts.rounds);
  if (facts.winner === null) {
    entry.draws += 1;
    return;
  }
  if (facts.winner === side) {
    entry.wins += 1;
    entry.winRounds.push(facts.rounds);
  } else {
    entry.losses += 1;
  }
}

function finish(entry: PairAccumulator, config: MetricsConfig): ColorPairRecord {
  const decided = entry.wins + entry.losses;
  const count = countFingerprints(entry.fingerprints);
  const decidedCount = { total: decided, distinct: Math.min(count.distinct, decided) };
  const sortedRounds = [...entry.rounds].sort((a, b) => a - b);
  const sortedWinRounds = [...entry.winRounds].sort((a, b) => a - b);
  const fast = entry.winRounds.filter((round) => round <= config.balance.fastWinRound).length;
  return {
    pair: entry.pair,
    games: entry.fingerprints.length,
    wins: entry.wins,
    losses: entry.losses,
    draws: entry.draws,
    winRate: sampled(decidedCount, config.floors.colorPair, () => share(entry.wins, decided)),
    interval: sampled(decidedCount, config.floors.colorPair, () => wilsonInterval(entry.wins, decided)),
    medianRounds: quantileSorted(sortedRounds, 0.5),
    medianWinRounds: quantileSorted(sortedWinRounds, 0.5),
    fastWinShare: entry.wins === 0 ? null : share(fast, entry.wins),
  };
}

export interface ColorPairReport {
  readonly records: readonly ColorPairRecord[];
  readonly mirrorGames: number;
  /** Max minus min win rate across pairs that cleared their sample floor. */
  readonly spread: number | null;
}

export function colorPairWinRates(
  logs: readonly SimGameLog[],
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): ColorPairReport {
  const accumulators = new Map<string, PairAccumulator>();
  let mirrorGames = 0;
  for (const log of logs) {
    const facts = gameFacts(log);
    if (facts.mirror) {
      mirrorGames += 1;
      continue;
    }
    const fingerprint = gameFingerprint(log);
    for (const side of SIDE_LIST) addSide(accumulators, facts, fingerprint, side);
  }
  const records = [...accumulators.values()]
    .map((entry) => finish(entry, config))
    .sort((a, b) => a.pair.localeCompare(b.pair));
  return { records, mirrorGames, spread: winRateSpread(records) };
}

/**
 * Max minus min measured win rate. `null` when fewer than two pairs qualify.
 *
 * It is an extreme-order statistic, and that is worth knowing before reading a
 * movement in it as a design fact. Each `winRate` is an estimate with a Wilson
 * interval attached; this keeps the two of them that happened to land furthest
 * apart and throws the other eight away, so it collects the sampling error at
 * both ends and averages nothing down. Two of its inputs carry a confidence
 * interval and its output carries none.
 *
 * The consequence is directional rather than fatal: as a *band* it is honest —
 * no pair was outside these two — and as a *delta* between two runs it is much
 * noisier than any single pair's delta. Measured for the balance gate's own
 * sweep in `packages/metrics/test/balance/round-robin.ts`, which is where the
 * numbers belong because they are a property of that volume and those bots.
 */
export function winRateSpread(records: readonly ColorPairRecord[]): number | null {
  const rates = records.flatMap((entry) => (entry.winRate.value === null ? [] : [entry.winRate.value]));
  if (rates.length < 2) return null;
  return Math.max(...rates) - Math.min(...rates);
}

export interface MatchupRecord {
  readonly pair: string;
  readonly opponent: string;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: Sampled<number>;
}

/**
 * The full directed matchup table. Every non-mirror game contributes both
 * directions, so `matrix[A][B].winRate` and `matrix[B][A].winRate` are exact
 * complements over decided games.
 */
export function matchupMatrix(
  logs: readonly SimGameLog[],
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): readonly MatchupRecord[] {
  const cells = new Map<
    string,
    { pair: string; opponent: string; fingerprints: string[]; wins: number; losses: number }
  >();
  for (const log of logs) {
    const facts = gameFacts(log);
    if (facts.mirror) continue;
    const fingerprint = gameFingerprint(log);
    for (const side of SIDE_LIST) {
      const pair = colorsOf(facts, side);
      const opponent = colorsOf(facts, otherSide(side));
      const key = `${pair}>${opponent}`;
      const cell = cells.get(key) ?? { pair, opponent, fingerprints: [], wins: 0, losses: 0 };
      cell.fingerprints.push(`${fingerprint}#${side}`);
      if (facts.winner === side) cell.wins += 1;
      else if (facts.winner !== null) cell.losses += 1;
      cells.set(key, cell);
    }
  }
  return [...cells.values()]
    .map((cell) => {
      const decided = cell.wins + cell.losses;
      const count = countFingerprints(cell.fingerprints);
      return {
        pair: cell.pair,
        opponent: cell.opponent,
        games: cell.fingerprints.length,
        wins: cell.wins,
        losses: cell.losses,
        winRate: sampled(
          { total: decided, distinct: Math.min(count.distinct, decided) },
          config.floors.matchup,
          () => share(cell.wins, decided),
        ),
      };
    })
    .sort((a, b) => a.pair.localeCompare(b.pair) || a.opponent.localeCompare(b.opponent));
}
