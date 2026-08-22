import { describe, expect, it } from 'vitest';
import { parseManaCost, pipDemand, requiredColors } from '../src/mana-cost';

describe('parseManaCost', () => {
  it('treats an absent cost as zero rather than an error', () => {
    for (const cost of [null, '']) {
      const parsed = parseManaCost(cost);
      expect(parsed.fixed.generic).toBe(0);
      expect(requiredColors(parsed)).toEqual([]);
    }
  });

  it('splits generic and colored pips', () => {
    const parsed = parseManaCost('{3}{U}{U}');
    expect(parsed.fixed.generic).toBe(3);
    expect(parsed.fixed.U).toBe(2);
  });

  it('records a hybrid pip as a choice, forcing neither color', () => {
    const parsed = parseManaCost('{W/U}{1}');
    expect(parsed.fixed.W).toBe(0);
    expect(parsed.fixed.U).toBe(0);
    expect(parsed.hybrid).toHaveLength(1);
    expect(parsed.hybrid[0]?.options).toEqual(['W', 'U']);
  });

  it('marks a two-brid as having a colorless side', () => {
    const parsed = parseManaCost('{2/W}');
    expect(parsed.hybrid[0]?.hasColorlessOption).toBe(true);
  });

  it('treats a phyrexian pip as forcing no source', () => {
    const parsed = parseManaCost('{W/P}');
    expect(parsed.fixed.W).toBe(0);
    expect(parsed.phyrexian).toEqual(['W']);
  });

  it('handles a hybrid-phyrexian pip, which forces neither of its colors', () => {
    const parsed = parseManaCost('{G/U/P}');
    expect(parsed.phyrexian).toEqual(['G', 'U']);
    expect(parsed.hybrid).toEqual([]);
  });

  it('reads only the front face of a split or adventure cost', () => {
    expect(parseManaCost('{R} // {2}{G}').fixed.generic).toBe(0);
  });

  it('charges snow and colorless symbols as generic, since no basic aims at them', () => {
    for (const cost of ['{S}', '{C}', '{L}', '{D}']) {
      expect(parseManaCost(cost).fixed.generic).toBe(1);
    }
  });

  it('reads a half pip', () => {
    expect(parseManaCost('{HW}').half.W).toBe(1);
  });

  it('treats X, Y and Z as zero', () => {
    expect(parseManaCost('{X}{R}').fixed.R).toBe(1);
    expect(parseManaCost('{X}{R}').fixed.generic).toBe(0);
  });

  it('records an unrecognised symbol instead of throwing', () => {
    const parsed = parseManaCost('{QQ}');
    expect(parsed.unrecognised).toEqual(['{QQ}']);
  });

  it('parses every mana symbol that occurs in the real card store', () => {
    // The full distinct set, taken from `SELECT DISTINCT mana_cost` across all
    // 38,623 oracle cards. A new symbol appearing upstream should surface here
    // as an unrecognised entry, not as a crash mid-build.
    const symbols = `0 1 10 1000000 11 12 13 14 15 16 2 2/B 2/G 2/R 2/U 2/W 3 4 5 6 7 8 9 B B/G B/P
      B/R C C/B C/G C/P C/R C/U C/W D G G/P G/U G/U/P G/W G/W/P HW L R R/G R/G/P R/P R/W R/W/P S U
      U/B U/P U/R W W/B W/P W/U X Y Z`
      .split(/\s+/)
      .filter((entry) => entry.length > 0);

    const unrecognised = symbols.flatMap((symbol) => parseManaCost(`{${symbol}}`).unrecognised);
    expect(unrecognised).toEqual([]);
  });
});

describe('pipDemand', () => {
  it('assigns a hybrid pip to the color the deck actually plays', () => {
    const demand = pipDemand(parseManaCost('{W/U}'), ['U']);
    expect(demand.U).toBe(1);
    expect(demand.W).toBe(0);
  });

  it('splits a hybrid pip evenly when the deck plays both sides', () => {
    const demand = pipDemand(parseManaCost('{W/U}'), ['W', 'U']);
    expect(demand.W).toBe(0.5);
    expect(demand.U).toBe(0.5);
  });

  it('ignores phyrexian pips, which are payable with life', () => {
    expect(pipDemand(parseManaCost('{W/P}'), ['W']).W).toBe(0);
  });

  it('ignores a hybrid with a colorless side, which forces no color', () => {
    expect(pipDemand(parseManaCost('{2/W}'), ['W']).W).toBe(0);
    expect(pipDemand(parseManaCost('{C/W}'), ['W']).W).toBe(0);
  });

  it('counts a half pip as half a source of demand', () => {
    expect(pipDemand(parseManaCost('{HW}'), ['W']).W).toBe(0.5);
  });
});

describe('requiredColors', () => {
  it('lists only colors with an unavoidable pip', () => {
    expect(requiredColors(parseManaCost('{R}{W/U}'))).toEqual(['R']);
  });
});
