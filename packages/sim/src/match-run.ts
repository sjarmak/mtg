/**
 * Assembling one match's outcomes into a result.
 *
 * Lives apart from the runner because both execution paths need it and the
 * worker pool must not import the runner: the runner is built *on* the pool.
 *
 * The sort is the load-bearing line. Outcomes arrive from however many shards
 * in whatever order the scheduler happened to finish them, and every aggregate
 * downstream is a pure function of the ordered list, so ordering here is what
 * makes a sharded run and a serial run produce byte-identical statistics.
 */
import type { MatchAggregate } from './aggregate';
import { aggregateOutcomes } from './aggregate';
import type { GameOutcome } from './driver';
import type { SimGameLog } from './log/schema';
import type { ResolvedMatchSpec } from './match';

export interface MatchRun {
  readonly aggregate: MatchAggregate;
  readonly outcomes: readonly GameOutcome[];
  readonly logs: readonly SimGameLog[];
  readonly elapsedMillis: number;
  readonly gamesPerSecond: number;
}

export function finishRun(
  spec: ResolvedMatchSpec,
  outcomes: readonly GameOutcome[],
  elapsedMillis: number,
): MatchRun {
  if (outcomes.length !== spec.games) {
    throw new Error(
      `match ${spec.runSeed} returned ${outcomes.length} outcomes for ${spec.games} games; ` +
        'a run that silently drops games would report statistics over a set nobody chose',
    );
  }
  const ordered = [...outcomes].sort((a, b) => a.index - b.index);
  const logs = ordered.flatMap((outcome) => (outcome.log === null ? [] : [outcome.log]));
  return {
    aggregate: aggregateOutcomes(spec.runSeed, ordered),
    outcomes: ordered,
    logs,
    elapsedMillis,
    gamesPerSecond: elapsedMillis === 0 ? 0 : (ordered.length * 1000) / elapsedMillis,
  };
}

/**
 * The same run, charged a different wall clock.
 *
 * Used where the caller pays for something the play loop does not know about —
 * booting a worker pool, most of all. Reporting only the playing time would
 * flatter the parallel path exactly where it is weakest.
 */
export function retime(run: MatchRun, elapsedMillis: number): MatchRun {
  return {
    ...run,
    elapsedMillis,
    gamesPerSecond: elapsedMillis === 0 ? 0 : (run.outcomes.length * 1000) / elapsedMillis,
  };
}

/** Round-robin by game index, so shard membership never depends on game length. */
export function shardIndices(games: number, shards: number): readonly (readonly number[])[] {
  const buckets: number[][] = Array.from({ length: shards }, () => []);
  for (let index = 0; index < games; index += 1) {
    buckets[index % shards]?.push(index);
  }
  return buckets.filter((bucket) => bucket.length > 0);
}
