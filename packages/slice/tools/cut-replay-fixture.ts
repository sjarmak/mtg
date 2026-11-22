/**
 * Regenerates `packages/ui/test/fixtures/replay.slice.jsonl`.
 *
 *   npx tsx packages/slice/tools/cut-replay-fixture.ts
 *
 * `mtg-6mei`. That fixture is what every reader test in `@mtg/ui` reads: the
 * Analysis tab's subject, the game drilldown, the route wiring, the theme
 * pass. Its value is that nothing in it was authored — it is a real run's log,
 * so a reader that gets it wrong gets a real run wrong. What it did not have
 * was a way back to the run. It was cut by hand, twice, and between the second
 * cut and this one the tree moved out from under it: at the same seed, `WU-WB`
 * now settles in 15 turns over 341 decisions rather than 17 over 391, and
 * `WU-UB` is not even one of the first three matchups any more. Nothing said
 * so, because nothing re-ran the run.
 *
 * Its sibling `packages/ui/test/replay/fixtures/replay-events.jsonl` has had
 * the shape this file gives back since it landed: a generator, and a test that
 * re-generates and asserts byte equality, so an intentional kernel change is
 * one command and an unintentional one is a red test. The generator and the
 * assertion call the same function here (`freshFixture`), so the two can never
 * disagree about what the fixture is supposed to be.
 *
 * # Why it lives in `@mtg/slice` and not beside the fixture
 *
 * The log is the slice pipeline's output, and `@mtg/ui` does not depend on
 * `@mtg/slice` — the arrow runs the other way round the workspace and adding
 * it would drag `@mtg/setgen`, `@mtg/llm` and `@mtg/data` into a package that
 * ships to a browser. So the cut rule lives with the run that produces the log
 * and writes across to the fixture by path. `test/ui-phone-scroll.browser.test.ts`
 * is the standing precedent for a `@mtg/slice` test whose subject is a UI file.
 *
 * # Three stages, not the whole loop
 *
 * The log is `runSimStage`'s output over `runDeckStage`'s over
 * `runSetgenStage`'s, and the two stages after it — the metrics verdict and
 * the throughput bench — read what those wrote and cannot change it. Running
 * only the three that matter takes a 47-second `npm run slice --games 3` down
 * to 22, which is what makes the byte assertion affordable in the unit suite
 * rather than something a person is trusted to remember. Checked rather than
 * argued: this tool's output is byte-identical to the same cut taken off a
 * full run's `logs/replay.jsonl`.
 *
 * Deterministic, and measured rather than assumed: two full runs at the
 * default seed wrote byte-identical 3.4 MB logs.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSliceOptions, runDeckStage, runSetgenStage, runSimStage } from '@mtg/slice';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed fixture this tool writes, reached from `packages/slice/tools/`. */
export const UI_FIXTURE_PATH = join(HERE, '..', '..', 'ui', 'test', 'fixtures', 'replay.slice.jsonl');

/**
 * Games per matchup in the run the fixture is cut from.
 *
 * Three, because the cut takes one game per matchup and a run that played one
 * apiece would be a different run: the seed stream a game draws from is its
 * position in its matchup, so game 0 of a three-game run is not game 0 of a
 * one-game run. It is also what the two hand cuts before this used, so the
 * fixture's header keeps saying `sim_games: 135` and the re-cut is a re-cut
 * rather than a new artifact.
 */
export const FIXTURE_GAMES_PER_MATCHUP = 3;

/** Matchups the fixture carries a game of. Three is what the reader tests read. */
export const FIXTURE_MATCHUPS = 3;

/** A row's matchup, from the two columns that name it rather than from its id. */
function matchupOf(row: Record<string, unknown>): string {
  const main = row['main_colors'];
  const opponent = row['opp_colors'];
  if (typeof main !== 'string' || typeof opponent !== 'string') {
    throw new Error('a replay row is missing main_colors or opp_colors');
  }
  return `${main}-${opponent}`;
}

/**
 * The header plus the first game of each of the first `FIXTURE_MATCHUPS`
 * matchups, in the order the run played them.
 *
 * The rule the two hand cuts followed, written down. It reads the matchup off
 * `main_colors` and `opp_colors` rather than splitting `draft_id`, because
 * those are columns of the 17lands superset the reader already spells and the
 * id's shape is the sim stage's private business.
 */
export function cutReplayFixture(text: string): string {
  const lines = text.split('\n').filter((line) => line !== '');
  const header = lines[0];
  if (header === undefined) throw new Error('the run log is empty');
  const kept = [header];
  const matchups: string[] = [];
  for (const line of lines.slice(1)) {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch (error: unknown) {
      throw new Error(`a replay row is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof row !== 'object' || row === null) throw new Error('a replay row is not an object');
    const matchup = matchupOf(row as Record<string, unknown>);
    if (matchups.includes(matchup)) continue;
    matchups.push(matchup);
    kept.push(line);
    if (matchups.length === FIXTURE_MATCHUPS) break;
  }
  if (matchups.length < FIXTURE_MATCHUPS) {
    throw new Error(
      `the run log played ${String(matchups.length)} matchups and the fixture needs ${String(FIXTURE_MATCHUPS)}`,
    );
  }
  return `${kept.join('\n')}\n`;
}

/** Replays the recorded set, builds the decks, plays the run, returns the cut. */
export async function freshFixture(outDir: string): Promise<string> {
  const options = resolveSliceOptions({
    outDir,
    provider: 'fixture',
    skipForge: true,
    gamesPerMatchup: FIXTURE_GAMES_PER_MATCHUP,
    metricsGate: 'advisory',
  });
  const setgen = await runSetgenStage(options);
  const decks = runDeckStage(setgen.cards);
  const logPath = join(outDir, 'logs', 'replay.jsonl');
  await runSimStage({
    decks: decks.decks,
    runSeed: options.runSeed,
    gamesPerMatchup: options.gamesPerMatchup,
    workers: options.workers,
    expansion: setgen.brief.setCode,
    logPath,
  });
  return cutReplayFixture(readFileSync(logPath, 'utf8'));
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mtg-slice-fixture-'));
  try {
    const text = await freshFixture(dir);
    writeFileSync(UI_FIXTURE_PATH, text, 'utf8');
    const rows = text.split('\n').filter((line) => line !== '').length - 1;
    console.log(`wrote ${String(text.length)} bytes, ${String(rows)} games, to ${UI_FIXTURE_PATH}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
