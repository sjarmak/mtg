/**
 * The criteria schema, which is the only place a cube's restrictions are read.
 *
 * Two things are worth a test here and the rest is zod doing its job: the
 * defaults, because they encode the Lucky Paper norms rather than arbitrary
 * numbers, and the curve-band refinement, because overlapping bands are not a
 * stricter constraint but an ambiguous one and nothing downstream would notice.
 */
import { describe, expect, it } from 'vitest';
import {
  bandHolds,
  bandLabel,
  CUBE_DEFAULT_CARDS_PER_SEAT,
  CUBE_DEFAULT_SEATS,
  CUBE_DEFAULT_SIZE,
  CubeCriteriaSchema,
  cubeCopyLimit,
  draftCapacity,
  parseArchetypeSpecs,
} from '../src/criteria';

const MINIMAL = { prompt: 'a cube', format: 'modern' } as const;

describe('the defaults', () => {
  it('are the 360-card, 8-seat, singleton cube the norms describe', () => {
    const criteria = CubeCriteriaSchema.parse(MINIMAL);
    expect(criteria.size).toBe(CUBE_DEFAULT_SIZE);
    expect(criteria.seats).toBe(CUBE_DEFAULT_SEATS);
    expect(criteria.cardsPerSeat).toBe(CUBE_DEFAULT_CARDS_PER_SEAT);
    expect(criteria.singleton).toBe(true);
    // 8 x 45 is 360, which is why the default size is the default size.
    expect(draftCapacity(criteria)).toBe(criteria.size);
  });

  it('state no curve and no archetypes, because both are the designer’s to state', () => {
    const criteria = CubeCriteriaSchema.parse(MINIMAL);
    expect(criteria.curve).toStrictEqual([]);
    expect(criteria.archetypes).toStrictEqual([]);
  });

  it('put the copy limit at one, and at the game’s four when the cube is not singleton', () => {
    expect(cubeCopyLimit(CubeCriteriaSchema.parse(MINIMAL))).toBe(1);
    expect(cubeCopyLimit(CubeCriteriaSchema.parse({ ...MINIMAL, singleton: false }))).toBe(4);
  });
});

describe('a curve the designer did state', () => {
  it('rejects bands that overlap, naming both', () => {
    const result = CubeCriteriaSchema.safeParse({
      ...MINIMAL,
      curve: [
        { from: 0, to: 2, minCards: 1, maxCards: 10 },
        { from: 2, to: 4, minCards: 1, maxCards: 10 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join(' ')).toContain(
      'MV 0-2 and MV 2-4 overlap',
    );
  });

  it('rejects an open-ended band that is not the last one', () => {
    const result = CubeCriteriaSchema.safeParse({
      ...MINIMAL,
      curve: [
        { from: 3, to: null, minCards: 1, maxCards: 10 },
        { from: 6, to: 8, minCards: 1, maxCards: 10 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join(' ')).toContain('must be the last one');
  });

  it('accepts contiguous bands in any order and labels them for a reader', () => {
    const criteria = CubeCriteriaSchema.parse({
      ...MINIMAL,
      curve: [
        { from: 6, to: null, minCards: 10, maxCards: 40 },
        { from: 0, to: 2, minCards: 100, maxCards: 200 },
        { from: 3, to: 5, minCards: 60, maxCards: 120 },
      ],
    });
    expect(criteria.curve.map(bandLabel)).toStrictEqual(['MV 6+', 'MV 0-2', 'MV 3-5']);
    const open = criteria.curve[0];
    expect(open).toBeDefined();
    if (open !== undefined) {
      expect(bandHolds(open, 20)).toBe(true);
      expect(bandHolds(open, 5)).toBe(false);
    }
  });
});

describe('an archetype', () => {
  it('may not be named twice', () => {
    const result = CubeCriteriaSchema.safeParse({
      ...MINIMAL,
      archetypes: [
        { name: 'boros aggro', colors: ['W', 'R'], minPlayable: 20 },
        { name: 'boros aggro', colors: ['W', 'R'], minPlayable: 30 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).join(' ')).toContain(
      'archetype named twice: boros aggro',
    );
  });

  it('must state at least one color, so membership stays checkable', () => {
    const result = CubeCriteriaSchema.safeParse({
      ...MINIMAL,
      archetypes: [{ name: 'artifacts', colors: [], minPlayable: 20 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('an archetype written for a command line', () => {
  it('reads name, colors and minimum out of one term', () => {
    expect(parseArchetypeSpecs('boros aggro:WR:24, dimir control:ub:18')).toStrictEqual([
      { name: 'boros aggro', colors: ['W', 'R'], minPlayable: 24 },
      { name: 'dimir control', colors: ['U', 'B'], minPlayable: 18 },
    ]);
  });

  it('states nothing when nothing was written', () => {
    expect(parseArchetypeSpecs('')).toStrictEqual([]);
  });

  it('reads a minimum availability out of a fourth field, and leaves it unstated without one', () => {
    expect(parseArchetypeSpecs('boros aggro:WR:24:0.25, dimir control:UB:18')).toStrictEqual([
      { name: 'boros aggro', colors: ['W', 'R'], minPlayable: 24, minAvailability: 0.25 },
      { name: 'dimir control', colors: ['U', 'B'], minPlayable: 18 },
    ]);
  });

  it('throws on a term the schema would not take, rather than dropping it', () => {
    // A typo that silently disappeared would build a cube to criteria the
    // designer did not state and report it as meeting them.
    expect(() => parseArchetypeSpecs('boros aggro:WR')).toThrow(/name:colors:minPlayable/);
    expect(() => parseArchetypeSpecs('boros aggro:WX:24')).toThrow(/boros aggro:WX:24/);
    expect(() => parseArchetypeSpecs('boros aggro:WR:many')).toThrow(/boros aggro:WR:many/);
    expect(() => parseArchetypeSpecs(':WR:24')).toThrow(/:WR:24/);
    expect(() => parseArchetypeSpecs('boros aggro:WR:24:often')).toThrow(/boros aggro:WR:24:often/);
    expect(() => parseArchetypeSpecs('boros aggro:WR:24:2')).toThrow(/boros aggro:WR:24:2/);
  });

  it('refuses a trailing colon rather than reading the nothing after it as a zero minimum', () => {
    // `Number('')` is 0, and a silent 0 is a minimum availability the designer
    // never asked for — one that no cube can ever fail, which is worse than one
    // that is wrong.
    expect(() => parseArchetypeSpecs('boros aggro:WR:24:')).toThrow(/minAvailability/);
  });
});

describe('an unknown field', () => {
  it('is rejected rather than ignored', () => {
    expect(CubeCriteriaSchema.safeParse({ ...MINIMAL, powerBand: 'vintage' }).success).toBe(false);
  });
});
