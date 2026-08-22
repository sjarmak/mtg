/**
 * The set symbol, one per set.
 *
 * The mark was one hardcoded shape for every set that had ever been staged, so
 * a reduced M11 reference set printed the flagship's symbol and so did M13, the
 * prototype, and every set the generator will ever emit. What that costs is not
 * a wrong picture; it is a card that says it belongs to a set it does not.
 *
 * `packages/card-render/test/parity.test.ts` is where the two faces are held to
 * one drawing. This file is the other half: the alphabet the default arm draws
 * a code in has to be total over every character a set code may legally carry,
 * has to tell those characters apart, and has to stay inside the box the type
 * bar reserves for it. All three are properties nothing else asks about,
 * because no set in this repository spells its code with a Q.
 */
import { describe, expect, it } from 'vitest';
import { SET_CODE_PATTERN } from '@mtg/dsl';
import { SET_SEAL_MARKS, setSealPath } from '../src/card/anatomy';
import { SCREEN_SEAL } from '../src/card/Card';

/**
 * The characters a set code may carry, read off the schema's own pattern rather
 * than restated here. A three-character run of the character is the shortest
 * string the pattern accepts, so this asks the pattern the question the pattern
 * exists to answer instead of copying `A-Z0-9` into a second place that can
 * drift from the first.
 */
const ALPHABET: readonly string[] = [
  ...Array.from({ length: 128 }, (_, code) => String.fromCharCode(code)),
].filter((character) => SET_CODE_PATTERN.test(character.repeat(3)));

/** Every coordinate in a path, as `[x, y]` pairs. Commands are all `M`/`L` here. */
function points(path: string): readonly (readonly [number, number])[] {
  const numbers = path
    .split(' ')
    .map((token) => Number(token))
    .filter((value) => Number.isFinite(value));
  const pairs: (readonly [number, number])[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    pairs.push([numbers[index] ?? Number.NaN, numbers[index + 1] ?? Number.NaN]);
  }
  return pairs;
}

describe('the set seal', () => {
  it('draws every character a set code may carry', () => {
    expect(ALPHABET).toHaveLength(36);
    const marks = new Map<string, string[]>();
    for (const character of ALPHABET) {
      // Three of the same character, so each glyph is drawn in the cell width a
      // real three-character code gets rather than in a cell of its own.
      const path = setSealPath(character.repeat(3), 0, 0, 10);
      expect(path.length, `${character} draws nothing`).toBeGreaterThan(0);
      const seen = marks.get(path);
      if (seen === undefined) marks.set(path, [character]);
      else seen.push(character);
    }
    // 36 characters, 35 marks: `S` and `5` are one glyph, as they are on every
    // segment display ever built, because what separates them is a curve and
    // there is no curve in a cell made of straight strokes. Asserted as the
    // exact pair rather than as a count, so a second collision is a failure
    // instead of an arithmetic coincidence.
    const collisions = [...marks.values()].filter((group) => group.length > 1);
    expect(collisions.map((group) => [...group].sort())).toEqual([['5', 'S']]);
  });

  it('keeps a code of any legal length inside the box the type bar reserves', () => {
    // The seal is drawn into a circle of `radius`, and the printed type bar
    // reserves exactly `radius * 2` of its width for it — a mark that grew past
    // that would print over the type line on one face and out of its own `<svg>`
    // on the other. Three through five characters is the whole legal range.
    const radius = 9;
    for (const length of [3, 4, 5]) {
      const path = setSealPath('M'.repeat(length), 10, 10, radius);
      for (const [x, y] of points(path)) {
        expect(Math.abs(x - 10), `${String(length)} characters overflow horizontally`).toBeLessThanOrEqual(
          radius,
        );
        expect(Math.abs(y - 10), `${String(length)} characters overflow vertically`).toBeLessThanOrEqual(
          radius,
        );
      }
    }
  });

  it('gives two codes that differ in one character two marks', () => {
    // The two sets `npm run reference:reduced` emits. They differ in their last
    // character, which is the case a mark keyed on anything coarser than the
    // code would miss, and it is the case the playtester was looking at.
    const m11 = setSealPath('M11', SCREEN_SEAL.cx, SCREEN_SEAL.cy, SCREEN_SEAL.radius);
    const m13 = setSealPath('M13', SCREEN_SEAL.cx, SCREEN_SEAL.cy, SCREEN_SEAL.radius);
    expect(m11).not.toBe(m13);
    // And the same code twice is the same mark, which is what makes a set's
    // symbol a set's symbol rather than a per-card decoration.
    expect(setSealPath('M11', SCREEN_SEAL.cx, SCREEN_SEAL.cy, SCREEN_SEAL.radius)).toBe(m11);
  });

  it('keeps the registered mark for a registered set, and only for it', () => {
    // The flagship keeps the trisigil — the 2026-08-13 decision preserved
    // rather than reversed — as one entry in a table whose default arm is the
    // design. Three closed subpaths, nine vertices, the center left empty.
    expect(Object.keys(SET_SEAL_MARKS)).toEqual(['XMP']);
    const flagship = setSealPath('XMP', SCREEN_SEAL.cx, SCREEN_SEAL.cy, SCREEN_SEAL.radius);
    expect([...flagship.matchAll(/Z/g)]).toHaveLength(3);
    expect([...flagship.matchAll(/[ML]/g)]).toHaveLength(9);
    // Resolved case-insensitively, because a code reaches this function from
    // places the schema never validated — a directory name, a launcher flag —
    // and a lowercase `xmp` naming the flagship should not fall through to the
    // arm for sets nobody has drawn a mark for.
    expect(setSealPath('xmp', SCREEN_SEAL.cx, SCREEN_SEAL.cy, SCREEN_SEAL.radius)).toBe(flagship);
    // An unregistered set is not that shape.
    expect(setSealPath('TGR', SCREEN_SEAL.cx, SCREEN_SEAL.cy, SCREEN_SEAL.radius)).not.toBe(flagship);
  });

  it('refuses to paint nothing', () => {
    // A seal with no code would draw an empty path, which is a mark that is
    // silently absent — the failure this whole change is about, arriving one
    // card at a time instead of one repository at a time.
    expect(() => setSealPath('', 10, 10, 9)).toThrow(/set code/);
  });
});
