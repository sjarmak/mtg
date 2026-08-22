/**
 * `loadTideglassEntryPool`: the first real execution of the recorded-replay
 * path this bead's sample is drawn from. Everything else in this suite builds
 * synthetic entries; this test proves the actual pool the sampling and
 * adjudication tools draw from is real, hermetic and the shape the rest of
 * this package assumes.
 */
import { describe, expect, it } from 'vitest';
import { loadTideglassEntryPool } from '../../src/critic/pool';

describe('loadTideglassEntryPool', () => {
  it('replays the recorded run into ninety entries, all model-generated', async () => {
    const pool = await loadTideglassEntryPool();
    expect(pool.entries).toHaveLength(90);
    expect(pool.brief.setCode).toBe('TGR');
    expect(pool.brief.seed).toBe('tideglass-1');
  });

  it('gives every entry a unique slot id and a named card', async () => {
    const pool = await loadTideglassEntryPool();
    const ids = pool.entries.map((entry) => entry.slot.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of pool.entries) {
      expect(entry.card.name.length).toBeGreaterThan(0);
      expect(entry.slot.id).toBe(entry.slot.id.toUpperCase());
    }
  });

  it('carries a well-formed revision report, whatever the recorded critique pass decided', async () => {
    const pool = await loadTideglassEntryPool();
    for (const revision of pool.revisions) {
      expect(['applied', 'reverted', 'unfilled']).toContain(revision.outcome);
      expect(revision.slotId.length).toBeGreaterThan(0);
      if (revision.outcome === 'reverted') expect(revision.reason).toBeDefined();
    }
  });

  it('is deterministic: two loads of the same recorded run produce the same entry ids in the same order', async () => {
    const first = await loadTideglassEntryPool();
    const second = await loadTideglassEntryPool();
    expect(second.entries.map((entry) => entry.slot.id)).toStrictEqual(
      first.entries.map((entry) => entry.slot.id),
    );
  });
});
