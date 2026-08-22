/**
 * Deterministic, seeded sample selection over a pool of generated entries.
 *
 * Reuses `../rng.ts`, the same mulberry32 generator the allocator seeds slots
 * with, so a sample is exactly as reproducible as the set it is drawn from:
 * same pool, same seed, same size, same cards, forever. Nothing here persists
 * a chosen sample to disk — both the critic-run tool and the adjudication tool
 * call this over the same pool with the same seed, so their draws agree by
 * construction rather than by reading a shared file, and there is no
 * intermediate artifact that can drift out of sync with either of them.
 */
import { createRng, shuffle } from '../rng';
import type { Entry } from '../validate/index';

export interface SampleOptions {
  readonly seed: string;
  readonly size: number;
}

export interface SampledEntry {
  readonly entry: Entry;
  /** 1-based position in the drawn order, stable for a given seed and pool. */
  readonly position: number;
}

export function selectSample(entries: readonly Entry[], options: SampleOptions): readonly SampledEntry[] {
  if (!Number.isInteger(options.size) || options.size <= 0) {
    throw new Error(`sample size must be a positive integer, got ${options.size}`);
  }
  if (options.size > entries.length) {
    throw new Error(`sample size ${options.size} exceeds the pool of ${entries.length} entries`);
  }
  const shuffled = shuffle(entries, createRng(options.seed));
  return shuffled.slice(0, options.size).map((entry, index) => ({ entry, position: index + 1 }));
}
