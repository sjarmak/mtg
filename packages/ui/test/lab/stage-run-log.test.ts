/**
 * Which statistics log `npm run play` puts in front of the Analysis tab.
 *
 * The launcher already refuses an art manifest that covers none of the set's
 * ids and a precon file naming a card the set does not print. The statistics
 * log was the one staged input with no rule at all: a hand-cut three-game slice
 * of a *Tideglass* run sat in `public/` and was served under whatever set the
 * lab had just opened, so the flagship wore "3 games, seed slice/v0" on every
 * route. The numbers were real; the subject was somebody else.
 *
 * So the rule tested here is the precon rule one step out — the whole log or
 * nothing, and only if it is about this set. What it costs to be wrong is a
 * dashboard of correct-looking rates about a set nobody is playing, and there
 * is no cheap honest fallback: the run that would produce a matching log is a
 * mass simulation (the one on this machine is 2,700 games and 62 MB), so the
 * answer when nothing matches is an empty state naming the command.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MAX_RUN_LOG_BYTES,
  RUN_LOG_FILENAME,
  chooseRunLog,
  describeRunLog,
  runLogCandidatesFor,
  writeRunLog,
} from '../../tools/stage-run-log';
import type { RunLogCandidate } from '../../tools/stage-run-log';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = mkdtempSync(join(tmpdir(), 'mtg-run-log-'));

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

/** The reader's own fixture: a real three-game slice of a TGR run, schema v2. */
const TIDEGLASS = readFileSync(join(HERE, '..', 'fixtures', RUN_LOG_FILENAME), 'utf8');
/** The same bytes with the expansion column moved, which is the accept case. */
const FLAGSHIP_SET = TIDEGLASS.replaceAll('"expansion":"TGR"', '"expansion":"XMP"');

function candidate(name: string, contents: string): RunLogCandidate {
  const path = join(DIR, name);
  writeFileSync(path, contents, 'utf8');
  return { path, what: `the ${name} run` };
}

describe('choosing a statistics log for the set being played', () => {
  it('stages a log whose every game is about this set', () => {
    const found = candidate('xmp.jsonl', FLAGSHIP_SET);
    const search = chooseRunLog([found], 'XMP');
    expect(search.chosen?.candidate.path).toBe(found.path);
    expect(search.chosen?.log.games.length).toBe(3);
    expect(describeRunLog(search)).toContain('3 games');
  });

  it('refuses another set’s log by name rather than staging it unlabeled', () => {
    const search = chooseRunLog([candidate('tgr.jsonl', TIDEGLASS)], 'XMP');
    expect(search.chosen).toBeNull();
    expect(search.rejected[0]?.why).toContain('TGR');
    expect(search.rejected[0]?.why).toContain('XMP');
    // The launcher says which file it passed over and why, the way it does for
    // a precon file it could not resolve.
    expect(describeRunLog(search)).toContain('tgr.jsonl');
    expect(describeRunLog(search)).toContain('npm run slice');
  });

  it('refuses a log the page’s own reader would refuse, carrying its message', () => {
    const stale = TIDEGLASS.replaceAll('replay-superset/2', 'replay-superset/1');
    const search = chooseRunLog([candidate('v1.jsonl', stale)], 'XMP');
    expect(search.chosen).toBeNull();
    expect(search.rejected[0]?.why).toContain('replay-superset/1');
  });

  it('refuses a log too large to serve, without reading it', () => {
    let read = false;
    const search = chooseRunLog([{ path: join(DIR, 'huge.jsonl'), what: 'a full sweep' }], 'XMP', {
      sizeOf: () => MAX_RUN_LOG_BYTES + 1,
      read: () => {
        read = true;
        return null;
      },
    });
    expect(search.chosen).toBeNull();
    expect(read).toBe(false);
    expect(search.rejected[0]?.why).toContain('MB');
  });

  it('refuses everything when the set document names no code', () => {
    const search = chooseRunLog([candidate('anon.jsonl', FLAGSHIP_SET)], null);
    expect(search.chosen).toBeNull();
    expect(describeRunLog(search)).toContain('names no set code');
  });

  it('looks beside the set first and in the slice output after it', () => {
    const paths = runLogCandidatesFor(join('/repo', 'out', 'XMP', 'set.json'), '/repo').map(
      (found) => found.path,
    );
    expect(paths[0]).toBe(join('/repo', 'out', 'XMP', 'logs', 'replay.jsonl'));
    expect(paths).toContain(join('/repo', 'out', 'slice', 'logs', 'replay.jsonl'));
  });
});

describe('what the launcher leaves in public/', () => {
  it('writes the chosen log verbatim, so the page reads the run’s own bytes', () => {
    const target = join(DIR, 'public', RUN_LOG_FILENAME);
    const search = chooseRunLog([candidate('match.jsonl', FLAGSHIP_SET)], 'XMP');
    writeRunLog(target, search);
    expect(readFileSync(target, 'utf8')).toBe(FLAGSHIP_SET);
  });

  it('clears a log staged for an earlier set rather than leaving it served', () => {
    const target = join(DIR, 'stale', RUN_LOG_FILENAME);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, TIDEGLASS, 'utf8');
    writeRunLog(target, chooseRunLog([candidate('other.jsonl', TIDEGLASS)], 'XMP'));
    expect(() => readFileSync(target, 'utf8')).toThrow();
  });
});
