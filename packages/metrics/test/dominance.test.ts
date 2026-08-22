import { describe, expect, it } from 'vitest';
import { colorPairWinRates, evaluateDominance, metricsConfig } from '@mtg/metrics';
import { matchup } from './helpers/log';

const config = metricsConfig({ floors: { colorPair: 4 }, balance: { fastWinRound: 7 } });

function evaluate(logs: Parameters<typeof colorPairWinRates>[0]) {
  const report = colorPairWinRates(logs, config);
  return { report, result: evaluateDominance(report.records, report.spread, config) };
}

describe('evaluateDominance', () => {
  it('passes a format where every pair sits inside the band', () => {
    const { result } = evaluate([...matchup('WU', 'BR', 20, 11), ...matchup('GW', 'UB', 20, 9)]);
    expect(result.outOfBand).toEqual([]);
    expect(result.dominant).toEqual([]);
    expect(result.evaluated).toHaveLength(4);
  });

  it('flags a pair above the band', () => {
    const { result } = evaluate(matchup('WU', 'BR', 20, 16, { playerTurns: 30 }));
    expect(result.outOfBand.map((finding) => [finding.pair, finding.side])).toEqual([
      ['BR', 'below'],
      ['WU', 'above'],
    ]);
  });

  it('does not call a slow winner dominant', () => {
    // 80% win rate, but every win takes 15 rounds.
    const { result } = evaluate(matchup('WU', 'BR', 20, 16, { playerTurns: 30 }));
    expect(result.dominant).toEqual([]);
  });

  it('calls a fast winner dominant and says why', () => {
    // 80% win rate, every win closed by round 5.
    const { result } = evaluate(matchup('WU', 'BR', 20, 16, { playerTurns: 10 }));
    expect(result.dominant).toHaveLength(1);
    const finding = result.dominant[0];
    expect(finding?.pair).toBe('WU');
    expect(finding?.reason).toBe('fastClock');
    expect(finding?.fastWinShare).toBe(1);
    expect(finding?.medianWinRounds).toBe(5);
    expect(finding?.detail).toContain('by round 7');
  });

  it('does not call a fast pair inside the band dominant', () => {
    // Every win is fast, but the pair only wins half its games.
    const { result } = evaluate(matchup('WU', 'BR', 20, 10, { playerTurns: 10 }));
    expect(result.dominant).toEqual([]);
    expect(result.outOfBand).toEqual([]);
  });

  it('lists pairs it could not judge instead of judging them', () => {
    const report = colorPairWinRates(matchup('WU', 'BR', 6, 6, { playerTurns: 10 }));
    const result = evaluateDominance(report.records, report.spread);
    expect(result.evaluated).toEqual([]);
    expect(result.underSampled.toSorted()).toEqual(['BR', 'WU']);
    expect(result.dominant).toEqual([]);
    expect(result.outOfBand).toEqual([]);
  });

  it('carries the spread through unchanged', () => {
    const { report, result } = evaluate(matchup('WU', 'BR', 20, 16));
    expect(result.spread).toBe(report.spread);
  });
});
