/**
 * `selectSample`: deterministic, seeded draws over a pool of entries.
 */
import { describe, expect, it } from 'vitest';
import type { Entry } from '@mtg/setgen';
import { selectSample } from '../../src/critic/sample';
import { testEntry } from './support';

function pool(size: number): Entry[] {
  return Array.from({ length: size }, (_unused, index) =>
    testEntry({ id: `CW${String(index + 1).padStart(2, '0')}`, collectorNumber: index + 1 }),
  );
}

describe('selectSample', () => {
  it('draws the same sample, in the same order, for the same seed and pool', () => {
    const entries = pool(8);
    const first = selectSample(entries, { seed: 'critic-sample-1', size: 5 });
    const second = selectSample(entries, { seed: 'critic-sample-1', size: 5 });
    expect(first.map((sampled) => sampled.entry.slot.id)).toStrictEqual(
      second.map((sampled) => sampled.entry.slot.id),
    );
  });

  it('draws a different sample for a different seed', () => {
    const entries = pool(8);
    const a = selectSample(entries, { seed: 'seed-a', size: 5 });
    const b = selectSample(entries, { seed: 'seed-b', size: 5 });
    expect(a.map((sampled) => sampled.entry.slot.id)).not.toStrictEqual(
      b.map((sampled) => sampled.entry.slot.id),
    );
  });

  it('numbers positions 1-based in drawn order', () => {
    const sample = selectSample(pool(6), { seed: 'critic-sample-1', size: 4 });
    expect(sample.map((sampled) => sampled.position)).toStrictEqual([1, 2, 3, 4]);
  });

  it('draws distinct entries with no duplicates and no entries outside the pool', () => {
    const entries = pool(10);
    const poolIds = new Set(entries.map((entry) => entry.slot.id));
    const sample = selectSample(entries, { seed: 'critic-sample-1', size: 10 });
    const drawnIds = sample.map((sampled) => sampled.entry.slot.id);
    expect(new Set(drawnIds).size).toBe(drawnIds.length);
    for (const id of drawnIds) expect(poolIds.has(id)).toBe(true);
  });

  it('allows a sample the exact size of the pool', () => {
    const entries = pool(3);
    expect(selectSample(entries, { seed: 'x', size: 3 })).toHaveLength(3);
  });

  it('rejects a non-positive or non-integer size', () => {
    const entries = pool(3);
    expect(() => selectSample(entries, { seed: 'x', size: 0 })).toThrow(/positive integer/);
    expect(() => selectSample(entries, { seed: 'x', size: -1 })).toThrow(/positive integer/);
    expect(() => selectSample(entries, { seed: 'x', size: 1.5 })).toThrow(/positive integer/);
  });

  it('rejects a size larger than the pool', () => {
    const entries = pool(3);
    expect(() => selectSample(entries, { seed: 'x', size: 4 })).toThrow(/exceeds the pool/);
  });
});
