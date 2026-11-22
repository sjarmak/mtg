import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef } from '@mtg/engine';
import { stageStrengthGameEpisodeId, type StageStrengthCampaignPlan } from '@mtg/metrics';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import {
  LEGACY_CUBE_BUILDER_FEATURES,
  LEGACY_CUBE_DRAFT_FEATURES,
  legacyCubeBuilderPolicies,
  legacyCubeDraftPolicies,
  legacyCubeSubjectIdentity,
  runLegacyCubeBuilderStageCampaign,
  runLegacyCubeDraftStageCampaign,
} from '../../tools/legacy-cube-stage-campaign';

const catalog = parsePrintedCardCatalog(
  JSON.parse(readFileSync('packages/data/data/legacy-cube-2021-card-catalog-v1.json', 'utf8')),
);
const runtime = { kind: 'native' as const, version: 'legacy-cube/test', buildSha256: 'a'.repeat(64) };
const gameplayConfig = { objective: 'strongest-play' };
const gameplayPolicy = {
  policyId: 'forge-strongest/test',
  configSha256: botEvidenceSha256(gameplayConfig),
  modelSha256: null,
  dataSha256: null,
};
const opponentPolicy = { ...gameplayPolicy, policyId: 'forge-opponent/test' };
const downstream = {
  runtime: { kind: 'forge' as const, version: 'forge-test', buildSha256: 'b'.repeat(64) },
  features: { schemaId: 'forge-observation/test', schemaSha256: 'c'.repeat(64) },
  focalPolicy: gameplayPolicy,
  opponentPolicy,
  opponents: [{ id: 'frozen', artifactSha256: 'd'.repeat(64) }],
};

function plan(stage: 'draft' | 'limited-construction'): StageStrengthCampaignPlan {
  const policies = stage === 'draft' ? legacyCubeDraftPolicies(catalog) : legacyCubeBuilderPolicies(catalog);
  const features = stage === 'draft' ? LEGACY_CUBE_DRAFT_FEATURES : LEGACY_CUBE_BUILDER_FEATURES;
  return {
    version: 'stage-strength-campaign-plan/v1',
    id: `legacy-cube-${stage}-test`,
    split: 'tuning',
    stage,
    evidenceStage: stage === 'draft' ? 'draft' : 'deckbuilding',
    engine: 'forge',
    runtime,
    features: { baseline: features, candidate: features },
    subjects: [legacyCubeSubjectIdentity(catalog)],
    primaryOutcome: 'paired-game-score',
    downstream,
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
    policies,
    segmentDimensions: [
      { id: 'format', values: [catalog.format] },
      { id: 'focal-seat', values: ['seat-1', 'seat-2'] },
    ],
    schedule: [0, 1].map((index) => ({
      unitId: `unit-${String(index)}`,
      subjectId: catalog.format,
      seed: `pool-${String(index)}`,
      evidenceSeed: `pool-${String(index)}`,
      outcomeSchedule: ([0, 1] as const).map((focalSeat) => ({
        gameId: `game-${String(index)}-${String(focalSeat)}`,
        seed: `game-seed-${String(index)}`,
        focalSeat,
        opponentId: 'frozen',
      })),
      segments: { format: catalog.format, 'focal-seat': `seat-${String(index + 1)}` },
    })),
  };
}

function winningOutcome(campaign: StageStrengthCampaignPlan, seen: DeckRef[]) {
  return async (
    context: Parameters<Parameters<typeof runLegacyCubeDraftStageCampaign>[0]['executeOutcome']>[0],
    deck: DeckRef,
  ) => {
    seen.push(structuredClone(deck));
    return {
      outcomeEvidence: {
        version: 'stage-strength-game-outcome/v1' as const,
        unitId: context.row.unitId,
        arm: context.arm,
        status: 'completed' as const,
        sourceEpisodeSha256: botEvidenceSha256(context.episode),
        games: context.row.outcomeSchedule.map((game) => ({
          ...game,
          opponent: {
            artifactSha256: context.downstream.opponents.find(({ id }) => id === game.opponentId)!
              .artifactSha256,
            policy: context.downstream.opponentPolicy,
          },
          result: 'win' as const,
          evidence: {
            schemaVersion: 1 as const,
            episode: {
              id: stageStrengthGameEpisodeId(campaign.id, context.row.unitId, context.arm, game.gameId),
              stage: 'gameplay' as const,
              seed: game.seed,
              runtime: campaign.downstream.runtime,
              subject: {
                formatId: context.subject.id,
                formatSha256: context.subject.formatSha256,
                cardsSha256: context.subject.cardsSha256,
              },
              features: campaign.downstream.features,
              behavior: { ...campaign.downstream.focalPolicy, config: gameplayConfig },
              lineage: { setId: context.subject.id, poolId: context.row.seed, gameId: game.gameId },
              splitGroup: { kind: 'game' as const, id: game.gameId },
            },
            decisions: [],
            outcome: { status: 'completed' as const, value: { winner: game.focalSeat } },
          },
          measurement: { elapsedMs: 1, decisions: 0 },
        })),
      },
      cost: { elapsedMs: 2, decisions: 0, spentUsd: 0 },
    };
  };
}

describe('Legacy Cube stage campaigns', () => {
  it('runs exact production-seat drafts and the advisor candidate through fixed game outcomes', async () => {
    const campaign = plan('draft');
    const decks: DeckRef[] = [];
    const result = await runLegacyCubeDraftStageCampaign({
      plan: campaign,
      catalog,
      executeOutcome: winningOutcome(campaign, decks),
    });
    expect(result.trials).toHaveLength(4);
    expect(result.trials.every((trial) => trial.episode.decisions.length === 45)).toBe(true);
    expect(result.trials.map((trial) => trial.episode.episode.behavior.policyId)).toEqual([
      campaign.policies.baseline.policyId,
      campaign.policies.candidate.policyId,
      campaign.policies.baseline.policyId,
      campaign.policies.candidate.policyId,
    ]);
    expect(decks.every((deck) => deck.cards.reduce((sum, slot) => sum + slot.count, 0) === 40)).toBe(true);
  }, 30_000);

  it('builds both arms from identical fixed pools and rejects pool drift', async () => {
    const campaign = plan('limited-construction');
    const pools = new Map(
      campaign.schedule.map((row, index) => [
        row.seed,
        catalog.cards.slice(index * 45, index * 45 + 45).map((card) => card.physicalId),
      ]),
    );
    const decks: DeckRef[] = [];
    const result = await runLegacyCubeBuilderStageCampaign({
      plan: campaign,
      catalog,
      pools,
      executeOutcome: winningOutcome(campaign, decks),
    });
    expect(result.trials).toHaveLength(4);
    expect(result.trials[0]!.episode.decisions[0]!.observation.sha256).toBe(
      result.trials[1]!.episode.decisions[0]!.observation.sha256,
    );
    expect(decks).toHaveLength(4);
    const drifted = new Map(pools);
    drifted.set(campaign.schedule[0]!.seed, pools.get(campaign.schedule[0]!.seed)!.slice(1));
    await expect(
      runLegacyCubeBuilderStageCampaign({
        plan: campaign,
        catalog,
        pools: drifted,
        executeOutcome: winningOutcome(campaign, []),
      }),
    ).rejects.toThrow(/45/);
  });
});
