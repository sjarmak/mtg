/**
 * The no-dominant-strategy guard.
 *
 * The the prior project precedent asserted two separate things and this keeps them
 * separate (`the prior-project reuse audit` item 5, metrics report
 * §6.2): a win-rate band per strategy, *and* a guard that no strategy wins too
 * fast too often. They fail for different reasons and want different fixes — a
 * pair at 72% over long games is an overpowered card pool, a pair at 72% that
 * closes by round six is an unanswerable curve — so a finding names which.
 *
 * A pair is *dominant* only when both conditions hold at once. That is
 * deliberate: the plain win-rate band already fails on the first case, and
 * folding them together would report one problem twice and leave the fast-clock
 * signal invisible whenever the pair also happened to be inside the band.
 *
 * Pairs whose win rate is under-sampled are listed, never judged: no evidence
 * is not the same as no dominance (metrics report §8 step 7).
 */
import type { MetricsConfig } from './config';
import { DEFAULT_METRICS_CONFIG } from './config';
import type { ColorPairRecord } from './win-rate';

export type DominanceReason = 'fastClock';

export interface DominanceFinding {
  readonly pair: string;
  readonly winRate: number;
  readonly fastWinShare: number;
  readonly medianWinRounds: number | null;
  readonly reason: DominanceReason;
  readonly detail: string;
}

export interface OutOfBandFinding {
  readonly pair: string;
  readonly winRate: number;
  readonly side: 'above' | 'below';
  readonly detail: string;
}

export interface DominanceResult {
  /** Pairs whose win rate cleared its sample floor and was judged. */
  readonly evaluated: readonly string[];
  /** Pairs skipped for want of evidence. */
  readonly underSampled: readonly string[];
  readonly spread: number | null;
  readonly outOfBand: readonly OutOfBandFinding[];
  readonly dominant: readonly DominanceFinding[];
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function evaluateDominance(
  records: readonly ColorPairRecord[],
  spread: number | null,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): DominanceResult {
  const bands = config.balance;
  const evaluated: string[] = [];
  const underSampled: string[] = [];
  const outOfBand: OutOfBandFinding[] = [];
  const dominant: DominanceFinding[] = [];

  for (const entry of records) {
    const winRate = entry.winRate.value;
    if (winRate === null) {
      underSampled.push(entry.pair);
      continue;
    }
    evaluated.push(entry.pair);

    if (winRate > bands.colorPairWinRate.max || winRate < bands.colorPairWinRate.min) {
      const side = winRate > bands.colorPairWinRate.max ? 'above' : 'below';
      outOfBand.push({
        pair: entry.pair,
        winRate,
        side,
        detail:
          `${entry.pair} won ${formatPercent(winRate)} of ${entry.wins + entry.losses} decided games, ` +
          `${side} the ${formatPercent(bands.colorPairWinRate.min)}-${formatPercent(bands.colorPairWinRate.max)} band`,
      });
    }

    const fastWinShare = entry.fastWinShare;
    if (fastWinShare === null) continue;
    if (winRate >= bands.dominantWinRate && fastWinShare > bands.maxFastWinShare) {
      dominant.push({
        pair: entry.pair,
        winRate,
        fastWinShare,
        medianWinRounds: entry.medianWinRounds,
        reason: 'fastClock',
        detail:
          `${entry.pair} won ${formatPercent(winRate)} and closed ${formatPercent(fastWinShare)} of its wins ` +
          `by round ${bands.fastWinRound} (limit ${formatPercent(bands.maxFastWinShare)})`,
      });
    }
  }

  return { evaluated, underSampled, spread, outOfBand, dominant };
}
