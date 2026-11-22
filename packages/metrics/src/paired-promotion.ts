import { normalQuantile } from './normal-quantile';

export type PromotionSplit = 'tuning' | 'holdout';

/**
 * The verdict interval is the paired normal approximation the power plan is
 * written in, made simultaneous over the headline and every segment by a
 * Bonferroni split of the 5%. The Hoeffding bound is reported beside it: it
 * assumes nothing about the spread, but on a 0-1 score it is wider than the
 * plan's own arithmetic by a factor that no campaign this size could pass.
 */
export const PRIMARY_INTERVAL_METHOD = 'simultaneous-two-sided-95%-paired-normal';
export const SECONDARY_INTERVAL_METHOD = 'simultaneous-two-sided-95%-hoeffding-bounds';

/** Normal quantiles behind a two-sided 95% paired test at 80% power. */
export const NORMAL_95_TWO_SIDED = 1.959_963_984_540_054;
export const NORMAL_80_POWER = 0.841_621_233_572_914_3;

/** The independent units a paired comparison needs to see one effect at a given spread. */
export function requiredIndependentUnitsFor(standardDeviation: number, smallestUsefulEffect: number): number {
  return Math.max(
    2,
    Math.ceil((((NORMAL_95_TWO_SIDED + NORMAL_80_POWER) * standardDeviation) / smallestUsefulEffect) ** 2),
  );
}

export interface PromotionInterval {
  readonly low: number;
  readonly high: number;
}

export interface PromotionSegmentDimension {
  readonly id: string;
  readonly values: readonly string[];
}

export interface PromotionUnit {
  readonly unitId: string;
  readonly difference: number | null;
  readonly segments: Readonly<Record<string, string>>;
}

export interface PromotionCompletion {
  readonly rate: number;
}

export interface PromotionSegment {
  readonly dimension: string;
  readonly id: string;
  readonly independentUnits: number;
  readonly meanPairedDifference: number | null;
  readonly interval95: PromotionInterval | null;
  readonly hoeffdingInterval95: PromotionInterval | null;
}

export interface PromotionPower {
  readonly anticipatedStandardDeviation: number | null;
  readonly realizedStandardDeviation: number | null;
  readonly requiredIndependentUnits: number | null;
  readonly requiredIndependentUnitsAtRealizedVariance: number | null;
}

export interface PairedPromotionResult {
  readonly strength: {
    readonly intervalMethod: typeof PRIMARY_INTERVAL_METHOD;
    readonly secondaryIntervalMethod: typeof SECONDARY_INTERVAL_METHOD;
    readonly status: 'measured' | 'under-sampled';
    readonly independentUnits: number;
    readonly excludedUnits: number;
    readonly meanPairedDifference: number | null;
    readonly interval95: PromotionInterval | null;
    readonly hoeffdingInterval95: PromotionInterval | null;
    readonly power: PromotionPower;
    readonly bySegment: readonly PromotionSegment[];
  };
  readonly promotion: {
    readonly status: 'promote-candidate' | 'retain-baseline';
    readonly reasons: readonly string[];
  };
}

export interface PairedPromotionInput {
  readonly split: PromotionSplit;
  readonly units: readonly PromotionUnit[];
  readonly segmentDimensions: readonly PromotionSegmentDimension[];
  readonly minimumIndependentUnits: number;
  readonly smallestUsefulEffect: number;
  /** The spread the campaign's own power plan assumed, when it declared one. */
  readonly anticipatedStandardDeviation?: number;
  readonly regressionMargin: number;
  readonly maximumFailureRate: number;
  readonly completion: {
    readonly baseline: PromotionCompletion;
    readonly candidate: PromotionCompletion;
  };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clampedInterval(average: number, halfWidth: number): PromotionInterval {
  return { low: Math.max(-1, average - halfWidth), high: Math.min(1, average + halfWidth) };
}

/** Paired normal interval at the realized spread, Bonferroni-adjusted over the family. */
function normalInterval95(values: readonly number[], familyComparisons: number): PromotionInterval | null {
  const spread = standardDeviation(values);
  if (spread === null) return null;
  const z = normalQuantile(1 - 0.025 / familyComparisons);
  return clampedInterval(mean(values)!, (z * spread) / Math.sqrt(values.length));
}

/** Distribution-free interval for differences bounded in [-1, 1], simultaneous over the family. */
function hoeffdingInterval95(values: readonly number[], familyComparisons: number): PromotionInterval | null {
  if (values.length < 2) return null;
  return clampedInterval(mean(values)!, Math.sqrt((2 * Math.log(40 * familyComparisons)) / values.length));
}

function validateInput(input: PairedPromotionInput): void {
  if (!Number.isInteger(input.minimumIndependentUnits) || input.minimumIndependentUnits < 2) {
    throw new Error('minimum independent units must be an integer of at least two');
  }
  if (
    !Number.isFinite(input.smallestUsefulEffect) ||
    input.smallestUsefulEffect <= 0 ||
    input.smallestUsefulEffect > 1
  ) {
    throw new Error('smallest useful effect must be within (0, 1]');
  }
  const anticipated = input.anticipatedStandardDeviation;
  if (anticipated !== undefined && (!Number.isFinite(anticipated) || anticipated <= 0 || anticipated > 1)) {
    throw new Error('anticipated standard deviation must be within (0, 1]');
  }
  if (!Number.isFinite(input.regressionMargin) || input.regressionMargin < 0 || input.regressionMargin > 1) {
    throw new Error('regression margin must be within [0, 1]');
  }
  if (
    !Number.isFinite(input.maximumFailureRate) ||
    input.maximumFailureRate < 0 ||
    input.maximumFailureRate > 1
  ) {
    throw new Error('maximum failure rate must be within [0, 1]');
  }
  for (const [trialArm, completion] of Object.entries(input.completion)) {
    if (!Number.isFinite(completion.rate) || completion.rate < 0 || completion.rate > 1) {
      throw new Error(`${trialArm} completion rate must be within [0, 1]`);
    }
  }
  const unitIds = new Set<string>();
  for (const unit of input.units) {
    if (unitIds.has(unit.unitId)) throw new Error(`duplicate independent unit ${unit.unitId}`);
    unitIds.add(unit.unitId);
    if (unit.difference !== null && (!Number.isFinite(unit.difference) || Math.abs(unit.difference) > 1)) {
      throw new Error(`paired difference for ${unit.unitId} must be within [-1, 1]`);
    }
    for (const dimension of input.segmentDimensions) {
      const value = unit.segments[dimension.id];
      if (value === undefined || !dimension.values.includes(value)) {
        throw new Error(`unit ${unit.unitId} has an invalid ${dimension.id} segment`);
      }
    }
  }
}

/** Apply one conservative promotion rule to already validated paired outcome units. */
export function comparePairedPromotion(input: PairedPromotionInput): PairedPromotionResult {
  validateInput(input);
  const differences = input.units.flatMap((unit) => (unit.difference === null ? [] : [unit.difference]));
  const familyComparisons =
    1 + input.segmentDimensions.reduce((sum, dimension) => sum + dimension.values.length, 0);
  const confidence = normalInterval95(differences, familyComparisons);
  const realizedStandardDeviation = standardDeviation(differences);
  const anticipated = input.anticipatedStandardDeviation ?? null;
  const power: PromotionPower = {
    anticipatedStandardDeviation: anticipated,
    realizedStandardDeviation,
    requiredIndependentUnits:
      anticipated === null ? null : requiredIndependentUnitsFor(anticipated, input.smallestUsefulEffect),
    requiredIndependentUnitsAtRealizedVariance:
      realizedStandardDeviation === null
        ? null
        : requiredIndependentUnitsFor(realizedStandardDeviation, input.smallestUsefulEffect),
  };
  const bySegment = input.segmentDimensions.flatMap((dimension) =>
    dimension.values.map((id) => {
      const values = input.units.flatMap((unit) =>
        unit.segments[dimension.id] === id && unit.difference !== null ? [unit.difference] : [],
      );
      return {
        dimension: dimension.id,
        id,
        independentUnits: values.length,
        meanPairedDifference: mean(values),
        interval95: normalInterval95(values, familyComparisons),
        hoeffdingInterval95: hoeffdingInterval95(values, familyComparisons),
      };
    }),
  );
  const status =
    differences.length >= input.minimumIndependentUnits && confidence !== null
      ? ('measured' as const)
      : ('under-sampled' as const);
  const reasons: string[] = [];
  if (input.split !== 'holdout') reasons.push('not-held-out');
  if (status !== 'measured') reasons.push('insufficient-independent-units');
  if (
    power.requiredIndependentUnitsAtRealizedVariance !== null &&
    differences.length < power.requiredIndependentUnitsAtRealizedVariance
  ) {
    reasons.push('realized-variance-exceeds-power-plan');
  }
  const minimumCompletionRate = 1 - input.maximumFailureRate;
  if (input.completion.baseline.rate < minimumCompletionRate) {
    reasons.push('baseline-failure-rate-exceeded');
  }
  if (input.completion.candidate.rate < minimumCompletionRate) {
    reasons.push('candidate-failure-rate-exceeded');
  }
  if (confidence === null || confidence.low < input.smallestUsefulEffect) {
    reasons.push('minimum-effect-not-established');
  }
  if (
    bySegment.some(
      (segment) => segment.interval95 === null || segment.interval95.low < -input.regressionMargin,
    )
  ) {
    reasons.push('segment-regression-not-excluded');
  }
  return {
    strength: {
      intervalMethod: PRIMARY_INTERVAL_METHOD,
      secondaryIntervalMethod: SECONDARY_INTERVAL_METHOD,
      status,
      independentUnits: differences.length,
      excludedUnits: input.units.length - differences.length,
      meanPairedDifference: mean(differences),
      interval95: confidence,
      hoeffdingInterval95: hoeffdingInterval95(differences, familyComparisons),
      power,
      bySegment,
    },
    promotion: {
      status: reasons.length === 0 ? 'promote-candidate' : 'retain-baseline',
      reasons,
    },
  };
}
