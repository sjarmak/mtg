/**
 * `tsx packages/setgen/tools/run-critic.ts` — run the faithfulness critic over
 * a seeded sample of the Tideglass Reach pool and write its verdicts.
 *
 * Shaped like `../src/cli.ts`: without `--record` it replays whatever is
 * already in the critic's own fixture directory and refuses any request that
 * is not there, which is how a curious reader or CI re-runs this for free.
 * With `--record` it calls the live provider (the authenticated `claude`
 * binary by default) and records every request/response pair, resumably —
 * an interrupted run costs nothing to restart.
 *
 * **This spends the operator's model quota when `--record` is passed and the
 * fixture directory does not already cover the sample.** Nobody should pass
 * `--record` without meaning to. `--max-usd` bounds it the same way it bounds
 * `cli.ts`.
 *
 * This tool never reads an adjudication file, and cannot: it has no code path
 * that imports `./records.ts`'s adjudication reader. See `../src/critic/records.ts`.
 *
 *   tsx packages/setgen/tools/run-critic.ts --size 60 --record --max-usd 5
 *   tsx packages/setgen/tools/run-critic.ts --size 60
 */
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBudgetGuard, createFixtureProvider } from '@mtg/llm';
import type { LlmProvider } from '@mtg/llm';
import { judgeFaithfulness } from '../src/critic/critic';
import { loadTideglassEntryPool } from '../src/critic/pool';
import { saveVerdictsFile } from '../src/critic/records';
import type { VerdictRecord } from '../src/critic/records';
import { createResumableRecorder } from '../src/record';
import { selectSample } from '../src/critic/sample';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SEED = 'critic-sample-1';
export const DEFAULT_SIZE = 60;
export const DEFAULT_CRITIC_FIXTURE_DIR = join(PACKAGE_ROOT, 'fixtures', 'critic-llm');

interface RunCriticOptions {
  readonly seed: string;
  readonly size: number;
  readonly outPath: string;
  readonly fixtureDir: string;
  readonly record: boolean;
  readonly maxUsd?: number;
}

function absolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

export function parseArgs(argv: readonly string[]): RunCriticOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(key);
      continue;
    }
    values.set(key, next);
    index += 1;
  }

  const seed = values.get('seed') ?? DEFAULT_SEED;
  const sizeRaw = values.get('size') ?? String(DEFAULT_SIZE);
  const size = Number(sizeRaw);
  if (!Number.isInteger(size) || size <= 0)
    throw new Error(`--size must be a positive integer, got ${sizeRaw}`);
  const maxUsdRaw = values.get('max-usd');
  const maxUsd = maxUsdRaw === undefined ? undefined : Number(maxUsdRaw);
  if (maxUsd !== undefined && (!Number.isFinite(maxUsd) || maxUsd <= 0)) {
    throw new Error(`--max-usd must be a positive number, got ${maxUsdRaw}`);
  }
  const out = values.get('out') ?? join(PACKAGE_ROOT, 'out', 'critic', `verdicts-${seed}.json`);
  return {
    seed,
    size,
    outPath: absolute(out),
    fixtureDir: absolute(values.get('fixtures') ?? DEFAULT_CRITIC_FIXTURE_DIR),
    record: flags.has('record'),
    ...(maxUsd === undefined ? {} : { maxUsd }),
  };
}

function buildProvider(options: RunCriticOptions): LlmProvider {
  const budget = options.maxUsd === undefined ? undefined : createBudgetGuard({ maxUsd: options.maxUsd });
  if (!options.record) {
    return createFixtureProvider({
      dir: options.fixtureDir,
      record: false,
      ...(budget === undefined ? {} : { budget }),
    });
  }
  return createResumableRecorder({
    dir: options.fixtureDir,
    ...(budget === undefined ? {} : { budget }),
    onCall: (event) => console.log(`  ${event.source} ${event.key}`),
  });
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  const pool = await loadTideglassEntryPool();
  const sample = selectSample(pool.entries, { seed: options.seed, size: options.size });
  const provider = buildProvider(options);

  const results: VerdictRecord[] = [];
  let failed = 0;
  for (const sampled of sample) {
    const outcome = await judgeFaithfulness({
      provider,
      brief: pool.brief,
      entry: sampled.entry,
      revisions: pool.revisions,
    });
    if (outcome.verdict === undefined) failed += 1;
    results.push({
      slotId: sampled.entry.slot.id,
      cardName: sampled.entry.card.name,
      position: sampled.position,
      ...(outcome.verdict === undefined
        ? {}
        : { criteria: outcome.verdict.criteria, overall: outcome.verdict.overall }),
      ...(outcome.call.error === undefined ? {} : { error: outcome.call.error }),
    });
    console.log(
      `  [${sampled.position}/${sample.length}] ${sampled.entry.slot.id} ${sampled.entry.card.name}`,
    );
  }

  saveVerdictsFile(options.outPath, {
    seed: options.seed,
    size: options.size,
    recordedAt: new Date().toISOString(),
    results,
  });
  console.log(`\nverdicts: ${options.outPath}`);
  console.log(`${results.length - failed}/${results.length} cards judged; ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
