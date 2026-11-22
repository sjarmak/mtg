import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forgeHomeForLauncher } from '../../tools/forge-home';

describe('Forge discovery for the UI launcher', () => {
  it('keeps an explicit operator path authoritative', () => {
    expect(
      forgeHomeForLauncher({
        repoRoot: '/repo/worktree',
        explicit: './operator-forge',
        commonGitDir: '/repo/.git',
        containsForgeJar: () => true,
      }),
    ).toBe(resolve('./operator-forge'));
  });

  it('uses a complete worktree-local install before the shared checkout', () => {
    const local = join('/repo/worktree', 'tools', 'forge', 'dist');
    expect(
      forgeHomeForLauncher({
        repoRoot: '/repo/worktree',
        commonGitDir: '/repo/.git',
        containsForgeJar: (candidate) => candidate === local,
      }),
    ).toBe(local);
  });

  it('finds the primary checkout install from a linked worktree', () => {
    const shared = join('/repo', 'tools', 'forge', 'dist');
    expect(
      forgeHomeForLauncher({
        repoRoot: '/repo/linked-worktrees/ui',
        commonGitDir: '/repo/.git',
        containsForgeJar: (candidate) => candidate === shared,
      }),
    ).toBe(shared);
  });

  it('returns undefined when neither checkout has an installed distribution', () => {
    expect(
      forgeHomeForLauncher({
        repoRoot: '/repo/linked-worktrees/ui',
        commonGitDir: '/repo/.git',
        containsForgeJar: () => false,
      }),
    ).toBeUndefined();
  });
});
