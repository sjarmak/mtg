import { describe, expect, it } from 'vitest';
import { hypergeometricAtLeast, hypergeometricExact, logChoose, minSourcesFor } from '@mtg/deckbuild';

/**
 * Independent reference implementation: P(zero successes) computed as a plain
 * product of "this draw missed" probabilities. Nothing shared with the log-space
 * code under test.
 */
function probabilityOfNone(successesInPopulation: number, draws: number, population: number): number {
  let probability = 1;
  for (let i = 0; i < draws; i += 1) {
    probability *= (population - successesInPopulation - i) / (population - i);
  }
  return probability;
}

describe('logChoose', () => {
  it('matches small binomial coefficients', () => {
    expect(Math.exp(logChoose(5, 2))).toBeCloseTo(10, 9);
    expect(Math.exp(logChoose(40, 7))).toBeCloseTo(18643560, 3);
    expect(Math.exp(logChoose(9, 0))).toBeCloseTo(1, 12);
  });

  it('is -Infinity for impossible choices', () => {
    expect(logChoose(3, 4)).toBe(Number.NEGATIVE_INFINITY);
    expect(logChoose(3, -1)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('hypergeometricExact', () => {
  it('forms a probability distribution over the possible counts', () => {
    const total = [0, 1, 2, 3, 4, 5, 6, 7].reduce(
      (sum, successes) => sum + hypergeometricExact(successes, 17, 7, 40),
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });

  it('returns 0 for counts that cannot occur', () => {
    expect(hypergeometricExact(9, 8, 20, 40)).toBe(0);
    expect(hypergeometricExact(5, 20, 4, 40)).toBe(0);
  });
});

describe('hypergeometricAtLeast', () => {
  it('agrees with an independent at-least-one calculation', () => {
    for (const sources of [3, 6, 8, 9, 11, 17]) {
      for (const draws of [7, 8, 9, 12]) {
        expect(hypergeometricAtLeast(1, sources, draws, 40)).toBeCloseTo(
          1 - probabilityOfNone(sources, draws, 40),
          10,
        );
      }
    }
  });

  it('is 1 when no successes are wanted and 0 when more are wanted than exist', () => {
    expect(hypergeometricAtLeast(0, 0, 7, 40)).toBe(1);
    expect(hypergeometricAtLeast(6, 5, 40, 40)).toBe(0);
    expect(hypergeometricAtLeast(9, 17, 8, 40)).toBe(0);
  });

  it('increases with more sources and with more draws', () => {
    const bySources = [5, 6, 7, 8, 9, 10].map((sources) => hypergeometricAtLeast(1, sources, 8, 40));
    const byDraws = [7, 8, 9, 10, 11].map((draws) => hypergeometricAtLeast(1, 9, draws, 40));
    for (let i = 1; i < bySources.length; i += 1) {
      expect(bySources[i]).toBeGreaterThan(bySources[i - 1] ?? 0);
    }
    for (let i = 1; i < byDraws.length; i += 1) {
      expect(byDraws[i]).toBeGreaterThan(byDraws[i - 1] ?? 0);
    }
  });

  it('reproduces the Karsten-style shape for a 17-land Limited deck', () => {
    // Every card of the deck is drawn eventually, so seeing all 17 lands is certain.
    expect(hypergeometricAtLeast(17, 17, 40, 40)).toBeCloseTo(1, 12);
    // Three lands by turn three on the play (nine cards seen) is a coin flip.
    const threeByThree = hypergeometricAtLeast(3, 17, 9, 40);
    expect(threeByThree).toBeGreaterThan(0.55);
    expect(threeByThree).toBeLessThan(0.85);
  });

  it('clamps draws to the deck instead of over-counting', () => {
    expect(hypergeometricAtLeast(2, 8, 400, 40)).toBe(1);
  });

  it('rejects impossible parameters', () => {
    expect(() => hypergeometricAtLeast(1, 41, 7, 40)).toThrow(/exceeds population/);
    expect(() => hypergeometricAtLeast(1, 8, -1, 40)).toThrow(/draws/);
    expect(() => hypergeometricAtLeast(1, 8, 7, 2.5)).toThrow(/population/);
  });

  /**
   * A negative or fractional ask is arithmetic that went wrong upstream, not a
   * question with an answer. Returning 1 for "at least -2 sources" is true and
   * useless: it hands the caller a castability figure computed from a pip count
   * it should never have produced. Every real caller counts pips, so the ask is
   * a whole number at least zero or it is a bug.
   */
  it('rejects a negative or fractional ask rather than answering it', () => {
    expect(() => hypergeometricAtLeast(-2, 5, 7, 40)).toThrow(/successesWanted/);
    expect(() => hypergeometricAtLeast(1.5, 8, 7, 40)).toThrow(/successesWanted/);
  });
});

describe('minSourcesFor', () => {
  it('returns the boundary: the count clears the target and one fewer does not', () => {
    for (const draws of [7, 8, 9, 10]) {
      for (const population of [40, 60]) {
        const floor = minSourcesFor(1, 0.9, draws, population);
        expect(hypergeometricAtLeast(1, floor, draws, population)).toBeGreaterThanOrEqual(0.9);
        expect(hypergeometricAtLeast(1, floor - 1, draws, population)).toBeLessThan(0.9);
      }
    }
  });

  it('reproduces the Karsten source counts for a 60-card deck', () => {
    // One source by turn one (seven cards) and by turn two (eight).
    expect(minSourcesFor(1, 0.9, 7, 60)).toBe(16);
    expect(minSourcesFor(1, 0.9, 8, 60)).toBe(15);
    // Two sources for a double pip on turn four (ten cards) costs far more.
    expect(minSourcesFor(2, 0.9, 10, 60)).toBe(20);
  });

  it('needs no sources when no successes are wanted', () => {
    expect(minSourcesFor(0, 0.9, 7, 60)).toBe(0);
  });

  it('rises with the target and falls as more cards are seen', () => {
    expect(minSourcesFor(1, 0.95, 7, 60)).toBeGreaterThan(minSourcesFor(1, 0.9, 7, 60));
    expect(minSourcesFor(1, 0.9, 12, 60)).toBeLessThan(minSourcesFor(1, 0.9, 7, 60));
  });

  it('rejects a target outside (0, 1] and an ask no deck can meet', () => {
    expect(() => minSourcesFor(1, 0, 7, 60)).toThrow(/target/);
    expect(() => minSourcesFor(1, 1.5, 7, 60)).toThrow(/target/);
    // More wanted than cards seen: nine sources among eight cards drawn.
    expect(() => minSourcesFor(9, 0.9, 8, 60)).toThrow(/no source count/);
    // More wanted than cards in the deck, though the draw alone would allow it.
    expect(() => minSourcesFor(7, 0.9, 40, 5)).toThrow(/no source count/);
  });

  /**
   * The verdict above is read off the parameters, not discovered by scanning.
   * A scan reaches the same verdict, so the message alone cannot tell the two
   * apart and the work is the only observable difference: the guard answers in
   * about 0.02 ms at any population, while visiting all population + 1
   * candidates takes about 3 s at a billion. The budget sits between them.
   */
  it('reads an impossible ask off the parameters instead of scanning', () => {
    const started = Date.now();
    expect(() => minSourcesFor(11, 0.9, 10, 1_000_000_000)).toThrow(/no source count/);
    expect(Date.now() - started).toBeLessThan(500);
  });

  /**
   * The ask is checked before the deck is asked to satisfy it, so a caller that
   * passes 2.5 hears about 2.5 rather than about a scan that failed. Both are
   * true of `minSourcesFor(2.5, 0.9, 1, 60)`; only one of them is useful.
   */
  it('rejects a negative or fractional ask before scanning', () => {
    expect(() => minSourcesFor(-1, 0.9, 7, 60)).toThrow(/successesWanted/);
    expect(() => minSourcesFor(1.5, 0.9, 7, 60)).toThrow(/successesWanted/);
    expect(() => minSourcesFor(2.5, 0.9, 1, 60)).toThrow(/successesWanted/);
  });
});
