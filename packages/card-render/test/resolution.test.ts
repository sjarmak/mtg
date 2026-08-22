/**
 * Every vitest project must alias `@mtg/*` to this checkout's sources.
 *
 * A git worktree has no `node_modules`, so a bare `@mtg/*` specifier walks up
 * out of the worktree and resolves against the main checkout's
 * `node_modules/@mtg` symlinks. A test in one package that imports another then
 * runs the main checkout's copy and passes without executing the change under
 * test — the failure is silent, which is what makes it dangerous (mtg-bc2.57).
 *
 * The alias is what prevents that, and vitest does NOT propagate a root-level
 * `resolve` into `test.projects`: a root-only alias applies to nothing. So the
 * regression this guards is specific and easy to reintroduce — adding a project
 * and forgetting its `resolve`, or "tidying" the repeated alias back up to the
 * root. This package is the natural home for the check because its tests import
 * both `@mtg/ui` and `@mtg/dsl`, so it is the first place the bug would bite.
 *
 * Verified by probe rather than by reading: with the alias absent, a test here
 * importing a deliberately-throwing `@mtg/ui` from a worktree passed 25/25
 * against the main checkout's copy; with it present, the same test failed on the
 * worktree's copy.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CONFIG_URL = new URL('../../../vitest.config.ts', import.meta.url);

describe('vitest package resolution', () => {
  const source = readFileSync(CONFIG_URL, 'utf8');

  it('gives every project a resolve alias, not just the root', () => {
    // `test:` blocks that carry a project `name:` are the project entries. The
    // match is anchored to a whole line so that the config's own prose does not
    // count as a project: a docblock there names `name: 'balance'` in passing,
    // and the loose pattern this replaced read that sentence as a fourth project
    // and failed for a comment.
    const projectCount = source.match(/^\s+name: '[^']+',$/gm)?.length ?? 0;
    expect(projectCount).toBeGreaterThan(0);

    // One alias per project, plus the root declaration.
    const aliasCount = source.match(/resolve:\s*resolveLocalPackages/g)?.length ?? 0;
    expect(aliasCount).toBe(projectCount + 1);
  });

  it('points the alias at package sources in the checkout that runs it', () => {
    // `import.meta.url` and not a hardcoded root: in a worktree the config must
    // resolve to that worktree's packages, which is the whole fix.
    expect(source).toContain("new URL('./packages/$1/src/index.ts', import.meta.url)");
  });
});
