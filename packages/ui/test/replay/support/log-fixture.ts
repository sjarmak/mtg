/**
 * The committed replay fixture, read from disk.
 *
 * Tests read the file rather than recording on the fly: a viewer test that
 * regenerates its own input is testing the recorder as well, and would go green
 * on a log format both sides got wrong together.
 *
 * The path is built with `path.join` rather than `new URL(literal,
 * import.meta.url)`, matching `test/support/replay-fixture.ts`: Vite rewrites
 * that pattern into an asset URL, which under the jsdom environment resolves
 * against the document's `http://localhost` base instead of the file system.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEventLog } from '../../../src/routes/replay/read-log';
import type { EventLog } from '../../../src/routes/replay/read-log';

const HERE = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_PATH = join(HERE, '..', 'fixtures', 'replay-events.jsonl');

export function fixtureText(): string {
  return readFileSync(FIXTURE_PATH, 'utf8');
}

export function fixtureLog(): EventLog {
  return readEventLog(fixtureText());
}
