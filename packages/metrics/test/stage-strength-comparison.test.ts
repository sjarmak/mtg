import { botEvidenceSha256, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import { describe, expect, it } from 'vitest';
import {
  compareStageStrengthCampaign,
  compareStageStrengthTrialSummaries,
  readStageStrengthComparison,
  stageStrengthEpisodeId,
  summarizeStageStrengthTrial,
  type StageStrengthCampaignPlan,
  type StageStrengthTrial,
} from '../src/stage-strength-comparison';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const BASELINE_CONFIG = { policy: 'score-ranked/v1' };
const CANDIDATE_CONFIG = { policy: 'synergy-aware/v1' };

function plan(unitCount = 4, split: 'tuning' | 'holdout' = 'holdout'): StageStrengthCampaignPlan {
  return {
    version: 'stage-strength-campaign-plan/v1',
    id: `limited-builder-${split}`,
    split,
    stage: 'limited-construction',
    evidenceStage: 'deckbuilding',
    engine: 'forge',
    runtime: { kind: 'analysis', version: 'builder-1', buildSha256: A },
    features: {
      baseline: { schemaId: 'limited-observation/v1', schemaSha256: A },
      candidate: { schemaId: 'limited-observation/v1', schemaSha256: A },
    },
    subjects: [
      { id: 'isd', formatSha256: A, cardsSha256: B },
      { id: 'legacy-cube', formatSha256: B, cardsSha256: C },
    ],
    primaryOutcome: 'candidate-downstream-game-score-minus-baseline',
    downstream: {
      runtime: { kind: 'forge', version: 'forge-1', buildSha256: B },
      features: { schemaId: 'gameplay-observation/v1', schemaSha256: C },
      focalPolicy: {
        policyId: 'greedy/v1',
        configSha256: botEvidenceSha256({ policy: 'greedy/v1' }),
        modelSha256: null,
        dataSha256: null,
      },
      opponentPolicy: {
        policyId: 'engine-default/v1',
        configSha256: botEvidenceSha256({ policy: 'engine-default/v1' }),
        modelSha256: null,
        dataSha256: null,
      },
      opponents: [
        { id: 'aggro', artifactSha256: A },
        { id: 'control', artifactSha256: B },
      ],
    },
    smallestUsefulEffect: 0.1,
    regressionMargin: 0,
    maximumFailureRate: 0,
    minimumIndependentUnits: unitCount,
    stoppingRule: { kind: 'fixed-independent-units', count: unitCount },
    powerPlan: {
      method: 'paired-normal-approximation',
      alpha: 0.05,
      targetPower: 0.8,
      anticipatedStandardDeviation: 0.25,
      requiredIndependentUnits: 50,
    },
    policies: {
      baseline: {
        policyId: 'score-ranked/v1',
        configSha256: botEvidenceSha256(BASELINE_CONFIG),
        modelSha256: null,
        dataSha256: null,
      },
      candidate: {
        policyId: 'synergy-aware/v1',
        configSha256: botEvidenceSha256(CANDIDATE_CONFIG),
        modelSha256: null,
        dataSha256: C,
      },
    },
    segmentDimensions: [
      { id: 'format', values: ['isd', 'legacy-cube'] },
      { id: 'opponent', values: ['aggro', 'control'] },
    ],
    schedule: Array.from({ length: unitCount }, (_, index) => ({
      unitId: `unit-${String(index)}`,
      subjectId: index % 2 === 0 ? 'isd' : 'legacy-cube',
      seed: `seed-${String(index)}`,
      evidenceSeed: null,
      outcomeSchedule: ([0, 1] as const).map((focalSeat) => ({
        gameId: `unit-${String(index)}-game-${String(focalSeat)}`,
        seed: `unit-${String(index)}-game-seed`,
        focalSeat,
        opponentId: index % 2 === 0 ? 'aggro' : 'control',
      })),
      segments: {
        format: index % 2 === 0 ? 'isd' : 'legacy-cube',
        opponent: index % 2 === 0 ? 'aggro' : 'control',
      },
    })),
  };
}

function evidence(
  campaign: StageStrengthCampaignPlan,
  unitId: string,
  arm: 'baseline' | 'candidate',
): BotEvidenceEpisode {
  const row = campaign.schedule.find((candidate) => candidate.unitId === unitId)!;
  const subject = campaign.subjects.find((candidate) => candidate.id === row.subjectId)!;
  const policy = campaign.policies[arm];
  const config = arm === 'baseline' ? BASELINE_CONFIG : CANDIDATE_CONFIG;
  const episodeId = stageStrengthEpisodeId(campaign.id, unitId, arm);
  return {
    schemaVersion: 1,
    episode: {
      id: episodeId,
      stage: campaign.evidenceStage,
      seed: row.evidenceSeed,
      runtime: campaign.runtime,
      subject: {
        formatId: subject.id,
        formatSha256: subject.formatSha256,
        cardsSha256: subject.cardsSha256,
      },
      features: campaign.features[arm],
      behavior: { ...policy, configSha256: botEvidenceSha256(config), config },
      lineage: { setId: subject.id, poolId: row.seed },
      splitGroup: { kind: 'pool', id: row.seed },
    },
    decisions: [],
    outcome: { status: 'completed', value: { selected: [`${arm}-card`] } },
  };
}

function completedOutcome(
  campaign: StageStrengthCampaignPlan,
  unitId: string,
  arm: 'baseline' | 'candidate',
  result: 'win' | 'loss' | 'draw',
) {
  const row = campaign.schedule.find((candidate) => candidate.unitId === unitId)!;
  const sourceEpisode = evidence(campaign, unitId, arm);
  if (sourceEpisode.outcome.status !== 'completed') throw new Error('expected completed fixture');
  return {
    version: 'stage-strength-game-outcome/v1' as const,
    unitId,
    arm,
    status: 'completed' as const,
    sourceEpisodeSha256: botEvidenceSha256(sourceEpisode),
    games: row.outcomeSchedule.map((game) => {
      const subject = campaign.subjects.find((candidate) => candidate.id === row.subjectId)!;
      const opponent = campaign.downstream.opponents.find((candidate) => candidate.id === game.opponentId)!;
      const gameplay: BotEvidenceEpisode = {
        schemaVersion: 1,
        episode: {
          id: `${campaign.id}/${unitId}/${arm}/${game.gameId}`,
          stage: 'gameplay',
          seed: game.seed,
          runtime: campaign.downstream.runtime,
          subject: {
            formatId: subject.id,
            formatSha256: subject.formatSha256,
            cardsSha256: subject.cardsSha256,
          },
          features: campaign.downstream.features,
          behavior: { ...campaign.downstream.focalPolicy, config: { policy: 'greedy/v1' } },
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
          value: {
            winner: result === 'draw' ? null : result === 'win' ? game.focalSeat : 1 - game.focalSeat,
          },
        },
      };
      return {
        ...game,
        opponent: { artifactSha256: opponent.artifactSha256, policy: campaign.downstream.opponentPolicy },
        result,
        evidence: gameplay,
        measurement: { elapsedMs: 1, decisions: 2 },
      };
    }),
  };
}

function trials(campaign: StageStrengthCampaignPlan): StageStrengthTrial[] {
  return campaign.schedule.flatMap((row) =>
    (['baseline', 'candidate'] as const).map((arm) => {
      const outcomeEvidence = completedOutcome(
        campaign,
        row.unitId,
        arm,
        arm === 'baseline' ? 'loss' : 'win',
      );
      return {
        unitId: row.unitId,
        arm,
        episode: evidence(campaign, row.unitId, arm),
        outcomeEvidenceSha256: botEvidenceSha256(outcomeEvidence),
        outcomeEvidence,
        cost: {
          elapsedMs: arm === 'baseline' ? 10 : 12,
          decisions: 0,
          downstreamDecisions: outcomeEvidence.games.reduce(
            (sum, game) => sum + game.measurement.decisions,
            0,
          ),
          spentUsd: 0.5,
        },
      };
    }),
  );
}

describe('stage-neutral bot strength comparison', () => {
  it('reconstructs the exact comparison from compact validated summaries', () => {
    const campaign = plan(50);
    const values = trials(campaign);
    const keyed = values
      .map((trial) => ({ key: `${trial.unitId}\u0000${trial.arm}`, trial }))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

    expect(
      compareStageStrengthTrialSummaries(
        campaign,
        values.map((trial) => summarizeStageStrengthTrial(campaign, trial)),
        botEvidenceSha256(keyed),
      ),
    ).toEqual(compareStageStrengthCampaign(campaign, values));
  });

  it('reports paired strength, segments, failures, and cost from canonical evidence', () => {
    const campaign = plan(50);
    const report = compareStageStrengthCampaign(campaign, trials(campaign));

    expect(report.scope).toEqual({
      engine: 'forge',
      stage: 'limited-construction',
      split: 'holdout',
    });
    expect(report.strength).toMatchObject({
      status: 'measured',
      independentUnits: 50,
      excludedUnits: 0,
      meanPairedDifference: 1,
    });
    expect(report.strength.bySegment.map(({ dimension, id }) => ({ dimension, id }))).toEqual([
      { dimension: 'format', id: 'isd' },
      { dimension: 'format', id: 'legacy-cube' },
      { dimension: 'opponent', id: 'aggro' },
      { dimension: 'opponent', id: 'control' },
    ]);
    expect(
      report.strength.byOpponent.map(({ dimension, id, independentUnits }) => ({
        dimension,
        id,
        independentUnits,
      })),
    ).toEqual([
      { dimension: 'downstream-opponent', id: 'aggro', independentUnits: 25 },
      { dimension: 'downstream-opponent', id: 'control', independentUnits: 25 },
    ]);
    expect(report.completion.candidate).toEqual({
      attempted: 50,
      completed: 50,
      failures: 0,
      rate: 1,
      byStatus: {},
    });
    expect(report.cost).toEqual({
      baseline: {
        trials: 50,
        elapsedMs: 500,
        decisions: 0,
        downstreamDecisions: 200,
        spentUsd: 25,
      },
      candidate: {
        trials: 50,
        elapsedMs: 600,
        decisions: 0,
        downstreamDecisions: 200,
        spentUsd: 25,
      },
    });
    expect(compareStageStrengthCampaign(campaign, [...trials(campaign)].reverse())).toEqual(report);
    expect(readStageStrengthComparison(campaign, trials(campaign), report)).toEqual(report);
  });

  it('counts each paired unit once per opponent when every unit plays both opponents', () => {
    const base = plan(50);
    const campaign = {
      ...base,
      schedule: base.schedule.map((row) => ({
        ...row,
        outcomeSchedule: base.downstream.opponents.flatMap((opponent) =>
          ([0, 1] as const).map((focalSeat) => ({
            gameId: `${row.unitId}-${opponent.id}-${String(focalSeat)}`,
            seed: `${row.seed}-${opponent.id}`,
            focalSeat,
            opponentId: opponent.id,
          })),
        ),
      })),
    };
    const report = compareStageStrengthCampaign(campaign, trials(campaign));
    expect(report.strength.byOpponent.map(({ id, independentUnits }) => ({ id, independentUnits }))).toEqual([
      { id: 'aggro', independentUnits: 50 },
      { id: 'control', independentUnits: 50 },
    ]);
  });

  it('promotes only a fixed holdout whose overall and segment intervals clear the gates', () => {
    const campaign = plan(200);
    const report = compareStageStrengthCampaign(campaign, trials(campaign));
    expect(report.strength.interval95!.low).toBeGreaterThan(campaign.smallestUsefulEffect);
    expect(report.strength.bySegment.every((segment) => segment.interval95!.low >= 0)).toBe(true);
    expect(report.promotion).toEqual({ status: 'promote-candidate', reasons: [] });
  });

  it('retains a candidate that regresses against a frozen downstream opponent', () => {
    const base = plan(200);
    const campaign: StageStrengthCampaignPlan = {
      ...base,
      schedule: base.schedule.map((row) => ({
        ...row,
        outcomeSchedule: [
          ...[0, 1].flatMap((repetition) =>
            ([0, 1] as const).map((focalSeat) => ({
              gameId: `${row.unitId}-aggro-${String(repetition)}-${String(focalSeat)}`,
              seed: `${row.seed}-aggro-${String(repetition)}`,
              focalSeat,
              opponentId: 'aggro',
            })),
          ),
          ...([0, 1] as const).map((focalSeat) => ({
            gameId: `${row.unitId}-control-${String(focalSeat)}`,
            seed: `${row.seed}-control`,
            focalSeat,
            opponentId: 'control',
          })),
        ],
      })),
    };
    const input = campaign.schedule.flatMap((row) =>
      (['baseline', 'candidate'] as const).map((arm) => {
        const original = completedOutcome(campaign, row.unitId, arm, 'draw');
        const games = original.games.map((game) => {
          const result =
            game.opponentId === 'aggro'
              ? arm === 'baseline'
                ? ('loss' as const)
                : ('win' as const)
              : arm === 'baseline'
                ? ('win' as const)
                : ('loss' as const);
          return {
            ...game,
            result,
            evidence: {
              ...game.evidence,
              outcome: {
                status: 'completed' as const,
                value: {
                  winner: result === 'win' ? game.focalSeat : 1 - game.focalSeat,
                },
              },
            },
          };
        });
        const outcomeEvidence = { ...original, games };
        return {
          unitId: row.unitId,
          arm,
          episode: evidence(campaign, row.unitId, arm),
          outcomeEvidenceSha256: botEvidenceSha256(outcomeEvidence),
          outcomeEvidence,
          cost: {
            elapsedMs: 1,
            decisions: 0,
            downstreamDecisions: games.reduce((sum, game) => sum + game.measurement.decisions, 0),
            spentUsd: 0,
          },
        };
      }),
    );
    const report = compareStageStrengthCampaign(campaign, input);
    expect(report.strength.interval95!.low).toBeGreaterThan(campaign.smallestUsefulEffect);
    expect(report.strength.byOpponent.find(({ id }) => id === 'control')).toMatchObject({
      meanPairedDifference: -1,
    });
    expect(report.promotion).toEqual({
      status: 'retain-baseline',
      reasons: ['downstream-opponent-regression-not-excluded'],
    });
  });

  it('retains tuning, failed, and underpowered evidence', () => {
    const campaign = plan(50, 'tuning');
    const input = trials(campaign)
      .map((trial) =>
        trial.arm === 'candidate' && trial.unitId === 'unit-0'
          ? (() => {
              const scheduled = completedOutcome(campaign, trial.unitId, trial.arm, 'win').games[0]!;
              return {
                ...trial,
                outcomeEvidence: {
                  version: 'stage-strength-game-outcome/v1' as const,
                  unitId: trial.unitId,
                  arm: trial.arm,
                  status: 'engine-failure' as const,
                  sourceEpisodeSha256: botEvidenceSha256(trial.episode),
                  error: 'downstream game failed',
                  games: [
                    {
                      ...scheduled,
                      result: null,
                      evidence: {
                        ...scheduled.evidence,
                        outcome: { status: 'engine-failure' as const, error: 'downstream game failed' },
                      },
                    },
                  ],
                },
                cost: { ...trial.cost, downstreamDecisions: scheduled.measurement.decisions },
              };
            })()
          : trial.unitId.endsWith('1')
            ? {
                ...trial,
                outcomeEvidence: completedOutcome(
                  campaign,
                  trial.unitId,
                  trial.arm,
                  trial.arm === 'baseline' ? 'win' : 'loss',
                ),
              }
            : trial,
      )
      .map((trial) => ({
        ...trial,
        outcomeEvidenceSha256: botEvidenceSha256(trial.outcomeEvidence),
      }));
    const report = compareStageStrengthCampaign(campaign, input);
    expect(report.strength).toMatchObject({ status: 'under-sampled', excludedUnits: 1 });
    expect(report.completion.candidate.byStatus).toEqual({ 'engine-failure': 1 });
    expect(report.promotion.reasons).toEqual(
      expect.arrayContaining([
        'not-held-out',
        'insufficient-independent-units',
        'realized-variance-exceeds-power-plan',
        'candidate-failure-rate-exceeded',
      ]),
    );
  });

  it('rejects schedule, score, segment, identity, and outcome-evidence drift', () => {
    const campaign = plan(50);
    expect(() =>
      compareStageStrengthCampaign(
        { ...campaign, schedule: [...campaign.schedule, campaign.schedule[0]!] },
        trials(campaign),
      ),
    ).toThrow(/duplicate.*unit/i);

    const unevenSeatSchedule = {
      ...campaign,
      schedule: campaign.schedule.map((row, index) =>
        index === 0
          ? {
              ...row,
              outcomeSchedule: [
                ...row.outcomeSchedule,
                {
                  gameId: 'unit-0-extra-game',
                  seed: 'unit-0-extra-seed',
                  focalSeat: 0 as const,
                  opponentId: 'aggro',
                },
              ],
            }
          : row,
      ),
    };
    expect(() => compareStageStrengthCampaign(unevenSeatSchedule, trials(campaign))).toThrow(
      /seat-balanced/i,
    );

    const unknownOpponent = {
      ...campaign,
      schedule: campaign.schedule.map((row, index) =>
        index === 0
          ? {
              ...row,
              outcomeSchedule: row.outcomeSchedule.map((game) => ({
                ...game,
                opponentId: 'unregistered-opponent',
              })),
            }
          : row,
      ),
    };
    expect(() => compareStageStrengthCampaign(unknownOpponent, trials(campaign))).toThrow(
      /unknown downstream opponent/i,
    );

    const changedOutcome = trials(campaign);
    const originalOutcome = changedOutcome[0]!.outcomeEvidence;
    if (originalOutcome.status !== 'completed') throw new Error('expected completed fixture outcome');
    changedOutcome[0] = {
      ...changedOutcome[0]!,
      outcomeEvidence: {
        ...originalOutcome,
        games: originalOutcome.games.map((game) => ({ ...game, result: 'win' as const })),
      },
    };
    expect(() => compareStageStrengthCampaign(campaign, changedOutcome)).toThrow(/outcome evidence SHA-256/i);

    const changedSchedule = trials(campaign);
    const scheduledOutcome = changedSchedule[0]!.outcomeEvidence;
    if (scheduledOutcome.status !== 'completed') throw new Error('expected completed fixture outcome');
    const driftedEvidence = {
      ...scheduledOutcome,
      games: scheduledOutcome.games.map((game, index) =>
        index === 0 ? { ...game, seed: 'candidate-only-game-seed' } : game,
      ),
    };
    changedSchedule[0] = {
      ...changedSchedule[0]!,
      outcomeEvidence: driftedEvidence,
      outcomeEvidenceSha256: botEvidenceSha256(driftedEvidence),
    };
    expect(() => compareStageStrengthCampaign(campaign, changedSchedule)).toThrow(/ordered prefix/i);

    const changedOpponent = trials(campaign);
    const scheduledOpponent = changedOpponent[0]!.outcomeEvidence;
    if (scheduledOpponent.status !== 'completed') throw new Error('expected completed fixture outcome');
    const opponentDrift = {
      ...scheduledOpponent,
      games: scheduledOpponent.games.map((game, index) =>
        index === 0 ? { ...game, opponent: { ...game.opponent, artifactSha256: C } } : game,
      ),
    };
    changedOpponent[0] = {
      ...changedOpponent[0]!,
      outcomeEvidence: opponentDrift,
      outcomeEvidenceSha256: botEvidenceSha256(opponentDrift),
    };
    expect(() => compareStageStrengthCampaign(campaign, changedOpponent)).toThrow(/opponent evidence drift/i);

    const changedArtifact = trials(campaign);
    const boundOutcome = changedArtifact[0]!.outcomeEvidence;
    if (boundOutcome.status !== 'completed') throw new Error('expected completed fixture outcome');
    const unboundEvidence = { ...boundOutcome, sourceEpisodeSha256: C };
    changedArtifact[0] = {
      ...changedArtifact[0]!,
      outcomeEvidence: unboundEvidence,
      outcomeEvidenceSha256: botEvidenceSha256(unboundEvidence),
    };
    expect(() => compareStageStrengthCampaign(campaign, changedArtifact)).toThrow(/source episode/i);

    const changedEpisode = trials(campaign);
    const originalEpisode = changedEpisode[0]!.episode;
    changedEpisode[0] = {
      ...changedEpisode[0]!,
      episode: {
        ...originalEpisode,
        episode: {
          ...originalEpisode.episode,
          lineage: { ...originalEpisode.episode.lineage, setId: 'substituted-lineage' },
        },
      },
    };
    expect(() => compareStageStrengthCampaign(campaign, changedEpisode)).toThrow(/source episode/i);

    const changedSeed = trials(campaign);
    const seededEpisode = changedSeed[0]!.episode;
    changedSeed[0] = {
      ...changedSeed[0]!,
      episode: {
        ...seededEpisode,
        episode: {
          ...seededEpisode.episode,
          lineage: { ...seededEpisode.episode.lineage, poolId: 'another-build-seed' },
          splitGroup: { kind: 'pool', id: 'another-build-seed' },
        },
      },
    };
    const seedOutcome = changedSeed[0]!.outcomeEvidence;
    changedSeed[0] = {
      ...changedSeed[0]!,
      outcomeEvidence: {
        ...seedOutcome,
        sourceEpisodeSha256: botEvidenceSha256(changedSeed[0]!.episode),
      },
    };
    changedSeed[0] = {
      ...changedSeed[0]!,
      outcomeEvidenceSha256: botEvidenceSha256(changedSeed[0]!.outcomeEvidence),
    };
    expect(() => compareStageStrengthCampaign(campaign, changedSeed)).toThrow(/scheduled seed/i);

    const reorderedFailure = trials(campaign);
    const failureEpisode = reorderedFailure[0]!.episode;
    const completedGames = reorderedFailure[0]!.outcomeEvidence.games;
    const partialFailure = {
      version: 'stage-strength-game-outcome/v1' as const,
      unitId: reorderedFailure[0]!.unitId,
      arm: reorderedFailure[0]!.arm,
      status: 'engine-failure' as const,
      sourceEpisodeSha256: botEvidenceSha256(failureEpisode),
      error: 'second game failed',
      games: [completedGames[1]!],
    };
    reorderedFailure[0] = {
      ...reorderedFailure[0]!,
      outcomeEvidence: partialFailure,
      outcomeEvidenceSha256: botEvidenceSha256(partialFailure),
    };
    expect(() => compareStageStrengthCampaign(campaign, reorderedFailure)).toThrow(/ordered prefix/i);

    const detachedFailure = trials(campaign);
    const detached = {
      version: 'stage-strength-game-outcome/v1' as const,
      unitId: detachedFailure[0]!.unitId,
      arm: detachedFailure[0]!.arm,
      status: 'engine-failure' as const,
      sourceEpisodeSha256: C,
      error: 'downstream game failed',
      games: [],
    };
    detachedFailure[0] = {
      ...detachedFailure[0]!,
      outcomeEvidence: detached,
      outcomeEvidenceSha256: botEvidenceSha256(detached),
    };
    expect(() => compareStageStrengthCampaign(campaign, detachedFailure)).toThrow(/source episode/i);

    const badIdentity = trials(campaign);
    badIdentity[0] = {
      ...badIdentity[0]!,
      episode: {
        ...badIdentity[0]!.episode,
        episode: { ...badIdentity[0]!.episode.episode, id: 'wrong' },
      },
    };
    expect(() => compareStageStrengthCampaign(campaign, badIdentity)).toThrow(/episode identity/i);

    const badHash = trials(campaign);
    badHash[0] = { ...badHash[0]!, outcomeEvidenceSha256: 'not-a-hash' };
    expect(() => compareStageStrengthCampaign(campaign, badHash)).toThrow();

    const badSegment = {
      ...campaign,
      schedule: campaign.schedule.map((row, index) =>
        index === 0 ? { ...row, segments: { ...row.segments, opponent: 'invented' } } : row,
      ),
    };
    expect(() => compareStageStrengthCampaign(badSegment, trials(campaign))).toThrow(/segment/i);
  });

  it('requires score-bearing game evidence and retains a terminal downstream failure', () => {
    const campaign = plan(50);
    const missingEvidence = trials(campaign);
    const original = missingEvidence[0]!.outcomeEvidence;
    if (original.status !== 'completed') throw new Error('expected completed fixture outcome');
    const withoutEvidence = {
      ...original,
      games: original.games.map(({ evidence: _evidence, ...game }) => game),
    };
    missingEvidence[0] = {
      ...missingEvidence[0]!,
      outcomeEvidence: withoutEvidence as never,
      outcomeEvidenceSha256: botEvidenceSha256(withoutEvidence),
    };
    expect(() => compareStageStrengthCampaign(campaign, missingEvidence)).toThrow();

    const missingTerminal = trials(campaign);
    const failure = {
      version: 'stage-strength-game-outcome/v1' as const,
      unitId: missingTerminal[0]!.unitId,
      arm: missingTerminal[0]!.arm,
      status: 'engine-failure' as const,
      sourceEpisodeSha256: botEvidenceSha256(missingTerminal[0]!.episode),
      error: 'game process failed',
      games: [],
    };
    missingTerminal[0] = {
      ...missingTerminal[0]!,
      outcomeEvidence: failure,
      outcomeEvidenceSha256: botEvidenceSha256(failure),
      cost: { ...missingTerminal[0]!.cost, downstreamDecisions: 0 },
    };
    expect(() => compareStageStrengthCampaign(campaign, missingTerminal)).toThrow(/terminal downstream/i);

    const mismatchedWinner = trials(campaign);
    const scored = mismatchedWinner[0]!.outcomeEvidence;
    if (scored.status !== 'completed') throw new Error('expected completed fixture outcome');
    const changed = {
      ...scored,
      games: scored.games.map((game, index) =>
        index === 0
          ? { ...game, result: game.result === 'win' ? ('loss' as const) : ('win' as const) }
          : game,
      ),
    };
    mismatchedWinner[0] = {
      ...mismatchedWinner[0]!,
      outcomeEvidence: changed,
      outcomeEvidenceSha256: botEvidenceSha256(changed),
    };
    expect(() => compareStageStrengthCampaign(campaign, mismatchedWinner)).toThrow(/result evidence drift/i);

    const mismatchedGameIdentity = trials(campaign);
    const identityOutcome = mismatchedGameIdentity[0]!.outcomeEvidence;
    if (identityOutcome.status !== 'completed') throw new Error('expected completed fixture outcome');
    const changedIdentity = {
      ...identityOutcome,
      games: identityOutcome.games.map((game, index) =>
        index === 0
          ? {
              ...game,
              evidence: {
                ...game.evidence,
                episode: { ...game.evidence.episode, id: 'another-unit/same-local-game' },
              },
            }
          : game,
      ),
    };
    mismatchedGameIdentity[0] = {
      ...mismatchedGameIdentity[0]!,
      outcomeEvidence: changedIdentity,
      outcomeEvidenceSha256: botEvidenceSha256(changedIdentity),
    };
    expect(() => compareStageStrengthCampaign(campaign, mismatchedGameIdentity)).toThrow(
      /downstream game.*evidence drift/i,
    );

    const mismatchedFailure = trials(campaign);
    const terminal = mismatchedFailure[0]!.outcomeEvidence.games[0]!;
    const terminalFailure = {
      ...terminal,
      result: null,
      evidence: {
        ...terminal.evidence,
        outcome: { status: 'illegal-action' as const, error: 'illegal choice' },
      },
    };
    const aggregateFailure = {
      version: 'stage-strength-game-outcome/v1' as const,
      unitId: mismatchedFailure[0]!.unitId,
      arm: mismatchedFailure[0]!.arm,
      status: 'timeout' as const,
      sourceEpisodeSha256: botEvidenceSha256(mismatchedFailure[0]!.episode),
      error: 'clock expired',
      games: [terminalFailure],
    };
    mismatchedFailure[0] = {
      ...mismatchedFailure[0]!,
      outcomeEvidence: aggregateFailure,
      outcomeEvidenceSha256: botEvidenceSha256(aggregateFailure),
      cost: {
        ...mismatchedFailure[0]!.cost,
        downstreamDecisions: terminalFailure.evidence.decisions.length,
      },
    };
    expect(() => compareStageStrengthCampaign(campaign, mismatchedFailure)).toThrow(
      /aggregate failure differs/i,
    );
  });
});
