/**
 * The shape census, over hand-built pools.
 *
 * `pool-census.test.ts` states the rule this file follows: nothing here pins a
 * count taken from a shipped set, because such an assertion is red on the next
 * card anybody authors and is a tripwire on authoring rather than a gate on the
 * instrument. The shipped pools are what the tool is *run* on; what is asserted
 * is the three properties that hold at any size.
 *
 *  1. **The absence is reported, not left to be scanned for.** The reading the
 *     census exists to produce is which pool prints none of a shape — that is
 *     the fact a gate opening one fixture cannot see about itself. A row of
 *     zeros the reader has to notice is the same defect one indirection later,
 *     so the last column names the pools outright.
 *  2. **Every shape gets a row, including the ones nothing prints.** A census
 *     that lists only what it found cannot say what is missing. Seven of the
 *     twenty-five shapes were printed by no committed set at all until one
 *     night moved all seven: `mtg-yxt1` printed a toll clause on a flagship
 *     common, and `mtg-07ym` committed a twelve-card fixture that prints the
 *     other six. The count is zero today, and the row is what will report the
 *     next one — a census that dropped a row once it filled would have to be
 *     re-taught the shape to notice it emptying again.
 *  3. **A pool is an argument.** `main([])` fails with the usage line rather
 *     than defaulting to a path, for the reason `--out` on the reduced reference
 *     emitter has no default: a census that answers about whichever set was
 *     interesting the day it was written is worse than no census.
 */
import { describe, expect, it } from 'vitest';
import { CARD_SHAPES } from '@mtg/dsl';
import type { CardInput } from '@mtg/dsl';
import { formatShapeCensus, main, poolShapes } from '../tools/shape-census';

const BODY: CardInput = {
  kind: 'creature',
  id: 'cen-body',
  name: 'Census Body',
  rarity: 'common',
  set: { code: 'CEN', collectorNumber: 1 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  power: 2,
  toughness: 2,
};

const PROBE: CardInput = {
  kind: 'instant',
  id: 'cen-probe',
  name: 'Census Probe',
  rarity: 'common',
  set: { code: 'CEN', collectorNumber: 2 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
};

function setFile(cards: readonly CardInput[]): unknown {
  return {
    formatVersion: 1,
    set: { code: 'CEN', name: 'Census', theme: 'census', seed: 'census', profile: 'test v1' },
    cards,
  };
}

describe('a pool census', () => {
  it('reads a set file as the shapes its cards are, under the name it was given', () => {
    const pool = poolShapes('two-cards', setFile([BODY, PROBE]));

    expect(pool.subject).toBe('two-cards');
    expect(pool.cards).toBe(2);
    expect(pool.counts.get('creature')).toBe(1);
    expect(pool.counts.get('instant')).toBe(1);
    expect(pool.counts.get('planeswalker')).toBe(0);
  });

  /**
   * The document comes off disk, so it is external data and is validated at the
   * boundary. A census that read an arbitrary object would report zeros for a
   * file that is not a set at all, which is the reading that looks like a
   * finding.
   */
  it('refuses a document that is not a set file rather than reporting it as empty', () => {
    expect(() => poolShapes('not-a-set', { cards: [] })).toThrow();
  });
});

describe('the formatted census', () => {
  it('names the pools that print none of a shape', () => {
    const table = formatShapeCensus([
      poolShapes('bodies', setFile([BODY])),
      poolShapes('probes', setFile([PROBE])),
    ]);
    const row = (shape: string): string => table.split('\n').find((line) => line.startsWith(shape)) ?? '';

    expect(row('creature')).toMatch(/probes$/);
    expect(row('instant')).toMatch(/bodies$/);
  });

  /**
   * The shape nothing prints is the one worth saying out loud, and saying it as
   * two pool names would read as a partial finding rather than a total one.
   */
  it('says so plainly when no pool named prints the shape', () => {
    const table = formatShapeCensus([poolShapes('bodies', setFile([BODY]))]);
    const rows = table.split('\n');

    expect(rows.find((line) => line.startsWith('planeswalker'))).toMatch(/every pool named$/);
    for (const shape of CARD_SHAPES) {
      expect(rows.filter((line) => line.startsWith(`${shape} `)).length).toBeGreaterThan(0);
    }
  });
});

describe('the command line', () => {
  it('refuses to census a pool nobody named', () => {
    expect(() => main([])).toThrow(/usage: shape-census/);
  });
});
