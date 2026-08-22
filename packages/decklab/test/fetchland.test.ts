import { describe, expect, it } from 'vitest';
import { basicLandTypesOf, FETCHLAND_COUNT, fetchTargets } from '../src/fetchland';

/**
 * The mtg-bc2.44 table and the type-line read it depends on, pinned away from
 * `assembleDeck` so a wrong entry names itself rather than surfacing as a mana
 * base that is two sources out.
 */
describe('fetchTargets', () => {
  it('gives a printed fetch the two types it names', () => {
    expect(fetchTargets('Arid Mesa')).toEqual({ types: ['Mountain', 'Plains'], basicsOnly: false });
    expect(fetchTargets('Polluted Delta')).toEqual({ types: ['Island', 'Swamp'], basicsOnly: false });
  });

  it('marks a search that only a basic satisfies', () => {
    expect(fetchTargets('Evolving Wilds')?.basicsOnly).toBe(true);
    expect(fetchTargets('Obscura Storefront')).toEqual({
      types: ['Plains', 'Island', 'Swamp'],
      basicsOnly: true,
    });
  });

  it('matches the way the store spells a name, not the way a model types it', () => {
    expect(fetchTargets('arid mesa')).toEqual(fetchTargets('Arid Mesa'));
    expect(fetchTargets('ARID  MESA')).toEqual(fetchTargets('Arid Mesa'));
  });

  it('knows nothing about a land that taps for itself', () => {
    expect(fetchTargets('Sacred Foundry')).toBeUndefined();
    expect(fetchTargets('Island')).toBeUndefined();
    // Excluded on purpose: the search costs {1}, so it is not a source on the
    // turn a castability check asks about it.
    expect(fetchTargets('Bant Panorama')).toBeUndefined();
  });

  it('holds every entry the store search kept, and none that names no type', () => {
    expect(FETCHLAND_COUNT).toBe(38);
  });
});

describe('basicLandTypesOf', () => {
  it('reads the subtypes printed after the dash', () => {
    expect(basicLandTypesOf('Land — Mountain Plains')).toEqual(['Plains', 'Mountain']);
    expect(basicLandTypesOf('Basic Land — Island')).toEqual(['Island']);
    // Dryad Arbor is a Forest, which is exactly what a Misty Rainforest finds.
    expect(basicLandTypesOf('Land Creature — Forest Dryad')).toEqual(['Forest']);
  });

  it('gives nothing to a land printed without land types', () => {
    expect(basicLandTypesOf('Land')).toEqual([]);
    expect(basicLandTypesOf('Land — Urza’s Mine')).toEqual([]);
    expect(basicLandTypesOf('Instant')).toEqual([]);
  });
});
