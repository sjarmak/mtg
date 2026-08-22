/**
 * The config that runs `generate-live.ts` and nothing else.
 *
 * Separate from the root `vitest.config.ts` on purpose. A live run reaches a
 * model and spends quota, so it must not be reachable from `npm test`, and the
 * root config's projects are what `npm test` runs. Adding a third project there
 * would put a live run one flag away from CI.
 *
 * It sits under `tools/` rather than at the package root for two reasons:
 * `AGENTS.md` says packages carry no vitest config of their own, which is about
 * the suite and stays true, and `tsconfig.json` includes
 * `packages/<pkg>/tools/**`, so this file is typechecked where a new root-level
 * `*.config.ts` would not be. That gap is the one `AGENTS.md` warns about, and
 * it is worth not widening for a file that exists to spend money.
 *
 * The alias below is copied from the root config rather than shared, for the
 * reason that config states at length: vitest does not propagate a root-level
 * `resolve` into `test.projects`, and a `@mtg/*` specifier that walks out of a
 * worktree lands on the main checkout's sources. A live run reads the tree it
 * was pointed at or it is measuring the wrong thing.
 */
import { defineConfig } from 'vitest/config';

const repoRoot = new URL('../../../', import.meta.url);

export default defineConfig({
  root: repoRoot.pathname,
  test: {
    name: 'live',
    include: ['packages/setgen/tools/generate-live.ts'],
    // One file, one call, and the call is a chain of model round trips. Running
    // it in a worker pool buys nothing and hides the output.
    fileParallelism: false,
  },
  resolve: {
    alias: [
      {
        find: /^@mtg\/(.*)$/,
        replacement: new URL('packages/$1/src/index.ts', repoRoot).pathname,
      },
    ],
  },
});
