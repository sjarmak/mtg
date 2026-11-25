import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import {
  preparePrintedLimitedFormat,
  printedSourceFingerprint,
  validatePrintedCardRoles,
  type PrintedCardRoles,
} from '@mtg/draft-export';
import type { DeckRef, ObservedBackend } from '@mtg/engine';
import type {
  ForgeObservedDecisionPolicy,
  ForgeObservedGameReport,
  ForgeObservedPolicyGameOptions,
} from '@mtg/forge-export';
import type { StageStrengthCampaignPlan } from '@mtg/metrics';
import { parsePrintedCardCatalog, type PrintedPlaySubject } from '@mtg/printed-card';
import {
  bindPrintedConstructionBackend,
  forgeGameplayFeatureIdentity,
  forgeGameplayPolicyIdentity,
  printedConstructionForgeRuntime,
  printedLimitedSubjectIdentity,
  type PrintedLimitedComparison,
} from '../../tools/printed-limited-construction-campaign';
import {
  PRINTED_LIMITED_DRAFT_FEATURES,
  printedLimitedDraftPolicies,
  runPrintedLimitedDraftCampaign,
} from '../../tools/printed-limited-draft-campaign';
import {
  PrintedDraftRatingsSchema,
  printedDraftRatingsFingerprintInput,
  type PrintedDraftRatings,
} from '../../src/lab/printed-draft-ratings';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const runtime = { kind: 'native' as const, version: 'printed-draft/test', buildSha256: A };
const opponentPolicy = {
  policyId: 'forge-default@test',
  configSha256: B,
  modelSha256: null,
  dataSha256: null,
};
const opponent: DeckRef = { name: 'Frozen opponent', cards: [{ name: 'Mountain', count: 40 }] };
let subject: Awaited<ReturnType<typeof preparePrintedLimitedFormat>>;
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

function admission(): PrintedPlaySubject {
  return {
    formatId: subject.format.id,
    formatSha256: subject.format.contentSha256,
    catalogs: Object.fromEntries(subject.format.sources.map((source) => [source.code, source.catalogSha256])),
    forgeVersion: 'test',
    forgeJarSha256: A,
    scriptArchiveSha256: B,
    resourcesSha256: C,
    bridgeSha256: A,
    adapterSha256: B,
    protocolVersion: 1,
  };
}

beforeAll(async () => {
  const read = (file: string): unknown => JSON.parse(readFileSync(`packages/data/data/isd/${file}`, 'utf8'));
  const catalog = parsePrintedCardCatalog(read('isd-printed-catalog-v1.json'));
  const full = await preparePrintedLimitedFormat(
    read('isd-limited-format-v1.json'),
    [catalog],
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
  const openDraftPacks = full.openDraftPacks.bind(full);
  subject = {
    ...full,
    format: {
      ...full.format,
      draft: { ...full.format.draft, seats: 2, rounds: full.format.draft.rounds.slice(0, 2) },
    },
    openDraftPacks: (seed) =>
      openDraftPacks(seed).filter(
        (pack) => pack.round <= 2 && (pack.openedBy === 'seat-1' || pack.openedBy === 'seat-2'),
      ),
  };
  const catalogs = [
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
  ratings = PrintedDraftRatingsSchema.parse({
    schemaVersion: 1,
    kind: 'printed-draft-ratings',
    source: {
      kind: 'forge-limited-rankings',
      ...source,
      fingerprint: createHash('sha256')
        .update(printedDraftRatingsFingerprintInput(source, catalogs))
        .digest('hex'),
    },
    catalogs,
  });
});

function isdCatalog() {
  return parsePrintedCardCatalog(
    JSON.parse(readFileSync('packages/data/data/isd/isd-printed-catalog-v1.json', 'utf8')),
  );
}

async function runCampaign(comparison?: PrintedLimitedComparison, roles?: PrintedCardRoles) {
  const backend: ObservedBackend = {
    id: 'forge-test',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => {
      throw new Error('injected game runner must not open the backend');
    },
  };
  const policies = printedLimitedDraftPolicies(ratings, comparison, roles);
  const identity = printedLimitedSubjectIdentity(subject);
  const plan: StageStrengthCampaignPlan = {
    version: 'stage-strength-campaign-plan/v1',
    id: 'isd-draft-test',
    split: 'tuning',
    stage: 'draft',
    evidenceStage: 'draft',
    engine: 'forge',
    runtime,
    features: { baseline: PRINTED_LIMITED_DRAFT_FEATURES, candidate: PRINTED_LIMITED_DRAFT_FEATURES },
    subjects: [identity],
    primaryOutcome: 'candidate-downstream-game-score-minus-baseline',
    downstream: {
      runtime: printedConstructionForgeRuntime(admission()),
      features: forgeGameplayFeatureIdentity(gameplayPolicy),
      focalPolicy: forgeGameplayPolicyIdentity(gameplayPolicy),
      opponentPolicy,
      opponents: [{ id: 'frozen', artifactSha256: botEvidenceSha256(opponent) }],
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
    segmentDimensions: [
      { id: 'format', values: ['isd'] },
      { id: 'focal-seat', values: ['seat-1', 'seat-2'] },
    ],
    schedule: [0, 1].map((index) => ({
      unitId: `pod-${String(index)}`,
      subjectId: 'isd',
      seed: `draft-${String(index)}`,
      evidenceSeed: `draft-${String(index)}`,
      outcomeSchedule: ([0, 1] as const).map((focalSeat) => ({
        gameId: `game-${String(index)}-${String(focalSeat)}`,
        seed: `game-${String(index)}`,
        focalSeat,
        opponentId: 'frozen',
      })),
      segments: { format: 'isd', 'focal-seat': `seat-${String(index + 1)}` },
    })),
  };
  const games: ForgeObservedPolicyGameOptions[] = [];
  const run = await runPrintedLimitedDraftCampaign(
    {
      plan,
      draftRuntime: runtime,
      gameplayPolicy,
      subjects: new Map([
        [
          'isd',
          {
            prepared: subject,
            catalogs: [{ code: 'ISD', catalog: isdCatalog() }],
            ratings,
            ...(roles === undefined ? {} : { roles }),
            backend: bindPrintedConstructionBackend(
              { admitted: true, subject: admission(), backend },
              opponentPolicy,
            ),
          },
        ],
      ]),
      opponents: new Map([['frozen', opponent]]),
      maximumTurns: 50,
      maximumDecisions: 500,
      ...(comparison === undefined ? {} : { comparison }),
    },
    async (options) => {
      games.push(options);
      const evidence = {
        schemaVersion: 1 as const,
        episode: {
          id: options.evidence.id,
          stage: 'gameplay' as const,
          seed: options.table.seed,
          runtime: { ...options.evidence.runtime, kind: 'forge' as const },
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
        outcome: { status: 'completed' as const, value: { winner: options.candidateSeat } },
      };
      return {
        evidence,
        measurement: {
          candidateSeat: options.candidateSeat,
          completion: 'completed',
          elapsedMs: 1,
          decisions: 0,
          callbackCounts: {},
        },
      } satisfies ForgeObservedGameReport;
    },
  );
  return { run, games, policies };
}

it('records every full-pod choice and scores a fixed ranked build from the rotated focal seat', async () => {
  const { run, games } = await runCampaign();
  expect(run.trials).toHaveLength(4);
  expect(run.trials.every((trial) => trial.episode.decisions.length === 56)).toBe(true);
  expect(run.trials.every((trial) => trial.outcomeEvidence.status === 'completed')).toBe(true);
  for (const unitId of ['pod-0', 'pod-1']) {
    const [baseline, candidate] = run.trials.filter((trial) => trial.unitId === unitId);
    expect(baseline).toBeDefined();
    expect(candidate).toBeDefined();
    const openedPacks = (trial: (typeof run.trials)[number]) =>
      trial.episode.decisions
        .filter((decision) => {
          const observation = decision.observation.value as { pickNumber?: unknown };
          return observation.pickNumber === 1;
        })
        .map((decision) => {
          const observation = decision.observation.value as {
            round: number;
            openedBy: string;
            pack: readonly { physicalId: string }[];
          };
          return {
            round: observation.round,
            openedBy: observation.openedBy,
            physicalIds: observation.pack.map((card) => card.physicalId),
          };
        });
    expect(openedPacks(baseline!)).toEqual(openedPacks(candidate!));
    const draftedPhysicalIds = (trial: (typeof run.trials)[number]) => {
      const outcome = trial.episode.outcome;
      if (outcome.status !== 'completed') throw new Error('test campaign draft did not complete');
      const value = outcome.value as {
        seats: readonly { picks: readonly { physicalId: string }[] }[];
      };
      return value.seats.flatMap((seat) => seat.picks.map((pick) => pick.physicalId)).sort();
    };
    expect(draftedPhysicalIds(baseline!)).toEqual(draftedPhysicalIds(candidate!));
  }
  expect(games).toHaveLength(8);
  expect(
    games.every(
      (game) =>
        game.table.seats[game.candidateSeat]!.deck.cards.reduce((sum, card) => sum + card.count, 0) === 40,
    ),
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
});

it('pairs the roles candidate against its exact roleless control, with construction held fixed', async () => {
  const roles = validatePrintedCardRoles(
    JSON.parse(readFileSync('packages/data/data/isd/card-roles-v1.json', 'utf8')),
    [{ code: 'ISD', catalog: isdCatalog() }],
  );
  const picks = (trial: { episode: { decisions: readonly { choice: unknown }[] } }) =>
    trial.episode.decisions.map((decision) => decision.choice);
  const arm = (trials: Awaited<ReturnType<typeof runCampaign>>['run']['trials'], name: string) =>
    trials.filter((trial) => trial.arm === name);
  const control = await runCampaign();

  for (const [comparison, controlArm] of [
    ['structural-vs-roles', 'baseline'],
    ['ranked-vs-roles', 'candidate'],
  ] as const) {
    const { run, games, policies } = await runCampaign(comparison, roles);
    const [base, fingerprint] = policies.candidate.policyId.split('+roles/');
    expect(base).toBe(policies.baseline.policyId);
    expect(fingerprint).toMatch(/^\d+$/u);
    expect(policies.baseline.policyId).toBe(control.policies[controlArm].policyId);
    expect(policies.candidate.dataSha256).not.toBe(policies.baseline.dataSha256);
    // The control arm drafts exactly as the roleless bot of the default comparison.
    expect(arm(run.trials, 'baseline').map(picks)).toEqual(arm(control.run.trials, controlArm).map(picks));
    // Labeled roles reach the picks: some choice differs from the roleless control.
    expect(arm(run.trials, 'candidate').map(picks)).not.toEqual(arm(run.trials, 'baseline').map(picks));
    for (const trial of run.trials)
      expect(trial.episode.episode.behavior.policyId).toBe(policies[trial.arm].policyId);
    expect(games).toHaveLength(8);
  }
  await expect(runCampaign('structural-vs-roles')).rejects.toThrow('needs the format roles file');
  // Three full campaigns: the roleless control and both roles comparisons.
}, 20_000);
