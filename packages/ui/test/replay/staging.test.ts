/**
 * What `npm run play` records, checked the way the page will read it.
 *
 * The staged log is not committed, so the thing that could rot without anybody
 * noticing is the round trip: the recorder writes, the reader parses, and the
 * viewer's own invariants (every object resolvable, every step in order) hold.
 * That is one assertion and it is the whole contract between the launcher and
 * the tab, proven here over the fallback deck: three games of `@mtg/sim`'s DSL
 * example cards, which stage whether or not a set has ever been generated on
 * this machine.
 *
 * The other half, added with `mtg-ihtz` — the log is about the set actually
 * being played, checked against the real flagship fixture — cannot export by
 * the same argument that keeps the fixture itself behind, so it lives in a
 * private sibling test beside this file.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EVENT_LOG_FILENAME, LAB_GAMES, describeEventLog, stageEventLog } from '../../tools/stage-replay';
import { readEventLog } from '../../src/routes/replay/read-log';

const DIR = mkdtempSync(join(tmpdir(), 'mtg-replay-staging-'));

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe('the log `npm run play` stages', () => {
  const path = join(DIR, EVENT_LOG_FILENAME);
  const staged = stageEventLog(path);
  const log = readEventLog(readFileSync(path, 'utf8'));

  it('is a file the viewer’s own reader accepts', () => {
    expect(log.games.length).toBe(LAB_GAMES.length);
    for (const game of log.games) {
      expect(game.steps.length).toBeGreaterThan(100);
      expect(game.steps.map((step) => step.seq)).toEqual(game.steps.map((_, index) => index));
    }
  });

  it('opens the lab on decided games rather than on the turn cap', () => {
    // A turn-cap draw is a real outcome and the test fixture holds one on
    // purpose; it is a poor first thing to show somebody.
    for (const game of log.games) expect(game.result.reason).not.toBe('turnLimit');
    expect(new Set(log.games.map((game) => game.result.winner)).size).toBeGreaterThan(1);
  });

  it('says what it recorded, per game, rather than only a total', () => {
    const said = describeEventLog(staged);
    expect(said).toContain(`Recorded ${String(LAB_GAMES.length)} bot games`);
    for (const game of LAB_GAMES) expect(said).toContain(game.seed);
  });

  it('is a pure function of the pinned seeds, so it cannot go stale', () => {
    const again = join(DIR, 'again.jsonl');
    stageEventLog(again);
    expect(readFileSync(again, 'utf8')).toBe(readFileSync(path, 'utf8'));
  });

  it('says the games are not this set’s, since nothing else on the page would', () => {
    expect(describeEventLog(staged)).toContain('DSL example');
  });
});
