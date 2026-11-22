/**
 * Every relative path this workspace's prose points at is a file that exists.
 *
 * `mtg-ztgr` found thirty-three of them in `@mtg/render-spec` alone, all made
 * the same way: the face specification lived in `@mtg/ui` until `mtg-ey09` moved
 * it, the code moved and the docblocks did not, so a path written when the file
 * was one directory away resolved to somewhere that has never existed. It left a
 * check behind over that one package, and the same walk over the workspace found
 * 78 more — mostly in `@mtg/ui`, and off by one directory rather than wrong about
 * the file, because the author counted from the package root instead of from the
 * file. `mtg-uqp2` repointed those and moved the check here.
 *
 * A path that points at nothing is worse than no path, because a reader follows
 * it before disbelieving it, and none of the usual gates read a comment: not
 * tsc, not eslint, not prettier, not a test.
 *
 * It lives in `@mtg/slice` because this is where the workspace-wide structural
 * gates already are — `./workspace-roster.test.ts`, `./package-surfaces.test.ts`,
 * `./public-boundary.test.ts` — and because a check that walks every package
 * cannot sensibly belong to one of them. It reads the checkout it runs in rather
 * than a fixed root, so a worktree checks its own tree.
 *
 * Two spellings are correct after a move and the repair picks between them per
 * site: a file that came with the code is written relative, and a file in another
 * package is written the way `CLAUDE.md` writes one, naming the package —
 * `@mtg/ui`'s `styles/card.ts` — which this check leaves alone because it is not
 * a relative path any more. That is the point. The moment a reference crosses a
 * package boundary it should stop looking like a local one.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

/** A backticked path that starts `./` or `../` and ends in a file or a directory. */
const RELATIVE_PATH = /`((?:\.\.?\/)[^`\s]*)`/g;

/**
 * Prose that names a path on purpose that is not a file, with the reason.
 *
 * Two entries and both are the same shape: a docblock quoting a path a *bug*
 * produced. `mtg-tfot`'s rig lost its temp directory and chrome-headless-shell
 * created a profile at the four-letter string it was handed instead; the whole
 * point of the sentence is that the path was made and should not have been, so a
 * check that demanded it exist would be demanding the bug back.
 *
 * Keyed by file and path rather than by line, so an entry survives the prose
 * moving down a file, and narrow enough that a new dangling path in either file
 * still fails. A path holding a `${` is skipped by rule rather than listed here:
 * it is a template expression in running code, and what it resolves to is a
 * different string on every call.
 */
const DELIBERATE: readonly { readonly file: string; readonly path: string }[] = [
  { file: 'ui/test/browser-project.test.ts', path: './undefined/' },
  { file: 'ui/test/support/chrome-driver.ts', path: './undefined/' },
];

function sourceFiles(dir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(path);
  }
  return found;
}

/** Every `path` a file's prose names, with the line it was named on. */
function referencedPaths(file: string): readonly { readonly line: number; readonly path: string }[] {
  const found: { readonly line: number; readonly path: string }[] = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, index) => {
      for (const [, path = ''] of text.matchAll(RELATIVE_PATH)) {
        if (path.includes('${')) continue;
        if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('/')) {
          found.push({ line: index + 1, path });
        }
      }
    });
  return found;
}

function deliberate(file: string, path: string): boolean {
  return DELIBERATE.some((entry) => entry.file === file && entry.path === path);
}

/** Every file the walk reads, read once for both cases below. */
let walked: readonly string[] | null = null;
function packageSources(): readonly string[] {
  walked ??= sourceFiles(PACKAGES);
  return walked;
}

/**
 * Budgeted rather than left to vitest's 5s default, and measured rather than
 * guessed: the walk is a `readdir` and a `stat` of every directory under
 * `packages/` and a read of every `.ts` in it, about 1.1s warm and 13.5s cold on
 * a box carrying other lanes. Memoizing it here rather than at module scope is
 * `@mtg/slice`'s `test/bench.test.ts`'s reason: module evaluation happens during
 * collection, where no test budget applies at all.
 */
describe('the paths this workspace names', { timeout: 30_000 }, () => {
  it('walks every package, and reads real paths, so an empty walk cannot pass', () => {
    const files = packageSources();
    const named = files.flatMap((file) => referencedPaths(file).map((found) => found.path));

    // The roster is checked elsewhere; what matters here is that the walk
    // reaches more than one package and finds prose in them.
    const packages = new Set(files.map((file) => relative(PACKAGES, file).split('/')[0]));
    expect(packages.size).toBeGreaterThan(20);
    expect(named.length).toBeGreaterThan(200);
  });

  it('all resolve to a file that is there', () => {
    const dangling: string[] = [];
    for (const file of packageSources()) {
      const named = relative(PACKAGES, file);
      for (const { line, path } of referencedPaths(file)) {
        if (deliberate(named, path)) continue;
        if (existsSync(normalize(join(dirname(file), path)))) continue;
        dangling.push(`${named}:${String(line)} names ${path}, which is not there`);
      }
    }
    expect(
      dangling,
      'a relative path in a docblock points at nothing — either the file moved and the path did not, or the reference crossed into another package and should name it instead of counting directories',
    ).toEqual([]);
  });
});
