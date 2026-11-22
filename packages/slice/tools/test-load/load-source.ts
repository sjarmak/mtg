/**
 * What the load reporter saw, handed to the one other reporter in the process
 * that has to write it down.
 *
 * `reporter.ts` holds the machine samples and the window each timeout was
 * attributed over, and nothing outside it can rebuild them: the samples are
 * taken in this process while the run is going. `tools/gate/outcome-reporter.ts`
 * is the caller that needs them, because a memoized red verdict is read later
 * by someone who was not on the box and cannot tell a red the run itself
 * attributed to the queue from one it did not (`mtg-tgsol`).
 *
 * Both reporters are loaded into the same vitest process, so a module-level
 * slot is enough and neither has to know how the other is constructed. The
 * source hands out closures rather than values so a reader at the end of the
 * run sees the run's findings, not the empty ones from when it was offered.
 */
import type { TimeoutFinding } from './attribution';
import type { MachineSummary } from './timeout-only';

export interface LoadSource {
  /** Every test that ran out of time in this run, with the window it was attributed over. */
  timeouts(): readonly TimeoutFinding[];
  /** The box over the whole run, or `null` when no sample fell inside it. */
  machine(): MachineSummary | null;
}

let current: LoadSource | null = null;

export function offerLoadSource(source: LoadSource | null): void {
  current = source;
}

export function loadSource(): LoadSource | null {
  return current;
}
