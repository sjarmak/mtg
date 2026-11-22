/**
 * Registry of the detached process groups this Node process spawned for Forge.
 *
 * xvfb-run, Xvfb and the JVM are spawned `detached: true` so each launch owns a
 * process group that `killProcessGroup` can reap whole (SIGKILL to the xvfb-run
 * shell alone bypasses its EXIT trap and orphans Xvfb). The cost of detaching is
 * that nothing ties the group to its parent: when vitest times a test out it
 * abandons the promise, the `finally { session.close() }` never runs, the worker
 * later exits, and the group is reparented to init (mtg-2joqn). So every group
 * is registered here at spawn and released when it is killed, and one
 * process-level handler kills whatever is still registered when this process
 * goes away.
 *
 * Handlers: `exit` (synchronous, so `process.kill` is safe there) and SIGTERM /
 * SIGINT, which kill the groups and then re-raise the signal so the exit status
 * is the one the sender asked for. SIGKILL cannot be caught; nothing here helps
 * a worker that is SIGKILLed.
 */

const live = new Set<number>();
let installed = false;

function killGroupQuietly(pgid: number): void {
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // ESRCH: already gone. Any other failure has nowhere useful to go while the
    // process is exiting, and the remaining groups still need their turn.
  }
}

function killAll(): void {
  for (const pgid of live) killGroupQuietly(pgid);
  live.clear();
}

function install(): void {
  if (installed) return;
  installed = true;
  process.on('exit', killAll);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    const onSignal = (): void => {
      killAll();
      process.removeListener(signal, onSignal);
      process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }
}

/** Register a group spawned with `detached: true`; its pid is its group id. */
export function trackProcessGroup(pgid: number | undefined): void {
  if (pgid === undefined) return;
  install();
  live.add(pgid);
}

/**
 * SIGKILL the whole group and stop tracking it. ESRCH (already gone) is not an
 * error; anything else is thrown so a caller can report a cleanup failure.
 */
export function killProcessGroup(pgid: number | undefined): void {
  if (pgid === undefined) return;
  live.delete(pgid);
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
  }
}

/** Groups still registered; for tests. */
export function liveProcessGroups(): readonly number[] {
  return [...live];
}
