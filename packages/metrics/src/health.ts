/**
 * The composite: every metric plus every verdict, from one pile of game logs.
 *
 * Deliberately not a weighted 0-100 score. The MtG Health Index's shape —
 * normalized sub-scores with explicit weights — is verdict **inspire** in the
 * metrics report (§4.2), and its constructed-specific inputs (price, event
 * growth) do not apply to us. More to the point, a single composite number
 * cannot fail a CI job usefully: "health 71" tells nobody which band moved.
 * The sub-metrics and their gates stay separate all the way to the report.
 */
import type { SimGameLog } from '@mtg/sim';
import type { AbilityPool, AbilityUsageReport } from './ability-usage';
import { abilityUsage } from './ability-usage';
import type { MetricsConfig } from './config';
import { DEFAULT_METRICS_CONFIG } from './config';
import type { DecisivenessResult } from './decisiveness';
import { decisiveness } from './decisiveness';
import type { DominanceResult } from './dominance';
import { evaluateDominance } from './dominance';
import type { GameLengthDistribution, OnPlayResult } from './game-length';
import { gameLengthDistribution, onPlayWinRate } from './game-length';
import type { GateResult } from './gates';
import {
  abstainWithinNoise,
  evaluateGates,
  failedGates,
  notApplicableGates,
  underSampledGates,
  withinNoiseGates,
} from './gates';
import type { ManaCheckpointResult } from './mana';
import { manaCheckpoints } from './mana';
import type { Sampled } from './sample';
import { countGames, duplicateShare } from './sample';
import type { ColorPairReport, MatchupRecord } from './win-rate';
import { colorPairWinRates, matchupMatrix } from './win-rate';

export interface FormatHealthOptions {
  /** Names the run in the report: the set, the bots, the seed. */
  readonly label?: string;
  readonly config?: MetricsConfig;
  /** The matchup matrix is O(pairs^2) rows; off by default. */
  readonly includeMatchups?: boolean;
  /**
   * The composition of the pool that was played, from `abilityPool()`.
   *
   * The one input here that the logs cannot supply. Given it, the report
   * carries the usage floor of `./ability-usage` — the gate that says whether
   * the pool's abilities fired at all, without which every band below can be
   * green for a format whose mechanic never ran. Left out, that gate is absent
   * from the report rather than guessed at.
   */
  readonly pool?: AbilityPool;
}

export interface FormatHealth {
  readonly label: string;
  readonly games: number;
  readonly distinctGames: number;
  /** Share of games that repeated another game's trajectory exactly. */
  readonly duplicateShare: number;
  readonly gameLength: Sampled<GameLengthDistribution>;
  readonly onPlay: Sampled<OnPlayResult>;
  readonly mana: readonly ManaCheckpointResult[];
  readonly decisiveness: Sampled<DecisivenessResult>;
  readonly colorPairs: ColorPairReport;
  readonly matchups: readonly MatchupRecord[];
  readonly dominance: DominanceResult;
  /** Present exactly when `options.pool` was. */
  readonly abilityUsage: AbilityUsageReport | null;
  readonly gates: readonly GateResult[];
  readonly config: MetricsConfig;
}

export function formatHealth(logs: readonly SimGameLog[], options: FormatHealthOptions = {}): FormatHealth {
  const config = options.config ?? DEFAULT_METRICS_CONFIG;
  const count = countGames(logs);
  const colorPairs = colorPairWinRates(logs, config);
  const dominance = evaluateDominance(colorPairs.records, colorPairs.spread, config);
  const length = gameLengthDistribution(logs, config);
  const onPlay = onPlayWinRate(logs, config);
  const mana = manaCheckpoints(logs, config);
  const resolution = decisiveness(logs, config);
  const abilities = options.pool === undefined ? null : abilityUsage(logs, options.pool, config);

  return {
    label: options.label ?? 'format health',
    games: count.total,
    distinctGames: count.distinct,
    duplicateShare: duplicateShare(count),
    gameLength: length,
    onPlay,
    mana,
    decisiveness: resolution,
    colorPairs,
    matchups: options.includeMatchups === true ? matchupMatrix(logs, config) : [],
    dominance,
    abilityUsage: abilities,
    // The gate constructors compare an observation to a band and know nothing
    // about how many games bought it, so the run volume is applied here, once,
    // over the assembled list: a miss smaller than the seed deviation at this
    // volume becomes `withinNoise` rather than `fail` (`./gates`
    // `abstainWithinNoise`). Doing it at the seam means the report, `fairness`
    // and the balance suite read one verdict rather than three opinions.
    gates: abstainWithinNoise(
      evaluateGates({
        length,
        onPlay,
        mana,
        decisiveness: resolution,
        colorPairs,
        dominance,
        ...(abilities === null ? {} : { abilityUsage: abilities }),
        config,
      }),
      count.total,
    ),
    config,
  };
}

/** Gates that failed outright. An empty list is what `test:balance` asserts. */
export function healthFailures(health: FormatHealth): readonly GateResult[] {
  return failedGates(health.gates);
}

/** Gates that had too little evidence to judge. Reported, never asserted on. */
export function healthUnderSampled(health: FormatHealth): readonly GateResult[] {
  return underSampledGates(health.gates);
}

/**
 * Gates that missed a band by less than this run's own dice.
 *
 * The sibling of `healthUnderSampled` and read the same way: neither is a
 * pass, and a caller counting passes has to subtract both. The pinned balance
 * suite fails the run on a non-empty list here, because at 10,035 games a miss
 * inside the noise means the gate could not be judged at the volume that was
 * supposed to be able to judge it.
 */
export function healthWithinNoise(health: FormatHealth): readonly GateResult[] {
  return withinNoiseGates(health.gates);
}

/** Gates with nothing in the subject to measure. Reported, never asserted on. */
export function healthNotApplicable(health: FormatHealth): readonly GateResult[] {
  return notApplicableGates(health.gates);
}
