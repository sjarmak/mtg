/**
 * The reduced reference artifact: what it keeps, what it names, and the one
 * thing it must never be mistaken for.
 *
 * The last test in this file is a compile-time assertion, so `npm run typecheck`
 * is where it runs and `vitest` is not: a reduced set is a different type from a
 * complete one, and the `@ts-expect-error` fails the build the moment a reduced
 * set becomes assignable where completeness is required. If the split ever
 * collapses into a boolean, that line stops erroring and the test fails for
 * having no error to expect.
 *
 * The five-position fixture is in `fixtures/reduced-reference-set.ts`, shared
 * with the test for the playable document cut from a reduced set: two suites
 * that reduce different source sets can disagree and both stay green.
 */
import { describe, expect, it } from 'vitest';
import {
  PartialExecutableReferenceSetSchema,
  buildExecutableReferenceSet,
  buildPartialExecutableReferenceSet,
  type ExecutableCoverageEvidence,
  type ExecutableReferenceSet,
} from '@mtg/data';
import {
  ORACLE,
  SPECS,
  UUID,
  copyEvidence,
  corpus,
  evidence,
  withRefusedRed,
} from './fixtures/reduced-reference-set';

const sheetsByName = (
  artifact: ReturnType<typeof buildPartialExecutableReferenceSet>,
): ReadonlyMap<string, (typeof artifact.collation.sheets)[number]> =>
  new Map(artifact.collation.sheets.map((sheet) => [sheet.name, sheet]));

describe('reduced executable reference seam', () => {
  it('keeps every provable position and names the one it drops', () => {
    const artifact = buildPartialExecutableReferenceSet(corpus(), withRefusedRed());

    expect(PartialExecutableReferenceSetSchema.parse(artifact)).toEqual(artifact);
    expect(artifact.kind).toBe('position-reduced-reference-set');
    expect(artifact.cards.map((card) => [card.id, card.name, card.rarity])).toEqual([
      ['rdc-1', 'Still Meadow', 'common'],
      ['rdc-2', 'Meadow Sentry', 'common'],
      ['rdc-4', 'Tidal Recall', 'uncommon'],
      ['rdc-5', 'Grove Warden', 'rare'],
    ]);
    expect(artifact.dropped).toHaveLength(1);
    const [drop] = artifact.dropped;
    if (drop === undefined) throw new Error('drop missing');
    expect(drop.collectorNumber).toBe(3);
    expect(drop.name).toBe('Ember Runner');
    expect(drop.code).toBe('NONEXACT_OUTCOME');
    expect(drop.outcome).toBe('untranslatable');
    expect(drop.reason).toContain('untranslatable');
    // The submitted evidence is kept whole: the drop explains a row, it does
    // not delete one.
    expect(artifact.coverage.rows).toHaveLength(SPECS.length);
    // A kept card is byte-identical to the one the strict builder would hold.
    expect(artifact.cards[1]).toEqual(buildExecutableReferenceSet(corpus(), evidence()).cards[1]);
  });

  it('reports the census of both halves so a lost color is visible', () => {
    const { census } = buildPartialExecutableReferenceSet(corpus(), withRefusedRed());

    expect(census.kept.positions).toBe(4);
    expect(census.kept.byRarity).toEqual([
      { rarity: 'common', positions: 2 },
      { rarity: 'uncommon', positions: 1 },
      { rarity: 'rare', positions: 1 },
    ]);
    expect(census.kept.byColor).toEqual([
      { color: 'W', positions: 1 },
      { color: 'U', positions: 1 },
      { color: 'G', positions: 1 },
      { color: 'colorless', positions: 1 },
    ]);
    expect(census.dropped).toEqual({
      positions: 1,
      byRarity: [{ rarity: 'common', positions: 1 }],
      byColor: [{ color: 'R', positions: 1 }],
    });
    // Red is gone entirely, and the census is the only place that says so.
    expect(census.kept.byColor.some((entry) => entry.color === 'R')).toBe(false);
  });

  it('reweights the sheets and refuses the booster the reduced pool cannot fill', () => {
    const artifact = buildPartialExecutableReferenceSet(corpus(), withRefusedRed());
    const sheets = sheetsByName(artifact);

    const common = sheets.get('common');
    if (common === undefined) throw new Error('common sheet missing');
    expect([common.sourceCards, common.cards]).toEqual([2, 1]);
    expect([common.sourceTotalWeight, common.totalWeight]).toEqual([2, 1]);
    expect(Object.keys(common.weights)).toEqual([UUID(2)]);

    // Untouched sheets keep their source weight exactly.
    const rare = sheets.get('rare');
    expect(rare?.totalWeight).toBe(rare?.sourceTotalWeight);
    expect(artifact.collation.emptiedSheets).toEqual([]);

    expect(artifact.collation.fillsAPack).toBe(true);
    expect(artifact.collation.boosters).toEqual([
      { contents: { basic: 1, common: 1, uncommon: 1, rare: 1 }, weight: 1, packSize: 4 },
    ]);
    expect(artifact.collation.boostersTotalWeight).toBe(1);
    expect(artifact.collation.unfillableBoosters).toEqual([
      {
        contents: { basic: 1, common: 2, uncommon: 1, rare: 1 },
        weight: 3,
        packSize: 5,
        shortSlots: [{ sheet: 'common', need: 2, have: 1 }],
      },
    ]);
  });

  it('says a pool that cannot open any pack cannot open any pack', () => {
    const input = copyEvidence();
    for (const row of input.rows) row.outcome = 'unreached';
    const artifact = buildPartialExecutableReferenceSet(corpus(), input);

    expect(artifact.cards).toEqual([]);
    expect(artifact.dropped).toHaveLength(SPECS.length);
    expect(artifact.collation.emptiedSheets).toEqual(['basic', 'common', 'rare', 'uncommon']);
    expect(artifact.collation.sheets).toEqual([]);
    expect(artifact.collation.boosters).toEqual([]);
    expect(artifact.collation.boostersTotalWeight).toBe(0);
    expect(artifact.collation.fillsAPack).toBe(false);
  });

  it('drops nothing when every position is provable, and is still not a complete set', () => {
    const artifact = buildPartialExecutableReferenceSet(corpus(), evidence());

    expect(artifact.dropped).toEqual([]);
    expect(artifact.cards).toHaveLength(SPECS.length);
    expect(artifact.census.dropped.positions).toBe(0);
    expect(artifact.collation.fillsAPack).toBe(true);
    expect(artifact.collation.boosters).toHaveLength(2);
    // Nothing was lost, and the artifact still does not claim completeness.
    expect(artifact.kind).toBe('position-reduced-reference-set');
  });

  it.each([
    ['MISSING_POSITION', (input: ExecutableCoverageEvidence): void => void input.rows.splice(2, 1)],
    [
      'APPROXIMATION',
      (input: ExecutableCoverageEvidence): void => {
        const row = input.rows[2];
        if (row === undefined) throw new Error('fixture row missing');
        row.approximations = ['left off a triggered ability'];
      },
    ],
    [
      'UNPROBED',
      (input: ExecutableCoverageEvidence): void => {
        const row = input.rows[2];
        if (row === undefined) throw new Error('fixture row missing');
        row.evidence = [];
      },
    ],
    [
      'INVALID_TRANSLATION',
      (input: ExecutableCoverageEvidence): void => {
        const row = input.rows[2];
        if (row === undefined) throw new Error('fixture row missing');
        row.problems = ['validator rejected the emitted card'];
      },
    ],
    [
      'STALE_POSITION',
      (input: ExecutableCoverageEvidence): void => {
        const row = input.rows[2];
        if (row === undefined) throw new Error('fixture row missing');
        row.sourceFingerprint = 'c'.repeat(64);
      },
    ],
    [
      'STALE_ORACLE',
      (input: ExecutableCoverageEvidence): void => {
        const row = input.rows[2];
        if (row === undefined) throw new Error('fixture row missing');
        row.oracleId = ORACLE(99);
      },
    ],
    [
      'STALE_TRANSLATION',
      (input: ExecutableCoverageEvidence): void => {
        const row = input.rows[2];
        if (row === undefined || row.card === null) throw new Error('fixture row missing');
        row.card.name = 'Different Card';
      },
    ],
  ])('drops a %s position and records that code as the reason', (code, damage) => {
    const input = copyEvidence();
    damage(input);
    const artifact = buildPartialExecutableReferenceSet(corpus(), input);

    expect(artifact.dropped.map((drop) => [drop.collectorNumber, drop.code])).toEqual([[3, code]]);
    expect(artifact.cards).toHaveLength(SPECS.length - 1);
  });

  it('still throws for the failures that are about the inputs, not about a card', () => {
    const staleCorpus = copyEvidence();
    staleCorpus.corpus.version = '5.2.0';
    expect(() => buildPartialExecutableReferenceSet(corpus(), staleCorpus)).toThrowError(
      expect.objectContaining({ code: 'STALE_CORPUS' }),
    );

    const staleSet = copyEvidence();
    staleSet.set.sourceSha256 = 'b'.repeat(64);
    expect(() => buildPartialExecutableReferenceSet(corpus(), staleSet)).toThrowError(
      expect.objectContaining({ code: 'STALE_SET' }),
    );

    const duplicate = copyEvidence();
    const first = duplicate.rows[0];
    if (first === undefined) throw new Error('fixture row missing');
    duplicate.rows.push(structuredClone(first));
    expect(() => buildPartialExecutableReferenceSet(corpus(), duplicate)).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_POSITION', collectorNumber: 1 }),
    );

    const unexpected = copyEvidence();
    const extra = structuredClone(first);
    unexpected.rows.push({ ...extra, collectorNumber: 99 });
    expect(() => buildPartialExecutableReferenceSet(corpus(), unexpected)).toThrowError(
      expect.objectContaining({ code: 'STALE_POSITION', collectorNumber: 99 }),
    );

    expect(() => buildPartialExecutableReferenceSet(corpus(), { rows: [] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_EVIDENCE' }),
    );
  });

  /**
   * The check the whole design is for: a caller that requires a complete set
   * says so in its signature, and a reduced set fails to compile rather than
   * reaching a surface that will present a set missing half its rares as the
   * set it is named after.
   */
  it('will not pass a reduced set where a complete one is required', () => {
    function parityOracle(set: ExecutableReferenceSet): number {
      return set.cards.length;
    }
    const reduced = buildPartialExecutableReferenceSet(corpus(), withRefusedRed());
    // @ts-expect-error a reduced set is missing the positions a parity oracle
    // would compare against, so it is not assignable here.
    expect(() => parityOracle(reduced)).toBeTypeOf('function');
  });
});
