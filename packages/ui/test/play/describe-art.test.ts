/**
 * The launcher's art line reports coverage of the staged set, not the size of
 * the chosen manifest (mtg-v2wr). A manifest with 87 entries that only
 * overlaps 20 of a 249-card set must say 20 of 249, not 87.
 */
import { describe, expect, it } from 'vitest';
import { describeArt } from '../../tools/stage-set-bundles';
import type { ArtOutcome } from '../../tools/stage-set-bundles';
import type { CachedSetArt, StagedSetArt } from '../../tools/stage-set-art';
import type { PreferenceOrdering } from '../../tools/art-preference-order';

/** No preferences file: the case every set but the flagship is in. */
const NO_PICKS: PreferenceOrdering = {
  manifest: { formatVersion: 2, art: {} },
  path: null,
  reordered: [],
  unavailable: [],
  unknown: [],
};

function stagedArt(overrides: Partial<StagedSetArt> = {}): StagedSetArt {
  return {
    manifest: { formatVersion: 2, art: {} },
    copied: 0,
    remote: 0,
    missing: [],
    pending: [],
    ...overrides,
  };
}

/** Nothing was remote, which is every generative run's manifest. */
function cachedArt(overrides: Partial<CachedSetArt> = {}): CachedSetArt {
  return {
    manifest: { formatVersion: 2, art: {} },
    fetched: 0,
    reused: 0,
    failures: [],
    ...overrides,
  };
}

describe('describeArt', () => {
  it('reports how many of the staged set are covered, not the manifest size', () => {
    const outcome: ArtOutcome = {
      status: 'staged',
      staged: stagedArt({ copied: 117 }),
      cached: cachedArt(),
      what: 'the art run in out/art/xmp-variants',
      covered: 20,
      total: 249,
      preferences: NO_PICKS,
    };

    const line = describeArt(outcome);

    expect(line).toContain('for 20 of 249 cards');
    expect(line).not.toContain('for 87 cards');
    expect(line).toContain('229 of them show the pending frame');
  });

  it('says nothing about pending cards when the manifest covers the whole set', () => {
    const outcome: ArtOutcome = {
      status: 'staged',
      staged: stagedArt({ copied: 3 }),
      cached: cachedArt(),
      what: 'the manifest beside the set',
      covered: 3,
      total: 3,
      preferences: NO_PICKS,
    };

    expect(describeArt(outcome)).not.toContain('pending frame');
  });

  it('says which preferences file chose the art, and says so when there is none', () => {
    const outcome: ArtOutcome = {
      status: 'staged',
      staged: stagedArt({ copied: 3 }),
      cached: cachedArt(),
      what: 'the manifest beside the set',
      covered: 3,
      total: 3,
      preferences: { ...NO_PICKS, path: '/repo/data/art-preferences/xmp.json', reordered: ['xmp-a'] },
    };

    expect(describeArt(outcome)).toContain('/repo/data/art-preferences/xmp.json');
    expect(describeArt(outcome)).toContain('1 card(s) reordered');
    expect(describeArt({ ...outcome, preferences: NO_PICKS })).toContain('No art preferences');
  });

  it('counts pulled illustrations in the staged total and says where they came from', () => {
    const outcome: ArtOutcome = {
      status: 'staged',
      staged: stagedArt({ copied: 0 }),
      cached: cachedArt({ fetched: 160, reused: 4 }),
      what: 'the manifest beside the set',
      covered: 162,
      total: 162,
      preferences: NO_PICKS,
    };

    const line = describeArt(outcome);

    expect(line).toContain('Staged 164 illustrations for 162 of 162 cards');
    expect(line).toContain('160 pulled from their own host and 4 already in the shared cache');
    expect(line).toContain('served from this page');
  });

  it('says nothing about pulling when the manifest named no other host', () => {
    const outcome: ArtOutcome = {
      status: 'staged',
      staged: stagedArt({ copied: 3 }),
      cached: cachedArt(),
      what: 'the art run in out/art/xmp-variants',
      covered: 3,
      total: 3,
      preferences: NO_PICKS,
    };

    expect(describeArt(outcome)).not.toContain('pulled from their own host');
  });

  it('names every illustration that could not be pulled rather than swallowing it', () => {
    const outcome: ArtOutcome = {
      status: 'staged',
      staged: stagedArt({ copied: 0 }),
      cached: cachedArt({ fetched: 1, failures: ['reduced-a: fetch failed'] }),
      what: 'the manifest beside the set',
      covered: 2,
      total: 2,
      preferences: NO_PICKS,
    };

    const line = describeArt(outcome);

    expect(line).toContain('1 illustrations could not be pulled');
    expect(line).toContain('reduced-a: fetch failed');
  });
});
