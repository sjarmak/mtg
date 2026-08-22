/**
 * The analysis document: what one measured run looks like on the wire.
 *
 * The `health` block is `@mtg/metrics`' `FormatHealth` verbatim — the same
 * object `formatHealth()` returns, serialized. It is restated here as a
 * structural type rather than imported because `@mtg/ui` depends on `@mtg/dsl`
 * and (for types only) `@mtg/sim`, and adding a metrics dependency would pull
 * the whole sim stack — `node:worker_threads`, `node:fs` — into a browser
 * bundle for the sake of six interfaces. The same trade the replay reader makes
 * with the log columns, and it is held honest the same way: the fixtures under
 * `test/analysis/fixtures/` are produced by running `@mtg/metrics` for real,
 * so a field rename upstream fails `readAnalysisRun` in this package's tests.
 *
 * Everything the route needs beyond the health block travels alongside it: the
 * skeleton targets the set was generated against (so composition is judged
 * against its design intent rather than shown in isolation) and the per-card
 * table (which the log schema cannot yet produce in-lab and which therefore
 * names its own statistic instead of assuming one).
 */
import type { Card } from '@mtg/dsl';
import type { ColorIdentity } from '../../styles/tokens';

/** `@mtg/metrics`' `Sampled<T>`, serialized. */
export interface SampledValue<T> {
  readonly value: T | null;
  readonly samples: number;
  readonly distinctSamples: number;
  readonly floor: number;
  readonly underSampled: boolean;
}

export interface NumericBand {
  readonly min: number;
  readonly max: number;
}

/**
 * Four, not three. `notApplicable` is `@mtg/metrics`' fourth gate status —
 * "there is nothing in this subject to measure", as distinct from "this run
 * bought too little evidence" — and it was missing here, which meant a
 * document produced from a set with no activated ability on any card would
 * have been *refused* by `readAnalysisRun` rather than drawn. Nothing had ever
 * produced such a document, so nothing had noticed.
 *
 * Five now. `withinNoise` is `@mtg/metrics`' fifth — "the miss is smaller than
 * the seed deviation at this run's volume, so the run cannot tell it from its
 * own dice" — and it arrives here for the same reason the fourth did: it is
 * produced, and a reader that refuses it refuses the document. `npm run
 * analyze` defaults to 2,700 games against the 10,035 the deviations were
 * measured at, so this is the ordinary volume for it rather than a corner.
 */
export type GateStatus = 'pass' | 'fail' | 'underSampled' | 'notApplicable' | 'withinNoise';

export const GATE_STATUSES: readonly GateStatus[] = [
  'pass',
  'fail',
  'underSampled',
  'notApplicable',
  'withinNoise',
];

/** `@mtg/metrics`' `GateBand`: the bound in numbers. An open side is `null`. */
export interface GateBand {
  readonly min: number | null;
  readonly max: number | null;
}

/** One CI verdict. `observed === null` exactly when the gate is under-sampled. */
export interface RunGate {
  readonly id: string;
  readonly label: string;
  readonly status: GateStatus;
  readonly observed: number | null;
  readonly bound: string;
  /** The same bound as `bound`, in numbers, so a miss can be measured. */
  readonly band: GateBand;
  readonly detail: string;
  readonly source: string;
}

/** `@mtg/metrics`' four fairness questions, in the order they are asked. */
export const FAIRNESS_QUESTIONS = ['balance', 'luck', 'shape', 'cards'] as const;
export type FairnessQuestion = (typeof FAIRNESS_QUESTIONS)[number];

export const FAIRNESS_VERDICTS = ['fair', 'unfair', 'unjudged'] as const;
export type FairnessVerdict = (typeof FAIRNESS_VERDICTS)[number];

/**
 * One missed band, with both sides of the comparison as numbers.
 *
 * Produced by `@mtg/metrics`' `fairness()` and carried in the document rather
 * than recomputed here. The route could re-derive it from `health.gates`, and
 * that is exactly what it must not do: a second implementation of the verdict
 * is a second answer to "is this set fair", and the two would drift the first
 * time a band moved.
 */
export interface RunFinding {
  readonly gate: string;
  readonly question: FairnessQuestion;
  readonly label: string;
  readonly measured: number;
  /** The edge that was missed. */
  readonly required: number;
  /** How far outside, in the gate's own units. Always positive. */
  readonly distance: number;
  /** How far this statistic moves on the seed alone, where that is measured. */
  readonly noise: number | null;
  /** `true` when the miss is smaller than the dice move the statistic. */
  readonly withinNoise: boolean;
  readonly detail: string;
}

/** A gate that returned neither a pass nor a fail, and why. */
export interface RunUnjudged {
  readonly gate: string;
  readonly label: string;
  readonly status: 'underSampled' | 'notApplicable' | 'withinNoise';
  readonly reason: string;
}

export interface RunFairnessReading {
  readonly question: FairnessQuestion;
  /** The question in a person's words, from the producer. */
  readonly asks: string;
  readonly verdict: FairnessVerdict;
  /** Gate ids; the full gates are in `health.gates`, keyed by the same id. */
  readonly gates: readonly string[];
  readonly passed: number;
  readonly findings: readonly RunFinding[];
  readonly unjudged: readonly RunUnjudged[];
}

/**
 * The answer, as the producer computed it.
 *
 * `label`, `games` and `distinctGames` are on `@mtg/metrics`' `Fairness` and
 * deliberately not here: the health block beside this one already carries all
 * three, and two game counts in one document is one that can disagree.
 */
export interface RunFairness {
  readonly verdict: FairnessVerdict;
  /** One per question, in `FAIRNESS_QUESTIONS` order, always all four. */
  readonly readings: readonly RunFairnessReading[];
  /** Every reading's findings, worst miss first. */
  readonly findings: readonly RunFinding[];
  /** Gate ids no question claimed; non-empty forces the verdict to unjudged. */
  readonly unattributed: readonly string[];
}

/** `@mtg/stats`' `Summary`: the descriptive shape of a length distribution. */
export interface LengthSummary {
  readonly count: number;
  readonly mean: number;
  readonly median: number;
  readonly p10: number;
  readonly p25: number;
  readonly p75: number;
  readonly p90: number;
  readonly iqr: number;
  readonly min: number;
  readonly max: number;
}

export interface GameLength {
  readonly rounds: LengthSummary;
  /** Games ending on each round; index is the round, index 0 unused. */
  readonly roundHistogram: readonly number[];
  readonly finishedByRound: readonly number[];
  readonly modalRound: number;
  readonly longGameShare: number;
  readonly blowoutShare: number;
}

export interface Decisiveness {
  readonly stallRate: number;
  readonly deckOutRate: number;
  readonly drawRate: number;
  readonly decidedByRound: number;
  readonly decisiveRound: number;
  readonly inertTurnRate: number;
  readonly inertTurnsPerGame: number;
}

export interface WinRateInterval {
  readonly low: number;
  readonly high: number;
}

export interface ColorPairRecord {
  /** WUBRG color string, e.g. `"UR"`. */
  readonly pair: string;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly winRate: SampledValue<number>;
  readonly interval: SampledValue<WinRateInterval>;
  readonly medianRounds: number | null;
  readonly medianWinRounds: number | null;
  readonly fastWinShare: number | null;
}

export interface ColorPairReport {
  readonly records: readonly ColorPairRecord[];
  readonly mirrorGames: number;
  readonly spread: number | null;
}

/** The subset of `MetricsConfig` the charts draw as bands and reference lines. */
export interface HealthBands {
  readonly length: {
    readonly medianRounds: NumericBand;
    readonly longGameRound: number;
    readonly maxLongGameShare: number;
    readonly maxIqrRounds: number;
  };
  readonly balance: {
    readonly colorPairWinRate: NumericBand;
    readonly maxWinRateSpread: number;
  };
  readonly decisiveness: {
    readonly maxStallRate: number;
    readonly maxDeckOutRate: number;
    readonly decisiveRound: number;
    readonly minDecidedByRound: number;
    readonly maxInertTurnRate: number;
  };
}

export interface RunHealth {
  readonly label: string;
  readonly games: number;
  readonly distinctGames: number;
  /** Share of games that repeated another game's trajectory exactly. */
  readonly duplicateShare: number;
  readonly gameLength: SampledValue<GameLength>;
  readonly decisiveness: SampledValue<Decisiveness>;
  readonly colorPairs: ColorPairReport;
  readonly gates: readonly RunGate[];
  readonly bands: HealthBands;
}

/** One curve bucket's target, flattened from the skeleton's creature curve. */
export interface CurveTarget {
  readonly label: string;
  readonly mvMin: number;
  /** `null` is an open top bucket, e.g. `5+`. */
  readonly mvMax: number | null;
  readonly cards: number;
}

export interface RarityTarget {
  readonly rarity: string;
  readonly cards: number;
}

export interface ColorTarget {
  readonly identity: ColorIdentity;
  readonly cards: number;
}

/**
 * What the set was supposed to be, from `@mtg/design-data`'s skeleton profile.
 *
 * Carried in the document rather than derived here so the dashboard compares a
 * set against the profile it was actually generated against, not against
 * whatever the canon says today.
 */
export interface SkeletonTargets {
  readonly profile: string;
  readonly setSize: number;
  readonly creatureShare: number;
  readonly rarities: readonly RarityTarget[];
  readonly colors: readonly ColorTarget[];
  readonly curve: readonly CurveTarget[];
}

export interface CardPerformance {
  readonly cardId: string;
  readonly name: string;
  readonly rarity: string;
  readonly identity: ColorIdentity;
  /** Observations behind the rate, duplicates included. */
  readonly games: number;
  /** Distinct trajectories among them: what the floor is checked against. */
  readonly distinctGames: number;
  readonly wins: number;
  /** `null` when the producer withheld it. Re-checked against `floor` here. */
  readonly winRate: number | null;
}

/**
 * The per-card table, with its statistic named.
 *
 * 17lands' GIH WR needs to know which cards were in hand, and the sim's replay
 * schema records per-turn aggregates rather than card instances, so the exact
 * metric is not computable in-lab yet. Naming the statistic in the document
 * instead of assuming it means the view reports what was measured; when the
 * card-instance columns land, only `statistic` and `definition` change.
 */
export interface CardPerformanceBlock {
  readonly statistic: string;
  readonly definition: string;
  readonly floor: number;
  readonly entries: readonly CardPerformance[];
}

export type PreconMatchupStatus = 'healthy' | 'outside' | 'underSampled';

/** The written deck identity and immutable list digest behind a matchup row. */
export interface PreconMatchupDeck {
  readonly id: string;
  readonly name: string;
  readonly plan: string;
  readonly payoff: string;
  readonly contentHash: string;
}

/** One directed cell: `deckId`'s result against `opponentId`. */
export interface PreconMatchupCell {
  readonly deckId: string;
  readonly opponentId: string;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** Withheld until the confidence requirement is met. */
  readonly winRate: number | null;
  /** Withheld alongside `winRate`; never a confident-looking whisker on a thin run. */
  readonly interval: WinRateInterval | null;
  readonly intervalHalfWidth: number;
  readonly status: PreconMatchupStatus;
}

/** Preconstructed decks are a separate product from the set's Limited sweep. */
export interface PreconMatchupBlock {
  readonly decks: readonly PreconMatchupDeck[];
  readonly planExecution:
    | {
        readonly status: 'measured';
        readonly samples: number;
        readonly evidence: string;
      }
    | { readonly status: 'unavailable'; readonly reason: string };
  /** Complete round robins, with reversed deck order used to reverse fixed seats. */
  readonly seatOrders: number;
  readonly games: number;
  readonly gamesPerMatchup: number;
  readonly band: NumericBand;
  readonly maxIntervalHalfWidth: number;
  readonly cells: readonly PreconMatchupCell[];
}

export interface RunSetRef {
  readonly code: string;
  readonly name: string;
}

export interface AnalysisRun {
  /** Stable across revisions of the same run; the diff view keys on it. */
  readonly id: string;
  readonly label: string;
  readonly seed: string;
  readonly set: RunSetRef;
  /** What produced the document, e.g. a command line. Shown in the header. */
  readonly producedBy: string;
  readonly health: RunHealth;
  /** Is the set fair, and where it missed. Computed once, by the producer. */
  readonly fairness: RunFairness;
  readonly targets: SkeletonTargets;
  readonly cards: CardPerformanceBlock;
  /** `null` when no written decks matched the measured set. */
  readonly precons: PreconMatchupBlock | null;
}

/** A generated set file, parsed into DSL cards. */
export interface SetDocument {
  readonly code: string;
  readonly name: string;
  readonly cards: readonly Card[];
}
