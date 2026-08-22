import { describe, expect, it } from 'vitest';
import { formatHealth, metricsConfig, report } from '@mtg/metrics';
import { matchup, repeatedGame } from './helpers/log';

const config = metricsConfig({
  floors: { gameLength: 20, onPlay: 20, manaCheckpoint: 20, decisiveness: 20, colorPair: 20, matchup: 20 },
});

function healthyReport(): string {
  return report(
    formatHealth(
      [
        ...matchup('WU', 'BR', 40, 36, { playerTurns: 16 }),
        ...matchup('GW', 'UB', 40, 20, { playerTurns: 18 }),
        ...matchup('WB', 'RG', 40, 20, { playerTurns: 16 }),
      ],
      { label: 'unit fixture', config },
    ),
  );
}

describe('report', () => {
  const markdown = healthyReport();

  it('titles itself with the run label', () => {
    expect(markdown.startsWith('# Format health — unit fixture')).toBe(true);
  });

  it('has every section', () => {
    for (const heading of [
      '## Game length',
      '## Mana development vs Karsten priors',
      '## Stall and decisiveness',
      '## Color-pair win rates',
      '## Gates',
    ]) {
      expect(markdown).toContain(heading);
    }
  });

  it('reports both length units so nothing has to be un-converted', () => {
    expect(markdown).toContain('| statistic | rounds | player turns |');
  });

  it('lists color pairs best-first with their records', () => {
    const wuLine = markdown.split('\n').find((line) => line.startsWith('| WU'));
    expect(wuLine).toBeDefined();
    expect(wuLine).toContain('90.0%');
  });

  it('marks 1.5-sigma outliers with the 17lands convention', () => {
    // WU at 90% and BR at 10% against four pairs at 50%: both clear 1.5 sigma.
    expect(markdown).toMatch(/\| WU \+1\.[0-9]σ/);
    expect(markdown).toMatch(/\| BR -1\.[0-9]σ/);
  });

  it('cites the source of every gate', () => {
    expect(markdown).toContain('### Sources');
    expect(markdown).toContain('metrics report §4.4');
  });

  it('says under-sampled instead of printing zeros', () => {
    const undersampled = report(formatHealth(repeatedGame(30, { playerTurns: 16 }), { label: 'thin' }));
    expect(undersampled).toContain('under-sampled');
    expect(undersampled).toContain('UNDER-SAMPLED');
    expect(undersampled).not.toContain('| PASS ');
  });

  it('warns when duplicate trajectories dominate the run', () => {
    const undersampled = report(formatHealth(repeatedGame(30, { playerTurns: 16 }), { label: 'thin' }));
    expect(undersampled).toContain('Duplicate trajectories exceed 10%');
  });

  it('ends with a trailing newline so it concatenates cleanly', () => {
    expect(markdown.endsWith('\n')).toBe(true);
  });
});
