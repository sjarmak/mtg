/**
 * The mass-sim runner.
 *
 * Two execution modes over one game function: in-process (`runMatchSerial`) and
 * worker-parallel (`runMatch`). They are required to agree — the aggregate of a
 * sharded run must equal the aggregate of a serial run of the same seed — and
 * `test/reproducibility.test.ts` asserts it rather than assuming it.
 *
 * Sharding is round-robin by game index and outcomes are re-sorted by index
 * before aggregation, so thread scheduling cannot reorder anything.
 *
 * `runMatch` boots a pool, plays one match and shuts it down, which is the
 * right shape for a single large match and the wrong shape for many small ones:
 * booting workers costs more than a short matchup takes to play. A caller with
 * more than one match to run should hold a `SimPool` open across all of them
 * (`createSimPool`, or `runRoundRobin`, which does it for you).
 *
 * Failures propagate. A worker that blows a game budget kills the run with the
 * offending game's seed in the message; a mass run that silently drops games
 * would report win rates computed over a set nobody chose.
 */
import type { AgentFactory } from './bots';
import { createBot } from './bots';
import type { GameOutcome } from './driver';
import type { MatchRun } from './match-run';
import { finishRun, retime } from './match-run';
import type { MatchSpec } from './match';
import { resolveMatchSpec } from './match';
import { playIndex } from './play-index';
import { poolSize, withSimPool } from './pool';

export interface RunOptions {
  /** 0 or 1 runs in-process. Defaults to `availableParallelism()` capped by game count. */
  readonly workers?: number | undefined;
  /**
   * In-process only: swap in a policy the registry does not know about. This is
   * the seam an MCTS tier or an LLM pilot plugs into. Worker runs must use a
   * `BotSpec`, because a closure cannot cross a thread boundary.
   */
  readonly agentFactory?: AgentFactory | undefined;
}

export type { MatchRun } from './match-run';

/** Runs every game on this thread. */
export function runMatchSerial(spec: MatchSpec, options: RunOptions = {}): MatchRun {
  const resolved = resolveMatchSpec(spec);
  const factory: AgentFactory = options.agentFactory ?? createBot;
  const started = Date.now();
  const outcomes: GameOutcome[] = [];
  for (let index = 0; index < resolved.games; index += 1) {
    outcomes.push(playIndex(resolved, index, factory));
  }
  return finishRun(resolved, outcomes, Date.now() - started);
}

/** Runs the match across worker threads, falling back to in-process for tiny runs. */
export async function runMatch(spec: MatchSpec, options: RunOptions = {}): Promise<MatchRun> {
  const resolved = resolveMatchSpec(spec);
  const requested = poolSize(options.workers);
  if (options.agentFactory !== undefined && requested > 1) {
    throw new Error('a custom agentFactory cannot cross a worker boundary; run with workers: 1');
  }
  const shards = Math.max(1, Math.min(requested, resolved.games));
  if (shards <= 1) return runMatchSerial(spec, options);
  const started = Date.now();
  const run = await withSimPool({ workers: shards }, (pool) => pool.runMatch(spec));
  // Charged with pool startup, because a one-shot caller pays for it.
  return retime(run, Date.now() - started);
}
