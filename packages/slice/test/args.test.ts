import { describe, expect, it } from 'vitest';
import { DEFAULT_GAMES_PER_MATCHUP, DEFAULT_RUN_SEED, parseSliceArgs } from '@mtg/slice';

describe('parseSliceArgs', () => {
  it('defaults to a hermetic, unattended, fixed-seed run', () => {
    const { help, options } = parseSliceArgs([]);
    expect(help).toBe(false);
    expect(options.provider).toBe('fixture');
    expect(options.runSeed).toBe(DEFAULT_RUN_SEED);
    expect(options.gamesPerMatchup).toBe(DEFAULT_GAMES_PER_MATCHUP);
    expect(options.metricsGate).toBe('strict');
    expect(options.skipForge).toBe(false);
    expect(options.maxUsd).toBeNull();
  });

  it('reads every flag the CLI advertises', () => {
    const { options } = parseSliceArgs([
      '--seed',
      'ci/fixed',
      '--games',
      '4',
      '--workers',
      '3',
      '--provider',
      'claude-cli',
      '--metrics-gate',
      'advisory',
      '--max-usd',
      '2.5',
      '--bench-games',
      '9',
      '--skip-forge',
      '--no-critique',
    ]);
    expect(options).toMatchObject({
      runSeed: 'ci/fixed',
      gamesPerMatchup: 4,
      workers: 3,
      provider: 'claude-cli',
      metricsGate: 'advisory',
      maxUsd: 2.5,
      benchGames: 9,
      skipForge: true,
      critique: false,
    });
  });

  it('makes every path absolute so the run does not depend on the shell cwd', () => {
    const { options } = parseSliceArgs([
      '--out',
      'relative/out',
      '--brief',
      'b.json',
      '--store',
      'db.sqlite',
    ]);
    expect(options.outDir.startsWith('/')).toBe(true);
    expect(options.briefPath.startsWith('/')).toBe(true);
    expect(options.storePath?.startsWith('/')).toBe(true);
  });

  it('refuses a value flag with no value rather than treating it as a boolean', () => {
    expect(() => parseSliceArgs(['--games'])).toThrow(/--games needs a value/);
  });

  it('refuses unknown flags and stray positional arguments', () => {
    expect(() => parseSliceArgs(['--gaems', '4'])).toThrow(/unknown flag/);
    expect(() => parseSliceArgs(['4'])).toThrow(/unexpected argument/);
  });

  it('validates numbers, providers and gate modes at the boundary', () => {
    expect(() => parseSliceArgs(['--games', '0'])).toThrow(/positive integer/);
    expect(() => parseSliceArgs(['--games', '2.5'])).toThrow(/positive integer/);
    expect(() => parseSliceArgs(['--workers', '-1'])).toThrow(/non-negative integer/);
    expect(() => parseSliceArgs(['--max-usd', '0'])).toThrow(/positive number/);
    expect(() => parseSliceArgs(['--provider', 'gpt'])).toThrow(/--provider must be one of/);
    expect(() => parseSliceArgs(['--metrics-gate', 'loose'])).toThrow(/--metrics-gate must be one of/);
    expect(() => parseSliceArgs(['--seed', '  '])).toThrow(/--seed must not be empty/);
  });

  it('short-circuits on --help without validating anything else', () => {
    expect(parseSliceArgs(['--help']).help).toBe(true);
    expect(parseSliceArgs(['-h']).help).toBe(true);
  });

  it('allows zero workers, which means in-process', () => {
    expect(parseSliceArgs(['--workers', '0']).options.workers).toBe(0);
  });
});
