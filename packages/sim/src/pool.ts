/**
 * A reusable pool of simulation worker threads.
 *
 * The pool exists because worker startup is expensive and matchups are short.
 * Booting one worker means registering the TypeScript loader and compiling the
 * kernel, the DSL and this package from source; on lab hardware that is roughly
 * half a second of wall clock for a full set of workers, against a matchup that
 * only takes a second to play. Spawning a fresh set per `runMatch` call spends
 * more time booting than playing, which is why the balance gate was serial.
 *
 * So the pool boots once and stays warm across every matchup of a round robin,
 * and tasks are pulled by whichever worker is free rather than assigned up
 * front. Dynamic pulling is safe precisely because nothing about a game depends
 * on where it runs: `playIndex` is a pure function of (spec, index), so the
 * assignment is a scheduling detail and the aggregate is not.
 *
 * Everything here is mutable by necessity — a pool is a lifecycle. The
 * mutation is confined to this module, and the values that cross its boundary
 * (tasks in, outcomes out) are plain data.
 */
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { GameOutcome } from './driver';
import type { MatchRun } from './match-run';
import { finishRun, shardIndices } from './match-run';
import type { MatchSpec, ResolvedMatchSpec } from './match';
import { resolveMatchSpec } from './match';
import { recordPoolEvent } from './pool-census';
import { defaultSimWorkers, insideTestWorker } from './pool-size';
import type { WorkerMessage, WorkerTask } from './worker';

const WORKER_URL = new URL('./worker.ts', import.meta.url);

/**
 * Pools opened by this process, so a record has an id that is unique across a
 * run without any two processes having to agree on anything.
 */
let poolsOpened = 0;

export interface SimPoolOptions {
  /** Worker threads to boot. Defaults to `availableParallelism()`. */
  readonly workers?: number | undefined;
}

export interface SimPool {
  /** Workers still in service. Drops if one dies mid-run. */
  readonly size: number;
  /** Plays one match across the pool. */
  runMatch(spec: MatchSpec): Promise<MatchRun>;
  /**
   * Plays several matches over one shared queue. Every match's shards are
   * enqueued together, so a worker that finishes early picks up the next
   * matchup instead of idling at a barrier. Results come back in the order the
   * specs were given, whatever order they finished in.
   *
   * Each `MatchRun.elapsedMillis` is that match's own span, which overlaps
   * every other match in the batch — it is a latency, not a throughput. Time
   * the whole call for throughput.
   */
  runMatches(specs: readonly MatchSpec[]): Promise<readonly MatchRun[]>;
  /** Terminates every worker. Pending work rejects. Idempotent. */
  close(): Promise<void>;
}

/** One match in flight: its shards, and how many are still outstanding. */
interface ShardedOutcomes {
  readonly outcomes: readonly GameOutcome[];
  readonly elapsedMillis: number;
}

interface MatchJob {
  readonly startedAt: number;
  readonly outcomes: GameOutcome[];
  remaining: number;
  settled: boolean;
  readonly resolve: (result: ShardedOutcomes) => void;
  readonly reject: (error: Error) => void;
}

interface PendingTask {
  readonly job: MatchJob;
  readonly input: WorkerTask;
}

interface PooledWorker {
  readonly worker: Worker;
  task: PendingTask | null;
}

/**
 * Worker bootstrap.
 *
 * The workspace runs from TypeScript sources with no build step, and module
 * hooks are per-thread: a worker does not inherit the parent's. So each worker
 * registers the TypeScript loader itself before importing the real entry point.
 * A registration failure is not swallowed — it is carried forward and reported
 * alongside whatever the import then fails with, because on a runtime that
 * already understands TypeScript the registration is genuinely optional.
 */
function bootstrapSource(): string {
  const require = createRequire(import.meta.url);
  let loaderPath: string;
  try {
    loaderPath = require.resolve('tsx/esm/api');
  } catch (error: unknown) {
    throw new Error(
      'worker-parallel runs need the tsx loader resolvable from @mtg/sim ' +
        `(install it at the workspace root, or run with workers: 1): ${String(error)}`,
    );
  }
  return `
    let loaderError = '';
    try { require(${JSON.stringify(loaderPath)}).register(); }
    catch (error) { loaderError = String(error && error.message); }
    import(${JSON.stringify(WORKER_URL.href)}).catch((error) => {
      const suffix = loaderError ? ' (TypeScript loader registration failed: ' + loaderError + ')' : '';
      require('node:worker_threads').parentPort.postMessage({
        kind: 'failed',
        id: null,
        message: String(error && error.message) + suffix,
        stack: String((error && error.stack) || ''),
      });
    });
  `;
}

/**
 * The width this pool opens at. A stated width is taken as stated; an unstated
 * one is `pool-size.ts`'s answer, which is the whole machine unless this
 * process is itself a worker inside a test run.
 */
export function poolSize(requested: number | undefined): number {
  const raw =
    requested ??
    defaultSimWorkers({
      cores: availableParallelism(),
      insideTestWorker: insideTestWorker(process.env),
      override: process.env['MTG_SIM_WORKERS'],
    });
  if (!Number.isFinite(raw))
    throw new Error(`a sim pool needs a finite worker count, got ${String(requested)}`);
  return Math.max(1, Math.floor(raw));
}

/**
 * Boots a pool and resolves once every worker has reported for duty, so a
 * caller timing a run is not charged for startup it did not ask for and a
 * bootstrap failure surfaces here rather than as a mysterious hang.
 */
export async function createSimPool(options: SimPoolOptions = {}): Promise<SimPool> {
  const size = poolSize(options.workers);
  poolsOpened += 1;
  const census = {
    id: `${process.pid}-${poolsOpened}`,
    pid: process.pid,
    workers: size,
    stated: options.workers !== undefined,
  };
  // Recorded before the workers boot, so a pool that dies during bootstrap is
  // still in the timeline; boot is where its threads are already on the cores.
  recordPoolEvent(process.env, { ...census, event: 'open', at: Date.now() });
  const source = bootstrapSource();

  const workers: PooledWorker[] = [];
  const idle: PooledWorker[] = [];
  const queue: PendingTask[] = [];
  let closed = false;
  let nextTaskId = 0;

  function failJob(job: MatchJob, error: Error): void {
    if (job.settled) return;
    job.settled = true;
    job.reject(error);
  }

  function completeShard(task: PendingTask, outcomes: readonly GameOutcome[]): void {
    const { job } = task;
    if (job.settled) return;
    job.outcomes.push(...outcomes);
    job.remaining -= 1;
    if (job.remaining === 0) {
      job.settled = true;
      job.resolve({ outcomes: job.outcomes, elapsedMillis: Date.now() - job.startedAt });
    }
  }

  function pump(): void {
    while (queue.length > 0 && idle.length > 0) {
      const task = queue.shift();
      if (task === undefined) return;
      // A match that has already failed does not get to spend more CPU.
      if (task.job.settled) continue;
      const pooled = idle.pop();
      if (pooled === undefined) {
        queue.unshift(task);
        return;
      }
      pooled.task = task;
      pooled.worker.postMessage(task.input);
    }
  }

  function retire(pooled: PooledWorker, error: Error): void {
    const index = workers.indexOf(pooled);
    if (index >= 0) workers.splice(index, 1);
    const idleIndex = idle.indexOf(pooled);
    if (idleIndex >= 0) idle.splice(idleIndex, 1);
    const task = pooled.task;
    pooled.task = null;
    if (task !== null) failJob(task.job, error);
    if (workers.length === 0) {
      while (queue.length > 0) {
        const orphan = queue.shift();
        if (orphan !== undefined) failJob(orphan.job, error);
      }
    }
  }

  function onMessage(pooled: PooledWorker, message: WorkerMessage): void {
    if (message.kind === 'ready') return;
    const task = pooled.task;
    if (task === null) return;
    pooled.task = null;
    if (!closed) idle.push(pooled);
    if (message.kind === 'result') completeShard(task, message.outcomes);
    else failJob(task.job, new Error(`sim worker failed: ${message.message}\n${message.stack}`));
    pump();
  }

  async function boot(): Promise<PooledWorker> {
    const worker = new Worker(source, { eval: true });
    const pooled: PooledWorker = { worker, task: null };
    await new Promise<void>((resolve, reject) => {
      const onBootError = (error: Error): void => {
        reject(error);
      };
      const onBootExit = (code: number): void => {
        reject(new Error(`sim worker exited with code ${code} before it was ready`));
      };
      const onFirst = (message: WorkerMessage): void => {
        if (message.kind === 'ready') {
          worker.off('message', onFirst);
          worker.off('error', onBootError);
          worker.off('exit', onBootExit);
          worker.on('message', (next: WorkerMessage) => {
            onMessage(pooled, next);
          });
          worker.on('error', (error: Error) => {
            retire(pooled, error);
          });
          worker.on('exit', (code: number) => {
            if (workers.includes(pooled)) {
              retire(pooled, new Error(`sim worker exited with code ${code} while in service`));
            }
          });
          resolve();
          return;
        }
        if (message.kind === 'failed') {
          reject(new Error(`sim worker failed to start: ${message.message}\n${message.stack}`));
        }
      };
      worker.on('message', onFirst);
      worker.on('error', onBootError);
      worker.on('exit', onBootExit);
    }).catch(async (error: unknown) => {
      // A half-started worker still holds a thread; do not leak it.
      await worker.terminate();
      throw error instanceof Error ? error : new Error(String(error));
    });
    return pooled;
  }

  const booted = await Promise.allSettled(Array.from({ length: size }, () => boot()));
  for (const result of booted) {
    if (result.status === 'fulfilled') workers.push(result.value);
  }
  if (workers.length === 0) {
    const first = booted.find((result) => result.status === 'rejected');
    const reason = first === undefined ? 'unknown' : String(first.reason);
    throw new Error(`no sim worker could start: ${reason}`);
  }
  idle.push(...workers);

  function enqueue(spec: ResolvedMatchSpec): Promise<ShardedOutcomes> {
    return new Promise<ShardedOutcomes>((resolve, reject) => {
      const buckets = shardIndices(spec.games, Math.min(workers.length, spec.games));
      const job: MatchJob = {
        startedAt: Date.now(),
        outcomes: [],
        remaining: buckets.length,
        settled: false,
        resolve,
        reject,
      };
      for (const indices of buckets) {
        nextTaskId += 1;
        queue.push({ job, input: { id: nextTaskId, spec, indices } });
      }
      pump();
    });
  }

  function guard(): void {
    if (closed) throw new Error('this sim pool is closed');
    if (workers.length === 0) throw new Error('this sim pool has no live workers left');
  }

  async function runMatch(spec: MatchSpec): Promise<MatchRun> {
    guard();
    const resolved = resolveMatchSpec(spec);
    const sharded = await enqueue(resolved);
    return finishRun(resolved, sharded.outcomes, sharded.elapsedMillis);
  }

  async function runMatches(specs: readonly MatchSpec[]): Promise<readonly MatchRun[]> {
    guard();
    const resolved = specs.map((spec) => resolveMatchSpec(spec));
    const settled = await Promise.allSettled(resolved.map((spec) => enqueue(spec)));
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure !== undefined && failure.status === 'rejected') {
      throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
    }
    return settled.map((result, position) => {
      const spec = resolved[position];
      if (spec === undefined || result.status !== 'fulfilled') {
        throw new Error(`sim pool lost the result for match ${position}`);
      }
      return finishRun(spec, result.value.outcomes, result.value.elapsedMillis);
    });
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    recordPoolEvent(process.env, { ...census, event: 'close', at: Date.now() });
    const error = new Error('the sim pool was closed before this match finished');
    while (queue.length > 0) {
      const task = queue.shift();
      if (task !== undefined) failJob(task.job, error);
    }
    const live = [...workers];
    workers.length = 0;
    idle.length = 0;
    for (const pooled of live) {
      if (pooled.task !== null) failJob(pooled.task.job, error);
    }
    await Promise.all(live.map((pooled) => pooled.worker.terminate()));
  }

  return {
    get size(): number {
      return workers.length;
    },
    runMatch,
    runMatches,
    close,
  };
}

/**
 * Runs `body` against a pool that is closed no matter how `body` ends. Worker
 * threads keep the event loop alive, so a leaked pool is a process that never
 * exits — a benchmark that hangs after printing its numbers is the usual way
 * that bug is discovered.
 */
export async function withSimPool<T>(
  options: SimPoolOptions,
  body: (pool: SimPool) => Promise<T>,
): Promise<T> {
  const pool = await createSimPool(options);
  try {
    return await body(pool);
  } finally {
    await pool.close();
  }
}
