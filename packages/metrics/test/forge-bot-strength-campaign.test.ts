import { describe, expect, it, vi } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef, ObservedBackend } from '@mtg/engine';
import type { ForgeObservedDecisionPolicy, ForgeObservedPolicyGameOptions } from '@mtg/forge-export';
import {
  runForgeBotStrengthCampaign,
  type BotStrengthCampaignPlan,
  type ForgeBotStrengthBackend,
} from '../src';

const SHA = 'a'.repeat(64);
const focalDeck: DeckRef = { name: 'Focal', cards: [{ name: 'Island', count: 40 }] };
const opponentDeck: DeckRef = { name: 'Opponent', cards: [{ name: 'Mountain', count: 40 }] };
const baseline: ForgeObservedDecisionPolicy = {
  identity: {
    policyId: 'baseline',
    policyVersion: 1,
    observationAdapterId: 'observation/v1',
    actionAdapterId: 'actions/v1',
    configuration: { arm: 'baseline' },
    configSha256: botEvidenceSha256({ arm: 'baseline' }),
  },
  choose: () => ({ status: 'unsupported', family: 'test', reason: 'unused' }),
};
const candidate: ForgeObservedDecisionPolicy = {
  identity: {
    policyId: 'candidate',
    policyVersion: 2,
    observationAdapterId: 'observation/v1',
    actionAdapterId: 'actions/v2',
    configuration: { arm: 'candidate' },
    configSha256: botEvidenceSha256({ arm: 'candidate' }),
  },
  choose: () => ({ status: 'unsupported', family: 'test', reason: 'unused' }),
};

function attestedBackend(backend: ObservedBackend): ForgeBotStrengthBackend {
  return {
    backend,
    opponentPolicy: {
      policyId: 'forge-default@forge-test',
      configSha256: SHA,
      modelSha256: null,
      dataSha256: null,
    },
  };
}

function features(policy: ForgeObservedDecisionPolicy) {
  const adapter = {
    observationAdapterId: policy.identity.observationAdapterId,
    actionAdapterId: policy.identity.actionAdapterId,
  };
  return {
    schemaId: `${adapter.observationAdapterId}+${adapter.actionAdapterId}`,
    schemaSha256: botEvidenceSha256(adapter),
  };
}

function plan(): BotStrengthCampaignPlan {
  return {
    version: 'bot-strength-campaign-plan/v1',
    id: 'forge-campaign',
    split: 'holdout',
    stage: 'gameplay',
    engine: 'forge',
    runtime: { version: 'forge-test', buildSha256: SHA },
    features: { baseline: features(baseline), candidate: features(candidate) },
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
        configSha256: baseline.identity.configSha256,
        modelSha256: null,
        dataSha256: null,
      },
      candidate: {
        policyId: 'candidate@2',
        configSha256: candidate.identity.configSha256,
        modelSha256: null,
        dataSha256: null,
      },
    },
    opponents: [
      {
        id: 'forge-default/deck',
        policyId: 'forge-default@forge-test',
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
        opponentId: 'forge-default/deck',
        seed: `seed-${unitId}`,
        focalSeat,
        focalDeckSha256: 'f'.repeat(64),
      })),
    ),
  };
}

describe('Forge bot strength campaign adapter', () => {
  it('builds seat-swapped local-vs-engine tables and retains observed reports', async () => {
    const tables: ForgeObservedPolicyGameOptions[] = [];
    const runGame = vi.fn(async (options: ForgeObservedPolicyGameOptions) => {
      tables.push(options);
      const adapter = features(options.policy);
      const { modelSha256, dataSha256, ...episodeIdentity } = options.evidence;
      return {
        evidence: {
          schemaVersion: 1 as const,
          episode: {
            ...episodeIdentity,
            stage: 'gameplay' as const,
            seed: options.table.seed,
            runtime: { kind: 'forge' as const, ...options.evidence.runtime },
            features: adapter,
            behavior: {
              policyId: `${options.policy.identity.policyId}@${String(options.policy.identity.policyVersion)}`,
              configSha256: options.policy.identity.configSha256,
              config: options.policy.identity.configuration,
              modelSha256,
              dataSha256,
            },
          },
          decisions: [],
          outcome: { status: 'completed' as const, value: { winner: options.candidateSeat } },
        },
        measurement: {
          candidateSeat: options.candidateSeat,
          completion: 'completed' as const,
          elapsedMs: 7,
          decisions: 0,
          callbackCounts: {},
        },
      };
    });
    const backend = {} as ObservedBackend;

    const result = await runForgeBotStrengthCampaign(
      {
        plan: plan(),
        policies: { baseline, candidate },
        decks: new Map([
          ['f'.repeat(64), focalDeck],
          ['d'.repeat(64), opponentDeck],
        ]),
        backends: new Map([['cube', attestedBackend(backend)]]),
        maximumTurns: 100,
        maximumDecisions: 5_000,
      },
      runGame,
    );

    expect(result.trials).toHaveLength(8);
    expect(tables[0]!.table.seats).toEqual([
      { name: 'Baseline', controller: 'local', deck: focalDeck },
      { name: 'Forge Default', controller: 'engine', deck: opponentDeck },
    ]);
    expect(tables[2]!.table.seats).toEqual([
      { name: 'Forge Default', controller: 'engine', deck: opponentDeck },
      { name: 'Baseline', controller: 'local', deck: focalDeck },
    ]);
    expect(new Set(tables.map((entry) => entry.backend))).toEqual(new Set([backend]));
  });

  it('refuses missing decks and non-Forge plans before opening a game', async () => {
    const runGame = vi.fn();
    const input = {
      plan: plan(),
      policies: { baseline, candidate },
      decks: new Map([['f'.repeat(64), focalDeck]]),
      backends: new Map([['cube', attestedBackend({} as ObservedBackend)]]),
      maximumTurns: 100,
      maximumDecisions: 5_000,
    };

    await expect(runForgeBotStrengthCampaign(input, runGame)).rejects.toThrow(/opponent deck/i);
    await expect(
      runForgeBotStrengthCampaign({ ...input, plan: { ...input.plan, engine: 'native' } }, runGame),
    ).rejects.toThrow(/Forge gameplay/i);
    const wrongOpponentPolicy = new Map([
      [
        'cube',
        {
          ...attestedBackend({} as ObservedBackend),
          opponentPolicy: {
            ...attestedBackend({} as ObservedBackend).opponentPolicy,
            policyId: 'forge-default@different-runtime',
          },
        },
      ],
    ]);
    await expect(
      runForgeBotStrengthCampaign(
        {
          ...input,
          decks: new Map([...input.decks, ['d'.repeat(64), opponentDeck]]),
          backends: wrongOpponentPolicy,
        },
        runGame,
      ),
    ).rejects.toThrow(/opponent policy/i);
    expect(runGame).not.toHaveBeenCalled();
  });
});
