import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { actionKey, type Action, type AgentView, type PlayerAgent } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, type GreedyBotConfig } from './config';
import { decideGreedy } from './greedy-bot';
import {
  createLearnedModel,
  encodeLearnedCandidate,
  sparsifyLearnedFeatures,
  type LearnedModelArtifact,
} from './learned-evaluator';

export interface AdvantageCalibrationSample {
  readonly predictedDifference: number;
  readonly utilityDifference: number;
}

export interface AdvantageCalibration {
  readonly minimumScoreAdvantage: number;
  readonly changed: number;
  readonly utilityGain: number;
  readonly meanUtilityGain: number;
  /** Gain after removing the single most favorable branch observation. */
  readonly supportedUtilityGain: number;
}

export interface LearnedAdvantagePolicyPayload {
  readonly schemaVersion: 1;
  readonly model: LearnedModelArtifact;
  readonly minimumScoreAdvantage: number;
}

export interface LearnedAdvantagePolicyArtifact extends LearnedAdvantagePolicyPayload {
  readonly sha256: string;
}

export function learnedAdvantagePolicySha256(payload: LearnedAdvantagePolicyPayload): string {
  return botEvidenceSha256(payload);
}

/**
 * Select an abstention margin on branch labels not used for fine-tuning.
 * Removing the strongest positive observation requires each accepted margin to
 * retain support beyond a single lucky continuation.
 */
export function calibrateAdvantageMargin(
  samples: readonly AdvantageCalibrationSample[],
): AdvantageCalibration {
  if (samples.length === 0) throw new Error('advantage calibration requires at least one sample');
  for (const sample of samples) {
    if (!Number.isFinite(sample.predictedDifference) || !Number.isFinite(sample.utilityDifference)) {
      throw new Error('advantage calibration samples must be finite');
    }
  }
  const thresholds = [
    0,
    ...samples.map((sample) => sample.predictedDifference).filter((difference) => difference > 0),
  ].toSorted((left, right) => left - right);
  let best: AdvantageCalibration | undefined;
  for (const threshold of new Set(thresholds)) {
    const taken = samples.filter((sample) => sample.predictedDifference > threshold);
    const utilityGain = taken.reduce((total, sample) => total + sample.utilityDifference, 0);
    const largestPositiveGain = Math.max(0, ...taken.map((sample) => sample.utilityDifference));
    const candidate = {
      minimumScoreAdvantage: threshold,
      changed: taken.length,
      utilityGain,
      meanUtilityGain: taken.length === 0 ? 0 : utilityGain / taken.length,
      supportedUtilityGain: utilityGain - largestPositiveGain,
    };
    if (
      best === undefined ||
      candidate.supportedUtilityGain > best.supportedUtilityGain ||
      (candidate.supportedUtilityGain === best.supportedUtilityGain &&
        candidate.minimumScoreAdvantage > best.minimumScoreAdvantage)
    ) {
      best = candidate;
    }
  }
  if (best === undefined) throw new Error('advantage calibration produced no margin candidates');
  return best;
}

function validatePolicy(policy: LearnedAdvantagePolicyArtifact): void {
  if (policy.schemaVersion !== 1) {
    throw new Error(`unsupported learned advantage policy schema ${String(policy.schemaVersion)}`);
  }
  createLearnedModel(policy.model);
  if (!Number.isFinite(policy.minimumScoreAdvantage) || policy.minimumScoreAdvantage < 0) {
    throw new Error('learned advantage policy margin must be non-negative and finite');
  }
  const { sha256: _sha256, ...payload } = policy;
  if (learnedAdvantagePolicySha256(payload) !== policy.sha256) {
    throw new Error('learned advantage policy digest does not match its payload');
  }
}

/** A coverage-preserving policy that departs from the reference only beyond a held-out margin. */
export function learnedAdvantageBot(
  name: string,
  policy: LearnedAdvantagePolicyArtifact,
  fallbackConfig: GreedyBotConfig = DEFAULT_GREEDY_CONFIG,
): PlayerAgent {
  validatePolicy(policy);
  const model = createLearnedModel(policy.model);
  const score = (view: AgentView, action: Action) =>
    model.score(sparsifyLearnedFeatures(encodeLearnedCandidate(view, action)));
  return {
    name,
    decide(view: AgentView): Action {
      const reference = decideGreedy(view, fallbackConfig);
      if (!view.decision.complete || view.decision.options.length < 2 || view.decision.kind === 'cardName') {
        return reference;
      }
      let best = reference;
      let bestScore = score(view, reference);
      const referenceScore = bestScore;
      for (const option of view.decision.options) {
        if (actionKey(option) === actionKey(reference)) continue;
        const optionScore = score(view, option);
        if (optionScore > bestScore) {
          best = option;
          bestScore = optionScore;
        }
      }
      return bestScore - referenceScore > policy.minimumScoreAdvantage ? best : reference;
    },
  };
}
