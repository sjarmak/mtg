/**
 * Play a candidate against the greedy baseline and print the win rate.
 *
 * `npx tsx packages/sim/tools/head-to-head.ts --model out/<run>/model.json --games 80`
 *
 * The default run seed is neither the training tool's nor the agreement tool's,
 * so these games are held out from both.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { greedyBot } from '../src/greedy-bot';
import { learnedBot, type LearnedModelArtifact } from '../src/learned-evaluator';
import { learnedAdvantageBot, type LearnedAdvantagePolicyArtifact } from '../src/learned-advantage-policy';
import { playHeadToHead } from '../src/head-to-head';
import { rolloutBot } from '../src/rollout-bot';
import { searchBot } from '../src/search-bot';

type Policy = 'learned' | 'rollout' | 'search' | 'compare';

interface ToolOptions {
  readonly policy: Policy;
  readonly model?: string;
  readonly games: number;
  readonly runSeed: string;
}

function parseArgs(args: readonly string[]): ToolOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      throw new Error(
        'usage: [--policy learned|rollout|search|compare] [--model FILE --games N --seed TEXT]',
      );
    }
    values.set(flag, value);
  }
  const rawPolicy = values.get('--policy') ?? (values.has('--model') ? 'learned' : 'compare');
  if (!['learned', 'rollout', 'search', 'compare'].includes(rawPolicy)) {
    throw new Error('--policy must be learned, rollout, search, or compare');
  }
  const policy = rawPolicy as Policy;
  const model = values.get('--model');
  if (policy === 'learned' && (model === undefined || model.length === 0)) {
    throw new Error('--model is required for the learned policy');
  }
  const games = Number(values.get('--games') ?? '80');
  if (!Number.isInteger(games) || games < 1) throw new Error('--games requires a positive integer');
  const runSeed = values.get('--seed') ?? 'native-action-q/holdout-head-to-head/v1';
  if (runSeed.length === 0) throw new Error('--seed must be non-empty');
  return model === undefined ? { policy, games, runSeed } : { policy, model, games, runSeed };
}

function wilson95(successes: number, trials: number): { readonly low: number; readonly high: number } {
  if (trials === 0) return { low: 0, high: 1 };
  const z = 1.96;
  const rate = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (rate + (z * z) / (2 * trials)) / denominator;
  const radius =
    (z / denominator) * Math.sqrt((rate * (1 - rate)) / trials + (z * z) / (4 * trials * trials));
  return { low: center - radius, high: center + radius };
}

type Report = ReturnType<typeof playHeadToHead> & {
  readonly interval95: { readonly low: number; readonly high: number };
  readonly wallMillis: number;
  readonly millisPerGame: number;
};

function measured(options: Parameters<typeof playHeadToHead>[0]): Report {
  const started = performance.now();
  const report = playHeadToHead(options);
  const wallMillis = performance.now() - started;
  return {
    ...report,
    interval95: wilson95(report.candidateWins, report.games),
    wallMillis,
    millisPerGame: wallMillis / report.games,
  };
}

function mirror(options: ToolOptions): Report {
  return measured({
    candidate: (name) => greedyBot(name),
    reference: (name) => greedyBot(name),
    games: options.games,
    runSeed: options.runSeed,
  });
}

function namedPolicy(
  policy: Exclude<Policy, 'learned' | 'compare'>,
  options: ToolOptions,
  rolloutWorld: 'fair' | 'privileged' = 'fair',
): Report {
  return measured({
    candidate: (name, gameSeed) => (policy === 'rollout' ? rolloutBot(name, gameSeed) : searchBot(name)),
    reference: (name) => greedyBot(name),
    games: options.games,
    runSeed: options.runSeed,
    rolloutWorld,
  });
}

function learnedPolicy(options: ToolOptions): {
  readonly report: Report;
  readonly artifact: string;
  readonly model: string;
  readonly policy: 'branch-advantage' | 'argmax';
} {
  if (options.model === undefined) throw new Error('--model is required for the learned policy');
  const artifact = JSON.parse(readFileSync(options.model, 'utf8')) as
    LearnedAdvantagePolicyArtifact | LearnedModelArtifact;
  const advantagePolicy = 'model' in artifact;
  const report = measured({
    candidate: (name) => (advantagePolicy ? learnedAdvantageBot(name, artifact) : learnedBot(name, artifact)),
    reference: (name) => greedyBot(name),
    games: options.games,
    runSeed: options.runSeed,
  });
  return {
    report,
    artifact: artifact.sha256,
    model: advantagePolicy ? artifact.model.sha256 : artifact.sha256,
    policy: advantagePolicy ? 'branch-advantage' : 'argmax',
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const control = mirror(options);
  if (options.policy === 'learned') {
    const learned = learnedPolicy(options);
    console.log(
      JSON.stringify(
        {
          artifact: learned.artifact,
          model: learned.model,
          policy: learned.policy,
          ...learned.report,
          mirrorWinRate: control.candidateWinRate,
          mirror: control,
        },
        null,
        2,
      ),
    );
    return;
  }
  const result =
    options.policy === 'compare'
      ? {
          policy: 'compare',
          seed: options.runSeed,
          rollout: namedPolicy('rollout', options),
          privilegedRollout: namedPolicy('rollout', options, 'privileged'),
          onePly: namedPolicy('search', options),
          greedy: control,
        }
      : {
          policy: options.policy,
          seed: options.runSeed,
          report: namedPolicy(options.policy, options),
          greedy: control,
        };
  console.log(JSON.stringify(result, null, 2));
}

main();
