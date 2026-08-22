/** Generic set-generation guidance and evaluation over a checked calibration profile. */
import {
  verifyCalibrationProfile,
  type CalibrationProfile,
  type CalibrationTarget,
  type StaticSetProfile,
} from '@mtg/data';

export interface CalibrationBand {
  readonly lower: number;
  readonly upper: number;
}

export interface CalibrationProfileIdentity {
  readonly profileVersion: CalibrationProfile['profileVersion'];
  readonly harnessVersion: CalibrationProfile['harnessVersion'];
  readonly digest: string;
}

export interface CalibrationDecisions {
  readonly profile: CalibrationProfileIdentity;
  readonly recommendations: {
    readonly curve: Readonly<Record<string, CalibrationBand>>;
    readonly interaction: Readonly<Record<string, CalibrationBand>>;
  };
  readonly constraints: {
    readonly complexity: Readonly<Record<string, CalibrationBand>>;
    readonly weakCard: Readonly<Record<string, CalibrationBand>>;
    readonly bombCeiling: Readonly<Record<string, CalibrationBand>>;
  };
}

function profileIdentity(profile: CalibrationProfile): CalibrationProfileIdentity {
  return {
    profileVersion: profile.profileVersion,
    harnessVersion: profile.harnessVersion,
    digest: profile.contentAddress.digest,
  };
}

function band(target: CalibrationTarget): CalibrationBand {
  return { lower: target.target.lower, upper: target.target.upper };
}

/**
 * Converts the versioned document into the two kinds of choices set generation
 * can act on. The mapping is by declared axis, never by source or subject set.
 */
export function calibrationDecisions(profile: CalibrationProfile): CalibrationDecisions {
  const checked = verifyCalibrationProfile(profile);
  const curve: Record<string, CalibrationBand> = {};
  const interaction: Record<string, CalibrationBand> = {};
  const complexity: Record<string, CalibrationBand> = {};
  const weakCard: Record<string, CalibrationBand> = {};
  const bombCeiling: Record<string, CalibrationBand> = {};

  for (const target of checked.targets) {
    switch (target.axis) {
      case 'curve':
        curve[target.id] = band(target);
        break;
      case 'interaction':
        interaction[target.id] = band(target);
        break;
      case 'complexity':
        complexity[target.id] = band(target);
        break;
      case 'weak-card':
        weakCard[target.id] = band(target);
        break;
      case 'bomb-ceiling':
        bombCeiling[target.id] = band(target);
        break;
    }
  }

  return {
    profile: profileIdentity(checked),
    recommendations: { curve, interaction },
    constraints: { complexity, weakCard, bombCeiling },
  };
}

export type CalibrationMetricStatus = 'below' | 'inside' | 'above' | 'missing';

export interface CalibrationMetricEvaluation {
  readonly id: string;
  readonly axis: CalibrationTarget['axis'];
  readonly kind: CalibrationTarget['kind'];
  readonly unit: CalibrationTarget['unit'];
  readonly target: CalibrationBand;
  readonly value: number | null;
  readonly status: CalibrationMetricStatus;
  readonly deltaToBand: number | null;
  readonly population: CalibrationTarget['population'];
  readonly provenance: CalibrationTarget['provenance'];
  readonly caveat: string;
}

export interface SetCalibrationEvaluation {
  readonly subject: { readonly code: string; readonly name: string };
  readonly profile: CalibrationProfileIdentity;
  readonly metrics: readonly CalibrationMetricEvaluation[];
  readonly claimsNativePlay: false;
  readonly claimsHumanEvidence: false;
  readonly caveat: string;
}

function evaluateMetric(target: CalibrationTarget, value: number | undefined): CalibrationMetricEvaluation {
  if (value === undefined) {
    return {
      id: target.id,
      axis: target.axis,
      kind: target.kind,
      unit: target.unit,
      target: band(target),
      value: null,
      status: 'missing',
      deltaToBand: null,
      population: target.population,
      provenance: target.provenance,
      caveat: target.caveat,
    };
  }
  const status = value < target.target.lower ? 'below' : value > target.target.upper ? 'above' : 'inside';
  const deltaToBand =
    status === 'below' ? value - target.target.lower : status === 'above' ? value - target.target.upper : 0;
  return {
    id: target.id,
    axis: target.axis,
    kind: target.kind,
    unit: target.unit,
    target: band(target),
    value,
    status,
    deltaToBand,
    population: target.population,
    provenance: target.provenance,
    caveat: target.caveat,
  };
}

/** Evaluates the subject's static observations without upgrading their evidence class. */
export function evaluateSetCalibration(
  subject: StaticSetProfile,
  profile: CalibrationProfile,
): SetCalibrationEvaluation {
  const checked = verifyCalibrationProfile(profile);
  const observations = new Map(
    subject.comparableScalars.map((observation) => [observation.id, observation.value]),
  );
  return {
    subject: { code: subject.set.code, name: subject.set.name },
    profile: profileIdentity(checked),
    metrics: checked.targets.map((target) => evaluateMetric(target, observations.get(target.id))),
    claimsNativePlay: checked.evidence.claimsNativePlay,
    claimsHumanEvidence: checked.evidence.claimsHumanEvidence,
    caveat: checked.evidence.caveat,
  };
}
