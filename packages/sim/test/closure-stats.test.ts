/**
 * Pins the closure-metric definitions in `support/closure-sweep.ts`.
 *
 * Those three shares are restated from `@mtg/metrics` rather than imported (the
 * grading package depends on this one, so importing it back would be a cycle).
 * A restatement is only safe if something asserts it still says the same thing,
 * which is what this file is: hand-built outcomes with the answer worked out by
 * hand, including the two conversions that are easy to get wrong — player turns
 * to rounds, and "decided" counting winners only.
 */
import { describe, expect, it } from 'vitest';
import type { GameEndReason, PlayerId } from '@mtg/kernel';
import type { GameOutcome } from '@mtg/sim';
import { closureStats, DECISIVE_ROUND, LONG_GAME_ROUND, roundsOf } from './support/closure-sweep';

function outcome(turns: number, reason: GameEndReason, winner: PlayerId | null): GameOutcome {
  return {
    index: 0,
    seed: 's',
    startingPlayer: 0,
    winner,
    reason,
    turns,
    decisions: 0,
    log: null,
    events: null,
    triggerCensus: null,
    activationCensus: null,
  };
}

describe('rounds', () => {
  it('converts player turns to rounds the way @mtg/metrics does', () => {
    // Turn 1 and turn 2 are both round 1; turn 3 opens round 2.
    expect([1, 2, 3, 4, 29, 30].map(roundsOf)).toEqual([1, 1, 2, 2, 15, 15]);
  });

  it('puts the two band constants where the metrics config puts them', () => {
    expect(LONG_GAME_ROUND).toBe(15);
    expect(DECISIVE_ROUND).toBe(15);
  });
});

describe('closureStats', () => {
  it('counts the long tail from round 15, inclusive', () => {
    const stats = closureStats([
      outcome(28, 'lifeZero', 0), // round 14
      outcome(29, 'lifeZero', 1), // round 15 — long
      outcome(30, 'lifeZero', 0), // round 15 — long
      outcome(40, 'turnLimit', null), // round 20 — long
    ]);
    expect(stats.longTail).toBeCloseTo(0.75, 9);
  });

  it('counts a stall as the turn cap and nothing else', () => {
    const stats = closureStats([
      outcome(40, 'turnLimit', null),
      outcome(18, 'emptyLibrary', 1),
      outcome(12, 'lifeZero', 0),
      outcome(12, 'concede', 1),
    ]);
    expect(stats.stall).toBeCloseTo(0.25, 9);
    expect(stats.deckOutRate).toBeCloseTo(0.25, 9);
    expect(stats.drawRate).toBeCloseTo(0.25, 9);
  });

  it('only counts a game as decided when somebody actually won it in time', () => {
    const stats = closureStats([
      outcome(10, 'lifeZero', 0), // round 5, won
      outcome(30, 'lifeZero', 1), // round 15, won on the boundary
      outcome(31, 'lifeZero', 0), // round 16, too late
      outcome(20, 'turnLimit', null), // no winner at all
    ]);
    expect(stats.decided).toBeCloseTo(0.5, 9);
  });

  it('summarizes length in rounds, not player turns', () => {
    const stats = closureStats([
      outcome(10, 'lifeZero', 0),
      outcome(14, 'lifeZero', 1),
      outcome(20, 'lifeZero', 0),
    ]);
    expect(stats.medianRounds).toBe(7);
    expect(stats.meanRounds).toBeCloseTo((5 + 7 + 10) / 3, 9);
    expect(stats.games).toBe(3);
  });

  it('refuses to report a share of nothing', () => {
    expect(() => closureStats([])).toThrow(/at least one game/);
  });
});
