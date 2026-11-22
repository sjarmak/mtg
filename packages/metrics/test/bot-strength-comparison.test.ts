import { describe, expect, it } from 'vitest';
import { botEvidenceSha256, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import {
  compareBotStrengthCampaign,
  compareBotStrengthTrialSummaries,
  readBotStrengthComparison,
  summarizeBotStrengthTrial,
  type BotStrengthCampaignPlan,
  type BotStrengthTrial,
} from '../src/bot-strength-comparison';

const DIGEST = 'a'.repeat(64);

const PLAN: BotStrengthCampaignPlan = {
  version: 'bot-strength-campaign-plan/v1',
  id: 'heldout-cross-format-v1',
  split: 'holdout',
  stage: 'gameplay',
  engine: 'forge',
  runtime: { version: 'forge-test', buildSha256: DIGEST },
  features: {
    baseline: { schemaId: 'safe-observation/v1+actions/v7', schemaSha256: '7'.repeat(64) },
    candidate: { schemaId: 'safe-observation/v1+actions/v13', schemaSha256: '1'.repeat(64) },
  },
  formats: [
    { id: 'legacy-cube-2021-08', formatSha256: DIGEST, cardsSha256: DIGEST },
    { id: 'printed-limited-holdout', formatSha256: DIGEST, cardsSha256: DIGEST },
  ],
  primaryOutcome: 'candidate-game-score-minus-baseline',
  smallestUsefulEffect: 0.05,
  regressionMargin: 0.1,
  maximumFailureRate: 0.05,
  minimumIndependentUnits: 4,
  stoppingRule: { kind: 'fixed-independent-units', count: 4 },
  powerPlan: {
    method: 'paired-normal-approximation',
    alpha: 0.05,
    targetPower: 0.8,
    anticipatedStandardDeviation: 0.02,
    requiredIndependentUnits: 2,
  },
  policies: {
    baseline: {
      policyId: 'baseline@1',
      configSha256: botEvidenceSha256({ arm: 'baseline' }),
      modelSha256: null,
      dataSha256: null,
    },
    candidate: {
      policyId: 'candidate@2',
      configSha256: botEvidenceSha256({ arm: 'candidate' }),
      modelSha256: null,
      dataSha256: null,
    },
  },
  opponents: [
    {
      id: 'aggro-v1',
      policyId: 'forge-default@1',
      configSha256: DIGEST,
      modelSha256: null,
      dataSha256: null,
      deckSha256: 'b'.repeat(64),
    },
    {
      id: 'control-v1',
      policyId: 'forge-default@1',
      configSha256: DIGEST,
      modelSha256: null,
      dataSha256: null,
      deckSha256: 'c'.repeat(64),
    },
  ],
  schedule: [
    {
      unitId: 'unit-a',
      formatId: 'legacy-cube-2021-08',
      opponentId: 'aggro-v1',
      seed: 'seed-a',
      focalSeat: 0,
      focalDeckSha256: 'd'.repeat(64),
    },
    {
      unitId: 'unit-a',
      formatId: 'legacy-cube-2021-08',
      opponentId: 'aggro-v1',
      seed: 'seed-a',
      focalSeat: 1,
      focalDeckSha256: 'd'.repeat(64),
    },
    {
      unitId: 'unit-b',
      formatId: 'printed-limited-holdout',
      opponentId: 'control-v1',
      seed: 'seed-b',
      focalSeat: 0,
      focalDeckSha256: 'd'.repeat(64),
    },
    {
      unitId: 'unit-b',
      formatId: 'printed-limited-holdout',
      opponentId: 'control-v1',
      seed: 'seed-b',
      focalSeat: 1,
      focalDeckSha256: 'd'.repeat(64),
    },
    {
      unitId: 'unit-c',
      formatId: 'legacy-cube-2021-08',
      opponentId: 'aggro-v1',
      seed: 'seed-c',
      focalSeat: 0,
      focalDeckSha256: 'd'.repeat(64),
    },
    {
      unitId: 'unit-c',
      formatId: 'legacy-cube-2021-08',
      opponentId: 'aggro-v1',
      seed: 'seed-c',
      focalSeat: 1,
      focalDeckSha256: 'd'.repeat(64),
    },
    {
      unitId: 'unit-d',
      formatId: 'printed-limited-holdout',
      opponentId: 'control-v1',
      seed: 'seed-d',
      focalSeat: 0,
      focalDeckSha256: 'd'.repeat(64),
    },
    {
      unitId: 'unit-d',
      formatId: 'printed-limited-holdout',
      opponentId: 'control-v1',
      seed: 'seed-d',
      focalSeat: 1,
      focalDeckSha256: 'd'.repeat(64),
    },
  ],
};

function episode(
  arm: 'baseline' | 'candidate',
  unitId: string,
  formatId: string,
  seed: string,
  focalSeat: 0 | 1,
  winner: 0 | 1 | null,
): BotEvidenceEpisode {
  const policy = PLAN.policies[arm];
  const config = { arm };
  const id = `${PLAN.id}/${unitId}/${String(focalSeat)}/${arm}`;
  return {
    schemaVersion: 1,
    episode: {
      id,
      stage: 'gameplay',
      seed,
      runtime: { kind: 'forge', version: 'forge-test', buildSha256: DIGEST },
      subject: { formatId, formatSha256: DIGEST, cardsSha256: DIGEST },
      features: PLAN.features[arm],
      behavior: {
        policyId: policy.policyId,
        config,
        configSha256: botEvidenceSha256(config),
        modelSha256: policy.modelSha256,
        dataSha256: policy.dataSha256,
      },
      lineage: { gameId: id },
      splitGroup: { kind: 'game', id },
    },
    decisions: [],
    outcome: { status: 'completed', value: { winner } },
  };
}

function trials(plan: BotStrengthCampaignPlan = PLAN): readonly BotStrengthTrial[] {
  return plan.schedule.flatMap((row) =>
    (['baseline', 'candidate'] as const).map((arm) => ({
      unitId: row.unitId,
      arm,
      focalSeat: row.focalSeat,
      opponent: plan.opponents.find((entry) => entry.id === row.opponentId)!,
      focalDeckSha256: row.focalDeckSha256,
      cost: { elapsedMs: arm === 'candidate' ? 12 : 10, decisions: 0 },
      episode: episode(
        arm,
        row.unitId,
        row.formatId,
        row.seed,
        row.focalSeat,
        arm === 'candidate' ? row.focalSeat : row.focalSeat === 0 ? 1 : 0,
      ),
    })),
  );
}

describe('stage-isolated paired bot strength comparison', () => {
  it('uses seat-swapped schedules and independent units for strength, failures, and cost', () => {
    const report = compareBotStrengthCampaign(PLAN, trials());
    const summaries = trials().map((trial) => summarizeBotStrengthTrial(PLAN, trial));

    expect(compareBotStrengthTrialSummaries(PLAN, summaries, report.evidenceSha256)).toEqual(report);

    expect(report.scope).toEqual({ engine: 'forge', stage: 'gameplay', split: 'holdout' });
    expect(report.population).toEqual({ formats: 2, opponents: 2, scheduledGamesPerArm: 8 });
    expect(report.completion).toEqual({
      baseline: { attempted: 8, completed: 8, failures: 0, rate: 1, byStatus: {} },
      candidate: { attempted: 8, completed: 8, failures: 0, rate: 1, byStatus: {} },
    });
    expect(report.strength).toMatchObject({
      intervalMethod: 'simultaneous-two-sided-95%-paired-normal',
      secondaryIntervalMethod: 'simultaneous-two-sided-95%-hoeffding-bounds',
      independentUnits: 4,
      meanPairedDifference: 1,
      status: 'measured',
    });
    expect(report.strength.interval95).toEqual({ low: 1, high: 1 });
    expect(report.strength.hoeffdingInterval95).toEqual({
      low: Math.max(-1, 1 - Math.sqrt((2 * Math.log(200)) / 4)),
      high: 1,
    });
    expect(report.cost).toEqual({
      baseline: { games: 8, elapsedMs: 80, decisions: 0 },
      candidate: { games: 8, elapsedMs: 96, decisions: 0 },
    });
    // Four units all scoring +1 against a plan that asked for two: the paired normal
    // verdict promotes on its own arithmetic, where the Hoeffding bound never could.
    expect(report.promotion).toEqual({ status: 'promote-candidate', reasons: [] });
    expect(compareBotStrengthCampaign(PLAN, [...trials()].reverse())).toEqual(report);
    expect(readBotStrengthComparison(PLAN, trials(), report)).toEqual(report);
  });

  it('promotes a candidate only after a sufficiently large fixed holdout clears every segment', () => {
    const schedule = Array.from({ length: 64 }, (_, unitIndex) => {
      const even = unitIndex % 2 === 0;
      return ([0, 1] as const).map((focalSeat) => ({
        unitId: `large-unit-${String(unitIndex)}`,
        formatId: even ? 'legacy-cube-2021-08' : 'printed-limited-holdout',
        opponentId: even ? 'aggro-v1' : 'control-v1',
        seed: `large-seed-${String(unitIndex)}`,
        focalSeat,
        focalDeckSha256: 'd'.repeat(64),
      }));
    }).flat();
    const largePlan: BotStrengthCampaignPlan = {
      ...PLAN,
      minimumIndependentUnits: 64,
      stoppingRule: { kind: 'fixed-independent-units', count: 64 },
      schedule,
    };

    const report = compareBotStrengthCampaign(largePlan, trials(largePlan));

    expect(report.strength).toMatchObject({ status: 'measured', independentUnits: 64 });
    expect(report.strength.interval95!.low).toBeGreaterThan(PLAN.smallestUsefulEffect);
    expect(report.strength.byFormat.every((segment) => segment.interval95!.low > 0)).toBe(true);
    expect(report.strength.byOpponent.every((segment) => segment.interval95!.low > 0)).toBe(true);
    expect(report.promotion).toEqual({ status: 'promote-candidate', reasons: [] });
  });

  it('retains failed trials and withholds strength for incomplete paired units', () => {
    const input = trials().map((trial) =>
      trial.arm === 'candidate' && trial.unitId === 'unit-a' && trial.focalSeat === 0
        ? {
            ...trial,
            episode: {
              ...trial.episode,
              outcome: { status: 'engine-failure' as const, error: 'engine stopped' },
            },
          }
        : trial,
    );

    const report = compareBotStrengthCampaign(PLAN, input);
    expect(report.completion.candidate).toMatchObject({
      attempted: 8,
      completed: 7,
      failures: 1,
      rate: 0.875,
      byStatus: { 'engine-failure': 1 },
    });
    expect(report.strength).toMatchObject({
      independentUnits: 3,
      excludedUnits: 1,
      status: 'under-sampled',
    });
    expect(report.promotion).toMatchObject({ status: 'retain-baseline' });
    expect(report.promotion.reasons).toContain('candidate-failure-rate-exceeded');
  });

  it('rejects unbalanced schedules and trial identity drift', () => {
    expect(() => compareBotStrengthCampaign({ ...PLAN, schedule: PLAN.schedule.slice(1) }, trials())).toThrow(
      /seat-balanced/i,
    );
    const wrongPolicy = trials().map((trial, index) =>
      index === 0
        ? {
            ...trial,
            episode: {
              ...trial.episode,
              episode: {
                ...trial.episode.episode,
                behavior: { ...trial.episode.episode.behavior, policyId: 'different-policy' },
              },
            },
          }
        : trial,
    );
    expect(() => compareBotStrengthCampaign(PLAN, wrongPolicy)).toThrow(/policy/i);
    const wrongOpponent = trials().map((trial, index) =>
      index === 0 ? { ...trial, opponent: { ...trial.opponent, deckSha256: 'f'.repeat(64) } } : trial,
    );
    expect(() => compareBotStrengthCampaign(PLAN, wrongOpponent)).toThrow(/opponent/i);
    const wrongSeed = trials().map((trial, index) =>
      index === 0
        ? {
            ...trial,
            episode: {
              ...trial.episode,
              episode: { ...trial.episode.episode, seed: 'different-seed' },
            },
          }
        : trial,
    );
    expect(() => compareBotStrengthCampaign(PLAN, wrongSeed)).toThrow(/seed/i);

    const seatSwapped = trials().map((trial, index, all) =>
      index === 0
        ? { ...trial, episode: all[2]!.episode }
        : index === 2
          ? { ...trial, episode: all[0]!.episode }
          : trial,
    );
    expect(() => compareBotStrengthCampaign(PLAN, seatSwapped)).toThrow(/episode identity/i);
  });

  it.each([
    [
      'focal deck',
      (trial: BotStrengthTrial): BotStrengthTrial => ({
        ...trial,
        focalDeckSha256: 'f'.repeat(64),
      }),
    ],
    [
      'runtime',
      (trial: BotStrengthTrial): BotStrengthTrial => ({
        ...trial,
        episode: {
          ...trial.episode,
          episode: {
            ...trial.episode.episode,
            runtime: { ...trial.episode.episode.runtime, version: 'different-runtime' },
          },
        },
      }),
    ],
    [
      'feature schema',
      (trial: BotStrengthTrial): BotStrengthTrial => ({
        ...trial,
        episode: {
          ...trial.episode,
          episode: {
            ...trial.episode.episode,
            features: { ...trial.episode.episode.features, schemaId: 'different-features' },
          },
        },
      }),
    ],
    [
      'format',
      (trial: BotStrengthTrial): BotStrengthTrial => ({
        ...trial,
        episode: {
          ...trial.episode,
          episode: {
            ...trial.episode.episode,
            subject: { ...trial.episode.episode.subject, cardsSha256: 'f'.repeat(64) },
          },
        },
      }),
    ],
  ])('rejects %s drift between policy arms', (_name, change) => {
    const input = trials().map((trial, index) => (index === 0 ? change(trial) : trial));
    expect(() => compareBotStrengthCampaign(PLAN, input)).toThrow(/drift/i);
  });

  it('rejects a stopping rule whose claimed power count was not calculated or funded', () => {
    expect(() =>
      compareBotStrengthCampaign(
        { ...PLAN, powerPlan: { ...PLAN.powerPlan, requiredIndependentUnits: 3 } },
        trials(),
      ),
    ).toThrow(/power plan required unit count/i);
    expect(() =>
      compareBotStrengthCampaign(
        {
          ...PLAN,
          stoppingRule: { kind: 'fixed-independent-units', count: 4 },
          powerPlan: {
            ...PLAN.powerPlan,
            anticipatedStandardDeviation: 0.04,
            requiredIndependentUnits: 6,
          },
        },
        trials(),
      ),
    ).toThrow(/below the power plan/i);
  });

  it('rejects missing, duplicate, stale-cost, and edited reports', () => {
    expect(() => compareBotStrengthCampaign(PLAN, trials().slice(1))).toThrow(/exactly one trial/i);
    expect(() => compareBotStrengthCampaign(PLAN, [...trials(), trials()[0]!])).toThrow(/exactly one trial/i);
    const staleCost = trials().map((trial, index) =>
      index === 0 ? { ...trial, cost: { ...trial.cost, decisions: 1 } } : trial,
    );
    expect(() => compareBotStrengthCampaign(PLAN, staleCost)).toThrow(/decision count/i);
    const canonical = compareBotStrengthCampaign(PLAN, trials());
    const report = {
      ...canonical,
      strength: { ...canonical.strength, meanPairedDifference: 0 },
    };
    expect(() => readBotStrengthComparison(PLAN, trials(), report)).toThrow(/canonical/i);
  });
});
