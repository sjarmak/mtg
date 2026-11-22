/** Process-isolated seam from the public UI launcher to the private calibration producer. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ResolvedSet } from './resolve-set';

export const CALIBRATION_FILENAME = 'calibration.json';
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const PRODUCER = join(REPO_ROOT, 'packages', 'setgen', 'tools', 'stage-analysis-calibration.ts');

export interface BuiltCalibration {
  readonly json: string;
  readonly summary: string;
}

export type CalibrationBuilder = (set: ResolvedSet) => BuiltCalibration;

/** Build outside `public/`; a producer failure therefore cannot mutate the playable pair. */
export function buildCalibration(set: ResolvedSet): BuiltCalibration {
  const directory = mkdtempSync(join(tmpdir(), 'mtg-play-calibration-'));
  const source = join(directory, 'set.json');
  const target = join(directory, CALIBRATION_FILENAME);
  try {
    // The resolver's checked bytes are the bytes staged below. Passing a
    // private copy prevents a path edit between resolution and production
    // from addressing a different document.
    writeFileSync(source, set.json, 'utf8');
    const result = spawnSync('npx', ['tsx', PRODUCER, source, target], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
      const detail = result.stderr.trim() || result.error?.message || 'producer exited without a reason';
      throw new Error(`could not build calibration (${detail})`);
    }
    const json = readFileSync(target, 'utf8');
    JSON.parse(json);
    return { json, summary: result.stdout.trim() };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * The filesystem calls staging makes, injectable so a test can fail one.
 *
 * Only `rename` is behind the seam: it is the step that commits, so it is the
 * only one whose failure leaves the pair half-changed.
 */
export interface StagingIo {
  readonly rename: (from: string, to: string) => void;
  /** How many times to look again when another invocation holds the lock. */
  readonly lockAttempts?: number;
  /** How long to wait between those looks, in milliseconds. */
  readonly lockWaitMs?: number;
}

const REAL_IO: StagingIo = { rename: renameSync };

const LOCK_FILENAME = '.staging.lock';
const DEFAULT_LOCK_ATTEMPTS = 50;
const DEFAULT_LOCK_WAIT_MS = 100;

/**
 * One invocation at a time may change the playable pair.
 *
 * Unique staging names stop two runs from writing one temporary file, but they
 * do not make the pair atomic: the commit is two renames onto two shared
 * targets, so an interleaving still leaves one run's set beside the other run's
 * calibration, which is exactly the mismatch the cleanup path exists to avoid
 * (`mtg-epyp`). The lock is `open` with `wx`, which is atomic on every platform
 * we run on, and it is released in a `finally` so a throwing commit does not
 * strand it. A run that cannot take it after `lockAttempts` says which process
 * holds it rather than staging anyway.
 *
 * The wait is a synchronous sleep because everything around it is synchronous:
 * this is a launcher step, not a server.
 */
function withStagingLock<T>(publicDir: string, io: StagingIo, run: () => T): T {
  const path = join(publicDir, LOCK_FILENAME);
  const attempts = io.lockAttempts ?? DEFAULT_LOCK_ATTEMPTS;
  const waitMs = io.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  let held: number | null = null;
  for (let attempt = 0; attempt <= attempts && held === null; attempt += 1) {
    try {
      held = openSync(path, 'wx');
    } catch (cause: unknown) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      if (attempt === attempts) {
        const holder = readHolder(path);
        throw new Error(
          `another launcher is staging into ${publicDir}${holder} and did not finish; ` +
            `remove ${path} if no launcher is running`,
        );
      }
      if (waitMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
  if (held === null) throw new Error(`could not take the staging lock at ${path}`);
  try {
    writeFileSync(held, `${String(process.pid)}\n`, 'utf8');
    return run();
  } finally {
    closeSync(held);
    rmSync(path, { force: true });
  }
}

/** Whose lock it is, when the file says; a lock with no readable pid is still a lock. */
function readHolder(path: string): string {
  try {
    const pid = readFileSync(path, 'utf8').trim();
    return pid.length === 0 ? '' : ` (pid ${pid})`;
  } catch {
    return '';
  }
}

/**
 * A staging name no other invocation can be holding.
 *
 * Two `npm run play` runs used to write `.set.json.staging` in one directory,
 * so the second overwrote the first's half-written bytes and either could
 * rename the other's document into place (`mtg-epyp`). The pid alone is not
 * enough — a launcher restages within one process — so it carries four random
 * bytes as well. Same directory as the target, because the commit is a rename
 * and a rename across filesystems is not one.
 */
function stagingName(publicDir: string, filename: string): string {
  return join(
    publicDir,
    `.${filename}.${process.pid.toString(36)}-${randomBytes(4).toString('hex')}.staging`,
  );
}

/** Commit the addressed calibration first and its exact set second, cleaning on a partial failure. */
export function stagePlayDocuments(
  set: ResolvedSet,
  calibration: BuiltCalibration,
  publicDir: string,
  io: StagingIo = REAL_IO,
): void {
  mkdirSync(publicDir, { recursive: true });
  withStagingLock(publicDir, io, () => {
    commitPlayDocuments(set, calibration, publicDir, io);
  });
}

function commitPlayDocuments(
  set: ResolvedSet,
  calibration: BuiltCalibration,
  publicDir: string,
  io: StagingIo,
): void {
  const setTarget = join(publicDir, 'set.json');
  const calibrationTarget = join(publicDir, CALIBRATION_FILENAME);
  const setTemp = stagingName(publicDir, 'set.json');
  const calibrationTemp = stagingName(publicDir, CALIBRATION_FILENAME);
  let calibrationCommitted = false;
  try {
    writeFileSync(calibrationTemp, calibration.json, 'utf8');
    writeFileSync(setTemp, set.json, 'utf8');
    io.rename(calibrationTemp, calibrationTarget);
    calibrationCommitted = true;
    io.rename(setTemp, setTarget);
  } catch (cause: unknown) {
    rmSync(setTemp, { force: true });
    rmSync(calibrationTemp, { force: true });
    // An old set without calibration is honest; a new/old mismatched pair is not.
    // Only when this run actually committed one, though: a failure before that
    // rename leaves the pair on disk matched, and removing the calibration then
    // would be this run destroying a document it never wrote — which is the
    // other invocation's, when two are running.
    if (calibrationCommitted) rmSync(calibrationTarget, { force: true });
    throw cause;
  }
}

/** Ordering seam used by the launcher and its failure-state regression. */
export function buildThenStagePlayDocuments(
  set: ResolvedSet,
  publicDir: string,
  builder: CalibrationBuilder = buildCalibration,
  io: StagingIo = REAL_IO,
): BuiltCalibration {
  const calibration = builder(set);
  stagePlayDocuments(set, calibration, publicDir, io);
  return calibration;
}
