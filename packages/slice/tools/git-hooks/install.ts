/**
 * Installs the tracked pre-push guard into this clone's real hooks directory.
 *
 * ```
 * npm run git-hooks:install
 * npm run git-hooks:install -- --force
 * ```
 *
 * Every worker worktree shares one `.git` with the rig root
 * (`/path/to/mtg/.git`), and `git rev-parse --git-dir` from inside a
 * worktree answers a per-worktree directory whose `hooks/` git never reads for
 * a push. `--git-common-dir` answers the one hooks directory that actually
 * fires, from any worktree. mtg-yved2: a hand-installed copy at that path
 * already caught a private-tree push before it happened; this is what makes a
 * fresh clone start with the same guard instead of none.
 *
 * An existing hook that differs from the tracked copy is somebody's — it is
 * refused rather than silently replaced, and `--force` is the explicit
 * override for a hook the caller has already decided to discard.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_NAME = 'pre-push';
const TRACKED_HOOK_PATH = join(dirname(fileURLToPath(import.meta.url)), HOOK_NAME);

export function trackedHookPath(): string {
  return TRACKED_HOOK_PATH;
}

export function trackedHookContent(): string {
  return readFileSync(TRACKED_HOOK_PATH, 'utf8');
}

/** The hooks directory git actually reads for a push from this worktree. */
export function resolveHooksDir(cwd: string = process.cwd()): string {
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  return resolve(cwd, commonDir, 'hooks');
}

export class HookConflictError extends Error {}

export interface InstallOptions {
  readonly hooksDir: string;
  readonly force?: boolean;
}

export interface InstallResult {
  readonly hookPath: string;
  readonly action: 'installed' | 'replaced' | 'unchanged';
}

export function installHook(options: InstallOptions): InstallResult {
  const target = join(options.hooksDir, HOOK_NAME);
  const tracked = trackedHookContent();

  if (existsSync(target)) {
    const installed = readFileSync(target, 'utf8');
    if (installed === tracked) {
      return { hookPath: target, action: 'unchanged' };
    }
    if (options.force !== true) {
      throw new HookConflictError(
        `${target} already exists and differs from the tracked hook at ${TRACKED_HOOK_PATH}.\n` +
          'Re-run with --force to replace it, or resolve the difference by hand.\n' +
          `--- installed (${target}) ---\n${installed}\n` +
          `--- tracked (${TRACKED_HOOK_PATH}) ---\n${tracked}\n`,
      );
    }
    writeFileSync(target, tracked, 'utf8');
    chmodSync(target, 0o755);
    return { hookPath: target, action: 'replaced' };
  }

  mkdirSync(options.hooksDir, { recursive: true });
  writeFileSync(target, tracked, 'utf8');
  chmodSync(target, 0o755);
  return { hookPath: target, action: 'installed' };
}

function currentPushDefault(cwd: string): string | null {
  try {
    return execFileSync('git', ['config', '--get', 'remote.pushDefault'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function setPushDefaultOrigin(cwd: string = process.cwd()): 'set' | 'already-set' {
  if (currentPushDefault(cwd) === 'origin') return 'already-set';
  execFileSync('git', ['config', 'remote.pushDefault', 'origin'], { cwd });
  return 'set';
}

export function main(argv: readonly string[]): number {
  const force = argv.includes('--force');
  const hooksDir = resolveHooksDir();
  try {
    const result = installHook({ hooksDir, force });
    process.stdout.write(`pre-push hook ${result.action}: ${result.hookPath}\n`);
  } catch (error) {
    if (error instanceof HookConflictError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const pushDefault = setPushDefaultOrigin();
  process.stdout.write(
    pushDefault === 'set' ? 'remote.pushDefault set to origin\n' : 'remote.pushDefault was already origin\n',
  );
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
