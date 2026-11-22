/**
 * The committed UI replay fixture is a run, and this is what says so.
 *
 * `mtg-6mei`. `packages/ui/test/fixtures/replay.slice.jsonl` is the log every
 * reader test in `@mtg/ui` reads, and the whole of its value is that nothing in
 * it was authored. It was cut by hand twice with nothing to re-cut it, and the
 * drift the bead predicted had already happened by the time anyone looked: at
 * the same seed the first matchup ran 15 turns over 341 decisions where the
 * committed file said 17 over 391, and one of its three games was a matchup the
 * round robin no longer reaches third.
 *
 * So `tools/cut-replay-fixture.ts` is the generator and this is the assertion,
 * both calling `freshFixture`. Run the tool after an intentional change to the
 * kernel, the deck builder or the recorded set; find out from this test after
 * an unintentional one. It is the arrangement
 * `packages/ui/test/replay/record.test.ts` has had over the event-log fixture
 * since that one landed, and this file is the missing half of the pair.
 *
 * Here rather than in `@mtg/ui` because the log is this package's output and
 * the workspace arrow does not run the other way: `@mtg/ui` cannot import
 * `@mtg/slice` without pulling `@mtg/setgen`, `@mtg/llm` and `@mtg/data` into
 * a browser bundle. `./ui-phone-scroll.browser.test.ts` is the standing
 * precedent for a test in this package whose subject is a UI file.
 *
 * Twenty-two seconds, stated at the call site the way every other CPU-bound
 * test in this package states its own.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_GAMES_PER_MATCHUP,
  FIXTURE_MATCHUPS,
  UI_FIXTURE_PATH,
  cutReplayFixture,
  freshFixture,
} from '../tools/cut-replay-fixture';
import { removeDir, tempDir } from './helpers';

describe('the committed UI replay fixture', () => {
  let dir = '';
  let fresh = '';

  beforeAll(async () => {
    dir = tempDir('mtg-slice-ui-fixture-');
    fresh = await freshFixture(dir);
  }, 180_000);

  afterAll(() => {
    if (dir !== '') removeDir(dir);
  });

  it('is byte-identical to a fresh cut of the run it claims to be', () => {
    expect(fresh).toBe(readFileSync(UI_FIXTURE_PATH, 'utf8'));
  });

  it('carries a header and one game of each of the first three matchups', () => {
    const lines = fresh.split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(FIXTURE_MATCHUPS + 1);
    const header: unknown = JSON.parse(lines[0] ?? '{}');
    expect(header).toMatchObject({
      sim_record: 'header',
      sim_run_seed: 'slice/v0',
      sim_games: 45 * FIXTURE_GAMES_PER_MATCHUP,
    });
    const pairs = lines.slice(1).map((line) => {
      const row = JSON.parse(line) as { main_colors: string; opp_colors: string };
      return `${row.main_colors}-${row.opp_colors}`;
    });
    expect(new Set(pairs).size, `two rows share a matchup: ${pairs.join(', ')}`).toBe(FIXTURE_MATCHUPS);
  });

  it('refuses a log it cannot cut rather than writing a short fixture', () => {
    expect(() => cutReplayFixture('')).toThrow(/empty/);
    expect(() => cutReplayFixture('{"sim_record":"header"}\nnot json\n')).toThrow(/not JSON/);
    expect(() => cutReplayFixture('{"sim_record":"header"}\n{"main_colors":"WU"}\n')).toThrow(
      /main_colors or opp_colors/,
    );
    const oneMatchup = ['{"sim_record":"header"}', '{"main_colors":"WU","opp_colors":"WB"}'].join('\n');
    expect(() => cutReplayFixture(oneMatchup)).toThrow(/played 1 matchups/);
  });
});
