import { botEvidenceSha256, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import type { StageStrengthCampaignPlan, StageStrengthTrial } from '@mtg/metrics';
import { describe, expect, it } from 'vitest';
import { compareConstructedPromotion } from '../src/constructed-promotion';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const GAMEPLAY_CONFIG = { policy: 'greedy/v1' };

function plan(): StageStrengthCampaignPlan {
  return {
    version: 'stage-strength-campaign-plan/v1',
    id: 'constructed-holdout-v1',
    split: 'holdout',
    stage: 'constructed-construction',
    evidenceStage: 'deckbuilding',
    engine: 'native',
    runtime: { kind: 'analysis', version: 'decklab-1', buildSha256: A },
    features: {
      baseline: { schemaId: 'decklab-request/v1', schemaSha256: A },
      candidate: { schemaId: 'decklab-request/v1', schemaSha256: A },
    },
    subjects: [{ id: 'modern-green', formatSha256: A, cardsSha256: B }],
    primaryOutcome: 'candidate-downstream-game-score-minus-baseline',
    downstream: {
      runtime: { kind: 'native', version: 'kernel-1', buildSha256: B },
      features: { schemaId: 'gameplay-observation/v1', schemaSha256: C },
      focalPolicy: {
        policyId: 'greedy/v1',
        configSha256: botEvidenceSha256(GAMEPLAY_CONFIG),
        modelSha256: null,
        dataSha256: null,
      },
      opponentPolicy: {
        policyId: 'greedy/v1',
        configSha256: botEvidenceSha256(GAMEPLAY_CONFIG),
        modelSha256: null,
        dataSha256: null,
      },
      opponents: [
        { id: 'aggro', artifactSha256: A },
        { id: 'control', artifactSha256: B },
      ],
    },
    smallestUsefulEffect: 1,
    regressionMargin: 0,
    maximumFailureRate: 0,
    minimumIndependentUnits: 2,
    stoppingRule: { kind: 'fixed-independent-units', count: 2 },
    powerPlan: {
      method: 'paired-normal-approximation',
      alpha: 0.05,
      targetPower: 0.8,
      anticipatedStandardDeviation: 0.25,
      requiredIndependentUnits: 2,
    },
    policies: {
      baseline: {
        policyId: 'generic-model/v1',
        configSha256: botEvidenceSha256({ arm: 'baseline' }),
        modelSha256: B,
        dataSha256: null,
      },
      candidate: {
        policyId: 'decklab-model-repair/v1',
        configSha256: botEvidenceSha256({ arm: 'candidate' }),
        modelSha256: B,
        dataSha256: C,
      },
    },
    segmentDimensions: [{ id: 'opponent-archetype', values: ['aggro', 'control'] }],
    schedule: ['aggro', 'control'].map((opponent, index) => ({
      unitId: `unit-${String(index)}`,
      subjectId: 'modern-green',
      seed: `build-${String(index)}`,
      evidenceSeed: null,
      outcomeSchedule: ([0, 1] as const).map((focalSeat) => ({
        gameId: `unit-${String(index)}-game-${String(focalSeat)}`,
        seed: `game-${String(index)}`,
        focalSeat,
        opponentId: opponent,
      })),
      segments: { 'opponent-archetype': opponent },
    })),
  };
}

function episode(
  campaign: StageStrengthCampaignPlan,
  unitId: string,
  arm: 'baseline' | 'candidate',
  totalCards = 60,
  firstSpellCount = 4,
  overrides: {
    readonly lands?: readonly { readonly id: string; readonly count: number }[];
    readonly basics?: Readonly<Record<string, number>>;
  } = {},
): BotEvidenceEpisode {
  const row = campaign.schedule.find((candidate) => candidate.unitId === unitId)!;
  const subject = campaign.subjects[0]!;
  const policy = campaign.policies[arm];
  return {
    schemaVersion: 1,
    episode: {
      id: `${campaign.id}/${unitId}/${arm}`,
      stage: 'deckbuilding',
      seed: null,
      runtime: campaign.runtime,
      subject: {
        formatId: subject.id,
        formatSha256: subject.formatSha256,
        cardsSha256: subject.cardsSha256,
      },
      features: campaign.features[arm],
      behavior: { ...policy, config: { arm } },
      lineage: { poolId: row.seed },
      splitGroup: { kind: 'pool', id: row.seed },
    },
    decisions: [],
    outcome: {
      status: 'completed',
      value: {
        construction: {
          format: { id: 'decklab-constructed-format/v1', deckSize: 60, copyLimit: 4 },
        },
        deck: {
          totalCards,
          spells: Array.from({ length: 9 }, (_unused, index) => ({
            id: `spell-${String(index)}`,
            count: index === 0 ? firstSpellCount : 4,
          })),
          lands: overrides.lands ?? [],
          basics: overrides.basics ?? {
            W: 0,
            U: 0,
            B: 0,
            R: 0,
            G: 60 - (32 + firstSpellCount),
          },
        },
        shortBy: 0,
      },
    },
  };
}

function trials(campaign: StageStrengthCampaignPlan): StageStrengthTrial[] {
  return campaign.schedule.flatMap((row) =>
    (['baseline', 'candidate'] as const).map((arm) => {
      const retainedEpisode = episode(campaign, row.unitId, arm);
      if (retainedEpisode.outcome.status !== 'completed') {
        throw new Error('expected completed fixture');
      }
      const outcomeEvidence = {
        version: 'stage-strength-game-outcome/v1' as const,
        unitId: row.unitId,
        arm,
        status: 'completed' as const,
        sourceEpisodeSha256: botEvidenceSha256(retainedEpisode),
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
              id: `${campaign.id}/${row.unitId}/${arm}/${game.gameId}`,
              stage: 'gameplay' as const,
              seed: game.seed,
              runtime: campaign.downstream.runtime,
              subject: {
                formatId: campaign.subjects[0]!.id,
                formatSha256: campaign.subjects[0]!.formatSha256,
                cardsSha256: campaign.subjects[0]!.cardsSha256,
              },
              features: campaign.downstream.features,
              behavior: { ...campaign.downstream.focalPolicy, config: GAMEPLAY_CONFIG },
              lineage: { gameId: game.gameId },
              splitGroup: { kind: 'game' as const, id: game.gameId },
            },
            decisions: Array.from({ length: 6 }, (_unused, sequence) => ({
              sequence,
              observation: { sha256: botEvidenceSha256({}), value: {} },
              candidates: { status: 'complete' as const, values: [{ id: 'pass', value: null }] },
              choice: { status: 'chosen' as const, candidateId: 'pass' },
            })),
            outcome: {
              status: 'completed' as const,
              value: { winner: arm === 'candidate' ? game.focalSeat : 1 - game.focalSeat },
            },
          },
          measurement: { elapsedMs: 1, decisions: 6 },
        })),
      };
      return {
        unitId: row.unitId,
        arm,
        episode: retainedEpisode,
        outcomeEvidence,
        outcomeEvidenceSha256: botEvidenceSha256(outcomeEvidence),
        cost: { elapsedMs: 10, decisions: 0, downstreamDecisions: 12, spentUsd: 0 },
      };
    }),
  );
}

describe('constructed promotion evidence', () => {
  it('uses the shared paired gate for legal 60-card Decklab outcomes', () => {
    const campaign = plan();
    const comparison = compareConstructedPromotion(campaign, trials(campaign));
    expect(comparison.scope).toEqual({
      engine: 'native',
      stage: 'constructed-construction',
      split: 'holdout',
    });
    expect(comparison.strength).toMatchObject({
      status: 'measured',
      independentUnits: 2,
      meanPairedDifference: 1,
    });
  });

  it('rejects non-constructed plans and illegal completed decks before scoring games', () => {
    const campaign = plan();
    expect(() =>
      compareConstructedPromotion({ ...campaign, stage: 'limited-construction' }, trials(campaign)),
    ).toThrow(/constructed-construction/);

    const illegal = trials(campaign);
    illegal[0] = { ...illegal[0]!, episode: episode(campaign, 'unit-0', 'baseline', 59) };
    expect(() => compareConstructedPromotion(campaign, illegal)).toThrow(/60-card/i);

    const repeated = trials(campaign);
    repeated[0] = {
      ...repeated[0]!,
      episode: episode(campaign, 'unit-0', 'baseline', 60, 5),
    };
    expect(() => compareConstructedPromotion(campaign, repeated)).toThrow(/copy limit/i);

    const duplicateRows = trials(campaign);
    duplicateRows[0] = {
      ...duplicateRows[0]!,
      episode: episode(campaign, 'unit-0', 'baseline', 60, 4, {
        lands: [{ id: 'spell-0', count: 4 }],
      }),
    };
    expect(() => compareConstructedPromotion(campaign, duplicateRows)).toThrow(/copy limit/i);

    const inventedBasics = trials(campaign);
    inventedBasics[0] = {
      ...inventedBasics[0]!,
      episode: episode(campaign, 'unit-0', 'baseline', 60, 4, { basics: { invented: 24 } }),
    };
    expect(() => compareConstructedPromotion(campaign, inventedBasics)).toThrow(/legal 60-card deck/i);
  });
});
