import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DeckList } from '@mtg/kernel';
import type { MatchAggregate, MatchRun, RoundRobinRun } from '@mtg/sim';
import { PreconMatchupPanel } from '../../src/routes/analysis/precon-matchups';
import { readAnalysisRun } from '../../src/routes/analysis/read';
import type { PreconAnalysisDeck, PreconSeatOrderRun } from '../../tools/analysis-run';
import { preconMatchups } from '../../tools/analysis-run';
import { fixtureJson } from './support/fixtures';

const DECKS = [
  deck('sky-islands', 'The Sky Islands'),
  deck('down-in-gloom', 'Down in the Gloom'),
  deck('wield-obliterator', 'Wield the Obliterator'),
] as const;

function deck(id: string, name: string): PreconAnalysisDeck & DeckList {
  return {
    id,
    name,
    plan: `${name} has a plan.`,
    payoff: `${id}-payoff`,
    contentHash: `${id}-sha256`,
    cards: [],
  };
}

function aggregate(runSeed: string, games: number, wins: readonly [number, number]): MatchAggregate {
  const draws = games - wins[0] - wins[1];
  return {
    runSeed,
    games,
    wins,
    draws,
    winRate: [wins[0] / games, wins[1] / games],
    onPlayGames: games - draws,
    onPlayWins: Math.floor((games - draws) / 2),
    onPlayWinRate: 0.5,
    meanTurns: 10,
    medianTurns: 10,
    minTurns: 8,
    maxTurns: 12,
    turnHistogram: [],
    endReasons: { lifeZero: games, emptyLibrary: 0, concede: 0, turnLimit: 0 },
    meanDecisions: 20,
    totalDecisions: games * 20,
  };
}

function match(runSeed: string, games: number, wins: readonly [number, number]): MatchRun {
  return {
    aggregate: aggregate(runSeed, games, wins),
    outcomes: [],
    logs: [],
    elapsedMillis: 1,
    gamesPerSecond: games,
  };
}

function roundRobin(
  decks: readonly PreconAnalysisDeck[],
  runSeed: string,
  games: number,
  wins: readonly (readonly [number, number])[],
): RoundRobinRun {
  const suffixes: string[] = [];
  for (let first = 0; first < decks.length; first += 1) {
    for (let second = first + 1; second < decks.length; second += 1) {
      suffixes.push(`${decks[first]?.name}-${decks[second]?.name}`);
    }
  }
  const runs = wins.map((record, index) => match(`${runSeed}/${suffixes[index]}`, games, record));
  return {
    runs,
    logs: [],
    matchups: runs.length,
    gamesPerMatchup: games,
    games: runs.length * games,
    elapsedMillis: 1,
    gamesPerSecond: runs.length * games,
  };
}

function seatRun(
  decks: readonly PreconAnalysisDeck[],
  runSeed: string,
  games: number,
  wins: readonly (readonly [number, number])[],
): PreconSeatOrderRun {
  return { decks, runSeed, run: roundRobin(decks, runSeed, games, wins) };
}

describe('preconMatchups', () => {
  it('zips schedule order instead of parsing hyphenated seeds and combines both seat orders', () => {
    const reverse = [...DECKS].reverse();
    const block = preconMatchups(DECKS, [
      seatRun(DECKS, 'precon/forward', 600, [
        [300, 300],
        [300, 300],
        [300, 300],
      ]),
      seatRun(reverse, 'precon/reverse', 600, [
        [300, 300],
        [300, 300],
        [300, 300],
      ]),
    ]);
    expect(block.seatOrders).toBe(2);
    expect(block.planExecution).toMatchObject({ status: 'unavailable' });
    expect(block.decks.map((entry) => entry.id)).toEqual(DECKS.map((entry) => entry.id));
    expect(block.cells.map((cell) => [cell.deckId, cell.opponentId])).toEqual([
      ['sky-islands', 'down-in-gloom'],
      ['down-in-gloom', 'sky-islands'],
      ['sky-islands', 'wield-obliterator'],
      ['wield-obliterator', 'sky-islands'],
      ['down-in-gloom', 'wield-obliterator'],
      ['wield-obliterator', 'down-in-gloom'],
    ]);
    expect(block.cells.every((cell) => cell.games === 1_200)).toBe(true);
    expect(block.cells.every((cell) => cell.status === 'healthy')).toBe(true);
    expect(block.cells.every((cell) => cell.winRate === 0.5)).toBe(true);
  });

  it('withholds a verdict until the 95% interval half-width is at most three points', () => {
    const decks = DECKS.slice(0, 2);
    const [cell] = preconMatchups(decks, [seatRun(decks, 'thin/v0', 60, [[36, 24]])]).cells;
    expect(cell?.status).toBe('underSampled');
    expect(cell?.winRate).toBeNull();
    expect(cell?.interval).toBeNull();
    expect(cell?.games).toBe(60);
    expect(cell?.wins).toBe(36);
  });

  it('marks a sufficiently measured pairing outside the 42-58% band', () => {
    const decks = DECKS.slice(0, 2);
    const block = preconMatchups(decks, [seatRun(decks, 'wide/v0', 1_200, [[900, 300]])]);
    expect(block.cells[0]?.status).toBe('outside');
    expect(block.cells[0]?.winRate).toBe(0.75);
    expect(block.cells[1]?.winRate).toBe(0.25);
  });

  it('refuses a run count that cannot be zipped to the schedule', () => {
    const run = roundRobin(DECKS, 'broken/v0', 1_200, [
      [600, 600],
      [600, 600],
      [600, 600],
    ]);
    const decks = DECKS.slice(0, 2);
    expect(() => preconMatchups(decks, [{ decks, run, runSeed: 'broken/v0' }])).toThrow(/schedule.*1.*3/);
  });

  it('accepts five written decks without claiming a balance verdict', () => {
    const decks = [
      ...DECKS,
      deck('construct-trial', 'Construct Trial'),
      deck('tide-watch', 'The Tide Watch'),
    ];
    const wins = Array.from({ length: 10 }, () => [1, 1] as const);
    const block = preconMatchups(decks, [seatRun(decks, 'five-decks/v0', 2, wins)]);
    expect(block.decks).toHaveLength(5);
    expect(block.decks.find((entry) => entry.id === 'construct-trial')?.payoff).toBe(
      'construct-trial-payoff',
    );
    expect(block.cells).toHaveLength(20);
    expect(block.cells.every((cell) => cell.status === 'underSampled')).toBe(true);
    expect(block.cells.every((cell) => cell.winRate === null)).toBe(true);
    const read = readAnalysisRun({ ...(fixtureJson('run-a') as object), precons: block }, 'five-decks');
    expect(read.precons?.decks).toHaveLength(5);
  });
});

describe('PreconMatchupPanel', () => {
  it('renders a labeled matrix with rates, confidence, records, and an explicit diagonal', () => {
    const block = preconMatchups(DECKS, [
      seatRun(DECKS, 'panel/v0', 1_200, [
        [600, 600],
        [900, 300],
        [600, 600],
      ]),
    ]);
    const markup = renderToStaticMarkup(h(PreconMatchupPanel, { matchups: block }));
    expect(markup).toContain('aria-label="Preconstructed deck matchups"');
    expect(markup).toContain('The Sky Islands');
    expect(markup).toContain('75.0%');
    expect(markup).toContain('95% CI');
    expect(markup).toContain('900W-300L-0D');
    expect(markup).toContain('not measured against itself');
    expect(markup).toContain('Plan execution is unavailable');
    expect(markup).toContain('authored intent, not measured execution');
  });
});

describe('the untrusted analysis boundary', () => {
  it('reads a producer matchup block without changing it', () => {
    const precons = preconMatchups(DECKS, [
      seatRun(DECKS, 'reader/v0', 1_200, [
        [600, 600],
        [900, 300],
        [600, 600],
      ]),
    ]);
    const run = readAnalysisRun({ ...(fixtureJson('run-a') as object), precons }, 'reader');
    expect(run.precons).toEqual(precons);
  });

  it('rejects a cell that names a deck outside the matrix', () => {
    const decks = DECKS.slice(0, 2);
    const precons = preconMatchups(decks, [seatRun(decks, 'hostile/v0', 1_200, [[600, 600]])]);
    const first = precons.cells[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const hostile = {
      ...precons,
      cells: [{ ...first, opponentId: 'not-in-this-run' }, ...precons.cells.slice(1)],
    };
    expect(() =>
      readAnalysisRun({ ...(fixtureJson('run-a') as object), precons: hostile }, 'hostile'),
    ).toThrow(/precons\.cells\[0\].*outside the matrix/);
  });

  it('rejects measured plan execution without a positive evidence population', () => {
    const decks = DECKS.slice(0, 2);
    const precons = preconMatchups(decks, [seatRun(decks, 'plan/v0', 1_200, [[600, 600]])]);
    const hostile = {
      ...precons,
      planExecution: { status: 'measured', samples: 0, evidence: 'No observations.' },
    };
    expect(() =>
      readAnalysisRun({ ...(fixtureJson('run-a') as object), precons: hostile }, 'hostile-plan'),
    ).toThrow(/planExecution\.samples.*positive samples/);
  });
});
