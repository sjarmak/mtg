import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { botEvidenceSha256, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import {
  compareBotStrengthCampaign,
  type BotStrengthCampaignPlan,
  type BotStrengthCampaignRun,
  type BotStrengthTrial,
} from '@mtg/metrics';
import {
  finalizeBotStrengthCampaignArtifacts,
  openBotStrengthCampaignArtifacts,
} from '../../tools/bot-strength-artifacts';

const SHA = 'a'.repeat(64);
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-bot-strength-artifacts-test-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function plan(): BotStrengthCampaignPlan {
  const baselineConfig = { arm: 'baseline' };
  const candidateConfig = { arm: 'candidate' };
  return {
    version: 'bot-strength-campaign-plan/v1',
    id: 'artifact-test',
    split: 'holdout',
    stage: 'gameplay',
    engine: 'forge',
    runtime: { version: 'forge-test', buildSha256: SHA },
    features: {
      baseline: { schemaId: 'base', schemaSha256: SHA },
      candidate: { schemaId: 'candidate', schemaSha256: 'b'.repeat(64) },
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
        policyId: 'base@1',
        configSha256: botEvidenceSha256(baselineConfig),
        modelSha256: null,
        dataSha256: null,
      },
      candidate: {
        policyId: 'candidate@1',
        configSha256: botEvidenceSha256(candidateConfig),
        modelSha256: null,
        dataSha256: null,
      },
    },
    opponents: [
      {
        id: 'opponent',
        policyId: 'forge-default@1',
        configSha256: SHA,
        modelSha256: null,
        dataSha256: null,
        deckSha256: SHA,
      },
    ],
    schedule: ['one', 'two'].flatMap((unitId) =>
      ([0, 1] as const).map((focalSeat) => ({
        unitId,
        formatId: 'cube',
        opponentId: 'opponent',
        seed: unitId,
        focalSeat,
        focalDeckSha256: SHA,
      })),
    ),
  };
}

function trial(
  campaign: BotStrengthCampaignPlan,
  row: BotStrengthCampaignPlan['schedule'][number],
  arm: 'baseline' | 'candidate',
): BotStrengthTrial {
  const id = `${campaign.id}/${row.unitId}/${String(row.focalSeat)}/${arm}`;
  const config = { arm };
  const episode: BotEvidenceEpisode = {
    schemaVersion: 1,
    episode: {
      id,
      stage: 'gameplay',
      seed: row.seed,
      runtime: { kind: 'forge', ...campaign.runtime },
      subject: { formatId: 'cube', formatSha256: SHA, cardsSha256: SHA },
      features: campaign.features[arm],
      behavior: { ...campaign.policies[arm], config },
      lineage: { gameId: id },
      splitGroup: { kind: 'game', id },
    },
    decisions: [],
    outcome: { status: 'completed', value: { winner: arm === 'candidate' ? row.focalSeat : null } },
  };
  return {
    unitId: row.unitId,
    arm,
    focalSeat: row.focalSeat,
    opponent: campaign.opponents[0]!,
    focalDeckSha256: row.focalDeckSha256,
    cost: { elapsedMs: 1, decisions: 0 },
    episode,
  };
}

it('pre-registers before checkpoints and durably finalizes the exact completed population', () => {
  const output = join(root, 'campaign');
  const recorder = openBotStrengthCampaignArtifacts(output, plan(), {
    version: 'fixture-runtime/v1',
    policyBundleSha256: SHA,
  });
  expect(JSON.parse(readFileSync(join(output, 'plan.json'), 'utf8'))).toMatchObject({ id: 'artifact-test' });
  expect(JSON.parse(readFileSync(join(output, 'runtime.json'), 'utf8'))).toMatchObject({
    policyBundleSha256: SHA,
  });

  const trials = Array.from({ length: 8 }, (_, sequence) => ({ sequence }));
  for (const trial of trials) recorder.checkpoint(trial as never);
  expect(readFileSync(join(output, 'trials.jsonl'), 'utf8').trim().split('\n')).toHaveLength(8);

  const comparison = {
    version: 'bot-strength-comparison/v2',
    planSha256: botEvidenceSha256(plan()),
  };
  recorder.complete({ trials, comparison } as unknown as BotStrengthCampaignRun);
  expect(JSON.parse(readFileSync(join(output, 'comparison.json'), 'utf8'))).toEqual(comparison);
  expect(() => recorder.checkpoint(trials[0] as never)).toThrow(/closed/i);
});

it('refuses an existing destination and an incomplete final population', () => {
  const occupied = join(root, 'occupied');
  mkdirSync(occupied);
  expect(() => openBotStrengthCampaignArtifacts(occupied, plan(), {})).toThrow();

  const recorder = openBotStrengthCampaignArtifacts(join(root, 'partial'), plan(), {});
  expect(() => recorder.complete({ trials: [], comparison: {} } as never)).toThrow(/8/);
  recorder.abort();
});

it('reconstructs the exact comparison while retaining only compact trial summaries', async () => {
  const original = plan();
  const campaign = { ...original, schedule: [...original.schedule].reverse() };
  const output = join(root, 'streamed');
  const recorder = openBotStrengthCampaignArtifacts(output, campaign, {});
  const trials = campaign.schedule.flatMap((row) =>
    (['baseline', 'candidate'] as const).map((arm) => trial(campaign, row, arm)),
  );
  for (const value of trials) recorder.checkpoint(value);
  recorder.abort();

  const comparison = await finalizeBotStrengthCampaignArtifacts(output);

  expect(comparison).toEqual(compareBotStrengthCampaign(campaign, trials));
  expect(JSON.parse(readFileSync(join(output, 'comparison.json'), 'utf8'))).toEqual(comparison);
});
