/** Process-isolated seam from the public UI launcher to the private calibration producer. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/** Commit the addressed calibration first and its exact set second, cleaning on a partial failure. */
export function stagePlayDocuments(set: ResolvedSet, calibration: BuiltCalibration, publicDir: string): void {
  mkdirSync(publicDir, { recursive: true });
  const setTarget = join(publicDir, 'set.json');
  const calibrationTarget = join(publicDir, CALIBRATION_FILENAME);
  const setTemp = join(publicDir, '.set.json.staging');
  const calibrationTemp = join(publicDir, '.calibration.json.staging');
  try {
    writeFileSync(calibrationTemp, calibration.json, 'utf8');
    writeFileSync(setTemp, set.json, 'utf8');
    renameSync(calibrationTemp, calibrationTarget);
    renameSync(setTemp, setTarget);
  } catch (cause: unknown) {
    rmSync(setTemp, { force: true });
    rmSync(calibrationTemp, { force: true });
    // An old set without calibration is honest; a new/old mismatched pair is not.
    rmSync(calibrationTarget, { force: true });
    throw cause;
  }
}

/** Ordering seam used by the launcher and its failure-state regression. */
export function buildThenStagePlayDocuments(
  set: ResolvedSet,
  publicDir: string,
  builder: CalibrationBuilder = buildCalibration,
): BuiltCalibration {
  const calibration = builder(set);
  stagePlayDocuments(set, calibration, publicDir);
  return calibration;
}
