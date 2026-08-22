import { describe, expect, it } from 'vitest';
import { gameLengthDistribution, metricsConfig, onPlayWinRate } from '@mtg/metrics';
import { distinctGames, fakeLog, repeatedGame } from './helpers/log';

const lowFloor = metricsConfig({ floors: { gameLength: 4, onPlay: 4 } });

function gamesOfLengths(lengths: readonly number[]): ReturnType<typeof fakeLog>[] {
  return lengths.map((playerTurns, index) => fakeLog({ playerTurns, index, variant: index }));
}

describe('gameLengthDistribution', () => {
  it('reports rounds and raw player turns side by side', () => {
    const result = gameLengthDistribution(gamesOfLengths([15, 16, 17, 18, 19, 20]), lowFloor);
    expect(result.underSampled).toBe(false);
    const value = result.value;
    expect(value).not.toBeNull();
    if (value === null) return;
    // 15..20 player turns is 8,8,9,9,10,10 rounds.
    expect(value.rounds.min).toBe(8);
    expect(value.rounds.max).toBe(10);
    expect(value.rounds.median).toBe(9);
    expect(value.playerTurns.median).toBe(17.5);
  });

  it('builds a round histogram and a cumulative finished-by curve', () => {
    const result = gameLengthDistribution(gamesOfLengths([2, 4, 4, 6]), lowFloor);
    const value = result.value;
    expect(value).not.toBeNull();
    if (value === null) return;
    // 2,4,4,6 player turns => rounds 1,2,2,3.
    expect(value.roundHistogram).toEqual([0, 1, 2, 1]);
    expect(value.finishedByRound[1]).toBe(0.25);
    expect(value.finishedByRound[2]).toBe(0.75);
    expect(value.finishedByRound[3]).toBe(1);
    expect(value.modalRound).toBe(2);
  });

  it('measures both tails', () => {
    const config = metricsConfig({ floors: { gameLength: 4 }, length: { longGameRound: 10 } });
    // rounds: 2, 2, 10, 12 -> half are blowouts (<=4), half are long (>=10).
    const result = gameLengthDistribution(gamesOfLengths([3, 4, 19, 23]), config);
    const value = result.value;
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.blowoutShare).toBe(0.5);
    expect(value.longGameShare).toBe(0.5);
  });

  it('refuses to answer below the sample floor', () => {
    const result = gameLengthDistribution(distinctGames(10, { playerTurns: 16 }));
    expect(result.value).toBeNull();
    expect(result.underSampled).toBe(true);
    expect(result.floor).toBe(100);
  });

  it('is not fooled by a thousand replays of one game', () => {
    const result = gameLengthDistribution(repeatedGame(1000, { playerTurns: 16 }));
    expect(result.samples).toBe(1000);
    expect(result.distinctSamples).toBe(1);
    expect(result.value).toBeNull();
  });
});

describe('onPlayWinRate', () => {
  it('counts wins by the seat that started, over decided games only', () => {
    const logs = [
      fakeLog({ index: 0, playerTurns: 10, onPlay: 0, winner: 0, variant: 1 }),
      fakeLog({ index: 1, playerTurns: 12, onPlay: 1, winner: 1, variant: 2 }),
      fakeLog({ index: 2, playerTurns: 14, onPlay: 0, winner: 1, variant: 3 }),
      fakeLog({ index: 3, playerTurns: 16, onPlay: 1, winner: 0, variant: 4 }),
      fakeLog({ index: 4, playerTurns: 40, onPlay: 0, winner: null, endReason: 'turnLimit', variant: 5 }),
    ];
    const result = onPlayWinRate(logs, lowFloor);
    const value = result.value;
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.decided).toBe(4);
    expect(value.onPlayWins).toBe(2);
    expect(value.winRate).toBe(0.5);
    expect(value.advantage).toBe(0);
  });

  it('reports the advantage as the deviation from a coin flip', () => {
    const logs = Array.from({ length: 8 }, (_unused, index) =>
      fakeLog({
        index,
        playerTurns: 10 + index,
        onPlay: 0,
        winner: index < 6 ? 0 : 1,
        variant: index,
      }),
    );
    const value = onPlayWinRate(logs, lowFloor).value;
    expect(value).not.toBeNull();
    if (value === null) return;
    expect(value.winRate).toBe(0.75);
    expect(value.advantage).toBe(0.25);
  });

  it('refuses to answer below the floor', () => {
    expect(onPlayWinRate(distinctGames(20, { playerTurns: 12 })).value).toBeNull();
  });
});
