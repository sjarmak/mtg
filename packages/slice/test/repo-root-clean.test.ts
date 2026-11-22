/**
 * Nothing at the repository root is a picture nobody meant to write.
 *
 * `mtg-6e0`: an overnight run left three files named `1024`, `1280` and `1440`
 * at the root of the main working tree, each a PNG, each written by an ad-hoc
 * CDP call that took a viewport width for a path. They were untracked, they had
 * no extension and no directory, so no gitignore entry could have caught them,
 * and a `git add -A` nearly swept them into a merge commit.
 *
 * `packages/ui/tools/out-path.ts` is the half that stops a shipped rig from
 * doing it. This is the half that notices when something not shipped does: it
 * reads the untracked entries at the root and sniffs their first bytes, so a
 * file is judged by what it is rather than by what it is called. Only the root,
 * only depth one, and only image and document magic - a scratch note or a shell
 * script at the root is somebody working, and this has nothing to say about it.
 */
import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url).pathname;

/** File signatures a working tree's root has no reason to hold. */
const MAGIC: readonly { readonly name: string; readonly bytes: readonly number[] }[] = [
  { name: 'PNG', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'JPEG', bytes: [0xff, 0xd8, 0xff] },
  { name: 'GIF', bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46] },
  { name: 'WebP', bytes: [0x52, 0x49, 0x46, 0x46] },
];

function firstBytes(path: string): readonly number[] {
  const handle = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(8);
    const read = readSync(handle, buffer, 0, 8, 0);
    return [...buffer.subarray(0, read)];
  } finally {
    closeSync(handle);
  }
}

function looksBinary(path: string): string | null {
  const head = firstBytes(path);
  for (const { name, bytes } of MAGIC) {
    if (bytes.every((byte, index) => head[index] === byte)) return name;
  }
  return null;
}

/**
 * Untracked entries at the root itself, one path component each. `--directory`
 * folds an untracked directory into one line, so a tree holding thousands of
 * untracked files under `packages/` cannot overflow the pipe this reads from.
 */
function untrackedAtRoot(): readonly string[] {
  const listed = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--directory'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return listed
    .split('\n')
    .filter((line) => line.length > 0 && !line.includes('/'))
    .map((line) => line.replace(/^"|"$/g, ''));
}

describe('the repository root', () => {
  it('holds no untracked image or document, which is a rig that wrote where it was standing', () => {
    const strays = untrackedAtRoot().flatMap((name) => {
      const path = join(ROOT, name);
      if (!statSync(path).isFile()) return [];
      const kind = looksBinary(path);
      return kind === null ? [] : [`${name} (${kind})`];
    });
    expect(strays, 'a rig wrote into the working tree; see packages/ui/tools/out-path.ts').toEqual([]);
  });
});
