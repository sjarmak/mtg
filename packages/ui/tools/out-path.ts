/**
 * Where a rig may write, and why the answer is not "wherever you said".
 *
 * `mtg-6e0`: an overnight measurement run left three PNGs named `1024`, `1280`
 * and `1440` at the repository root, in the main working tree while every lane
 * runs in a worktree of its own. A viewport width had been passed where a path
 * was meant, and a `git add -A` nearly swept them into a merge commit. The
 * names are the small half; the half worth a guard is that a lane wrote into
 * main at all.
 *
 * So a rig resolves its `--out` through here. Under `out/` is the answer for
 * every shipped rig, since that is the one directory the repository ignores
 * wholesale; a temporary directory is allowed as well, because a test that
 * drives a rig has nowhere else to put a frame. Anything else is refused by
 * name, before a server starts or a browser opens, which is the difference
 * between a typo that costs a message and a typo that costs a merge.
 */
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Refusal with the path in it, so the message names what to fix. */
export class OutPathError extends Error {}

/** True when `child` is `parent` itself or anything under it. */
function within(parent: string, child: string): boolean {
  const step = relative(parent, child);
  return step === '' || (!step.startsWith('..') && !isAbsolute(step));
}

/**
 * The absolute directory a rig may write into, or a refusal.
 *
 * `repoRoot` is passed rather than derived so a test can state one. Symlinks
 * are resolved on the roots and not on the requested path, which may not exist
 * yet: the caller creates it after this returns.
 */
export function resolveOutDir(requested: string, repoRoot: string): string {
  const out = resolve(requested);
  const allowed = [join(repoRoot, 'out'), tmpdir()].flatMap((root) => {
    // Both spellings of each root: `/tmp` is a symlink to `/private/tmp` on some
    // machines, and a caller who wrote the unresolved one is inside it.
    try {
      return [root, realpathSync(root)];
    } catch {
      return [root];
    }
  });
  for (const root of allowed) if (within(root, out)) return out;
  throw new OutPathError(
    `refusing to write to ${out}: a rig writes under ${join(repoRoot, 'out')} or a temporary directory. ` +
      `A path that is neither is usually a value passed where a path was meant.`,
  );
}
