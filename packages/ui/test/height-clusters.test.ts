/**
 * The tolerance the board rigs count face heights with.
 *
 * `mtg-aud` filed a reading of two distinct face heights in one row, 73.6 and
 * 73.5, and asked whoever fixed it to decide whether the invariant is "one
 * height" or "one height to within half a pixel" and "put that tolerance in the
 * rig rather than in a reader's head". `../tools/height-clusters.ts` is where it
 * went and this is what holds it.
 *
 * Both rigs run the rule in a browser, inside a string, where no test can reach
 * it. So the last case here reads their source and requires that the string is
 * built from this function rather than from a second copy of it. A rig that
 * quietly went back to exact counting would pass every other case in this file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEIGHT_TOLERANCE_PX, distinctHeights } from '../tools/height-clusters';

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools');
const RIGS = ['card-uniformity.ts', 'hand-scale.ts'];

function count(values: readonly number[]): number {
  return distinctHeights(values, HEIGHT_TOLERANCE_PX);
}

describe('counting the heights in a row', () => {
  it('reads an empty row as no heights and a row of equals as one', () => {
    expect(count([])).toBe(0);
    expect(count([156.4])).toBe(1);
    expect(count([156.4, 156.4, 156.4, 156.4])).toBe(1);
  });

  it('reads the sub-pixel residue mtg-aud measured as one height', () => {
    expect(count([73.6, 73.5])).toBe(1);
  });

  it('leaves a genuinely ragged row at its own count', () => {
    // The three heights `../tools/card-uniformity.ts` records a seat's row of
    // twelve coming out at. Spreads of 6.4 and 10.8, which is the defect.
    expect(count([138.2, 144.6, 155.4])).toBe(3);
  });

  it('takes the tolerance inclusively and the step past it as a second height', () => {
    expect(count([100, 100 + HEIGHT_TOLERANCE_PX])).toBe(1);
    expect(count([100, 100 + HEIGHT_TOLERANCE_PX + 0.01])).toBe(2);
  });

  it('does not care what order the row arrived in', () => {
    expect(count([155.4, 138.2, 144.6])).toBe(3);
    expect(count([73.6, 73.5])).toBe(count([73.5, 73.6]));
  });

  /**
   * The failure a tolerance is most likely to introduce, and the reason a
   * cluster is measured from its own first member rather than from the value
   * before it. Twenty faces each 0.4px taller than the last span 7.6px, which is
   * a ragged row by any reading; a rule that chained would call it one height.
   */
  it('cannot walk a ragged row into one height a step at a time', () => {
    const chain = Array.from({ length: 20 }, (_step, index) => 100 + index * 0.4);
    expect(chain[chain.length - 1]! - chain[0]!).toBeCloseTo(7.6, 6);
    expect(count(chain)).toBe(10);
  });

  it('is the rule both rigs run, rather than a second copy of it', () => {
    for (const rig of RIGS) {
      const source = readFileSync(join(TOOLS, rig), 'utf8');
      expect(source, rig).toContain('var distinctHeights = ${String(distinctHeights)};');
      expect(source, rig).toContain('var TOLERANCE = ${String(HEIGHT_TOLERANCE_PX)};');
      expect(source, rig).toContain('heights: distinctHeights(tall, TOLERANCE),');
    }
  });

  it('is valid standalone JavaScript once the types are stripped off', () => {
    // What the rigs interpolate. It runs with no module around it, so anything
    // it referenced outside its own parameters would be a page-time ReferenceError
    // that no Node test could see.
    const source = String(distinctHeights);
    expect(source.startsWith('function')).toBe(true);
    expect(source).not.toContain(': number');
    expect(source).not.toContain('readonly');
  });
});
