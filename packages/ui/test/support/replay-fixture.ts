/**
 * The committed replay slice the reader tests run against.
 *
 * `test/fixtures/replay.slice.jsonl` is a verbatim three-game slice of a real
 * `npm run slice` run (seed `slice/v0`, set TGR, greedy self-play): the header
 * line plus three game rows, copied byte-for-byte out of that run's
 * `logs/replay.jsonl`. It is committed inside the package because `out/` is
 * gitignored.
 *
 * It lived in `public/` until `mtg-ihtz`, on the reasoning that the dev app
 * could serve the same file rather than keep a second copy. What that actually
 * did was serve three games of TGR under whatever set the lab had opened, with
 * nothing staging or clearing it — so the flagship's Analysis tab summarized
 * another set's run and the shell badge carried the count on every route. The
 * served copy is staged now (`tools/stage-run-log.ts`) and only when a log on
 * disk is about the set being played; this one is a reader fixture and nothing
 * else, which is why it sits beside the event-log fixture in the test tree.
 *
 * Re-cut 2026-08-13 from `npx tsx packages/slice/src/cli.ts --games 3
 * --skip-forge`, because `mtg-2m3` added the `sim_triggers` column and bumped
 * the log schema to `mtg-sim/replay-superset/2`; the reader refuses a file it
 * cannot spell every column of, which is the check working. Same three rows the
 * previous cut took — the first game of each of the first three matchups — off
 * a run of the same seed. Migrating the old file by writing zeros into the new
 * column was the alternative and is not one: this fixture's value is that
 * nothing in it was authored. The column reads zero throughout because the
 * generated TGR pool prints no triggered ability at all, which is the same
 * reason `abilities` was already zero throughout.
 *
 * The path is built with `path.join` rather than `new URL(literal,
 * import.meta.url)`: Vite rewrites that pattern into an asset URL, which under
 * the jsdom environment resolves against the document's `http://localhost`
 * base instead of the file system.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_PATH = join(HERE, '..', 'fixtures', 'replay.slice.jsonl');

export function fixtureText(): string {
  return readFileSync(FIXTURE_PATH, 'utf8');
}
