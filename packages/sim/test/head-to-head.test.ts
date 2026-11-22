import { describe, expect, it } from 'vitest';
import { actionKey } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '../src/config';
import { decideGreedy, greedyBot } from '../src/greedy-bot';
import { playHeadToHead } from '../src/head-to-head';

describe('head to head', () => {
  it('counts every game and splits a mirror match between the seats', () => {
    const report = playHeadToHead({
      candidate: (name) => greedyBot(name),
      reference: (name) => greedyBot(name),
      games: 8,
      runSeed: 'sim/test/head-to-head/mirror',
    });
    expect(report.games).toBe(8);
    expect(report.candidateWins + report.referenceWins + report.draws).toBe(8);
    expect(report.candidateWinRate).toBeCloseTo(report.candidateWins / 8, 12);
    expect(report.candidateDepartures).toBe(0);
    expect(report.candidateDeparturesPerGame).toBe(0);
    // Greedy against itself with the seats alternated should not be a sweep;
    // a sweep would mean the seat assignment, not the policy, decided the games.
    expect(report.candidateWins).toBeGreaterThan(0);
    expect(report.referenceWins).toBeGreaterThan(0);
  });

  it('counts decisions where the candidate departs from greedy', () => {
    const report = playHeadToHead({
      candidate: (name) => ({
        name,
        decide: (view) => {
          const greedy = decideGreedy(view, DEFAULT_GREEDY_CONFIG);
          return view.decision.options.find((option) => actionKey(option) !== actionKey(greedy)) ?? greedy;
        },
      }),
      reference: (name) => greedyBot(name),
      games: 2,
      runSeed: 'sim/test/head-to-head/departures',
    });
    expect(report.candidateDepartures).toBeGreaterThan(0);
    expect(report.candidateDeparturesPerGame).toBe(report.candidateDepartures / 2);
  });

  it('reproduces a reading on the same run seed', () => {
    const run = () =>
      playHeadToHead({
        candidate: (name) => greedyBot(name),
        reference: (name) => greedyBot(name),
        games: 4,
        runSeed: 'sim/test/head-to-head/repeat',
      });
    expect(run()).toStrictEqual(run());
  });

  it('names each agent factory with the concrete game seed', () => {
    const candidateSeeds: string[] = [];
    const referenceSeeds: string[] = [];
    playHeadToHead({
      candidate: (name, gameSeed) => {
        candidateSeeds.push(gameSeed);
        return greedyBot(name);
      },
      reference: (name, gameSeed) => {
        referenceSeeds.push(gameSeed);
        return greedyBot(name);
      },
      games: 2,
      runSeed: 'sim/test/head-to-head/agent-seed',
    });
    expect(candidateSeeds).toEqual([
      'sim/test/head-to-head/agent-seed:0',
      'sim/test/head-to-head/agent-seed:1',
    ]);
    expect(referenceSeeds).toEqual(candidateSeeds);
  });

  it('refuses a reading it cannot take', () => {
    const base = {
      candidate: (name: string) => greedyBot(name),
      reference: (name: string) => greedyBot(name),
    };
    expect(() => playHeadToHead({ ...base, games: 0, runSeed: 'x' })).toThrow(/positive integer/);
    expect(() => playHeadToHead({ ...base, games: 2, runSeed: '' })).toThrow(/non-empty/);
  });
});
