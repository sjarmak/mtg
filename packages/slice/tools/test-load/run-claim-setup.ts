/**
 * Vitest global setup: leave a claim (`run-claims.ts`) for the whole run's
 * lifetime, so a run that starts beside this one can size its pool against it.
 *
 * Every run claims, whatever its worker count and whether or not it pinned one:
 * a run pinned to one worker still holds cores the others cannot use, and
 * counting it is what keeps a sibling from assuming the box is empty.
 *
 * It sits after the Forge lock in `vitest.config.ts`'s `globalSetup`, because a
 * run waiting behind another Forge run is not yet spending the cores it will
 * spend, and a claim taken before the wait would shrink every sibling for it.
 */
import { hostname } from 'node:os';
import { runsDirPath } from './host-lock';
import { claimRun } from './run-claims';

export interface RunClaimOptions {
  readonly dir?: string;
  readonly label?: string;
}

/** Exported for tests; the default export below is what Vitest actually loads. */
export function runClaimSetup(options: RunClaimOptions = {}): () => void {
  const label = options.label ?? `vitest pid ${process.pid} in ${process.cwd()} on ${hostname()}`;
  return claimRun(options.dir ?? runsDirPath(), label);
}

export default function setup(): () => void {
  return runClaimSetup();
}
