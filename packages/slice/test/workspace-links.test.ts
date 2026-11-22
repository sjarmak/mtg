/**
 * The install holds one `@mtg/*` link per package, and each points at a package
 * of the checkout that owns it.
 *
 * npm workspaces links `node_modules/@mtg/<name>` to `../../packages/<name>`,
 * and everything that resolves a bare specifier through node rather than
 * through a bundler alias depends on it: every `npx tsx packages/<pkg>/src/cli.ts`,
 * so `npm run slice`, `npm run play`, `npm run lab`, the art pipeline's governance check, and
 * `@mtg/cube` and `@mtg/decklab` and `@mtg/draft-export` on the command line.
 *
 * On 2026-08-27 at 06:27 an install run from inside
 * an isolated worktree repointed ten of the twenty-four
 * links in the MAIN checkout's `node_modules` at that worktree's packages, by
 * absolute path. For a day, a CLI run on `main` executed the
 * `codex/rtr-overload-integrate` branch's copy of the art pipeline, `@mtg/cube`,
 * `@mtg/decklab`, `@mtg/draft-export`, `@mtg/dsl-coverage`, `@mtg/engine`,
 * `@mtg/netplay`, `@mtg/raster`, `@mtg/referee` and `@mtg/card-geometry`, and
 * six of those ten differed from main. Nothing said so: `tsc` reads
 * `tsconfig.json`'s `paths`, vitest reads the alias in `vitest.config.ts`, and
 * both of those name `packages/` relative to their own file, so the two gates
 * that would notice are the two that cannot.
 *
 * The same run left the other half of the workspace as thirteen nested
 * self-links — `packages/dsl/dsl`, `packages/ui/ui` and eleven more, each
 * pointing at the worktree's package of that name. Those reach no resolver:
 * every glob in this repo spells the package level `packages/*`, which is one
 * segment and does not match `packages/dsl/dsl/src`. What they do reach is
 * anyone reading the tree — a `find` or a recursive grep under `packages/`
 * returns another branch's files as though they were main's, and says nothing
 * about where they came from. Both shapes are checked here because both came
 * from the one install, and a check for only the half that executes code would
 * have reported the tree clean while it still held the other half.
 *
 * ## What this asserts, and why it is not "the links are correct for me"
 *
 * A git worktree mostly does not have an install of its own. Counted on this
 * box on 2026-08-28: of 152 worktrees, 110 carry `node_modules` as a symlink to
 * the main checkout's, 40 carry a real directory (23 of those with an `@mtg`
 * scope in it), and 2 carry none. In the 110, a bare specifier reaches MAIN's
 * links and therefore MAIN's packages, which is the arrangement
 * `vitest.config.ts`'s alias exists to work around. So "resolves inside the
 * checkout the test file is in" is the wrong assertion: true on main, false in
 * 110 worktrees, for a state that is correct in all of them.
 *
 * What holds everywhere is the ownership rule: a link under `<dir>/node_modules`
 * resolves to a package under `<dir>`, where `<dir>` is read after resolving
 * `node_modules` itself. Main's links reaching main's packages satisfies it
 * whichever checkout is reading; the recorded failure violates it, because
 * main's links reached a worktree's packages.
 *
 * ## On checking untracked state
 *
 * The `bd` memory `a-gate-s-exit-code-must-be-a-function-of-tracked-state` says
 * a gate whose verdict depends on the hard drive is a fact about the hard
 * drive rather than about the tree. That is exactly what this is, and it is the
 * point: `node_modules` is the artifact under test, nothing else in the suite
 * looks at it, and the recorded failure was invisible precisely because every
 * other gate reads tracked state. The precedent it must not repeat is the
 * expense — `verify:art` walking a 4.2 GB gitignored directory by default. This
 * reads twenty-four symlinks and never opens a file.
 */
import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The `node_modules/@mtg` a bare specifier from this file would reach, and the
 * directory that owns it.
 *
 * Walked rather than computed from a fixed root, and the walk resolves
 * `node_modules` itself before naming an owner. Measured over the 152 worktrees
 * on this box: 110 of them have `node_modules` as a symlink to the main
 * checkout's, so the directory the walk stops at is not the directory whose
 * packages the links inside it point to. Reading the owner off the walk without
 * that resolution calls all 110 broken, which is the opposite of true. The 23
 * that hold a real `@mtg` scope of their own were checked at the same time and
 * every one of them is self-consistent.
 */
function installedScope(): { scope: string; owner: string } | null {
  let dir = dirname(new URL(import.meta.url).pathname);
  for (;;) {
    const modules = join(dir, 'node_modules');
    if (existsSync(join(modules, '@mtg'))) {
      const real = realpathSync(modules);
      return { scope: join(real, '@mtg'), owner: dirname(real) };
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

describe('the workspace install', () => {
  it('links every @mtg package to a package of the checkout that owns the install', () => {
    const found = installedScope();
    // Not a skip: vitest itself is resolved out of a node_modules, so a run
    // that got this far has one, and npm creates the @mtg scope in the same
    // install that creates vitest. An absent scope is a broken install, and
    // saying so beats passing on nothing.
    expect(found, 'no node_modules/@mtg above this file').not.toBeNull();
    if (found === null) return;

    const wrong: string[] = [];
    for (const name of readdirSync(found.scope).sort()) {
      const entry = join(found.scope, name);
      if (!lstatSync(entry).isSymbolicLink()) {
        // npm workspaces links; a real directory here is a stale copy that no
        // edit in packages/ will ever reach.
        wrong.push(`${name}: not a symlink (${entry})`);
        continue;
      }
      if (!existsSync(entry)) {
        // A link whose package is gone. `realpathSync` would throw here, and an
        // exception names the file rather than the repair.
        wrong.push(`${name}: ${readlinkSync(entry)} points at nothing`);
        continue;
      }
      const target = realpathSync(entry);
      const expected = resolve(found.owner, 'packages', name);
      if (target !== expected) {
        wrong.push(`${name}: ${readlinkSync(entry)} resolves to ${target}, not ${expected}`);
      }
    }

    expect(
      wrong,
      `Links out of ${found.owner}. Repair each with:\n` +
        `  ln -sfn ../../packages/<name> ${found.scope}/<name>\n` +
        wrong.map((line) => `  ${line}`).join('\n'),
    ).toEqual([]);
  });

  it('links every package of that checkout', () => {
    // The other direction, and the quiet one. A missing link puts nothing out
    // of place, so the assertion above passes over the links that are there and
    // so does every other gate: `tsc` reads `tsconfig.json`'s `paths`, vitest
    // and Vite read their own aliases, and `tsx` reads `paths` too, which is why
    // `npm run play` kept working. Only plain node resolution says anything, and
    // nothing in this suite uses it.
    //
    // Measured 2026-08-28: `@mtg/render-spec` was added to `packages/` at 08:54
    // and still had no link at 21:44. Nothing had gone wrong — npm creates the
    // links during an install, and installing in this tree is banned. So a new
    // package arrives unlinked by default, and this is the thing that says so.
    const found = installedScope();
    expect(found, 'no node_modules/@mtg above this file').not.toBeNull();
    if (found === null) return;

    const packages = join(found.owner, 'packages');
    const linked = new Set(readdirSync(found.scope));
    const missing = readdirSync(packages, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(packages, entry.name, 'package.json')))
      .map((entry) => entry.name)
      .filter((name) => !linked.has(name))
      .sort();

    expect(
      missing,
      `Workspace packages with no link in ${found.scope}. Create each with:\n` +
        missing.map((name) => `  ln -sfn ../../packages/${name} ${found.scope}/${name}`).join('\n'),
    ).toEqual([]);
  });

  it('leaves no symlink among the packages themselves', () => {
    // One level in from each package, which is where the thirteen appeared and
    // is twenty-four readdirs. Not a walk of the whole tree: `packages/ui/public`
    // holds staged art, and a gate that reads a gitignored directory in full is
    // the expense `a-gate-s-exit-code-must-be-a-function-of-tracked-state`
    // records. No symlink is tracked anywhere under `packages/`, so the rule is
    // that there is none, rather than that the ones present point somewhere.
    const packages = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
    const links: string[] = [];
    for (const pkg of readdirSync(packages, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      for (const entry of readdirSync(join(packages, pkg.name), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || !entry.isSymbolicLink()) continue;
        const path = join(packages, pkg.name, entry.name);
        links.push(`${path} -> ${readlinkSync(path)}`);
      }
    }

    expect(links, `Delete each of these; they are install debris, not sources:\n${links.join('\n')}`).toEqual(
      [],
    );
  });
});
