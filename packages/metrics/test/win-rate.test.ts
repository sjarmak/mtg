import { describe, expect, it } from 'vitest';
import { colorPairWinRates, matchupMatrix, metricsConfig, winRateSpread } from '@mtg/metrics';
import { fakeLog, matchup, repeatedGame } from './helpers/log';

const config = metricsConfig({ floors: { colorPair: 4, matchup: 4 } });

function pair(records: ReturnType<typeof colorPairWinRates>['records'], name: string) {
  const found = records.find((entry) => entry.pair === name);
  expect(found).toBeDefined();
  return found;
}

describe('colorPairWinRates', () => {
  it('credits both seats of every game to their own color pair', () => {
    const report = colorPairWinRates(matchup('WU', 'BR', 10, 7), config);
    const wu = pair(report.records, 'WU');
    const br = pair(report.records, 'BR');
    expect(wu?.wins).toBe(7);
    expect(wu?.losses).toBe(3);
    expect(br?.wins).toBe(3);
    expect(br?.losses).toBe(7);
    expect(wu?.winRate.value).toBe(0.7);
    expect(br?.winRate.value).toBe(0.3);
  });

  it('excludes draws from the win-rate denominator and reports them separately', () => {
    const logs = [
      ...matchup('WU', 'BR', 8, 4),
      fakeLog({
        index: 100,
        userColors: 'WU',
        oppoColors: 'BR',
        playerTurns: 40,
        winner: null,
        endReason: 'turnLimit',
        variant: 7,
      }),
    ];
    const wu = pair(colorPairWinRates(logs, config).records, 'WU');
    expect(wu?.games).toBe(9);
    expect(wu?.draws).toBe(1);
    expect(wu?.winRate.value).toBe(0.5);
  });

  it('excludes mirrors entirely rather than dragging the pair toward 50%', () => {
    const logs = [...matchup('WU', 'BR', 10, 9), ...matchup('WU', 'WU', 6, 3)];
    const report = colorPairWinRates(logs, config);
    expect(report.mirrorGames).toBe(6);
    const wu = pair(report.records, 'WU');
    expect(wu?.games).toBe(10);
    expect(wu?.winRate.value).toBe(0.9);
  });

  it('reports a Wilson interval that brackets the point estimate', () => {
    const wu = pair(colorPairWinRates(matchup('WU', 'BR', 20, 12), config).records, 'WU');
    const interval = wu?.interval.value;
    expect(interval).toBeDefined();
    if (interval === undefined || interval === null) return;
    expect(interval.low).toBeLessThan(0.6);
    expect(interval.high).toBeGreaterThan(0.6);
  });

  it("measures a pair's clock off the games it won", () => {
    const fast = matchup('WU', 'BR', 8, 8, { playerTurns: 10 }); // round 5
    const slow = matchup('WU', 'GW', 8, 0, { playerTurns: 30 }); // round 15
    const wu = pair(colorPairWinRates([...fast, ...slow], config).records, 'WU');
    expect(wu?.medianWinRounds).toBe(5);
    expect(wu?.fastWinShare).toBe(1);
    expect(wu?.medianRounds).toBe(10);
  });

  it('reports fastWinShare as null for a pair that never won', () => {
    const br = pair(colorPairWinRates(matchup('WU', 'BR', 8, 8), config).records, 'BR');
    expect(br?.wins).toBe(0);
    expect(br?.fastWinShare).toBeNull();
  });

  it('withholds a win rate for a pair below its sample floor', () => {
    const report = colorPairWinRates(matchup('WU', 'BR', 6, 3));
    const wu = pair(report.records, 'WU');
    expect(wu?.winRate.value).toBeNull();
    expect(wu?.winRate.underSampled).toBe(true);
    expect(report.spread).toBeNull();
  });

  it('counts distinct trajectories, so replaying one game does not clear the floor', () => {
    const report = colorPairWinRates(
      repeatedGame(500, { userColors: 'WU', oppoColors: 'BR', playerTurns: 16 }),
      config,
    );
    const wu = pair(report.records, 'WU');
    expect(wu?.games).toBe(500);
    expect(wu?.winRate.distinctSamples).toBe(1);
    expect(wu?.winRate.value).toBeNull();
  });
});

describe('winRateSpread', () => {
  it('is the gap between the best and worst measured pair', () => {
    const report = colorPairWinRates([...matchup('WU', 'BR', 10, 8), ...matchup('GW', 'UB', 10, 5)], config);
    expect(report.spread).toBeCloseTo(0.8 - 0.2, 10);
    expect(winRateSpread(report.records)).toBe(report.spread);
  });

  it('is null with fewer than two measured pairs', () => {
    expect(winRateSpread([])).toBeNull();
  });
});

describe('matchupMatrix', () => {
  it('produces complementary directed cells', () => {
    const cells = matchupMatrix(matchup('WU', 'BR', 10, 7), config);
    const forward = cells.find((cell) => cell.pair === 'WU' && cell.opponent === 'BR');
    const backward = cells.find((cell) => cell.pair === 'BR' && cell.opponent === 'WU');
    expect(forward?.winRate.value).toBe(0.7);
    expect(backward?.winRate.value).toBeCloseTo(0.3, 10);
    expect((forward?.winRate.value ?? 0) + (backward?.winRate.value ?? 0)).toBeCloseTo(1, 10);
  });

  it('skips mirrors', () => {
    expect(matchupMatrix(matchup('WU', 'WU', 10, 5), config)).toEqual([]);
  });
});
