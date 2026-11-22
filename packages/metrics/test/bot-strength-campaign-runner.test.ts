import { describe, expect, it, vi } from 'vitest';
import { botEvidenceSha256, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import {
  executeBotStrengthCampaign,
  runBotStrengthCampaign,
  type BotStrengthCampaignPlan,
  type BotStrengthTrialExecution,
} from '../src';

const SHA = 'a'.repeat(64);

function plan(): BotStrengthCampaignPlan {
  return {
    version: 'bot-strength-campaign-plan/v1',
    id: 'runner-holdout-v1',
    split: 'holdout',
    stage: 'gameplay',
    engine: 'forge',
    runtime: { version: 'forge-test', buildSha256: SHA },
    features: {
      baseline: { schemaId: 'observation/v1+actions/v7', schemaSha256: '7'.repeat(64) },
      candidate: { schemaId: 'observation/v1+actions/v13', schemaSha256: '1'.repeat(64) },
    },
    formats: [{ id: 'cube', formatSha256: SHA, cardsSha256: SHA }],
    primaryOutcome: 'candidate-game-score-minus-baseline',
    smallestUsefulEffect: 0.1,
    regressionMargin: 0.1,
    maximumFailureRate: 0.1,
    minimumIndependentUnits: 2,
    stoppingRule: { kind: 'fixed-independent-units', count: 2 },
    powerPlan: {
      method: 'paired-normal-approximation',
      alpha: 0.05,
      targetPower: 0.8,
      anticipatedStandardDeviation: 0.05,
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
        policyId: 'candidate@1',
        configSha256: botEvidenceSha256({ arm: 'candidate' }),
        modelSha256: null,
        dataSha256: null,
      },
    },
    opponents: [
      {
        id: 'forge-default/deck-a',
        policyId: 'forge-default@2.0.14',
        configSha256: SHA,
        modelSha256: null,
        dataSha256: null,
        deckSha256: 'd'.repeat(64),
      },
    ],
    schedule: ['one', 'two'].flatMap((unitId) =>
      ([0, 1] as const).map((focalSeat) => ({
        unitId,
        formatId: 'cube',
        opponentId: 'forge-default/deck-a',
        seed: `seed-${unitId}`,
        focalSeat,
        focalDeckSha256: 'f'.repeat(64),
      })),
    ),
  };
}

function evidence(context: Parameters<BotStrengthTrialExecution>[0]): BotEvidenceEpisode {
  const id = `runner-holdout-v1/${context.row.unitId}/${String(context.row.focalSeat)}/${context.arm}`;
  const config = { arm: context.arm };
  return {
    schemaVersion: 1,
    episode: {
      id,
      stage: 'gameplay',
      seed: context.row.seed,
      runtime: { kind: 'forge', ...context.runtime },
      subject: {
        formatId: context.format.id,
        formatSha256: context.format.formatSha256,
        cardsSha256: context.format.cardsSha256,
      },
      features: context.features,
      behavior: { ...context.policy, config },
      lineage: { gameId: id },
      splitGroup: { kind: 'game', id },
    },
    decisions: [],
    outcome: { status: 'completed', value: { winner: context.row.focalSeat } },
  };
}

describe('bot strength campaign runner', () => {
  it('executes the fixed schedule once per arm and checkpoints canonical trials', async () => {
    const seen: string[] = [];
    const checkpoints: string[] = [];
    const execute: BotStrengthTrialExecution = vi.fn(async (context) => {
      seen.push(`${context.row.unitId}/${String(context.row.focalSeat)}/${context.arm}`);
      return { episode: evidence(context), cost: { elapsedMs: 5, decisions: 0 } };
    });

    const result = await runBotStrengthCampaign(plan(), execute, async (trial) => {
      checkpoints.push(trial.episode.episode.id);
    });

    expect(seen).toEqual([
      'one/0/baseline',
      'one/0/candidate',
      'one/1/baseline',
      'one/1/candidate',
      'two/0/baseline',
      'two/0/candidate',
      'two/1/baseline',
      'two/1/candidate',
    ]);
    expect(checkpoints).toEqual(seen.map((id) => `runner-holdout-v1/${id}`));
    expect(result.trials).toHaveLength(8);
    expect(result.comparison.population.scheduledGamesPerArm).toBe(4);
  });

  it('rejects an invalid plan before starting an external game', async () => {
    const execute = vi.fn<BotStrengthTrialExecution>();
    const invalid = { ...plan(), schedule: plan().schedule.slice(1) };

    await expect(runBotStrengthCampaign(invalid, execute)).rejects.toThrow(/seat-balanced/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes and checkpoints a complete population without returning retained trials', async () => {
    const checkpoints: string[] = [];
    const count = await executeBotStrengthCampaign(
      plan(),
      async (context) => ({ episode: evidence(context), cost: { elapsedMs: 5, decisions: 0 } }),
      (trial) => {
        checkpoints.push(trial.episode.episode.id);
      },
    );

    expect(count).toBe(8);
    expect(checkpoints).toHaveLength(8);
  });

  it('rejects drift before checkpointing the engine result', async () => {
    const execute: BotStrengthTrialExecution = vi.fn(async (context) => {
      const episode = evidence(context);
      return {
        episode: {
          ...episode,
          episode: { ...episode.episode, seed: 'engine-returned-a-different-seed' },
        },
        cost: { elapsedMs: 5, decisions: 0 },
      };
    });
    const checkpoint = vi.fn();

    await expect(runBotStrengthCampaign(plan(), execute, checkpoint)).rejects.toThrow(/seed drift/i);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(checkpoint).not.toHaveBeenCalled();
  });
});
