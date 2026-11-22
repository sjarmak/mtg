/**
 * Read a learned model's held-out top-1 agreement with the greedy policy its
 * dataset was drawn from.
 *
 * `npx tsx packages/sim/tools/policy-agreement.ts --model out/<run>/model.json --games 30`
 *
 * The default run seed is deliberately not the training tool's, so every game
 * here is one the model never saw. Pass `--seed` to reproduce another reading.
 */
import { readFileSync } from 'node:fs';
import type { AgentView } from '@mtg/kernel';
import { playSimGame } from '../src/driver';
import { greedyBot } from '../src/greedy-bot';
import { DEFAULT_GREEDY_CONFIG } from '../src/config';
import { FIXTURE_DECK_GW, FIXTURE_DECK_RW, FIXTURE_DECK_UB } from '../src/fixtures';
import { createPolicyAgreementRecorder } from '../src/policy-agreement';
import {
  createLearnedModel,
  encodeLearnedCandidate,
  sparsifyLearnedFeatures,
  type LearnedModelArtifact,
} from '../src/learned-evaluator';

const DECKS = [FIXTURE_DECK_RW, FIXTURE_DECK_GW, FIXTURE_DECK_UB] as const;

function parseArgs(args: readonly string[]): { model: string; games: number; runSeed: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      throw new Error('usage: --model FILE [--games N --seed TEXT]');
    }
    values.set(flag, value);
  }
  const model = values.get('--model');
  if (model === undefined || model.length === 0) throw new Error('--model is required');
  const games = Number(values.get('--games') ?? '30');
  if (!Number.isInteger(games) || games < 1) throw new Error('--games requires a positive integer');
  const runSeed = values.get('--seed') ?? 'native-action-q/holdout-agreement/v1';
  if (runSeed.length === 0) throw new Error('--seed must be non-empty');
  return { model, games, runSeed };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const artifact = JSON.parse(readFileSync(options.model, 'utf8')) as LearnedModelArtifact;
  const model = createLearnedModel(artifact);
  const recorder = createPolicyAgreementRecorder();
  const candidate = (view: AgentView) => {
    const first = view.decision.options[0];
    if (first === undefined) throw new Error('candidate reached a decision with no options');
    let best = first;
    let bestScore = model.score(sparsifyLearnedFeatures(encodeLearnedCandidate(view, first)));
    for (const option of view.decision.options.slice(1)) {
      const score = model.score(sparsifyLearnedFeatures(encodeLearnedCandidate(view, option)));
      if (score > bestScore) {
        best = option;
        bestScore = score;
      }
    }
    return best;
  };
  for (let index = 0; index < options.games; index += 1) {
    const first = DECKS[index % DECKS.length];
    const second = DECKS[(index + 1 + Math.floor(index / DECKS.length)) % DECKS.length];
    if (first === undefined || second === undefined) throw new Error('fixture deck rotation is empty');
    playSimGame({
      index,
      seed: `${options.runSeed}:${String(index)}`,
      decks: [first, second],
      startingPlayer: index % 2 === 0 ? 0 : 1,
      agents: [
        recorder.observe(greedyBot('greedy-left', DEFAULT_GREEDY_CONFIG), candidate),
        recorder.observe(greedyBot('greedy-right', DEFAULT_GREEDY_CONFIG), candidate),
      ],
      log: null,
    });
  }
  process.stdout.write(
    `${JSON.stringify({ model: artifact.sha256, games: options.games, ...recorder.report() }, null, 2)}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
