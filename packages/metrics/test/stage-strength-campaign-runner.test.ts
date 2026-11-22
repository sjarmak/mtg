import { botEvidenceSha256, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import { describe, expect, it, vi } from 'vitest';
import {
  executeStageStrengthCampaign,
  runStageStrengthCampaign,
  stageStrengthEpisodeId,
  type StageStrengthCampaignPlan,
} from '../src';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const BASELINE_CONFIG = { policy: 'structural/v1' };
const CANDIDATE_CONFIG = { policy: 'ranked/v1' };
const GAMEPLAY_CONFIG = { policy: 'fixed-gameplay/v1' };

function plan(): StageStrengthCampaignPlan {
  return {
    version: 'stage-strength-campaign-plan/v1',
    id: 'printed-limited-tuning-v1',
    split: 'tuning',
    stage: 'limited-construction',
    evidenceStage: 'deckbuilding',
    engine: 'forge',
    runtime: { kind: 'analysis', version: 'builder/v1', buildSha256: A },
    features: {
      baseline: { schemaId: 'printed-pool/v1', schemaSha256: A },
      candidate: { schemaId: 'printed-pool/v1', schemaSha256: A },
    },
    subjects: [{ id: 'isd', formatSha256: A, cardsSha256: B }],
    primaryOutcome: 'candidate-downstream-game-score-minus-baseline',
    downstream: {
      runtime: { kind: 'forge', version: 'forge/v1', buildSha256: B },
      features: { schemaId: 'observed-game/v1', schemaSha256: B },
      focalPolicy: {
        policyId: 'fixed-gameplay/v1',
        configSha256: botEvidenceSha256(GAMEPLAY_CONFIG),
        modelSha256: null,
        dataSha256: null,
      },
      opponentPolicy: {
        policyId: 'forge-default/v1',
        configSha256: B,
        modelSha256: null,
        dataSha256: null,
      },
      opponents: [{ id: 'opponent-a', artifactSha256: A }],
    },
    smallestUsefulEffect: 0.1,
    regressionMargin: 0.05,
    maximumFailureRate: 0,
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
        policyId: 'structural/v1',
        configSha256: botEvidenceSha256(BASELINE_CONFIG),
        modelSha256: null,
        dataSha256: null,
      },
      candidate: {
        policyId: 'ranked/v1',
        configSha256: botEvidenceSha256(CANDIDATE_CONFIG),
        modelSha256: null,
        dataSha256: B,
      },
    },
    segmentDimensions: [{ id: 'format', values: ['isd'] }],
    schedule: [0, 1].map((index) => ({
      unitId: `pool-${String(index)}`,
      subjectId: 'isd',
      seed: `pool-seed-${String(index)}`,
      evidenceSeed: null,
      outcomeSchedule: ([0, 1] as const).map((focalSeat) => ({
        gameId: `pool-${String(index)}-game-${String(focalSeat)}`,
        seed: `game-seed-${String(index)}`,
        focalSeat,
        opponentId: 'opponent-a',
      })),
      segments: { format: 'isd' },
    })),
  };
}

function outcomeGame(
  campaign: StageStrengthCampaignPlan,
  unitId: string,
  trialArm: 'baseline' | 'candidate',
  game: StageStrengthCampaignPlan['schedule'][number]['outcomeSchedule'][number],
  result: 'win' | 'loss' | 'draw',
) {
  const subject = campaign.subjects[0]!;
  const opponent = campaign.downstream.opponents.find((candidate) => candidate.id === game.opponentId)!;
  const evidence: BotEvidenceEpisode = {
    schemaVersion: 1,
    episode: {
      id: `${campaign.id}/${unitId}/${trialArm}/${game.gameId}`,
      stage: 'gameplay',
      seed: game.seed,
      runtime: campaign.downstream.runtime,
      subject: {
        formatId: subject.id,
        formatSha256: subject.formatSha256,
        cardsSha256: subject.cardsSha256,
      },
      features: campaign.downstream.features,
      behavior: { ...campaign.downstream.focalPolicy, config: GAMEPLAY_CONFIG },
      lineage: { gameId: game.gameId },
      splitGroup: { kind: 'game', id: game.gameId },
    },
    decisions: Array.from({ length: 2 }, (_unused, sequence) => ({
      sequence,
      observation: { sha256: botEvidenceSha256({}), value: {} },
      candidates: { status: 'complete' as const, values: [{ id: 'pass', value: null }] },
      choice: { status: 'chosen' as const, candidateId: 'pass' },
    })),
    outcome: {
      status: 'completed',
      value: { winner: result === 'draw' ? null : result === 'win' ? game.focalSeat : 1 - game.focalSeat },
    },
  };
  return {
    ...game,
    opponent: { artifactSha256: opponent.artifactSha256, policy: campaign.downstream.opponentPolicy },
    result,
    evidence,
    measurement: { elapsedMs: 1, decisions: 2 },
  };
}

function episode(
  campaign: StageStrengthCampaignPlan,
  unitId: string,
  arm: 'baseline' | 'candidate',
): BotEvidenceEpisode {
  const row = campaign.schedule.find((entry) => entry.unitId === unitId)!;
  const policy = campaign.policies[arm];
  const config = arm === 'baseline' ? BASELINE_CONFIG : CANDIDATE_CONFIG;
  return {
    schemaVersion: 1,
    episode: {
      id: stageStrengthEpisodeId(campaign.id, unitId, arm),
      stage: campaign.evidenceStage,
      seed: row.evidenceSeed,
      runtime: campaign.runtime,
      subject: { formatId: 'isd', formatSha256: A, cardsSha256: B },
      features: campaign.features[arm],
      behavior: { ...policy, config },
      lineage: { setId: 'isd', poolId: row.seed },
      splitGroup: { kind: 'pool', id: row.seed },
    },
    decisions: [],
    outcome: { status: 'completed', value: { selected: [`${arm}-card`] } },
  };
}

describe('stage strength campaign runner', () => {
  it('executes and checkpoints a complete population without returning retained trials', async () => {
    const campaign = plan();
    const checkpoints: string[] = [];
    const count = await executeStageStrengthCampaign({
      plan: campaign,
      executeStage: async (context) => ({
        episode: episode(campaign, context.row.unitId, context.arm),
        cost: { elapsedMs: 3, spentUsd: 0 },
      }),
      executeOutcome: async (context) => ({
        outcomeEvidence: {
          version: 'stage-strength-game-outcome/v1',
          unitId: context.row.unitId,
          arm: context.arm,
          status: 'completed',
          sourceEpisodeSha256: botEvidenceSha256(context.episode),
          games: context.row.outcomeSchedule.map((game) =>
            outcomeGame(campaign, context.row.unitId, context.arm, game, 'draw'),
          ),
        },
        cost: { elapsedMs: 7, decisions: 4, spentUsd: 0 },
      }),
      onTrial: (trial) => {
        checkpoints.push(`${trial.unitId}:${trial.arm}`);
      },
    });

    expect(count).toBe(4);
    expect(checkpoints).toEqual([
      'pool-0:baseline',
      'pool-0:candidate',
      'pool-1:baseline',
      'pool-1:candidate',
    ]);
  });

  it('validates the stage before downstream games and checkpoints canonical trials', async () => {
    const campaign = plan();
    const order: string[] = [];
    const checkpoints: string[] = [];
    const result = await runStageStrengthCampaign({
      plan: campaign,
      executeStage: async (context) => {
        order.push(`stage:${context.row.unitId}:${context.arm}`);
        return {
          episode: episode(campaign, context.row.unitId, context.arm),
          cost: { elapsedMs: 3, spentUsd: 0 },
        };
      },
      executeOutcome: async (context) => {
        order.push(`outcome:${context.row.unitId}:${context.arm}`);
        expect(context.episode).toEqual(episode(campaign, context.row.unitId, context.arm));
        return {
          outcomeEvidence: {
            version: 'stage-strength-game-outcome/v1',
            unitId: context.row.unitId,
            arm: context.arm,
            status: 'completed',
            sourceEpisodeSha256: botEvidenceSha256(context.episode),
            games: context.row.outcomeSchedule.map((game) =>
              outcomeGame(
                campaign,
                context.row.unitId,
                context.arm,
                game,
                context.arm === 'candidate' ? 'win' : 'loss',
              ),
            ),
          },
          cost: { elapsedMs: 7, decisions: 4, spentUsd: 0 },
        };
      },
      onTrial: (trial) => {
        checkpoints.push(`${trial.unitId}:${trial.arm}`);
      },
    });

    expect(order).toEqual([
      'stage:pool-0:baseline',
      'outcome:pool-0:baseline',
      'stage:pool-0:candidate',
      'outcome:pool-0:candidate',
      'stage:pool-1:baseline',
      'outcome:pool-1:baseline',
      'stage:pool-1:candidate',
      'outcome:pool-1:candidate',
    ]);
    expect(checkpoints).toEqual([
      'pool-0:baseline',
      'pool-0:candidate',
      'pool-1:baseline',
      'pool-1:candidate',
    ]);
    expect(result.trials).toHaveLength(4);
    expect(result.trials[0]?.cost).toEqual({
      elapsedMs: 10,
      decisions: 0,
      downstreamDecisions: 4,
      spentUsd: 0,
    });
    expect(result.comparison.strength.meanPairedDifference).toBe(1);
  });

  it('does not run downstream games for an episode that differs from the frozen plan', async () => {
    const campaign = plan();
    const executeOutcome = vi.fn();
    await expect(
      runStageStrengthCampaign({
        plan: campaign,
        executeStage: async (context) => {
          const value = episode(campaign, context.row.unitId, context.arm);
          return {
            episode: {
              ...value,
              episode: { ...value.episode, runtime: { ...value.episode.runtime, version: 'drifted' } },
            },
            cost: { elapsedMs: 1, spentUsd: 0 },
          };
        },
        executeOutcome,
      }),
    ).rejects.toThrow(/runtime drift/i);
    expect(executeOutcome).not.toHaveBeenCalled();
  });

  it('does not let callbacks rewrite the frozen plan or retained evidence', async () => {
    const campaign = plan();
    const executeOutcome = vi.fn();
    await expect(
      runStageStrengthCampaign({
        plan: campaign,
        executeStage: async (context) => {
          const mutableFeatures = context.features as { schemaSha256: string };
          mutableFeatures.schemaSha256 = B;
          const value = episode(campaign, context.row.unitId, context.arm);
          return {
            episode: {
              ...value,
              episode: { ...value.episode, features: context.features },
            },
            cost: { elapsedMs: 1, spentUsd: 0 },
          };
        },
        executeOutcome,
      }),
    ).rejects.toThrow(/feature schema drift/i);
    expect(executeOutcome).not.toHaveBeenCalled();

    const checkpoints: string[] = [];
    let returnedStageCost: { elapsedMs: number; spentUsd: number } | undefined;
    const result = await runStageStrengthCampaign({
      plan: campaign,
      executeStage: async (context) => {
        returnedStageCost = { elapsedMs: 1, spentUsd: 0 };
        return {
          episode: episode(campaign, context.row.unitId, context.arm),
          cost: returnedStageCost,
        };
      },
      executeOutcome: async (context) => {
        returnedStageCost!.elapsedMs = 999;
        return {
          outcomeEvidence: {
            version: 'stage-strength-game-outcome/v1',
            unitId: context.row.unitId,
            arm: context.arm,
            status: 'completed',
            sourceEpisodeSha256: botEvidenceSha256(context.episode),
            games: context.row.outcomeSchedule.map((game) =>
              outcomeGame(campaign, context.row.unitId, context.arm, game, 'draw'),
            ),
          },
          cost: { elapsedMs: 1, decisions: 4, spentUsd: 0 },
        };
      },
      onTrial: (trial) => {
        checkpoints.push(`${trial.unitId}:${trial.arm}`);
        const mutableCost = trial.cost as { elapsedMs: number };
        mutableCost.elapsedMs = 999;
      },
    });
    expect(result.trials.every((trial) => trial.cost.elapsedMs === 2)).toBe(true);
    expect(result.comparison.cost.baseline.elapsedMs).toBe(4);
    expect(checkpoints).toHaveLength(4);
  });
});
