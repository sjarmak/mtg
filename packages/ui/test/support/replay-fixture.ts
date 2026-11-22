/**
 * The committed replay slice the reader tests run against.
 *
 * `test/fixtures/replay.slice.jsonl` is a verbatim three-game slice of a real
 * `npm run slice` run (seed `slice/v0`, set TGR, greedy self-play): the header
 * line plus three game rows, the first game of each of the first three
 * matchups, taken out of that run's `logs/replay.jsonl`. It is committed inside
 * the package because `out/` is gitignored.
 *
 * `packages/slice/tools/cut-replay-fixture.ts` writes it and
 * `packages/slice/test/ui-replay-fixture.test.ts` re-cuts it on every unit run
 * and asserts byte equality, so an intentional kernel, deck-builder or set
 * change is one command (`npx tsx packages/slice/tools/cut-replay-fixture.ts`)
 * and an unintentional one is a red test. Both call the same `freshFixture`,
 * so the writer and the check cannot disagree about what the fixture is.
 *
 * That pair is `mtg-6mei`, and it exists because the two cuts before it were
 * taken by hand with nothing to re-take them: by the time anyone looked, the
 * same seed was settling the first matchup in 15 turns over 341 decisions where
 * the committed file said 17 over 391, and the third row was a matchup the
 * round robin no longer reaches third. Nothing said so, because nothing re-ran
 * the run. A reader test that pins a name or a count out of this file is
 * therefore pinning a moving number: `test/replay.test.ts` reads the matchup
 * keys off the games instead, having been the one test that noticed.
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
 * Re-cut 2026-08-13 because `mtg-2m3` added the `sim_triggers` column and
 * bumped the log schema to `mtg-sim/replay-superset/2`; the reader refuses a
 * file it cannot spell every column of, which is the check working. Migrating
 * the old file by writing zeros into the new column was the alternative and is
 * not one: this fixture's value is that nothing in it was authored. The column reads zero throughout because the
 * generated TGR pool prints no triggered ability at all, which is the same
 * reason `abilities` was already zero throughout.
 *
 * Re-cut again 2026-09-22 (`mtg-1j00i.3`), which added the per-card
 * `deck_`/`sideboard_`/`opening_hand_`/`drawn_` columns and bumped the schema
 * to `mtg-sim/replay-superset/3`. Same reasoning as the prior bump: the UI's
 * reader mirror does not parse these columns (out of that bead's scope), but
 * the schema-version gate does not know that, so an un-recut fixture is
 * refused outright rather than read partially.
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
