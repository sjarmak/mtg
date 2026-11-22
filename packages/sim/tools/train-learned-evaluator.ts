import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { botEvidenceArraySha256, botEvidenceSha256, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import {
  learnedExamplesFromEpisode,
  learnedPreferenceExamplesFromEpisode,
  type LearnedDatasetProjection,
  type LearnedExample,
} from '../src/learned-dataset';
import {
  learnedBranchExamplesFromGame,
  type LearnedBranchDatasetProjection,
} from '../src/learned-branch-dataset';
import {
  LEARNED_FEATURE_SCHEMA,
  createLearnedModel,
  learnedBot,
  type LearnedModelArtifact,
} from '../src/learned-evaluator';
import { calibrateAdvantageMargin, learnedAdvantagePolicySha256 } from '../src/learned-advantage-policy';
import {
  fineTuneLearnedModel,
  trainLearnedModel,
  trainLearnedRankingModel,
  type LearnedTrainingConfig,
} from '../src/learned-training';
import { playSimGame } from '../src/driver';
import { FIXTURE_DECK_GW, FIXTURE_DECK_RW, FIXTURE_DECK_UB } from '../src/fixtures';
import { greedyBot } from '../src/greedy-bot';
import { exploringAgent } from '../src/exploring-agent';

/**
 * Which question the dataset asks of a game.
 *
 * `imitation` labels the reference policy's chosen action +1 and every
 * alternative -1. Its ceiling is the reference policy, which is why the model
 * it produced agrees with greedy on 95.9% of held-out decisions and loses to it
 * (mtg-bw8z.1).
 *
 * `outcome` labels the action a game actually took by what that game went on to
 * produce. It can exceed the reference policy, and only if the run explored:
 * without deviation the dataset visits only the reference's own actions, and the
 * fitted score ranks every alternative by extrapolation. That trap is refused
 * below rather than left for a campaign to discover.
 *
 * `counterfactual` preserves that broad imitation coverage, fine-tunes on
 * paired continuations from the same state, then calibrates an abstention
 * margin on held-out departures proposed by the fitted model itself.
 */
type Objective = 'counterfactual' | 'imitation' | 'outcome';

export interface CliOptions {
  readonly games: number;
  readonly out: string;
  readonly runSeed: string;
  readonly objective: Objective;
  readonly epsilon: number;
  readonly sampleEvery: number;
  readonly maximumBranches: number;
  readonly anchor: number;
  readonly training: LearnedTrainingConfig;
}

function positiveInteger(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} requires a positive integer`);
  return value;
}

function finiteNumber(flag: string, raw: string | undefined, minimum: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${flag} requires a number >= ${minimum}`);
  return value;
}

export function parseArgs(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      throw new Error('usage: --games N --out FILE [--seed TEXT --hidden N --epochs N --rate N --l2 N]');
    }
    values.set(flag, value);
  }
  const out = values.get('--out');
  const runSeed = values.get('--seed') ?? 'native-action-q/train/v1';
  if (out === undefined || out.length === 0) throw new Error('--out is required');
  if (runSeed.length === 0) throw new Error('--seed must be non-empty');
  const objectiveValue = values.get('--objective') ?? 'imitation';
  if (objectiveValue !== 'imitation' && objectiveValue !== 'outcome' && objectiveValue !== 'counterfactual') {
    throw new Error('--objective must be imitation, outcome, or counterfactual');
  }
  const epsilon = finiteNumber('--explore', values.get('--explore') ?? '0', 0);
  if (epsilon > 1) throw new Error('--explore requires a number <= 1');
  if (objectiveValue === 'outcome' && epsilon === 0) {
    throw new Error(
      '--objective outcome with --explore 0 visits only the reference policy actions, so the fitted ' +
        'score ranks every alternative by extrapolation; pass --explore to give the dataset coverage',
    );
  }
  if (objectiveValue === 'imitation' && epsilon !== 0) {
    throw new Error('--objective imitation labels the reference action, so exploring it changes the teacher');
  }
  if (objectiveValue === 'counterfactual' && epsilon !== 0) {
    throw new Error(
      '--objective counterfactual uses the greedy reference continuation on both branches; --explore must be 0',
    );
  }
  return {
    games: positiveInteger('--games', values.get('--games')),
    out,
    runSeed,
    objective: objectiveValue,
    epsilon,
    sampleEvery: positiveInteger('--sample-every', values.get('--sample-every') ?? '20'),
    maximumBranches: positiveInteger('--branches-per-game', values.get('--branches-per-game') ?? '4'),
    anchor: finiteNumber('--anchor', values.get('--anchor') ?? '0.1', 0),
    training: {
      hiddenSize: positiveInteger('--hidden', values.get('--hidden') ?? '8'),
      epochs: positiveInteger('--epochs', values.get('--epochs') ?? '4'),
      learningRate: finiteNumber('--rate', values.get('--rate') ?? '0.002', Number.MIN_VALUE),
      l2: finiteNumber('--l2', values.get('--l2') ?? '0.000001', 0),
      seed: 20260913,
    },
  };
}

const DECKS = [FIXTURE_DECK_RW, FIXTURE_DECK_GW, FIXTURE_DECK_UB] as const;
const CALIBRATION_MODULUS = 5;

function evidenceGame(options: CliOptions, index: number): BotEvidenceEpisode {
  const first = DECKS[index % DECKS.length]!;
  const second = DECKS[(index + 1 + Math.floor(index / DECKS.length)) % DECKS.length]!;
  const gameId = `${options.runSeed}:${String(index)}`;
  const exploring = options.epsilon > 0;
  const behaviorConfig = exploring
    ? { policy: 'greedy-explore', version: 1, epsilon: options.epsilon }
    : { policy: 'greedy', version: 1 };
  const seat = (name: string) =>
    exploring
      ? exploringAgent(greedyBot(name), { epsilon: options.epsilon, streamSeed: gameId })
      : greedyBot(name);
  let outcome: ReturnType<typeof playSimGame>;
  try {
    outcome = playSimGame({
      index,
      seed: gameId,
      decks: [first, second],
      startingPlayer: index % 2 === 0 ? 0 : 1,
      agents: [seat('greedy-left'), seat('greedy-right')],
      evidence: {
        id: gameId,
        runtime: { version: 'kernel-workspace', buildSha256: botEvidenceSha256({ runtime: 1 }) },
        subject: {
          formatId: 'sim-fixtures',
          formatSha256: botEvidenceSha256(DECKS),
          cardsSha256: botEvidenceSha256(DECKS.flatMap((deck) => deck.cards)),
        },
        features: {
          schemaId: LEARNED_FEATURE_SCHEMA.id,
          schemaSha256: LEARNED_FEATURE_SCHEMA.sha256,
        },
        behavior: {
          policyId: exploring ? 'greedy-explore-v1' : 'greedy-v1',
          config: behaviorConfig,
          configSha256: botEvidenceSha256(behaviorConfig),
          modelSha256: null,
          dataSha256: null,
        },
        lineage: { gameId },
        splitGroup: { kind: 'game', id: gameId },
      },
    });
  } catch (error) {
    throw new Error(`self-play game ${gameId} failed`, { cause: error });
  }
  if (outcome.evidence === undefined) throw new Error(`game ${gameId} returned no evidence`);
  return outcome.evidence;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.objective === 'counterfactual') {
    await trainCounterfactual(options);
    return;
  }
  let episodeIds: readonly string[] = [];
  let projections: readonly LearnedDatasetProjection[] = [];
  function* projectedEpisodes(): Generator<BotEvidenceEpisode> {
    for (let index = 0; index < options.games; index += 1) {
      const episode = evidenceGame(options, index);
      episodeIds = [...episodeIds, episode.episode.id];
      projections = [
        ...projections,
        options.objective === 'outcome'
          ? learnedExamplesFromEpisode(episode)
          : learnedPreferenceExamplesFromEpisode(episode),
      ];
      yield episode;
    }
  }
  const evidenceSha256 = botEvidenceArraySha256(projectedEpisodes());
  // Uniform example weights. Inverse-frequency balancing across action types is
  // the obvious next lever - a game is about 94% priority decisions - but an
  // uncapped inverse frequency reaches the thousands on a rare type and a
  // squared-error step that large diverges, and any cap is a constant nobody has
  // evidence for yet. Read the fitted model with tools/policy-agreement.ts first:
  // it says per decision kind whether the capacity actually went to priority.
  const examples = projections.flatMap((projection) => projection.examples);
  const model =
    options.objective === 'outcome'
      ? trainLearnedModel(examples, options.training)
      : trainLearnedRankingModel(examples, options.training);
  const receipt = {
    schemaVersion: 1,
    runSeed: options.runSeed,
    games: options.games,
    episodeIds,
    evidenceSha256,
    featureSchema: LEARNED_FEATURE_SCHEMA,
    objective: options.objective,
    explore: options.epsilon,
    training: options.training,
    examples: examples.length,
    skipped: projections.reduce(
      (total, projection) => ({
        failed: total.failed + projection.skipped.failed,
        forced: total.forced + projection.skipped.forced,
        incomplete: total.incomplete + projection.skipped.incomplete,
      }),
      { failed: 0, forced: 0, incomplete: 0 },
    ),
    modelSha256: model.sha256,
  };
  await mkdir(dirname(options.out), { recursive: true });
  await Promise.all([
    writeFile(options.out, `${JSON.stringify(model, null, 2)}\n`, 'utf8'),
    writeFile(`${options.out}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
  ]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function branchGame(
  options: CliOptions,
  index: number,
  challenger?: ReturnType<typeof learnedBot>,
): LearnedBranchDatasetProjection {
  const first = DECKS[index % DECKS.length]!;
  const second = DECKS[(index + 1 + Math.floor(index / DECKS.length)) % DECKS.length]!;
  const gameId = `${options.runSeed}:${String(index)}`;
  return learnedBranchExamplesFromGame({
    episodeId: gameId,
    setup: {
      seed: gameId,
      decks: [first, second],
      startingPlayer: index % 2 === 0 ? 0 : 1,
      maximumTurns: 40,
    },
    reference: [greedyBot('greedy-left'), greedyBot('greedy-right')],
    ...(challenger === undefined ? {} : { challenger: [challenger, challenger] as const }),
    sampleEvery: options.sampleEvery,
    maximumBranches: options.maximumBranches,
  });
}

async function trainCounterfactual(options: CliOptions): Promise<void> {
  const projections = Array.from({ length: options.games }, (_, index) => branchGame(options, index));
  const preferenceExamples = projections.flatMap((projection) => projection.preferenceExamples);
  const fineTuneExamples = projections.flatMap((projection, index) =>
    index % CALIBRATION_MODULUS === CALIBRATION_MODULUS - 1
      ? []
      : projection.advantageExamples.filter((example) => example.return !== 0),
  );
  if (preferenceExamples.length === 0) {
    throw new Error('counterfactual training produced no behavior-policy examples');
  }
  if (fineTuneExamples.length === 0) {
    throw new Error('counterfactual training produced no utility-sensitive branches');
  }
  const initial = trainLearnedRankingModel(preferenceExamples, options.training);
  const model = fineTuneLearnedModel(initial, fineTuneExamples, {
    ...options.training,
    anchor: options.anchor,
  });
  const challenger = learnedBot('counterfactual-calibration', model);
  const calibrationProjections = Array.from({ length: options.games }, (_, index) =>
    index % CALIBRATION_MODULUS === CALIBRATION_MODULUS - 1 ? branchGame(options, index, challenger) : null,
  ).filter((projection): projection is LearnedBranchDatasetProjection => projection !== null);
  const calibrationExamples = calibrationProjections.flatMap((projection) => projection.advantageExamples);
  if (calibrationExamples.length === 0) {
    throw new Error('counterfactual training produced no held-out model departures');
  }
  const calibration = calibrationOf(calibrationExamples, model);
  const policyPayload = {
    schemaVersion: 1 as const,
    model,
    minimumScoreAdvantage: calibration.minimumScoreAdvantage,
  };
  const policy = { ...policyPayload, sha256: learnedAdvantagePolicySha256(policyPayload) };
  const cost = counterfactualCost([...projections, ...calibrationProjections]);
  const episodeIds = Array.from(
    { length: options.games },
    (_, index) => `${options.runSeed}:${String(index)}`,
  );
  const dataSha256 = botEvidenceSha256({
    objective: options.objective,
    episodeIds,
    preferenceExamples,
    fineTuneExamples,
    calibrationExamples,
    cost,
  });
  const receipt = {
    schemaVersion: 1,
    runSeed: options.runSeed,
    games: options.games,
    episodeIds,
    dataSha256,
    featureSchema: LEARNED_FEATURE_SCHEMA,
    objective: options.objective,
    sampleEvery: options.sampleEvery,
    maximumBranches: options.maximumBranches,
    anchor: options.anchor,
    training: options.training,
    preferenceExamples: preferenceExamples.length,
    fineTuneExamples: fineTuneExamples.length,
    calibrationExamples: calibrationExamples.length,
    calibration,
    cost,
    samplingRate: cost.eligibleDecisions === 0 ? 0 : cost.sampledDecisions / cost.eligibleDecisions,
    branchRolloutsPerSampledDecision:
      cost.sampledDecisions === 0 ? 0 : cost.branchRollouts / cost.sampledDecisions,
    branchRolloutsPerRetainedPair:
      fineTuneExamples.length + calibrationExamples.length === 0
        ? 0
        : cost.branchRollouts / ((fineTuneExamples.length + calibrationExamples.length) / 2),
    initialModelSha256: initial.sha256,
    modelSha256: model.sha256,
    policySha256: policy.sha256,
  };
  await mkdir(dirname(options.out), { recursive: true });
  await Promise.all([
    writeFile(options.out, `${JSON.stringify(policy, null, 2)}\n`, 'utf8'),
    writeFile(`${options.out}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
  ]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function calibrationOf(examples: readonly LearnedExample[], model: LearnedModelArtifact) {
  const scorer = createLearnedModel(model);
  return calibrateAdvantageMargin(
    Array.from({ length: examples.length / 2 }, (_, pair) => {
      const chosen = examples[pair * 2];
      const alternative = examples[pair * 2 + 1];
      if (
        chosen === undefined ||
        alternative === undefined ||
        chosen.episodeId !== alternative.episodeId ||
        chosen.sequence !== alternative.sequence
      ) {
        throw new Error('counterfactual calibration examples lost their decision pairs');
      }
      return {
        predictedDifference: scorer.score(alternative.features) - scorer.score(chosen.features),
        utilityDifference: alternative.return - chosen.return,
      };
    }),
  );
}

function counterfactualCost(projections: readonly LearnedBranchDatasetProjection[]) {
  return projections.reduce(
    (total, projection) => ({
      baselineGames: total.baselineGames + projection.cost.baselineGames,
      baselineDecisions: total.baselineDecisions + projection.cost.baselineDecisions,
      eligibleDecisions: total.eligibleDecisions + projection.cost.eligibleDecisions,
      sampledDecisions: total.sampledDecisions + projection.cost.sampledDecisions,
      sensitiveDecisions: total.sensitiveDecisions + projection.cost.sensitiveDecisions,
      branchRollouts: total.branchRollouts + projection.cost.branchRollouts,
    }),
    {
      baselineGames: 0,
      baselineDecisions: 0,
      eligibleDecisions: 0,
      sampledDecisions: 0,
      sensitiveDecisions: 0,
      branchRollouts: 0,
    },
  );
}

function errorChain(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause === undefined ? error.message : `${error.message}: ${errorChain(error.cause)}`;
}

if (process.argv[1]?.endsWith('train-learned-evaluator.ts') === true) {
  main().catch((error: unknown) => {
    process.stderr.write(`${errorChain(error)}\n`);
    process.exitCode = 1;
  });
}
