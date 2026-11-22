/**
 * The refusal that keeps a rig's output out of the working tree.
 *
 * `mtg-6e0`: three PNGs named after viewport widths appeared at the repository
 * root during an overnight run, in the main tree while every lane runs in a
 * worktree of its own, and a `git add -A` nearly committed them.
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OutPathError, resolveOutDir } from '../../tools/out-path';

const ROOT = '/home/someone/projects/mtg';

describe('where a rig may write its frames', () => {
  it('takes out/ and anything under it, which is the directory the repository ignores whole', () => {
    expect(resolveOutDir(join(ROOT, 'out'), ROOT)).toBe(join(ROOT, 'out'));
    expect(resolveOutDir(join(ROOT, 'out', 'shots', 'phone'), ROOT)).toBe(
      join(ROOT, 'out', 'shots', 'phone'),
    );
  });

  it('takes a temporary directory, because a test driving a rig has nowhere else to put a frame', () => {
    const scratch = join(tmpdir(), 'mtg-shots-test');
    expect(resolveOutDir(scratch, ROOT)).toBe(scratch);
  });

  it('refuses the repository root, which is where the incident put three PNGs', () => {
    expect(() => resolveOutDir(ROOT, ROOT)).toThrow(OutPathError);
    expect(() => resolveOutDir(join(ROOT, '1024'), ROOT)).toThrow(/refusing to write/);
  });

  it('refuses a tracked directory inside the repository, not only the root', () => {
    expect(() => resolveOutDir(join(ROOT, 'packages', 'ui', 'public'), ROOT)).toThrow(OutPathError);
    expect(() => resolveOutDir(join(ROOT, 'docs', 'screenshots'), ROOT)).toThrow(OutPathError);
  });

  it('refuses a path that climbs out of out/, which a joined argument can do', () => {
    expect(() => resolveOutDir(join(ROOT, 'out', '..', 'shots'), ROOT)).toThrow(OutPathError);
  });

  it('names the path and the directory it should have been under', () => {
    expect(() => resolveOutDir(join(ROOT, '1440'), ROOT)).toThrow(
      new RegExp(`${join(ROOT, '1440')}.*${join(ROOT, 'out')}`),
    );
  });

  it('is what the shots rig resolves its --out through, before it starts a server', () => {
    const source = readFileSync(new URL('../../tools/shots.ts', import.meta.url), 'utf8');
    expect(source).toContain('resolveOutDir(args.out');
    expect(source.indexOf('resolveOutDir(args.out')).toBeLessThan(source.indexOf('await createServer('));
  });
});
