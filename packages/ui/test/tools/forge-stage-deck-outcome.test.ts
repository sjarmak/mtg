import { describe, expect, it, vi } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef, ObservedBackend } from '@mtg/engine';
import type { ForgeObservedDecisionPolicy, ForgeObservedPolicyGameOptions } from '@mtg/forge-export';
import type { StageStrengthCampaignPlan, StageStrengthOutcomeContext } from '@mtg/metrics';
import {
  evaluateForgeStageDeckOutcome,
  forgeGameplayFeatureIdentity,
  forgeGameplayPolicyIdentity,
  validateForgeStageDeckOutcomeOptions,
} from '../../tools/forge-stage-deck-outcome';

const deck: DeckRef = { name: 'Focal', cards: [{ name: 'Mountain', count: 40 }] };
const opponent: DeckRef = { name: 'Opponent', cards: [{ name: 'Forest', count: 40 }] };
const policy: ForgeObservedDecisionPolicy = {
  identity: {
    policyId: 'strongest',
    policyVersion: 1,
    observationAdapterId: 'observation/v1',
    actionAdapterId: 'action/v1',
    configuration: { objective: 'strongest-play' },
    configSha256: botEvidenceSha256({ objective: 'strongest-play' }),
  },
  choose: () => ({ status: 'unsupported', family: 'test', reason: 'unused' }),
};
const backend: ObservedBackend = {
  id: 'forge-test',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
  supports: async () => [],
  open: async () => {
    throw new Error('the injected runner owns games');
  },
};
const opponentPolicy = {
  policyId: 'forge-engine/test',
  configSha256: 'e'.repeat(64),
  modelSha256: null,
  dataSha256: null,
};

function plan(): StageStrengthCampaignPlan {
  return {
    version: 'stage-strength-campaign-plan/v1',
    id: 'generic-forge-outcome-test',
    split: 'tuning',
    stage: 'draft',
    evidenceStage: 'draft',
    engine: 'forge',
    runtime: { kind: 'native', version: 'draft/test', buildSha256: 'a'.repeat(64) },
    features: {
      baseline: { schemaId: 'draft/v1', schemaSha256: 'b'.repeat(64) },
      candidate: { schemaId: 'draft/v1', schemaSha256: 'b'.repeat(64) },
    },
    subjects: [{ id: 'cube', formatSha256: 'c'.repeat(64), cardsSha256: 'd'.repeat(64) }],
    primaryOutcome: 'candidate-downstream-game-score-minus-baseline',
    downstream: {
      runtime: { kind: 'forge', version: 'forge/test', buildSha256: 'f'.repeat(64) },
      features: forgeGameplayFeatureIdentity(policy),
      focalPolicy: forgeGameplayPolicyIdentity(policy),
      opponentPolicy,
      opponents: [{ id: 'opponent', artifactSha256: botEvidenceSha256(opponent) }],
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
      baseline: { policyId: 'baseline', configSha256: '1'.repeat(64), modelSha256: null, dataSha256: null },
      candidate: { policyId: 'candidate', configSha256: '2'.repeat(64), modelSha256: null, dataSha256: null },
    },
    segmentDimensions: [{ id: 'format', values: ['cube'] }],
    schedule: [0, 1].map((index) => ({
      unitId: `unit-${String(index)}`,
      subjectId: 'cube',
      seed: `draft-${String(index)}`,
      evidenceSeed: `draft-${String(index)}`,
      outcomeSchedule: ([0, 1] as const).map((focalSeat) => ({
        gameId: `game-${String(index)}-${String(focalSeat)}`,
        seed: `game-seed-${String(index)}-${String(focalSeat)}`,
        focalSeat,
        opponentId: 'opponent',
      })),
      segments: { format: 'cube' },
    })),
  };
}

function context(campaign: StageStrengthCampaignPlan): StageStrengthOutcomeContext {
  const row = campaign.schedule[0]!;
  const subject = campaign.subjects[0]!;
  return {
    arm: 'candidate',
    row,
    subject,
    downstream: campaign.downstream,
    policy: campaign.policies.candidate,
    features: campaign.features.candidate,
    runtime: campaign.runtime,
    episode: {
      schemaVersion: 1,
      episode: {
        id: 'draft-episode',
        stage: 'draft',
        seed: row.evidenceSeed,
        runtime: campaign.runtime,
        subject: {
          formatId: subject.id,
          formatSha256: subject.formatSha256,
          cardsSha256: subject.cardsSha256,
        },
        features: campaign.features.candidate,
        behavior: { ...campaign.policies.candidate, config: {} },
        lineage: { setId: subject.id, poolId: row.seed },
        splitGroup: { kind: 'draft', id: row.seed },
      },
      decisions: [],
      outcome: { status: 'completed', value: {} },
    },
  };
}

describe('generic Forge stage deck outcomes', () => {
  it('validates frozen inputs and records seat-balanced, opponent-attested games', async () => {
    const campaign = plan();
    const options = {
      plan: campaign,
      gameplayPolicy: policy,
      backends: new Map([['cube', backend]]),
      opponents: new Map([['opponent', opponent]]),
      maximumTurns: 200,
      maximumDecisions: 5_000,
    };
    await expect(validateForgeStageDeckOutcomeOptions(options)).resolves.toBeUndefined();
    const games: ForgeObservedPolicyGameOptions[] = [];
    const runGame = vi.fn(async (configured: ForgeObservedPolicyGameOptions) => {
      games.push(configured);
      return {
        evidence: {
          schemaVersion: 1 as const,
          episode: {
            id: configured.evidence.id,
            stage: 'gameplay' as const,
            seed: configured.table.seed,
            runtime: { ...configured.evidence.runtime, kind: 'forge' as const },
            subject: configured.evidence.subject,
            features: forgeGameplayFeatureIdentity(configured.policy),
            behavior: {
              ...forgeGameplayPolicyIdentity(configured.policy),
              config: configured.policy.identity.configuration,
            },
            lineage: configured.evidence.lineage,
            splitGroup: configured.evidence.splitGroup,
          },
          decisions: [],
          outcome: { status: 'completed' as const, value: { winner: configured.candidateSeat } },
        },
        measurement: {
          candidateSeat: configured.candidateSeat,
          completion: 'completed' as const,
          elapsedMs: 3,
          decisions: 0,
          callbackCounts: {},
        },
      };
    });
    const result = await evaluateForgeStageDeckOutcome(options, context(campaign), deck, runGame);
    expect(games.map((game) => game.candidateSeat)).toEqual([0, 1]);
    expect(
      result.outcomeEvidence.games.every(
        (game) => game.opponent.artifactSha256 === botEvidenceSha256(opponent),
      ),
    ).toBe(true);
    expect(result.cost).toEqual({ elapsedMs: 6, decisions: 0, spentUsd: 0 });
  });

  it('rejects opponent drift before opening a game', async () => {
    const campaign = plan();
    await expect(
      validateForgeStageDeckOutcomeOptions({
        plan: campaign,
        gameplayPolicy: policy,
        backends: new Map([['cube', backend]]),
        opponents: new Map([['opponent', deck]]),
        maximumTurns: 200,
        maximumDecisions: 5_000,
      }),
    ).rejects.toThrow(/frozen opponent/);
  });

  it('rejects opponent drift introduced after preflight before opening a game', async () => {
    const campaign = plan();
    const opponents = new Map([['opponent', opponent]]);
    const options = {
      plan: campaign,
      gameplayPolicy: policy,
      backends: new Map([['cube', backend]]),
      opponents,
      maximumTurns: 200,
      maximumDecisions: 5_000,
    };
    await validateForgeStageDeckOutcomeOptions(options);
    opponents.set('opponent', deck);
    const runGame = vi.fn();
    await expect(evaluateForgeStageDeckOutcome(options, context(campaign), deck, runGame)).rejects.toThrow(
      /frozen opponent/,
    );
    expect(runGame).not.toHaveBeenCalled();
  });

  it('validates evidence against a snapshot the runner cannot mutate', async () => {
    const campaign = plan();
    const options = {
      plan: campaign,
      gameplayPolicy: policy,
      backends: new Map([['cube', backend]]),
      opponents: new Map([['opponent', opponent]]),
      maximumTurns: 200,
      maximumDecisions: 5_000,
    };
    const runGame = vi.fn(async (configured: ForgeObservedPolicyGameOptions) => {
      configured.evidence.id = 'runner-substituted-evidence';
      return {
        evidence: {
          schemaVersion: 1 as const,
          episode: {
            id: configured.evidence.id,
            stage: 'gameplay' as const,
            seed: configured.table.seed,
            runtime: { ...configured.evidence.runtime, kind: 'forge' as const },
            subject: configured.evidence.subject,
            features: forgeGameplayFeatureIdentity(configured.policy),
            behavior: {
              ...forgeGameplayPolicyIdentity(configured.policy),
              config: configured.policy.identity.configuration,
            },
            lineage: configured.evidence.lineage,
            splitGroup: configured.evidence.splitGroup,
          },
          decisions: [],
          outcome: { status: 'completed' as const, value: { winner: configured.candidateSeat } },
        },
        measurement: {
          candidateSeat: configured.candidateSeat,
          completion: 'completed' as const,
          elapsedMs: 1,
          decisions: 0,
          callbackCounts: {},
        },
      };
    });
    await expect(evaluateForgeStageDeckOutcome(options, context(campaign), deck, runGame)).rejects.toThrow(
      /evidence identity drift/,
    );
  });
});
