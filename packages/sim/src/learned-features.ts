export interface SparseLearnedFeatures {
  readonly kind: 'sparse';
  readonly size: number;
  readonly indices: Uint32Array;
  readonly values: Float64Array;
}

export type LearnedFeatures = Float64Array | SparseLearnedFeatures;

export function isSparseLearnedFeatures(features: LearnedFeatures): features is SparseLearnedFeatures {
  return !(features instanceof Float64Array);
}

export function learnedFeatureSize(features: LearnedFeatures): number {
  return isSparseLearnedFeatures(features) ? features.size : features.length;
}

export function sparsifyLearnedFeatures(features: Float64Array): SparseLearnedFeatures {
  const indices: number[] = [];
  const values: number[] = [];
  for (const [index, value] of features.entries()) {
    if (value !== 0) {
      indices.push(index);
      values.push(value);
    }
  }
  return {
    kind: 'sparse',
    size: features.length,
    indices: Uint32Array.from(indices),
    values: Float64Array.from(values),
  };
}

export function denseLearnedFeatures(features: LearnedFeatures): Float64Array {
  if (!isSparseLearnedFeatures(features)) return features;
  const result = new Float64Array(features.size);
  for (let offset = 0; offset < features.indices.length; offset += 1) {
    result[features.indices[offset]!] = features.values[offset]!;
  }
  return result;
}

export function validateLearnedFeatures(features: LearnedFeatures, size: number): void {
  if (learnedFeatureSize(features) !== size) throw new Error('learned features have the wrong length');
  if (!isSparseLearnedFeatures(features)) {
    if (!features.every(Number.isFinite)) throw new Error('learned features contain a non-finite value');
    return;
  }
  if (features.indices.length !== features.values.length) {
    throw new Error('sparse learned feature indexes and values have different lengths');
  }
  let prior = -1;
  for (let offset = 0; offset < features.indices.length; offset += 1) {
    const index = features.indices[offset]!;
    const value = features.values[offset]!;
    if (index <= prior || index >= size) throw new Error('sparse learned feature indexes are not ordered');
    if (!Number.isFinite(value) || value === 0)
      throw new Error('sparse learned features contain an invalid value');
    prior = index;
  }
}

export function dotLearnedFeatures(weights: Float64Array, features: LearnedFeatures, row = 0): number {
  let result = 0;
  if (isSparseLearnedFeatures(features)) {
    for (let offset = 0; offset < features.indices.length; offset += 1) {
      result += (weights[row + features.indices[offset]!] ?? 0) * features.values[offset]!;
    }
    return result;
  }
  for (let index = 0; index < features.length; index += 1) {
    result += (weights[row + index] ?? 0) * (features[index] ?? 0);
  }
  return result;
}
