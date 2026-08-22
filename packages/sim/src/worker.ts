/**
 * Worker-thread entry point.
 *
 * A worker is a long-lived task server, not a one-shot job. It boots once,
 * announces itself, and then answers `WorkerTask` messages until the pool
 * terminates it. That is the whole point: booting a worker means transforming
 * and JIT-compiling the kernel, the DSL and this package from TypeScript
 * source, which costs far more than a short matchup is worth (see
 * `bench/README.md` for the measured numbers). Paying it once per run instead
 * of once per `runMatch` call is what makes worker parallelism win.
 *
 * It never touches shared state and it never derives a seed of its own: the
 * indices are the only thing that differ between shards, so the union of all
 * shards is exactly the serial run.
 *
 * Failures are posted back as a message rather than thrown into the void, so
 * the pool can attribute a blown budget to a specific game seed and keep the
 * worker in service for the next task.
 */
import type { MessagePort } from 'node:worker_threads';
import { parentPort } from 'node:worker_threads';
import type { GameOutcome } from './driver';
import type { ResolvedMatchSpec } from './match';
import { playIndex } from './play-index';

export interface WorkerTask {
  /** Pool-assigned, unique per task; echoed back so a reply is attributable. */
  readonly id: number;
  readonly spec: ResolvedMatchSpec;
  readonly indices: readonly number[];
}

export type WorkerMessage =
  | { readonly kind: 'ready' }
  | { readonly kind: 'result'; readonly id: number; readonly outcomes: readonly GameOutcome[] }
  | {
      readonly kind: 'failed';
      /** `null` when the worker failed to boot, so no task can be blamed. */
      readonly id: number | null;
      readonly message: string;
      readonly stack: string;
    };

function answer(task: WorkerTask): WorkerMessage {
  try {
    return {
      kind: 'result',
      id: task.id,
      outcomes: task.indices.map((index) => playIndex(task.spec, index)),
    };
  } catch (error: unknown) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    return { kind: 'failed', id: task.id, message: wrapped.message, stack: wrapped.stack ?? '' };
  }
}

if (parentPort === null) {
  throw new Error('sim worker was loaded outside a worker thread');
}

const port: MessagePort = parentPort;
port.on('message', (task: WorkerTask) => {
  port.postMessage(answer(task));
});
port.postMessage({ kind: 'ready' } satisfies WorkerMessage);
