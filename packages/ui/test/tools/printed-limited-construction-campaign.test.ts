import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import {
  preparePrintedLimitedFormat,
  printedSourceFingerprint,
  validatePrintedCardRoles,
  type PrintedCardRoles,
} from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import type { DeckRef, ObservedBackend, SeatId } from '@mtg/engine';
import type {
  ForgeObservedDecisionPolicy,
  ForgeObservedGameReport,
  ForgeObservedPolicyGameOptions,
} from '@mtg/forge-export';
import type { StageStrengthCampaignPlan } from '@mtg/metrics';
import { parsePrintedCardCatalog, type PrintedCardCatalog, type PrintedPlaySubject } from '@mtg/printed-card';
import {
  PRINTED_LIMITED_CONSTRUCTION_FEATURES,
  bindPrintedConstructionBackend,
  forgeGameplayFeatureIdentity,
  forgeGameplayPolicyIdentity,
  printedLimitedConstructionPolicies,
  printedLimitedSubjectIdentity,
  printedConstructionForgeRuntime,
  runPrintedLimitedConstructionCampaign,
  type PrintedLimitedComparison,
} from '../../tools/printed-limited-construction-campaign';
import type { AdmittedPrintedBackend } from '../../tools/admitted-printed-backend';
import {
  PrintedDraftRatingsSchema,
  printedDraftRatingsFingerprintInput,
  type PrintedDraftRatings,
} from '../../src/lab/printed-draft-ratings';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
let prepared: PreparedPrintedLimitedFormat;
let catalog: PrintedCardCatalog;
let ratings: PrintedDraftRatings;

const gameplayPolicy: ForgeObservedDecisionPolicy = {
  identity: {
    policyId: 'fixed-gameplay',
    policyVersion: 1,
    observationAdapterId: 'forge-observation/v1',
    actionAdapterId: 'forge-actions/v1',
    configuration: { objective: 'strongest-play' },
    configSha256: botEvidenceSha256({ objective: 'strongest-play' }),
  },
  choose: () => ({ status: 'unsupported', family: 'test', reason: 'unused' }),
};
const opponentDeck: DeckRef = { name: 'Frozen opponent', cards: [{ name: 'Mountain', count: 40 }] };
const opponentPolicy = {
  policyId: 'forge-default@test',
  configSha256: B,
  modelSha256: null,
  dataSha256: null,
};
const builderRuntime = { kind: 'analysis' as const, version: 'printed-builder/test', buildSha256: A };
let forgeRuntime: StageStrengthCampaignPlan['downstream']['runtime'];

function admission(): PrintedPlaySubject {
  return {
    formatId: prepared.format.id,
    formatSha256: prepared.format.contentSha256,
    catalogs: Object.fromEntries(
      prepared.format.sources.map((source) => [source.code, source.catalogSha256]),
    ),
    forgeVersion: 'test',
    forgeJarSha256: A,
    scriptArchiveSha256: B,
    resourcesSha256: C,
    bridgeSha256: A,
    adapterSha256: B,
    protocolVersion: 1,
  };
}

function backend(supports: ObservedBackend['supports'] = async () => []): ObservedBackend {
  return {
    id: 'forge-test',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports,
    open: async () => {
      throw new Error('injected game runner must not open the backend');
    },
  };
}

function admitted(backendValue = backend(), subject = admission()): AdmittedPrintedBackend {
  return { admitted: true, backend: backendValue, subject } as AdmittedPrintedBackend;
}

beforeAll(async () => {
  const read = (file: string): unknown => JSON.parse(readFileSync(`packages/data/data/isd/${file}`, 'utf8'));
  catalog = parsePrintedCardCatalog(read('isd-printed-catalog-v1.json'));
  prepared = await preparePrintedLimitedFormat(read('isd-limited-format-v1.json'), [catalog], async (text) =>
    createHash('sha256').update(text).digest('hex'),
  );
  const sources = [
    {
      code: 'ISD',
      catalogSha256: catalog.contentSha256,
      cards: catalog.cards.map((card) => ({
        physicalId: card.physicalId,
        sourceFingerprint: printedSourceFingerprint(card),
        quality: card.correctedName === 'Bloodline Keeper' ? 5 : 2.5,
      })),
    },
  ];
  const source = { version: 'test', bridgeFingerprint: C };
  const fingerprint = createHash('sha256')
    .update(printedDraftRatingsFingerprintInput(source, sources))
    .digest('hex');
  ratings = PrintedDraftRatingsSchema.parse({
    schemaVersion: 1,
    kind: 'printed-draft-ratings',
    source: { kind: 'forge-limited-rankings', ...source, fingerprint },
    catalogs: sources,
  });
  forgeRuntime = printedConstructionForgeRuntime(admission());
});

function plan(comparison?: PrintedLimitedComparison, roles?: PrintedCardRoles): StageStrengthCampaignPlan {
  const policies = printedLimitedConstructionPolicies(ratings, comparison, roles);
  const subject = printedLimitedSubjectIdentity(prepared);
  return {
    version: 'stage-strength-campaign-plan/v1',
    id: 'isd-construction-test',
    split: 'tuning',
    stage: 'limited-construction',
    evidenceStage: 'deckbuilding',
    engine: 'forge',
    runtime: builderRuntime,
    features: {
      baseline: PRINTED_LIMITED_CONSTRUCTION_FEATURES,
      candidate: PRINTED_LIMITED_CONSTRUCTION_FEATURES,
    },
    subjects: [subject],
    primaryOutcome: 'candidate-downstream-game-score-minus-baseline',
    downstream: {
      runtime: forgeRuntime,
      features: forgeGameplayFeatureIdentity(gameplayPolicy),
      focalPolicy: forgeGameplayPolicyIdentity(gameplayPolicy),
      opponentPolicy,
      opponents: [{ id: 'frozen-opponent', artifactSha256: botEvidenceSha256(opponentDeck) }],
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
    policies,
    segmentDimensions: [{ id: 'format', values: ['isd'] }],
    schedule: [0, 1].map((index) => ({
      unitId: `pool-${String(index)}`,
      subjectId: 'isd',
      seed: `sealed-pool-${String(index)}`,
      evidenceSeed: null,
      outcomeSchedule: ([0, 1] as const).map((focalSeat) => ({
        gameId: `pool-${String(index)}-game-${String(focalSeat)}`,
        seed: `game-${String(index)}`,
        focalSeat,
        opponentId: 'frozen-opponent',
      })),
      segments: { format: 'isd' },
    })),
  };
}

function completedGameReport(
  options: ForgeObservedPolicyGameOptions,
  winner: SeatId | null,
): ForgeObservedGameReport {
  return {
    evidence: {
      schemaVersion: 1,
      episode: {
        id: options.evidence.id,
        stage: 'gameplay',
        seed: options.table.seed,
        runtime: { ...options.evidence.runtime, kind: 'forge' },
        subject: options.evidence.subject,
        features: forgeGameplayFeatureIdentity(options.policy),
        behavior: {
          ...forgeGameplayPolicyIdentity(options.policy),
          config: options.policy.identity.configuration,
        },
        lineage: options.evidence.lineage,
        splitGroup: options.evidence.splitGroup,
      },
      decisions: [],
      outcome: { status: 'completed', value: { winner } },
    },
    measurement: {
      candidateSeat: options.candidateSeat,
      completion: 'completed',
      elapsedMs: 5,
      decisions: 0,
      callbackCounts: {},
    },
  };
}

function subject(backendValue = backend()) {
  return {
    prepared,
    catalogs: [{ code: 'ISD', catalog }],
    ratings,
    backend: bindPrintedConstructionBackend(admitted(backendValue), opponentPolicy),
  };
}

describe('printed Limited construction campaign', () => {
  it('builds identical ISD pools under each policy and plays the frozen seat-balanced schedule', async () => {
    const games: ForgeObservedPolicyGameOptions[] = [];
    const runGame = vi.fn(async (options: ForgeObservedPolicyGameOptions) => {
      games.push(options);
      const candidateWon = options.evidence.id.includes('/candidate/');
      return completedGameReport(
        options,
        candidateWon ? options.candidateSeat : options.candidateSeat === 0 ? 1 : 0,
      );
    });
    const backendValue = backend();
    const result = await runPrintedLimitedConstructionCampaign(
      {
        plan: plan(),
        builderRuntime,
        gameplayPolicy,
        subjects: new Map([
          [
            'isd',
            {
              ...subject(backendValue),
            },
          ],
        ]),
        opponents: new Map([['frozen-opponent', opponentDeck]]),
        maximumTurns: 200,
        maximumDecisions: 5_000,
      },
      runGame,
    );

    expect(result.trials).toHaveLength(4);
    for (const unit of ['pool-0', 'pool-1']) {
      const matching = result.trials.filter((trial) => trial.unitId === unit);
      expect(matching[0]!.episode.decisions[0]!.observation.sha256).toBe(
        matching[1]!.episode.decisions[0]!.observation.sha256,
      );
    }
    expect(games.map((game) => game.candidateSeat)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(
      games.every((game) => game.table.content.kind === 'printed' && game.table.content.format === 'isd'),
    ).toBe(true);
    for (let index = 0; index < games.length; index += 4) {
      const baseline = games.slice(index, index + 2);
      const candidate = games.slice(index + 2, index + 4);
      const fixedSchedule = (game: ForgeObservedPolicyGameOptions) => ({
        seed: game.table.seed,
        candidateSeat: game.candidateSeat,
        opponent: botEvidenceSha256(game.table.seats[game.candidateSeat === 0 ? 1 : 0]!.deck),
        policy: game.policy.identity,
        maximumTurns: game.table.maximumTurns,
        maximumDecisions: game.maximumDecisions,
      });
      expect(baseline.map(fixedSchedule)).toEqual(candidate.map(fixedSchedule));
    }
    expect(result.comparison.strength.meanPairedDifference).toBe(1);
  });

  it('builds the roles candidate beside its exact roleless control on the same pools', async () => {
    const roles = validatePrintedCardRoles(
      JSON.parse(readFileSync('packages/data/data/isd/card-roles-v1.json', 'utf8')),
      [{ code: 'ISD', catalog }],
    );
    const run = (comparison?: PrintedLimitedComparison) =>
      runPrintedLimitedConstructionCampaign(
        {
          plan: plan(comparison, comparison === undefined ? undefined : roles),
          builderRuntime,
          gameplayPolicy,
          subjects: new Map([['isd', { ...subject(), roles }]]),
          opponents: new Map([['frozen-opponent', opponentDeck]]),
          maximumTurns: 200,
          maximumDecisions: 5_000,
          ...(comparison === undefined ? {} : { comparison }),
        },
        async (options) => completedGameReport(options, options.candidateSeat),
      );
    const decks = (result: Awaited<ReturnType<typeof run>>, arm: string) =>
      result.trials.filter((trial) => trial.arm === arm).map((trial) => trial.episode.outcome);
    const control = await run();

    for (const [comparison, controlArm] of [
      ['structural-vs-roles', 'baseline'],
      ['ranked-vs-roles', 'candidate'],
    ] as const) {
      const result = await run(comparison);
      const policies = printedLimitedConstructionPolicies(ratings, comparison, roles);
      expect(policies.baseline).toEqual(printedLimitedConstructionPolicies(ratings)[controlArm]);
      expect(policies.candidate.policyId).toBe(
        `${policies.baseline.policyId}+roles/${policies.candidate.policyId.split('+roles/')[1]!}`,
      );
      // The control arm builds exactly the roleless deck; roles change at least one build.
      expect(decks(result, 'baseline')).toEqual(decks(control, controlArm));
      expect(decks(result, 'candidate')).not.toEqual(decks(result, 'baseline'));
      for (const trial of result.trials)
        expect(trial.episode.episode.behavior.policyId).toBe(policies[trial.arm].policyId);
    }
  });

  it('rejects runtime or rating drift before opening a game', async () => {
    const runGame = vi.fn();
    const campaign = plan();
    await expect(
      runPrintedLimitedConstructionCampaign(
        {
          plan: { ...campaign, runtime: { ...builderRuntime, buildSha256: C } },
          builderRuntime,
          gameplayPolicy,
          subjects: new Map(),
          opponents: new Map(),
          maximumTurns: 200,
          maximumDecisions: 5_000,
        },
        runGame,
      ),
    ).rejects.toThrow(/builder runtime/i);

    const driftedRatings = {
      ...ratings,
      source: { ...ratings.source, fingerprint: A },
    };
    await expect(
      runPrintedLimitedConstructionCampaign(
        {
          plan: campaign,
          builderRuntime,
          gameplayPolicy,
          subjects: new Map([
            [
              'isd',
              {
                prepared,
                catalogs: [{ code: 'ISD', catalog }],
                ratings: driftedRatings,
                backend: bindPrintedConstructionBackend(admitted(), opponentPolicy),
              },
            ],
          ]),
          opponents: new Map([['frozen-opponent', opponentDeck]]),
          maximumTurns: 200,
          maximumDecisions: 5_000,
        },
        runGame,
      ),
    ).rejects.toThrow(/fingerprint/i);
    expect(runGame).not.toHaveBeenCalled();
  });

  it('holds validated ratings, gameplay policy identity, and opponent decks fixed during execution', async () => {
    const campaignRatings = structuredClone(ratings);
    const campaignPolicy = { ...gameplayPolicy, identity: structuredClone(gameplayPolicy.identity) };
    const campaignOpponent = structuredClone(opponentDeck);
    const campaignPrepared = { ...prepared };
    const originalOpenSealedPool = campaignPrepared.openSealedPool;
    const originalPolicyHash = campaignPolicy.identity.configSha256;
    const originalRatingsFingerprint = campaignRatings.source.fingerprint;
    const observedOpponentCounts: number[] = [];
    const observedPolicyHashes: string[] = [];
    let gameCalls = 0;
    const runGame = vi.fn(async (options: ForgeObservedPolicyGameOptions) => {
      observedOpponentCounts.push(
        options.table.seats[options.candidateSeat === 0 ? 1 : 0]!.deck.cards[0]!.count,
      );
      observedPolicyHashes.push(options.policy.identity.configSha256);
      gameCalls += 1;
      const report = completedGameReport(options, null);
      if (gameCalls === 1) {
        (campaignOpponent.cards[0] as { count: number }).count = 39;
        (campaignPolicy.identity as { configSha256: string }).configSha256 = A;
        (campaignPolicy as { choose: ForgeObservedDecisionPolicy['choose'] }).choose = () => ({
          status: 'unsupported',
          family: 'mutated',
          reason: 'must not escape into the campaign',
        });
        (options.policy.identity as { configSha256: string }).configSha256 = A;
        const opponentSeat = options.candidateSeat === 0 ? 1 : 0;
        (options.table.seats[opponentSeat]!.deck.cards[0] as { count: number }).count = 1;
      }
      return report;
    });

    const result = await runPrintedLimitedConstructionCampaign(
      {
        plan: plan(),
        builderRuntime,
        gameplayPolicy: campaignPolicy,
        subjects: new Map([
          [
            'isd',
            {
              prepared: campaignPrepared,
              catalogs: [{ code: 'ISD', catalog }],
              ratings: campaignRatings,
              backend: bindPrintedConstructionBackend(admitted(), opponentPolicy),
            },
          ],
        ]),
        opponents: new Map([['frozen-opponent', campaignOpponent]]),
        maximumTurns: 200,
        maximumDecisions: 5_000,
        onTrial: (trial) => {
          if (trial.unitId === 'pool-0' && trial.arm === 'baseline') {
            (campaignRatings.source as { fingerprint: string }).fingerprint = A;
            (campaignRatings.catalogs[0]!.cards[0] as { quality: number }).quality = 0;
            campaignPrepared.openSealedPool = (seed) => originalOpenSealedPool(`${seed}-mutated`);
          }
        },
      },
      runGame,
    );

    expect(observedOpponentCounts).toEqual(Array.from({ length: 8 }, () => 40));
    expect(observedPolicyHashes).toEqual(Array.from({ length: 8 }, () => originalPolicyHash));
    expect(
      result.trials.find((trial) => trial.arm === 'candidate')!.episode.episode.behavior.dataSha256,
    ).toBe(originalRatingsFingerprint);
    for (const unitId of ['pool-0', 'pool-1']) {
      const observations = result.trials
        .filter((trial) => trial.unitId === unitId)
        .map((trial) => trial.episode.decisions[0]!.observation.sha256);
      expect(new Set(observations).size).toBe(1);
    }
  });

  it('rejects incomplete or identity-drifted Forge game evidence', async () => {
    const runGame = vi.fn(async () => ({
      evidence: { outcome: { status: 'completed', value: { winner: null } } },
      measurement: { elapsedMs: 1, decisions: 0 },
    })) as unknown as (options: ForgeObservedPolicyGameOptions) => Promise<ForgeObservedGameReport>;
    await expect(
      runPrintedLimitedConstructionCampaign(
        {
          plan: plan(),
          builderRuntime,
          gameplayPolicy,
          subjects: new Map([['isd', subject()]]),
          opponents: new Map([['frozen-opponent', opponentDeck]]),
          maximumTurns: 200,
          maximumDecisions: 5_000,
        },
        runGame,
      ),
    ).rejects.toThrow();
  });

  it('retains a terminal game artifact when the injected runner throws', async () => {
    const result = await runPrintedLimitedConstructionCampaign(
      {
        plan: plan(),
        builderRuntime,
        gameplayPolicy,
        subjects: new Map([['isd', subject()]]),
        opponents: new Map([['frozen-opponent', opponentDeck]]),
        maximumTurns: 200,
        maximumDecisions: 5_000,
      },
      async () => {
        throw new Error('runner process disappeared');
      },
    );

    expect(result.trials).toHaveLength(4);
    for (const trial of result.trials) {
      expect(trial.outcomeEvidence).toMatchObject({
        status: 'engine-failure',
        games: [
          {
            result: null,
            evidence: { outcome: { status: 'engine-failure', error: 'runner process disappeared' } },
            measurement: { decisions: 0 },
          },
        ],
      });
    }
  });

  it('attests and probes the exact Forge backend before constructing a deck', async () => {
    const runGame = vi.fn();
    const unsupported = backend(async () => ['runtime unavailable']);
    await expect(
      runPrintedLimitedConstructionCampaign(
        {
          plan: plan(),
          builderRuntime,
          gameplayPolicy,
          subjects: new Map([['isd', subject(unsupported)]]),
          opponents: new Map([['frozen-opponent', opponentDeck]]),
          maximumTurns: 200,
          maximumDecisions: 5_000,
        },
        runGame,
      ),
    ).rejects.toThrow(/refused the campaign runtime/i);

    const wrongAdmission = { ...admission(), forgeJarSha256: C };
    await expect(
      runPrintedLimitedConstructionCampaign(
        {
          plan: plan(),
          builderRuntime,
          gameplayPolicy,
          subjects: new Map([
            [
              'isd',
              {
                ...subject(),
                backend: bindPrintedConstructionBackend(admitted(backend(), wrongAdmission), opponentPolicy),
              },
            ],
          ]),
          opponents: new Map([['frozen-opponent', opponentDeck]]),
          maximumTurns: 200,
          maximumDecisions: 5_000,
        },
        runGame,
      ),
    ).rejects.toThrow(/Forge runtime/i);
    expect(runGame).not.toHaveBeenCalled();
  });
});
