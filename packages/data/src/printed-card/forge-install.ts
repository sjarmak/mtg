/** Readers over the installed Forge distribution under `tools/forge/dist`. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const forgeDist = fileURLToPath(new URL('../../../../tools/forge/dist/', import.meta.url));
export const FORGE_SCRIPT_ARCHIVE_PATH = join(forgeDist, 'res/cardsfolder/cardsfolder.zip');
export const FORGE_EDITIONS_PATH = join(forgeDist, 'res/editions');
export const FORGE_TOKEN_SCRIPTS_PATH = join(forgeDist, 'res/tokenscripts');

/** Unzips the archive once and returns every card script by its archive-relative path. */
export function readForgeScriptArchive(
  archive: string = FORGE_SCRIPT_ARCHIVE_PATH,
): ReadonlyMap<string, Uint8Array> {
  const root = mkdtempSync(join(tmpdir(), 'forge-script-archive-'));
  try {
    execFileSync('unzip', ['-q', archive, '-d', root], { timeout: 120_000 });
    const scripts = new Map<string, Uint8Array>();
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry.endsWith('.txt')) scripts.set(relative(root, path), readFileSync(path));
      }
    };
    walk(root);
    return scripts;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Every `res/editions/*.txt`, in file-name order. */
export function readForgeEditionTexts(directory: string = FORGE_EDITIONS_PATH): readonly string[] {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.txt'))
    .sort()
    .map((entry) => readFileSync(join(directory, entry), 'utf8'));
}
