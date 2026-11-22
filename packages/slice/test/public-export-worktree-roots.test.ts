import { describe, expect, it } from 'vitest';
import { scanText, prefixTerms, substitute } from '../tools/public-export/terms';
import { PRIVATE_PATH_MARKERS } from '../tools/public-export/tiers';

// Built by concatenation so the exporter, which launders and scans literal
// paths, leaves these fixtures as written in the public tree.
const HOME = '/home' + '/ds/';
const HOME_MARKERS = prefixTerms(PRIVATE_PATH_MARKERS.map((entry) => entry.word));

describe('a per-bead worktree root is laundered at export', () => {
  it.each([
    ['a worker slot root', `${HOME}mtg-worktrees/mtg-worker-slots/mtg-worker-4-a9z4l/packages/data/x.json`],
    ['the bare slot root itself', `${HOME}mtg-worktrees/mtg-worker-slots/mtg-worker-4/packages/data/x.json`],
    [
      'a dotted bead in a slot root',
      `${HOME}mtg-worktrees/mtg-worker-slots/mtg-worker-2-j4ucd.4/packages/data/x.json`,
    ],
    [
      'the older worktrees root',
      `${HOME}mtg-worktrees/mtg-worker-3-worktrees/mtg-abcde/packages/data/x.json`,
    ],
    [
      'a worktrees root inside a slot',
      `${HOME}mtg-worktrees/mtg-worker-slots/mtg-worker-1-worktrees/mtg-ccgaj/packages/data/x.json`,
    ],
    [
      'a worktrees root inside an account pool slot',
      `${HOME}mtg-worktrees/mtg-worker-slots/mtg-worker-a3-2-worktrees/mtg-6cbd4l.2/packages/data/x.json`,
    ],
    [
      'an account pool slot root',
      `${HOME}mtg-worktrees/mtg-worker-slots/mtg-worker-a3-2/packages/data/x.json`,
    ],
    [
      'a dotted bead in an account pool slot root',
      `${HOME}mtg-worktrees/mtg-worker-slots/mtg-worker-a3-1-j4ucd.4/packages/data/x.json`,
    ],
  ])('%s becomes the placeholder checkout', (_name, input) => {
    expect(substitute(`"root": "${input}"`)).toBe('"root": "/path/to/mtg/packages/data/x.json"');
  });

  it('launders the canonical checkout the same way', () => {
    expect(substitute(`${HOME}projects/mtg/packages/x`)).toBe('/path/to/mtg/packages/x');
  });

  it.each([
    `${HOME}.local/state/mtg-forge-run.lock`,
    `${HOME}mtg-worktrees/mtg-worker-slots/`,
    `${HOME}mtg-worktrees/mtg-worker-slots/notes.txt`,
    `${HOME}mtg-worktrees/scratch/mtg-worker-1-abc/x`,
  ])('leaves %s untouched so the path markers still report it', (input) => {
    expect(substitute(input)).toBe(input);
    expect(scanText('f.txt', substitute(input), HOME_MARKERS)).not.toEqual([]);
  });
});
