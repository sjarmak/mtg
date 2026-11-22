/**
 * The drift tool asserts nothing, so what can go wrong in it is bookkeeping.
 *
 * Three failures here would each produce a plausible table and a wrong repair.
 * A kept card scored at one revision twice reads as "nothing moved" for a color
 * that was rewritten. An added card counted as kept hides the whole question
 * `mtg-14ep` asks, which is whether a color fell or was passed. And a
 * historical set that will not parse is not a small inconvenience: it is the
 * earlier column of every row, so the tool is worthless without it.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { COLORS, parseCard } from '@mtg/dsl';
import { driftRows, loadDriftSet, parseDriftArgs, poolRows } from '../tools/color-drift';

/** A real card rather than a shape: `evaluateCard` reads fields a cast hides. */
function bear(name: string, color: string, power: number, rarity = 'common'): Card {
  return parseCard({
    id: name.toLowerCase().replace(/ /gu, '-'),
    name,
    kind: 'creature',
    rarity,
    set: { code: 'TST', collectorNumber: 1 },
    colors: [color],
    manaCost: { generic: 1, W: 0, U: 0, B: 0, R: 0, G: 0, [color]: 1 },
    artifact: false,
    power,
    toughness: power,
    subtypes: ['Bear'],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [],
    oracleText: '',
  });
}

describe('kept against added', () => {
  it('scores a kept card at both revisions, so a flat color is visible', () => {
    const before = [bear('Cub', 'W', 2)];
    const after = [bear('Cub', 'W', 5)];
    const row = driftRows(before, after).find((candidate) => candidate.color === 'W');
    expect(row?.kept).toBe(1);
    expect(row?.added).toBe(0);
    expect(row?.keptMeanAfter).toBeGreaterThan(row?.keptMeanBefore as number);
  });

  it('counts a name the earlier set never held as added, not as kept', () => {
    const row = driftRows([bear('Cub', 'W', 2)], [bear('Cub', 'W', 2), bear('Sow', 'W', 2)]).find(
      (candidate) => candidate.color === 'W',
    );
    expect({ kept: row?.kept, added: row?.added, removed: row?.removed }).toEqual({
      kept: 1,
      added: 1,
      removed: 0,
    });
  });

  it('counts a name the later set dropped as removed', () => {
    const row = driftRows([bear('Cub', 'W', 2), bear('Sow', 'W', 2)], [bear('Cub', 'W', 2)]).find(
      (candidate) => candidate.color === 'W',
    );
    expect({ kept: row?.kept, removed: row?.removed }).toEqual({ kept: 1, removed: 1 });
  });

  it('names every color, and means over no cards are not zero', () => {
    const rows = driftRows([], []);
    expect(rows.map((row) => row.color)).toEqual([...COLORS]);
    // Zero would read as "this color's cards are worthless" rather than "this
    // color has no cards".
    expect(rows.every((row) => Number.isNaN(row.addedMean) && Number.isNaN(row.keptMeanAfter))).toBe(true);
  });
});

describe('loading a historical set', () => {
  const document = (oracleText: string): string =>
    JSON.stringify({ set: { code: 'TST', name: 'Test' }, cards: [{ ...bear('Cub', 'W', 2), oracleText }] });

  it('re-renders an oracle string today’s renderer writes differently, and counts it', () => {
    const stale = loadDriftSet('stale.json', document('Bear go brrr.'));
    expect(stale.rerendered).toBe(1);
    expect(stale.pool).toHaveLength(1);
    expect(stale.label).toBe('TST Test (1 cards)');
  });

  it('counts nothing when the file already holds what the renderer writes', () => {
    const fresh = loadDriftSet('fresh.json', document(''));
    expect(fresh.rerendered).toBe(0);
  });

  it('still refuses a file that is not a set, naming the path', () => {
    expect(() => loadDriftSet('empty.json', '{"cards":[]}')).toThrow('empty.json has an empty');
    expect(() => loadDriftSet('none.json', '{}')).toThrow('none.json has no "cards"');
    expect(() => loadDriftSet('bad.json', '{"cards":[{"kind":"nonsense"}]}')).toThrow(
      'bad.json: card 0 is not a DSL card',
    );
  });
});

describe('the per-pool rows', () => {
  it('splits the mass a color contributes into bodies and everything else', () => {
    const rarities = ['common', 'uncommon', 'rare', 'mythic'];
    const set = ['W', 'U'].flatMap((color) =>
      rarities.flatMap((rarity) =>
        Array.from({ length: 10 }, (_, index) =>
          bear(`${color}${rarity} ${String(index)}`, color, 2, rarity),
        ),
      ),
    );
    const rows = poolRows(set, 3, 'drift-test');
    const white = rows.find((row) => row.color === 'W');
    expect(white?.cards).toBeGreaterThan(0);
    // Every card in this set is a creature, so the spell column is the empty
    // sum rather than a share of the creature one.
    expect(rows.every((row) => row.spellMass === 0)).toBe(true);
    expect(white?.creatureMass).toBeGreaterThan(0);
  });
});

describe('the flags', () => {
  it('wants two paths, the earlier one first, and defaults the pools and the seed', () => {
    expect(() => parseDriftArgs(['one.json'])).toThrow('two set paths');
    expect(() => parseDriftArgs(['a.json', 'b.json', 'c.json'])).toThrow('two set paths');
    expect(parseDriftArgs(['a.json', 'b.json'])).toEqual({
      before: 'a.json',
      after: 'b.json',
      pools: 400,
      seed: 'blue-audit/pool',
    });
  });

  it('refuses a pool count that is not a positive integer, and an unknown flag', () => {
    expect(() => parseDriftArgs(['a.json', 'b.json', '--pools', '0'])).toThrow('positive integer');
    expect(() => parseDriftArgs(['a.json', 'b.json', '--nope', 'x'])).toThrow('unknown flag --nope');
    expect(() => parseDriftArgs(['a.json', 'b.json', '--seed'])).toThrow('--seed needs a value');
  });
});
