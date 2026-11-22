/**
 * Bind the complete shared probe-support tree, not just its importing wrappers.
 * Trusted local inputs: this detects ordinary edits, not adversarial file swaps.
 */
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function regularSources(path: string): Promise<readonly string[]> {
  const stat = await lstat(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) throw new Error(`Unsupported probe source: ${path}`);
  const children = await readdir(path);
  return (await Promise.all(children.map((name) => regularSources(join(path, name))))).flat();
}

export async function captureProbeSources(workspace: string, testFiles: readonly string[]) {
  const support = await regularSources(join(workspace, 'packages/forge-export/test/support'));
  const selected = (await Promise.all(testFiles.map(regularSources))).flat();
  return Promise.all(
    [...new Set([...support, ...selected])].sort().map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    })),
  );
}
