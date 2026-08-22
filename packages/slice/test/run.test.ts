import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLOR_PAIRS } from '@mtg/deckbuild';
import { parseReplayJsonl } from '@mtg/sim';
import type { SliceRunResult } from '@mtg/slice';
import { REVISION_GAME_COUNT, runSlice, sliceStatus } from '@mtg/slice';
import { optionsFor, removeDir, tempDir } from './helpers';

/**
 * The whole loop, run for real on a fixed seed.
 *
 * Two games per matchup keeps this inside a unit-test budget while still
 * playing every one of the 45 matchups, so the wiring — set to decks to games
 * to gates to memo — is exercised end to end rather than mocked. Every metric
 * comes back `underSampled` at this size, which is the correct behavior to
 * assert: an under-sampled gate is not a pass.
 */
describe('the thin slice, end to end', () => {
  let dir = '';
  let run: SliceRunResult;

  beforeAll(async () => {
    dir = tempDir('mtg-slice-run-');
    run = await runSlice(optionsFor(dir, { runSeed: 'slice-test/v0' }));
  }, 120_000);

  afterAll(() => {
    if (dir !== '') removeDir(dir);
  });

  it('completes every stage and reports green under an advisory gate', () => {
    expect(run.summary.status).toBe('green');
    expect(run.summary.runSeed).toBe('slice-test/v0');
    expect(run.summary.durationMs).toBeGreaterThan(0);
  });

  it('carries the set through generation with the validators satisfied', () => {
    expect(run.summary.setgen.enforceable).toBe(true);
    expect(run.summary.setgen.cardsPrinted).toBe(run.summary.setgen.targetSize);
    expect(run.summary.setgen.legalCards).toBe(run.summary.setgen.cardsPrinted);
    expect(run.summary.set.code).toBe('TGR');
  });

  it('publishes the validator-retry counts the go/no-go memo asks for', () => {
    const gen = run.summary.setgen;
    expect(gen.slotsNeedingRetry).toBeGreaterThan(0);
    expect(gen.maxAttemptsForOneSlot).toBeGreaterThan(1);
    expect(gen.retryRounds.length).toBeGreaterThan(0);
    for (const round of gen.retryRounds) {
      expect(round.slots).toBeGreaterThan(0);
      expect(round.causes.length).toBeGreaterThan(0);
    }
    expect(gen.critiqueRan).toBe(true);
  });

  it('builds one deck per color pair and plays every pairing', () => {
    expect(run.summary.decks).toHaveLength(COLOR_PAIRS.length);
    expect(run.summary.sim.matchups).toBe((COLOR_PAIRS.length * (COLOR_PAIRS.length - 1)) / 2);
    expect(run.summary.sim.games).toBe(run.summary.sim.matchups * run.summary.sim.gamesPerMatchup);
  });

  it('publishes throughput and fork cost as measured numbers', () => {
    const { sim, kernel } = run.summary;
    expect(sim.gamesPerSecond).toBeGreaterThan(0);
    expect(sim.secondsPerRevision).toBeCloseTo(REVISION_GAME_COUNT / sim.gamesPerSecond, 3);
    expect(kernel.kernelGamesPerSecond).toBeGreaterThan(0);
    expect(kernel.forkNanos).toBeGreaterThan(0);
    expect(kernel.deepCopyNanos).toBeGreaterThan(kernel.forkNanos);
    expect(kernel.forkSpeedup).toBeGreaterThan(10);
  });

  it('reports a verdict over gates that all know their own sample size', () => {
    const metrics = run.summary.metrics;
    expect(metrics.gates).toBeGreaterThan(0);
    expect(
      metrics.passed + metrics.failed + metrics.underSampled + metrics.notApplicable + metrics.withinNoise,
    ).toBe(metrics.gates);
    // 90 games cannot clear any distinct-game floor, so nothing may claim a pass.
    expect(metrics.underSampled).toBeGreaterThan(0);
    // No ability pool reaches this stage, so no ability gate can go not-applicable.
    expect(metrics.notApplicable).toBe(0);
  });

  it('labels a Forge skip as a skip', () => {
    expect(run.summary.forge.status).toBe('skipped');
    expect(run.summary.forge.skippedByRequest).toBe(true);
  });

  it('writes every artifact it names', () => {
    for (const [name, path] of Object.entries(run.summary.artifacts)) {
      expect(existsSync(path), `${name} is missing at ${path}`).toBe(true);
    }
    expect(existsSync(run.summaryPath)).toBe(true);
    expect(existsSync(join(dir, 'memo.txt'))).toBe(true);
    for (const pair of COLOR_PAIRS.map(([a, b]) => `${a}${b}`)) {
      expect(existsSync(join(dir, 'decks', `${pair}.md`))).toBe(true);
    }
  });

  it('writes a replay log a 17lands-shaped reader can parse', () => {
    const parsed = parseReplayJsonl(readFileSync(run.summary.sim.logPath, 'utf8'));
    expect(parsed.header.sim_run_seed).toBe('slice-test/v0');
    expect(parsed.rows).toHaveLength(run.summary.sim.games);
    expect(parsed.rows[0]).toHaveProperty('main_colors');
  });

  it('publishes every billed token kind, not just the plain input', () => {
    const gen = run.summary.setgen;
    expect(run.summary.formatVersion).toBe(3);
    expect(gen.tokens).toEqual({
      input: 54,
      cacheWrite: 899_589,
      cacheRead: 626_439,
      output: 120_346,
      billed: 1_646_428,
    });
    expect(gen.costUsd).toBeCloseTo(24.636059, 6);
    expect(gen.costSource).toBe('reported');
    // The point of the field: a caching-heavy run's blended rate sits far below
    // the model's $50/MTok output rate, which the old two-field memo implied.
    expect(gen.usdPerMillionTokens ?? 0).toBeCloseTo(14.9633, 3);
  });

  it('prints the token breakdown and the blended rate in the memo', () => {
    expect(run.memo).toContain(
      '  tokens                1,646,428 billed — 54 fresh input, 899,589 cache write, 626,439 cache read, 120,346 output',
    );
    expect(run.memo).toContain(
      '  cost                  $24.6361 (reported), $14.96 per million billed tokens',
    );
    expect(run.memo).toContain('  spend                 nothing — fixtures were replayed');
    expect(run.memo).not.toContain('54 in / 120346 out');
  });

  it('prints a memo carrying the four ADR inputs', () => {
    expect(run.memo).toContain('SLICE GREEN');
    expect(run.memo).toContain('validator retries');
    expect(run.memo).toContain('games/sec');
    expect(run.memo).toContain('fork(state)');
    expect(run.memo).toContain('Format-health verdict');
    expect(run.memo).toContain('Forge boot gate');
  });

  it('replays byte-identically from the same seed', async () => {
    const second = tempDir('mtg-slice-run2-');
    try {
      await runSlice(optionsFor(second, { runSeed: 'slice-test/v0' }));
      expect(readFileSync(join(second, 'logs', 'replay.jsonl'), 'utf8')).toBe(
        readFileSync(run.summary.sim.logPath, 'utf8'),
      );
      expect(readFileSync(join(second, 'set', 'set.json'), 'utf8')).toBe(
        readFileSync(join(dir, 'set', 'set.json'), 'utf8'),
      );
    } finally {
      removeDir(second);
    }
  }, 120_000);
});

describe('sliceStatus', () => {
  it('only turns a red band into a no-go under the strict gate', () => {
    expect(sliceStatus('strict', 'fail')).toBe('no-go');
    expect(sliceStatus('strict', 'pass')).toBe('green');
    expect(sliceStatus('advisory', 'fail')).toBe('green');
    expect(sliceStatus('advisory', 'pass')).toBe('green');
  });
});
