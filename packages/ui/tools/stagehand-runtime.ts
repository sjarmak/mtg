/**
 * Whether the connected Chrome can run Stagehand's bundled extension is
 * unverified for chrome-headless-shell (`packages/ui/test/support/chrome-driver.ts`'s
 * default browser, reused as-is by the Stagehand path, `mtg-onjme.1`'s "same
 * chrome-headless-shell process" decision — `docs/research/stagehand-jev-seam.md`).
 * When it can't, Stagehand throws one of two distinct, easily confused
 * failures, and both must become one clean, named refusal here, before the
 * first journey step runs, rather than surfacing wherever the first
 * `observe()` happens to touch the extension:
 *
 * - An untyped `Error` whose message names `Extensions.loadUnpacked` when the
 *   CDP method itself is unsupported by this Chrome build.
 * - The typed `StagehandRuntimeIncompatibleError` when the extension loads
 *   but its RPC protocol version does not match this SDK's — a different
 *   failure mode, checked separately (confirmed by reading
 *   `StagehandRuntimeIncompatibleError`'s declaration directly: it is raised
 *   on a protocol-version mismatch, not on `Extensions.loadUnpacked` support).
 */
import { StagehandRuntimeIncompatibleError } from '@browserbasehq/stagehand';

export class StagehandRuntimeRefusalError extends Error {
  constructor(
    message: string,
    override readonly cause: unknown,
  ) {
    super(message);
    this.name = 'StagehandRuntimeRefusalError';
  }
}

const LOAD_UNPACKED_PATTERN = /Extensions\.loadUnpacked/u;

/**
 * Stagehand's extension RPC keeps a pending-call map and rejects an entry on
 * a protocol error from inside its own message handler, not from the promise
 * `observe()`/`act()` handed back to its caller. That rejection belongs to
 * nobody's `await`, so Node reports it as an unhandled rejection and — since
 * no listener is registered for that event by default — terminates the
 * process (`mtg-sh8ej`: a claude-cli "OAuth session expired" failure inside
 * `observe()` surfaced exactly this way and killed the run before any report
 * was written).
 *
 * This wraps one call with temporary `unhandledRejection`/`uncaughtException`
 * listeners, live only for the call's duration, so a stray rejection is
 * delivered as *this call's* failure instead of a process-ending event: the
 * caller gets an ordinary rejected promise it can catch and record.
 */
export async function guardProcessCrash<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      process.off('unhandledRejection', onCrash);
      process.off('uncaughtException', onCrash);
    };
    const onCrash = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    };
    process.on('unhandledRejection', onCrash);
    process.on('uncaughtException', onCrash);
    run().then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

export async function withRuntimePreflight<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StagehandRuntimeIncompatibleError) {
      throw new StagehandRuntimeRefusalError(
        `Stagehand's extension reports a protocol version this SDK cannot use (${error.reason}): ${error.detail}`,
        error,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    if (LOAD_UNPACKED_PATTERN.test(message)) {
      throw new StagehandRuntimeRefusalError(
        `this Chrome build cannot load Stagehand's bundled extension (Extensions.loadUnpacked unsupported): ${message}`,
        error,
      );
    }
    throw error;
  }
}
