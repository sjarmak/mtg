import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { botEvidenceSha256, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import {
  compareStageStrengthCampaign,
  stageStrengthEpisodeId,
  type StageStrengthArm,
  type StageStrengthCampaignPlan,
  type StageStrengthTrial,
} from '@mtg/metrics';
import {
  finalizeStageStrengthCampaignArtifacts,
  openStageStrengthCampaignArtifacts,
} from '../../tools/stage-strength-artifacts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const configs = { baseline: { policy: 'base' }, candidate: { policy: 'candidate' } } as const;
const gameplayConfig = { policy: 'play/v1' };
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-stage-strength-artifacts-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function plan(): StageStrengthCampaignPlan {
  return {
    version: 'stage-strength-campaign-plan/v1',
    id: 'artifact-test',
    split: 'tuning',
    stage: 'limited-construction',
    evidenceStage: 'deckbuilding',
    engine: 'forge',
    runtime: { kind: 'analysis', version: 'builder/v1', buildSha256: A },
    features: {
      baseline: { schemaId: 'pool/v1', schemaSha256: A },
      candidate: { schemaId: 'pool/v1', schemaSha256: A },
    },
    subjects: [{ id: 'isd', formatSha256: A, cardsSha256: B }],
    primaryOutcome: 'candidate-downstream-game-score-minus-baseline',
    downstream: {
      runtime: { kind: 'forge', version: 'forge/v1', buildSha256: B },
      features: { schemaId: 'game/v1', schemaSha256: B },
      focalPolicy: {
        policyId: 'play/v1',
        configSha256: botEvidenceSha256(gameplayConfig),
        modelSha256: null,
        dataSha256: null,
      },
      opponentPolicy: { policyId: 'opponent/v1', configSha256: B, modelSha256: null, dataSha256: null },
      opponents: [{ id: 'opponent', artifactSha256: A }],
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
        policyId: 'base/v1',
        configSha256: botEvidenceSha256(configs.baseline),
        modelSha256: null,
        dataSha256: null,
      },
      candidate: {
        policyId: 'candidate/v1',
        configSha256: botEvidenceSha256(configs.candidate),
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
        gameId: `game-${String(index)}-${String(focalSeat)}`,
        seed: `game-seed-${String(index)}`,
        focalSeat,
        opponentId: 'opponent',
      })),
      segments: { format: 'isd' },
    })),
  };
}

function trial(
  campaign: StageStrengthCampaignPlan,
  unitId: string,
  arm: StageStrengthArm,
): StageStrengthTrial {
  const row = campaign.schedule.find((candidate) => candidate.unitId === unitId)!;
  const episode: BotEvidenceEpisode = {
    schemaVersion: 1,
    episode: {
      id: stageStrengthEpisodeId(campaign.id, unitId, arm),
      stage: 'deckbuilding',
      seed: null,
      runtime: campaign.runtime,
      subject: { formatId: 'isd', formatSha256: A, cardsSha256: B },
      features: campaign.features[arm],
      behavior: { ...campaign.policies[arm], config: configs[arm] },
      lineage: { setId: 'isd', poolId: row.seed },
      splitGroup: { kind: 'pool', id: row.seed },
    },
    decisions: [],
    outcome: { status: 'completed', value: { deck: arm } },
  };
  const outcomeEvidence = {
    version: 'stage-strength-game-outcome/v1' as const,
    unitId,
    arm,
    status: 'completed' as const,
    sourceEpisodeSha256: botEvidenceSha256(episode),
    games: row.outcomeSchedule.map((game) => ({
      ...game,
      opponent: {
        artifactSha256: campaign.downstream.opponents.find(({ id }) => id === game.opponentId)!
          .artifactSha256,
        policy: campaign.downstream.opponentPolicy,
      },
      result: arm === 'candidate' ? ('win' as const) : ('loss' as const),
      evidence: {
        schemaVersion: 1 as const,
        episode: {
          id: `${campaign.id}/${unitId}/${arm}/${game.gameId}`,
          stage: 'gameplay' as const,
          seed: game.seed,
          runtime: campaign.downstream.runtime,
          subject: { formatId: 'isd', formatSha256: A, cardsSha256: B },
          features: campaign.downstream.features,
          behavior: { ...campaign.downstream.focalPolicy, config: gameplayConfig },
          lineage: { gameId: game.gameId },
          splitGroup: { kind: 'game' as const, id: game.gameId },
        },
        decisions: [],
        outcome: {
          status: 'completed' as const,
          value: { winner: arm === 'candidate' ? game.focalSeat : 1 - game.focalSeat },
        },
      },
      measurement: { elapsedMs: 1, decisions: 0 },
    })),
  };
  return {
    unitId,
    arm,
    episode,
    outcomeEvidence,
    outcomeEvidenceSha256: botEvidenceSha256(outcomeEvidence),
    cost: { elapsedMs: 1, decisions: 0, downstreamDecisions: 0, spentUsd: 0 },
  };
}

it('pre-registers, validates ordered checkpoints, and finalizes only the exact campaign', () => {
  const campaign = plan();
  const output = join(root, 'campaign');
  const recorder = openStageStrengthCampaignArtifacts(output, campaign, { version: 'runtime/v1' });
  expect(JSON.parse(readFileSync(join(output, 'plan.json'), 'utf8')).id).toBe('artifact-test');
  const trials = campaign.schedule.flatMap((row) =>
    (['baseline', 'candidate'] as const).map((arm) => trial(campaign, row.unitId, arm)),
  );
  expect(() => recorder.checkpoint(trials[1]!)).toThrow(/expected.*baseline/i);
  for (const value of trials) recorder.checkpoint(value);
  const comparison = compareStageStrengthCampaign(campaign, trials);
  recorder.complete({ trials, comparison });
  expect(JSON.parse(readFileSync(join(output, 'comparison.json'), 'utf8')).sha256).toBe(comparison.sha256);
  expect(readFileSync(join(output, 'trials.jsonl'), 'utf8').trim().split('\n')).toHaveLength(4);
});

it('refuses drifted checkpoints and incomplete completion', () => {
  const campaign = plan();
  const recorder = openStageStrengthCampaignArtifacts(join(root, 'campaign'), campaign, {});
  const first = trial(campaign, 'pool-0', 'baseline');
  expect(() => recorder.checkpoint({ ...first, outcomeEvidenceSha256: B })).toThrow(/SHA-256 mismatch/i);
  recorder.checkpoint(first);
  expect(() => recorder.complete({ trials: [first], comparison: {} as never })).toThrow(/4/);
  recorder.abort();
});

it('refuses to reuse an existing campaign output directory', () => {
  const output = join(root, 'campaign');
  mkdirSync(output);
  expect(() => openStageStrengthCampaignArtifacts(output, plan(), {})).toThrow(/EEXIST/u);

  const fresh = join(root, 'fresh-campaign');
  const recorder = openStageStrengthCampaignArtifacts(fresh, plan(), {});
  expect(() => openStageStrengthCampaignArtifacts(fresh, plan(), {})).toThrow(/EEXIST/u);
  recorder.abort();
});

it('streams the exact comparison from complete checkpoints in noncanonical schedule order', async () => {
  const original = plan();
  const campaign = { ...original, schedule: [...original.schedule].reverse() };
  const output = join(root, 'streamed');
  const recorder = openStageStrengthCampaignArtifacts(output, campaign, {});
  const values = campaign.schedule.flatMap((row) =>
    (['baseline', 'candidate'] as const).map((arm) => trial(campaign, row.unitId, arm)),
  );
  for (const value of values) recorder.checkpoint(value);
  recorder.abort();

  const comparison = await finalizeStageStrengthCampaignArtifacts(output);

  expect(comparison).toEqual(compareStageStrengthCampaign(campaign, values));
  expect(JSON.parse(readFileSync(join(output, 'comparison.json'), 'utf8'))).toEqual(comparison);
});
