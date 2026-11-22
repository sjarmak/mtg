/**
 * Finds the pinned Forge artifact from either a checkout or one of its worktrees.
 *
 * Gitignored artifacts do not follow a branch into a linked worktree. The Forge
 * distribution therefore usually exists under the primary checkout even when
 * `npm run play` is launched from an isolated UI lane. Git's common directory
 * is the stable bridge between those checkouts; no repository state is changed.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const FORGE_JAR = /^forge-gui-desktop-.+-jar-with-dependencies\.jar$/u;

export interface ForgeHomeSearch {
  readonly repoRoot: string;
  /** An explicit operator override. Missing explicit paths remain explicit. */
  readonly explicit?: string;
  /** Absolute common Git directory, injected in tests and discovered in use. */
  readonly commonGitDir?: string | null;
  /** Test seam for recognizing a complete-enough distribution directory. */
  readonly containsForgeJar?: (home: string) => boolean;
}

function hasForgeJar(home: string): boolean {
  try {
    return readdirSync(home).some((entry) => FORGE_JAR.test(entry));
  } catch {
    return false;
  }
}

/**
 * Selects the artifact directory without guessing outside this repository.
 *
 * The explicit path wins even when it is bad so the existing backend locator
 * can report that exact operator error. Automatic candidates, by contrast,
 * must contain the pinned distribution jar before they are selected.
 */
export function forgeHomeForLauncher(search: ForgeHomeSearch): string | undefined {
  if (search.explicit !== undefined && search.explicit.trim().length > 0) {
    return resolve(search.explicit);
  }
  const contains = search.containsForgeJar ?? hasForgeJar;
  const local = join(resolve(search.repoRoot), 'tools', 'forge', 'dist');
  if (contains(local)) return local;
  if (search.commonGitDir === undefined || search.commonGitDir === null) return undefined;
  const shared = join(dirname(resolve(search.commonGitDir)), 'tools', 'forge', 'dist');
  if (shared !== local && contains(shared)) return shared;
  return undefined;
}

/** Read-only discovery used by the play launcher. */
export function discoverForgeHome(repoRoot: string): string | undefined {
  let commonGitDir: string | null = null;
  try {
    commonGitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // A source archive has no common checkout to search; the local candidate
    // and explicit override remain valid there.
  }
  return forgeHomeForLauncher({
    repoRoot,
    ...(process.env['FORGE_HOME'] === undefined ? {} : { explicit: process.env['FORGE_HOME'] }),
    commonGitDir,
  });
}
