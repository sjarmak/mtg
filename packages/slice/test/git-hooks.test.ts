/**
 * The pre-push guard survives a fresh clone.
 *
 * mtg-yved2: worker slot branches were once pointed at the public export
 * remote, and the fix that caught it — `.git/hooks/pre-push` refusing any push
 * to `public` or a `sjarmak/mtg` URL — lived only hand-installed in one clone's
 * `.git/hooks/`, which is never versioned. A fresh clone had no guard at all.
 * The tracked copy under `git-hooks/` and the drift check below are what make
 * "the guard exists" a checked fact rather than a memory of having typed it
 * once, the same shape as `workspace-roster.test.ts` for the package list.
 *
 * This never runs a real `git push`. The second `describe` block invokes the
 * hook script directly as a subprocess with the arguments a pre-push hook
 * receives (remote name, remote URL) and asserts its exit code and message;
 * it never touches a remote.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  HookConflictError,
  installHook,
  resolveHooksDir,
  trackedHookContent,
  trackedHookPath,
} from '../tools/git-hooks/install';

const INSTALL_COMMAND = 'npm run git-hooks:install';
const SOMEONE_ELSES_HOOK = "#!/usr/bin/env bash\necho 'someone else installed this hook'\n";

describe('the installed pre-push guard', () => {
  it('exists and matches the tracked hook, or names the install command', () => {
    const installedPath = join(resolveHooksDir(), 'pre-push');
    expect(
      existsSync(installedPath),
      `no pre-push hook at ${installedPath}; run \`${INSTALL_COMMAND}\``,
    ).toBe(true);
    const installed = readFileSync(installedPath, 'utf8');
    expect(
      installed,
      `${installedPath} has drifted from the tracked copy at ${trackedHookPath()}; run \`${INSTALL_COMMAND} -- --force\` to resync it`,
    ).toBe(trackedHookContent());
  });
});

describe('installHook', () => {
  const dirs: string[] = [];
  function tmpHooksDir(): string {
    const made = mkdtempSync(join(tmpdir(), 'git-hooks-install-'));
    dirs.push(made);
    return made;
  }
  afterAll(() => {
    for (const made of dirs) rmSync(made, { recursive: true, force: true });
  });

  it('installs the tracked hook into an empty hooks directory', () => {
    const hooksDir = tmpHooksDir();
    const result = installHook({ hooksDir });
    expect(result.action).toBe('installed');
    expect(readFileSync(result.hookPath, 'utf8')).toBe(trackedHookContent());
  });

  it('is a no-op when the installed hook already matches', () => {
    const hooksDir = tmpHooksDir();
    installHook({ hooksDir });
    const second = installHook({ hooksDir });
    expect(second.action).toBe('unchanged');
  });

  it('refuses to silently replace a different existing hook', () => {
    const hooksDir = tmpHooksDir();
    const target = join(hooksDir, 'pre-push');
    writeFileSync(target, SOMEONE_ELSES_HOOK, 'utf8');
    expect(() => installHook({ hooksDir })).toThrow(HookConflictError);
    expect(readFileSync(target, 'utf8')).toBe(SOMEONE_ELSES_HOOK);
  });

  it('replaces a different existing hook when forced', () => {
    const hooksDir = tmpHooksDir();
    const target = join(hooksDir, 'pre-push');
    writeFileSync(target, SOMEONE_ELSES_HOOK, 'utf8');
    const result = installHook({ hooksDir, force: true });
    expect(result.action).toBe('replaced');
    expect(readFileSync(target, 'utf8')).toBe(trackedHookContent());
  });
});

describe('the pre-push guard script itself', () => {
  function runHook(
    remoteName: string,
    remoteUrl: string,
    extraEnv: Readonly<Record<string, string>> = {},
  ): { status: number; stderr: string } {
    const { GC_MTG_PUBLIC_EXPORT: _drop, ...base } = process.env;
    try {
      execFileSync('bash', [trackedHookPath(), remoteName, remoteUrl], {
        // A real pre-push hook receives ref lines on stdin; this script reads
        // none of them, but a line is supplied anyway so the subprocess sees
        // the same shape git would give it.
        input: 'refs/heads/work/test abc123 refs/heads/work/test def456\n',
        encoding: 'utf8',
        env: { ...base, ...extraEnv },
      });
      return { status: 0, stderr: '' };
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      return { status: failure.status ?? 1, stderr: failure.stderr ?? '' };
    }
  }

  it('refuses a push by remote name "public", whatever the URL', () => {
    const result = runHook('public', 'https://github.com/sjarmak/mtg-lab.git');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pre-push REFUSED');
  });

  it('refuses a sjarmak/mtg URL even under a different remote name', () => {
    const result = runHook('origin', 'https://github.com/sjarmak/mtg.git');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pre-push REFUSED');
  });

  it('passes the refused case when GC_MTG_PUBLIC_EXPORT=1 is set', () => {
    const result = runHook('public', 'https://github.com/sjarmak/mtg.git', { GC_MTG_PUBLIC_EXPORT: '1' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('permits origin and the mtg-lab URL', () => {
    const result = runHook('origin', 'https://github.com/sjarmak/mtg-lab.git');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
