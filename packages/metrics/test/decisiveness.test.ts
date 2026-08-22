import { describe, expect, it } from 'vitest';
import { decisiveness, metricsConfig } from '@mtg/metrics';
import { distinctGames, fakeLog } from './helpers/log';

const config = metricsConfig({ floors: { decisiveness: 4 }, decisiveness: { decisiveRound: 8 } });

/** Two lands and then nothing: no land drop is available to advance a turn. */
const STALLED = [1, 2, 2, 2, 2, 2];

describe('decisiveness', () => {
  it('separates turn-cap stalls from deck-outs from ordinary wins', () => {
    const logs = [
      fakeLog({ index: 0, playerTurns: 40, winner: null, endReason: 'turnLimit', variant: 1 }),
      fakeLog({ index: 1, playerTurns: 30, winner: 0, endReason: 'emptyLibrary', variant: 2 }),
      fakeLog({ index: 2, playerTurns: 14, winner: 0, endReason: 'lifeZero', variant: 3 }),
      fakeLog({ index: 3, playerTurns: 12, winner: 1, endReason: 'lifeZero', variant: 4 }),
    ];
    const value = decisiveness(logs, config).value;
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.stallRate).toBe(0.25);
    expect(value.deckOutRate).toBe(0.25);
    expect(value.drawRate).toBe(0.25);
  });

  it('counts a game as decided only if it both resolved and resolved early', () => {
    const logs = [
      // 14 player turns is round 7: inside the round-8 window.
      fakeLog({ index: 0, playerTurns: 14, winner: 0, variant: 1 }),
      // 30 player turns is round 15: decided but late.
      fakeLog({ index: 1, playerTurns: 30, winner: 1, variant: 2 }),
      // A draw inside the window still does not count as decided.
      fakeLog({ index: 2, playerTurns: 10, winner: null, endReason: 'turnLimit', variant: 3 }),
      fakeLog({ index: 3, playerTurns: 16, winner: 0, variant: 4 }),
    ];
    const value = decisiveness(logs, config).value;
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.decidedByRound).toBe(0.5);
    expect(value.decisiveRound).toBe(8);
  });

  it('measures inert turns against every turn played', () => {
    const logs = [
      // Both sides stop making land drops after turn 2, so turns 5-7 advance
      // nothing at all once their casts are suppressed too.
      fakeLog({
        index: 0,
        playerTurns: 10,
        inertTurns: [5, 6, 7],
        userLands: STALLED,
        oppoLands: STALLED,
        variant: 1,
      }),
      fakeLog({ index: 1, playerTurns: 10, userLands: STALLED, oppoLands: STALLED, variant: 2 }),
      fakeLog({ index: 2, playerTurns: 10, userLands: STALLED, oppoLands: STALLED, variant: 3 }),
      fakeLog({ index: 3, playerTurns: 10, userLands: STALLED, oppoLands: STALLED, variant: 4 }),
    ];
    const value = decisiveness(logs, config).value;
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.totalTurns).toBe(40);
    expect(value.inertTurns).toBe(3);
    expect(value.inertTurnRate).toBeCloseTo(0.075, 10);
    expect(value.inertTurnsPerGame).toBeCloseTo(0.75, 10);
  });

  it('refuses to answer below the sample floor', () => {
    const result = decisiveness(distinctGames(20, { playerTurns: 12 }));
    expect(result.value).toBeNull();
    expect(result.underSampled).toBe(true);
  });
});
