import { describe, expect, it } from 'vitest';
import type { SliceSummary } from '@mtg/slice';
import { formatSummary } from '@mtg/slice';

/**
 * A `SliceSummary` built by hand, for the memo-formatting arithmetic that
 * needs no pipeline run. Every stage result is a plain data shape, so a
 * plausible fixture is enough to exercise `formatSummary` on its own.
 */
function summaryOf(overrides: {
  readonly passed: number;
  readonly failed: number;
  readonly underSampled: number;
  readonly notApplicable: number;
  readonly withinNoise: number;
}): SliceSummary {
  const gates =
    overrides.passed +
    overrides.failed +
    overrides.underSampled +
    overrides.notApplicable +
    overrides.withinNoise;
  return {
    formatVersion: 3,
    status: overrides.failed === 0 ? 'green' : 'no-go',
    startedAt: '2026-08-16T00:00:00.000Z',
    durationMs: 1000,
    runSeed: 'format-test/v0',
    metricsGate: 'advisory',
    set: { code: 'TST', name: 'Test Set', cards: 90 },
    setgen: {
      provider: 'fixture',
      briefSeed: 'seed',
      targetSize: 90,
      cardsPrinted: 90,
      legalCards: 90,
      enforceable: true,
      calls: 1,
      failedCalls: 0,
      tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, billed: 0 },
      costUsd: 0,
      costSource: 'reported',
      usdPerMillionTokens: null,
      slotsNeedingRetry: 0,
      maxAttemptsForOneSlot: 0,
      retryRounds: [],
      critiqueRan: false,
      critiqueApplied: 0,
      critiqueReverted: 0,
      warnings: [],
    },
    decks: [],
    sim: {
      matchups: 1,
      gamesPerMatchup: 2,
      games: 2,
      workers: 1,
      elapsedMillis: 10,
      gamesPerSecond: 200,
      secondsPerRevision: 50,
      logPath: '/tmp/replay.jsonl',
    },
    metrics: {
      verdict: overrides.failed === 0 ? 'pass' : 'fail',
      gates,
      passed: overrides.passed,
      failed: overrides.failed,
      underSampled: overrides.underSampled,
      notApplicable: overrides.notApplicable,
      withinNoise: overrides.withinNoise,
      failures: [],
      reportPath: '/tmp/format-health.md',
      gatesPath: '/tmp/gates.json',
    },
    kernel: {
      benchGames: 3,
      kernelGamesPerSecond: 300,
      meanTurnsPerGame: 10,
      meanDecisionsPerGame: 20,
      positionTurn: 4,
      positionObjects: 30,
      positionBytes: 900,
      forkNanos: 100,
      deepCopyNanos: 2000,
      forkSpeedup: 20,
      branchReduceNanos: 50,
      secondsPerRevision: 33,
    },
    forge: {
      status: 'skipped',
      reason: 'skipped by request',
      skippedByRequest: true,
      cardCount: 0,
      forgeVersion: null,
      gamesPlayed: 0,
      problemCards: [],
      commands: [],
      durationMs: 0,
    },
    artifacts: {},
    storePath: null,
  };
}

describe('formatSummary — format-health verdict line', () => {
  it('names all four non-pass states, not one undifferentiated count', () => {
    const memo = formatSummary(
      summaryOf({ passed: 3, failed: 1, underSampled: 2, notApplicable: 1, withinNoise: 1 }),
    );
    expect(memo).toContain('3 pass, 1 fail, 2 under-sampled, 1 n/a, 1 inside the seed noise, of 8 gates');
  });

  it('flags a gate that abstained inside the seed noise as neither a pass nor a fail', () => {
    const memo = formatSummary(
      summaryOf({ passed: 4, failed: 0, underSampled: 0, notApplicable: 0, withinNoise: 1 }),
    );
    expect(memo).toContain("1 gate(s) missed inside this run's own seed noise; not a pass, not a fail");
  });

  it('flags a gate with nothing in the pool to measure', () => {
    const memo = formatSummary(
      summaryOf({ passed: 4, failed: 0, underSampled: 0, notApplicable: 1, withinNoise: 0 }),
    );
    expect(memo).toContain('1 gate(s) had nothing in the pool to measure');
  });

  it('omits both abstention hints when neither state is present', () => {
    const memo = formatSummary(
      summaryOf({ passed: 5, failed: 0, underSampled: 0, notApplicable: 0, withinNoise: 0 }),
    );
    expect(memo).not.toContain("inside this run's own seed noise");
    expect(memo).not.toContain('nothing in the pool to measure');
  });
});
