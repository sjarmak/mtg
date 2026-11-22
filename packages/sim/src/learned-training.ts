import {
  LEARNED_FEATURE_SCHEMA,
  LEARNED_ACTION_TYPES,
  createLearnedModel,
  learnedModelSha256,
  type LearnedModelArtifact,
} from './learned-evaluator';
import type { LearnedExample } from './learned-dataset';
import {
  denseLearnedFeatures,
  dotLearnedFeatures,
  isSparseLearnedFeatures,
  validateLearnedFeatures,
  type LearnedFeatures,
} from './learned-features';

export interface LearnedTrainingConfig {
  readonly hiddenSize: number;
  readonly epochs: number;
  readonly learningRate: number;
  readonly l2: number;
  readonly seed: number;
}

export interface LearnedFineTuneConfig extends LearnedTrainingConfig {
  /** L2 penalty toward the supplied checkpoint, preserving pretrained coverage. */
  readonly anchor: number;
}

interface MutableNetwork {
  readonly directWeights: Float64Array;
  readonly inputWeights: Float64Array;
  readonly hiddenBias: Float64Array;
  readonly outputWeights: Float64Array;
  outputBias: number;
}

interface NetworkEvaluation {
  readonly activations: Float64Array;
  readonly score: number;
}

interface TrainingReference {
  readonly directWeights: Float64Array;
  readonly inputWeights: Float64Array;
  readonly hiddenBias: Float64Array;
  readonly outputWeights: Float64Array;
  readonly outputBias: number;
}

function validateConfig(config: LearnedTrainingConfig): void {
  if (!Number.isInteger(config.hiddenSize) || config.hiddenSize < 1) {
    throw new Error('learned training hiddenSize must be a positive integer');
  }
  if (!Number.isInteger(config.epochs) || config.epochs < 1) {
    throw new Error('learned training epochs must be a positive integer');
  }
  if (!Number.isFinite(config.learningRate) || config.learningRate <= 0) {
    throw new Error('learned training learningRate must be positive and finite');
  }
  if (!Number.isFinite(config.l2) || config.l2 < 0) {
    throw new Error('learned training l2 must be non-negative and finite');
  }
  if (!Number.isInteger(config.seed)) throw new Error('learned training seed must be an integer');
}

function canonicalExamples(examples: readonly LearnedExample[]): readonly LearnedExample[] {
  if (examples.length === 0) throw new Error('learned training requires at least one example');
  const ordered = examples.toSorted(
    (left, right) =>
      (left.episodeId < right.episodeId ? -1 : left.episodeId > right.episodeId ? 1 : 0) ||
      left.sequence - right.sequence ||
      (left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0),
  );
  let prior: LearnedExample | undefined;
  for (const example of ordered) {
    if (
      prior?.episodeId === example.episodeId &&
      prior.sequence === example.sequence &&
      prior.candidateId === example.candidateId
    ) {
      throw new Error(
        `learned training has duplicate example ${JSON.stringify([
          example.episodeId,
          example.sequence,
          example.candidateId,
        ])}`,
      );
    }
    prior = example;
    try {
      validateLearnedFeatures(example.features, LEARNED_FEATURE_SCHEMA.size);
    } catch {
      throw new Error('learned training example has invalid features');
    }
    if (!Number.isFinite(example.weight) || example.weight <= 0) {
      throw new Error('learned training example has an invalid weight');
    }
    if (!Number.isFinite(example.return) || example.return < -1 || example.return > 1) {
      throw new Error('learned training example return must be finite and between -1 and 1');
    }
    if (!LEARNED_ACTION_TYPES.includes(example.actionType)) {
      throw new Error('learned training example has an invalid action type');
    }
  }
  return ordered;
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function initialize(config: LearnedTrainingConfig, random: () => number): MutableNetwork {
  const inputSize = LEARNED_FEATURE_SCHEMA.size;
  const inputScale = Math.sqrt(2 / inputSize);
  const outputScale = Math.sqrt(2 / config.hiddenSize);
  return {
    directWeights: new Float64Array(inputSize),
    inputWeights: Float64Array.from(
      { length: inputSize * config.hiddenSize },
      () => (random() * 2 - 1) * inputScale,
    ),
    hiddenBias: Float64Array.from({ length: config.hiddenSize }, () => 0.01),
    outputWeights: Float64Array.from({ length: config.hiddenSize }, () => (random() * 2 - 1) * outputScale),
    outputBias: 0,
  };
}

function networkFromArtifact(artifact: LearnedModelArtifact, hiddenSize: number): MutableNetwork {
  createLearnedModel(artifact);
  if (artifact.hiddenSize !== hiddenSize) {
    throw new Error('learned fine-tuning hidden size must match the checkpoint');
  }
  return {
    directWeights: Float64Array.from(artifact.directWeights),
    inputWeights: Float64Array.from(artifact.inputWeights),
    hiddenBias: Float64Array.from(artifact.hiddenBias),
    outputWeights: Float64Array.from(artifact.outputWeights),
    outputBias: artifact.outputBias,
  };
}

function referenceOf(network: MutableNetwork): TrainingReference {
  return {
    directWeights: Float64Array.from(network.directWeights),
    inputWeights: Float64Array.from(network.inputWeights),
    hiddenBias: Float64Array.from(network.hiddenBias),
    outputWeights: Float64Array.from(network.outputWeights),
    outputBias: network.outputBias,
  };
}

function penaltyGradient(weight: number, initial: number, l2: number, anchor: number): number {
  return l2 * weight + anchor * (weight - initial);
}

function shuffledIndexes(length: number, random: () => number): readonly number[] {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swap]] = [indexes[swap]!, indexes[index]!];
  }
  return indexes;
}

function trainExample(
  network: MutableNetwork,
  example: LearnedExample,
  config: LearnedTrainingConfig,
  reference?: TrainingReference,
  anchor = 0,
): void {
  const inputSize = LEARNED_FEATURE_SCHEMA.size;
  const features =
    isSparseLearnedFeatures(example.features) && (config.l2 !== 0 || anchor !== 0)
      ? denseLearnedFeatures(example.features)
      : example.features;
  const activations = new Float64Array(config.hiddenSize);
  let prediction = network.outputBias + dotLearnedFeatures(network.directWeights, features);
  for (let hidden = 0; hidden < config.hiddenSize; hidden += 1) {
    const row = hidden * inputSize;
    const activation =
      (network.hiddenBias[hidden] ?? 0) + dotLearnedFeatures(network.inputWeights, features, row);
    activations[hidden] = Math.max(0, activation);
    prediction += (activations[hidden] ?? 0) * (network.outputWeights[hidden] ?? 0);
  }
  if (!Number.isFinite(prediction)) throw new Error('learned training produced a non-finite prediction');
  const outputGradient = 2 * example.weight * (prediction - example.return);
  network.outputBias -=
    config.learningRate *
    (outputGradient + anchor * (network.outputBias - (reference?.outputBias ?? network.outputBias)));
  updateExampleWeights(
    network.directWeights,
    features,
    0,
    outputGradient,
    config,
    reference?.directWeights,
    anchor,
  );
  for (let hidden = 0; hidden < config.hiddenSize; hidden += 1) {
    const outputWeight = network.outputWeights[hidden] ?? 0;
    network.outputWeights[hidden] =
      outputWeight -
      config.learningRate *
        (outputGradient * (activations[hidden] ?? 0) +
          penaltyGradient(outputWeight, reference?.outputWeights[hidden] ?? outputWeight, config.l2, anchor));
    if ((activations[hidden] ?? 0) === 0) continue;
    const hiddenGradient = outputGradient * outputWeight;
    network.hiddenBias[hidden] =
      (network.hiddenBias[hidden] ?? 0) -
      config.learningRate *
        (hiddenGradient +
          penaltyGradient(
            network.hiddenBias[hidden] ?? 0,
            reference?.hiddenBias[hidden] ?? network.hiddenBias[hidden] ?? 0,
            config.l2,
            anchor,
          ));
    const row = hidden * inputSize;
    updateExampleWeights(
      network.inputWeights,
      features,
      row,
      hiddenGradient,
      config,
      reference?.inputWeights,
      anchor,
    );
  }
}

function updateExampleWeights(
  weights: Float64Array,
  features: LearnedFeatures,
  row: number,
  dataGradient: number,
  config: LearnedTrainingConfig,
  reference: Float64Array | undefined,
  anchor: number,
): void {
  if (isSparseLearnedFeatures(features) && config.l2 === 0 && anchor === 0) {
    for (let offset = 0; offset < features.indices.length; offset += 1) {
      const index = row + features.indices[offset]!;
      weights[index] =
        (weights[index] ?? 0) - config.learningRate * (dataGradient * features.values[offset]!);
    }
    return;
  }
  const dense = denseLearnedFeatures(features);
  for (let input = 0; input < dense.length; input += 1) {
    const index = row + input;
    const weight = weights[index] ?? 0;
    weights[index] =
      weight -
      config.learningRate *
        (dataGradient * (dense[input] ?? 0) +
          penaltyGradient(weight, reference?.[index] ?? weight, config.l2, anchor));
  }
}

function evaluate(network: MutableNetwork, features: LearnedFeatures, hiddenSize: number): NetworkEvaluation {
  const inputSize = LEARNED_FEATURE_SCHEMA.size;
  const activations = new Float64Array(hiddenSize);
  let score = network.outputBias + dotLearnedFeatures(network.directWeights, features);
  for (let hidden = 0; hidden < hiddenSize; hidden += 1) {
    const row = hidden * inputSize;
    const activation =
      (network.hiddenBias[hidden] ?? 0) + dotLearnedFeatures(network.inputWeights, features, row);
    activations[hidden] = Math.max(0, activation);
    score += (activations[hidden] ?? 0) * (network.outputWeights[hidden] ?? 0);
  }
  if (!Number.isFinite(score)) throw new Error('learned training produced a non-finite prediction');
  return { activations, score };
}

function updateDecisionWeights(
  weights: Float64Array,
  row: number,
  candidates: readonly LearnedExample[],
  factors: Float64Array,
  config: LearnedTrainingConfig,
): void {
  const dataGradients = new Float64Array(LEARNED_FEATURE_SCHEMA.size);
  const seen = new Uint8Array(LEARNED_FEATURE_SCHEMA.size);
  const touched: number[] = [];
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const factor = factors[candidateIndex] ?? 0;
    const features = candidate.features;
    if (isSparseLearnedFeatures(features)) {
      for (let offset = 0; offset < features.indices.length; offset += 1) {
        const input = features.indices[offset]!;
        if (seen[input] === 0) {
          seen[input] = 1;
          touched.push(input);
        }
        dataGradients[input] = (dataGradients[input] ?? 0) + factor * features.values[offset]!;
      }
      continue;
    }
    for (let input = 0; input < features.length; input += 1) {
      const gradient = factor * (features[input] ?? 0);
      if (gradient === 0) continue;
      if (seen[input] === 0) {
        seen[input] = 1;
        touched.push(input);
      }
      dataGradients[input] = (dataGradients[input] ?? 0) + gradient;
    }
  }
  if (config.l2 === 0) {
    for (const input of touched.toSorted((left, right) => left - right)) {
      const index = row + input;
      weights[index] = (weights[index] ?? 0) - config.learningRate * (dataGradients[input] ?? 0);
    }
    return;
  }
  for (let input = 0; input < LEARNED_FEATURE_SCHEMA.size; input += 1) {
    const index = row + input;
    const weight = weights[index] ?? 0;
    weights[index] = weight - config.learningRate * ((dataGradients[input] ?? 0) + config.l2 * weight);
  }
}

function trainDecision(
  network: MutableNetwork,
  chosen: LearnedExample,
  rejected: readonly LearnedExample[],
  decisionWeight: number,
  config: LearnedTrainingConfig,
): void {
  const candidates = [chosen, ...rejected];
  const evaluations = candidates.map((candidate) => evaluate(network, candidate.features, config.hiddenSize));
  const maximumScore = Math.max(...evaluations.map(({ score }) => score));
  const exponentials = evaluations.map(({ score }) => Math.exp(score - maximumScore));
  const normalizer = exponentials.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(normalizer) || normalizer <= 0) {
    throw new Error('learned training produced invalid decision probabilities');
  }
  const gradients = Float64Array.from(
    exponentials,
    (value, index) => decisionWeight * (value / normalizer - (index === 0 ? 1 : 0)),
  );
  const inputSize = LEARNED_FEATURE_SCHEMA.size;
  const outputBiasGradient = gradients.reduce((total, gradient) => total + gradient, 0);
  network.outputBias -= config.learningRate * outputBiasGradient;
  updateDecisionWeights(network.directWeights, 0, candidates, gradients, config);
  for (let hidden = 0; hidden < config.hiddenSize; hidden += 1) {
    const outputWeight = network.outputWeights[hidden] ?? 0;
    let outputGradient = config.l2 * outputWeight;
    const hiddenGradients = new Float64Array(candidates.length);
    for (let candidate = 0; candidate < candidates.length; candidate += 1) {
      const activation = evaluations[candidate]?.activations[hidden] ?? 0;
      const candidateGradient = gradients[candidate] ?? 0;
      outputGradient += candidateGradient * activation;
      hiddenGradients[candidate] = activation === 0 ? 0 : candidateGradient * outputWeight;
    }
    network.outputWeights[hidden] = outputWeight - config.learningRate * outputGradient;
    const hiddenBias = network.hiddenBias[hidden] ?? 0;
    const hiddenBiasGradient =
      hiddenGradients.reduce((total, gradient) => total + gradient, 0) + config.l2 * hiddenBias;
    network.hiddenBias[hidden] = hiddenBias - config.learningRate * hiddenBiasGradient;
    const row = hidden * inputSize;
    updateDecisionWeights(network.inputWeights, row, candidates, hiddenGradients, config);
  }
}

function artifact(network: MutableNetwork, hiddenSize: number): LearnedModelArtifact {
  const payload = {
    schemaVersion: 2 as const,
    featureSchemaSha256: LEARNED_FEATURE_SCHEMA.sha256,
    inputSize: LEARNED_FEATURE_SCHEMA.size,
    hiddenSize,
    directWeights: Array.from(network.directWeights),
    inputWeights: Array.from(network.inputWeights),
    hiddenBias: Array.from(network.hiddenBias),
    outputWeights: Array.from(network.outputWeights),
    outputBias: network.outputBias,
  };
  return { ...payload, sha256: learnedModelSha256(payload) };
}

/** Deterministic offline SGD over whole-game Monte-Carlo returns. */
export function trainLearnedModel(
  examples: readonly LearnedExample[],
  config: LearnedTrainingConfig,
): LearnedModelArtifact {
  validateConfig(config);
  const ordered = canonicalExamples(examples);
  const random = randomGenerator(config.seed);
  const network = initialize(config, random);
  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    for (const index of shuffledIndexes(ordered.length, random)) {
      trainExample(network, ordered[index]!, config);
    }
  }
  return artifact(network, config.hiddenSize);
}

/** Deterministic outcome fine-tuning anchored to a validated pretrained checkpoint. */
export function fineTuneLearnedModel(
  initial: LearnedModelArtifact,
  examples: readonly LearnedExample[],
  config: LearnedFineTuneConfig,
): LearnedModelArtifact {
  validateConfig(config);
  if (!Number.isFinite(config.anchor) || config.anchor < 0) {
    throw new Error('learned fine-tuning anchor must be non-negative and finite');
  }
  const ordered = canonicalExamples(examples);
  const network = networkFromArtifact(initial, config.hiddenSize);
  const reference = referenceOf(network);
  const random = randomGenerator(config.seed);
  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    for (const index of shuffledIndexes(ordered.length, random)) {
      trainExample(network, ordered[index]!, config, reference, config.anchor);
    }
  }
  return artifact(network, config.hiddenSize);
}

/** Deterministic softmax ranking over one chosen action and all alternatives per decision. */
export function trainLearnedRankingModel(
  examples: readonly LearnedExample[],
  config: LearnedTrainingConfig,
): LearnedModelArtifact {
  validateConfig(config);
  const ordered = canonicalExamples(examples);
  const groups: Array<{ readonly chosen: LearnedExample; readonly rejected: readonly LearnedExample[] }> = [];
  for (let start = 0; start < ordered.length;) {
    const first = ordered[start]!;
    let end = start + 1;
    while (
      end < ordered.length &&
      ordered[end]!.episodeId === first.episodeId &&
      ordered[end]!.sequence === first.sequence
    ) {
      end += 1;
    }
    const decision = ordered.slice(start, end);
    const chosen = decision.filter((example) => example.return === 1);
    const rejected = decision.filter((example) => example.return === -1);
    if (chosen.length !== 1 || rejected.length !== decision.length - 1 || rejected.length === 0) {
      throw new Error(
        `learned ranking decision ${first.episodeId}:${String(first.sequence)} must have exactly one chosen candidate and at least one rejected candidate`,
      );
    }
    if (decision.some((example) => example.weight !== chosen[0]!.weight)) {
      throw new Error(
        `learned ranking decision ${first.episodeId}:${String(first.sequence)} must use one decision weight`,
      );
    }
    groups.push({ chosen: chosen[0]!, rejected });
    start = end;
  }
  const random = randomGenerator(config.seed);
  const network = initialize(config, random);
  const chosenTypeCounts = new Map<LearnedExample['actionType'], number>();
  for (const group of groups) {
    chosenTypeCounts.set(group.chosen.actionType, (chosenTypeCounts.get(group.chosen.actionType) ?? 0) + 1);
  }
  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    for (const index of shuffledIndexes(groups.length, random)) {
      const group = groups[index]!;
      const typeCount = chosenTypeCounts.get(group.chosen.actionType);
      if (typeCount === undefined) throw new Error('learned ranking lost a chosen action type');
      const decisionWeight = group.chosen.weight * (groups.length / (chosenTypeCounts.size * typeCount));
      trainDecision(network, group.chosen, group.rejected, decisionWeight, config);
    }
  }
  return artifact(network, config.hiddenSize);
}
