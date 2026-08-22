import { describe, expect, it } from 'vitest';
import { countGames, duplicateShare, gameFingerprint, sampled, unsampled } from '@mtg/metrics';
import { distinctGames, fakeLog, repeatedGame } from './helpers/log';

describe('gameFingerprint', () => {
  it('is identical for games with identical trajectories', () => {
    const a = fakeLog({ playerTurns: 12 });
    const b = fakeLog({ playerTurns: 12, index: 99 });
    // Different index and seed, same game: the fingerprint deliberately
    // ignores identity and looks only at what happened.
    expect(gameFingerprint(a)).toBe(gameFingerprint(b));
  });

  it('separates games that differ in outcome', () => {
    expect(gameFingerprint(fakeLog({ playerTurns: 12, winner: 0 }))).not.toBe(
      gameFingerprint(fakeLog({ playerTurns: 12, winner: 1 })),
    );
  });

  it('separates games that differ only in board trace', () => {
    expect(gameFingerprint(fakeLog({ playerTurns: 12, userLands: [1, 2, 3, 4, 5] }))).not.toBe(
      gameFingerprint(fakeLog({ playerTurns: 12, userLands: [1, 1, 1, 2, 3] })),
    );
  });

  it('separates games that differ in length', () => {
    expect(gameFingerprint(fakeLog({ playerTurns: 12 }))).not.toBe(
      gameFingerprint(fakeLog({ playerTurns: 14 })),
    );
  });
});

describe('countGames', () => {
  it('collapses repeated trajectories: 500 replays of one game is one sample', () => {
    const count = countGames(repeatedGame(500, { playerTurns: 12 }));
    expect(count.total).toBe(500);
    expect(count.distinct).toBe(1);
    expect(duplicateShare(count)).toBeCloseTo(0.998, 3);
  });

  it('counts genuinely different games separately', () => {
    const count = countGames(distinctGames(12, { playerTurns: 12 }));
    expect(count).toEqual({ total: 12, distinct: 12 });
  });

  it('reports no duplicates for an empty sample rather than dividing by zero', () => {
    expect(duplicateShare(countGames([]))).toBe(0);
  });
});

describe('sampled', () => {
  it('returns null and flags under-sampling below the floor', () => {
    const result = sampled({ total: 900, distinct: 3 }, 100, () => 0.5);
    expect(result.value).toBeNull();
    expect(result.underSampled).toBe(true);
    expect(result.samples).toBe(900);
    expect(result.distinctSamples).toBe(3);
    expect(result.floor).toBe(100);
  });

  it('does not even run the computation below the floor', () => {
    let ran = 0;
    sampled({ total: 10, distinct: 10 }, 100, () => {
      ran += 1;
      return 1;
    });
    expect(ran).toBe(0);
  });

  it('computes at or above the floor', () => {
    const result = sampled({ total: 120, distinct: 100 }, 100, () => 0.42);
    expect(result.value).toBe(0.42);
    expect(result.underSampled).toBe(false);
  });

  it('gates on distinct games, not games played — the sample illusion', () => {
    const illusion = countGames(repeatedGame(1000, { playerTurns: 12 }));
    const result = sampled(illusion, 100, () => 1);
    expect(result.samples).toBe(1000);
    expect(result.underSampled).toBe(true);
  });
});

describe('unsampled', () => {
  it('is under-sampled by construction', () => {
    const result = unsampled<number>(50);
    expect(result).toEqual({
      value: null,
      samples: 0,
      distinctSamples: 0,
      floor: 50,
      underSampled: true,
    });
  });
});
