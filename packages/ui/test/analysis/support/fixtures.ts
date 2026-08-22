/**
 * Fixture loading for the analysis tests.
 *
 * The JSON files here are real `@mtg/metrics` output over real `@mtg/sim`
 * games; `fixtures/make-fixtures.ts` is the runnable command that produced
 * them. Loading them through `readAnalysisRun` rather than casting is
 * deliberate: it means a field rename upstream fails these tests at the reader
 * instead of silently rendering `undefined` somewhere in a chart.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAnalysisRun, readSetDocument } from '../../../src/routes/analysis/read';
import type { AnalysisRun, SetDocument } from '../../../src/routes/analysis/model';

/**
 * `path.join` rather than `new URL(literal, import.meta.url)`: Vite rewrites
 * that pattern into an asset URL, which under the jsdom environment resolves
 * against the document's `http://localhost` base instead of the file system.
 * The replay fixtures hit the same wall.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', 'fixtures');

/**
 * The set these runs were played on, read at its one committed home in
 * `@mtg/setgen` rather than copied in beside them (`mtg-bc2.86`). A local copy
 * would let the runs and the set they claim to describe drift apart silently,
 * which is the failure a single source exists to prevent.
 */
const PACKAGES = join(HERE, '..', '..', '..', '..');
const SET_FILE = join(PACKAGES, 'setgen', 'fixtures', 'sets', 'tideglass-reach.set.json');

export type FixtureName = 'run-a' | 'run-b' | 'run-strict' | 'run-sparse';

export function fixtureJson(name: FixtureName): unknown {
  return JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
}

export function loadRun(name: FixtureName): AnalysisRun {
  return readAnalysisRun(fixtureJson(name), name);
}

export function loadSet(): SetDocument {
  return readSetDocument(JSON.parse(readFileSync(SET_FILE, 'utf8')));
}
