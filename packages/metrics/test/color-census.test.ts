/**
 * The census reads the scorer; these cases hold the reading itself.
 *
 * The tool asserts nothing by design, so what can go wrong in it is arithmetic
 * and argument handling: a median over an even count, a land counted as a color
 * it only taps for, a `--pools` that quietly becomes a fraction of a run. Each
 * of those would produce a plausible number and a wrong conclusion, which is
 * the failure mode `mtg-0g9g` names outright when it says guessing at this will
 * produce the wrong fix.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import { cardColors, colorRows, median, parseCensusArgs } from '../tools/color-census';

const SET = 'out/XMP/set.json';

function land(produces: readonly string[]): Card {
  return {
    id: 'land',
    name: 'A Land',
    kind: 'land',
    rarity: 'common',
    producesMana: produces,
    abilities: [],
  } as unknown as Card;
}

describe('the census arithmetic', () => {
  it('takes the middle of an odd count and the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('is not a number over nothing, rather than zero over nothing', () => {
    expect(median([])).toBeNaN();
  });

  it('reads a land by what it taps for, and drops colorless because it is not a color', () => {
    expect(cardColors(land(['B', 'C']))).toEqual(['B']);
    expect(cardColors(land(['C']))).toEqual([]);
  });
});

describe('the per-color rows', () => {
  it('names every color even when the set prints none of it', () => {
    const rows = colorRows([], new Map());
    expect(rows.map((row) => row.color)).toEqual([...COLORS]);
    expect(rows.every((row) => row.cards === 0 && row.builds === 0)).toBe(true);
    // A share over no cards is not zero: zero would read as "none of them are
    // weak", which is a claim about cards that do not exist.
    expect(rows.every((row) => Number.isNaN(row.weakShare))).toBe(true);
  });
});

describe('the flags', () => {
  it('requires a set and defaults the pools and the seed', () => {
    expect(() => parseCensusArgs([])).toThrow('give it a path');
    const args = parseCensusArgs([SET]);
    expect({ path: args.path, pools: args.pools, color: args.color }).toEqual({
      path: SET,
      pools: 400,
      color: null,
    });
  });

  it('refuses a pool count that is not a positive integer', () => {
    expect(() => parseCensusArgs([SET, '--pools', '0'])).toThrow('positive integer');
    expect(() => parseCensusArgs([SET, '--pools', '2.5'])).toThrow('positive integer');
  });

  it('takes a color case-insensitively and refuses one that is not a color', () => {
    expect(parseCensusArgs([SET, '--color', 'b']).color).toBe('B');
    expect(() => parseCensusArgs([SET, '--color', 'C'])).toThrow('WUBRG');
  });

  it('refuses an unknown flag and a flag with no value', () => {
    expect(() => parseCensusArgs([SET, '--nope', 'x'])).toThrow('unknown flag --nope');
    expect(() => parseCensusArgs([SET, '--seed'])).toThrow('--seed needs a value');
  });
});
