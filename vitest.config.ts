import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
import { testWorkerCount } from './packages/slice/tools/test-load/workers';

/**
 * Single root config so packages need no vitest config of their own.
 *
 * The `balance` project is the format-health gate (`npm run test:balance`):
 * seeded mass-simulation assertions that live in packages/metrics. It is
 * excluded from the default `unit` project because a full run is minutes,
 * not seconds.
 *
 * The `browser` project **names a set of files that were already running**
 * rather than adding one. A `*.browser.test.ts` matches the `unit` include, so
 * the real-Chrome rigs under `packages/ui/test/play` and the phone-scroll rig
 * in `packages/slice/test` have run under `unit` since the first of them
 * landed, and naming them buys three things a glob inside another project
 * cannot. A run can ask for exactly them (`--project browser`), which is what
 * an agent verifying a play-surface change runs and what AGENTS.md points at. A
 * run can ask for exactly not them, which is the local loop on a checkout with
 * no browser binary, where every one of them skips. And the set is enumerable,
 * so a machine without the binary reports an empty project instead of green
 * checks that measured nothing — `packages/ui/test/support/chrome.ts` is where
 * `MTG_REQUIRE_BROWSER=1` turns that skip into a failure for CI.
 *
 * **It stays inside the default run, and the measurement is the argument.** Six
 * files and ten tests, 5.7 to 7.0s of wall clock alone on a box already
 * carrying a 1-minute load of 7 to 13 on 16 cores. Over the same file set,
 * three interleaved pairs on a box decaying from load 54 to 25 ran 32.3 / 28.3
 * / 20.6s without the project and 33.5 / 26.8 / 26.2s with it: a marginal cost
 * of about a second, smaller than the noise the contention itself puts on
 * either arm. A project that CI runs and a local run skips would buy that
 * second and cost the reason the split exists, which is that a person changing
 * the play surface runs these before they say it works.
 *
 * It sits **before** `balance` in this list on purpose. The gate in
 * `packages/slice/test/test-load.test.ts` reads this file as text and requires
 * every clock named in it to sit after `name: 'balance'`, so an entry placed
 * after that one could quietly raise a budget the gate was built to refuse.
 * Browser tests state their own at the call site, as every other slow test here
 * does; the slowest is 5.4s against the 30s it asks for, and it reached that 30s
 * once in five runs at load 25 to 54, which is the load these agents put on the
 * box rather than anything CI will see.
 *
 * The projects deliberately still run concurrently under a bare
 * `vitest run`. Vitest can serialize them (`sequence.groupOrder`), and
 * that was weighed and rejected under mtg-bc2.55 — it would add the unit
 * project's ~15s to every full run and to CI while leaving the real fragility
 * untouched, since a unit test already competes with 139 sibling files whatever
 * balance is doing. What running them together used to cost is measured under
 * mtg-czt and is now paid on the other side of the seam: every sim pool sized
 * itself to `availableParallelism()`, four of them were live at once during one
 * `npm test`, and the run held over a hundred runnable threads of its own on
 * 16 cores.
 * `packages/sim/src/pool-size.ts` narrows a pool that is itself running inside
 * a test worker and leaves every other caller at the full machine. The
 * remaining cost lands on the individual CPU-bound tests,
 * and each pays it at its own call site: packages/setgen, packages/sim,
 * packages/slice, packages/cube, `packages/ui/test/play/play.test.ts` and
 * `packages/ui/test/replay/viewer.test.ts` all state a budget where the cost is
 * paid, some per test and some over a whole describe. Nothing here raises the
 * default, and a test in play.test.ts fails if anyone does.
 *
 * That is a fix for tests that are slow *by nature*, not armor against
 * arbitrary load. Measured under mtg-bc2.107: 24 CPU hogs against 16 cores
 * triples the wall clock and fails nothing, while 48 pushes tests that take
 * 91ms on a quiet box past 5s. Past roughly 2x oversubscription the answer is
 * to stop running four suites at once, not to keep raising numbers.
 *
 * Which leaves the half of the problem that no budget fixes: when a wave does
 * push a test past its clock, the red lands on whoever happened to be running,
 * and they pay a round of work proving their diff is innocent. `reporters`
 * below adds `tools/test-load/reporter.ts`, which prints the machine's load and
 * this process's own scheduling lateness beside every timeout, so the reader
 * classifies it at a glance instead of by re-running. It reports and never
 * decides: no budget moves, nothing is retried, the exit code is unchanged.
 *
 * There is one load failure a budget cannot reach at all, because the clock
 * that runs out is not a test's. Vitest's worker gives the collating process 60
 * seconds to answer each birpc call and that deadline is compiled into the
 * installed dist with no config option pointing at it, so a starved collator
 * turns into `[vitest-worker]: Timeout calling "onTaskUpdate"`, an unhandled
 * error, and an exit code of 1 on a run whose every assertion passed. That is
 * mtg-c9bc, recorded three times on the balance gate, whose single cases run
 * 200 to 400 seconds. `tools/test-load/rpc-timeout.ts` is the second reporter
 * below: it names that failure on stdout and clears the exit code when, and
 * only when, the run can prove no result went missing with it. It can turn a 1
 * into a 0 and never the reverse, and its docblock has the six conditions.
 */

/**
 * Cross-package imports must resolve to the sources in THIS checkout.
 *
 * A git worktree has no `node_modules` of its own, so a bare `@mtg/*` specifier
 * walks up out of the worktree and lands on the main checkout's
 * `node_modules/@mtg` symlinks, which point at the main checkout's packages. A
 * test in `packages/A` that imports `@mtg/B` then exercises main's copy of B
 * rather than the worktree's, and passes without ever running the change under
 * test. Tests inside their own package escape via Node self-reference, which is
 * what makes the failure quiet rather than obvious.
 *
 * This alias has to be repeated on every project rather than declared once at
 * the root: vitest does not propagate a root-level `resolve` into the entries
 * of `test.projects`, so a root-only alias silently applies to nothing. It is
 * also what lets a package be imported before `npm install` has linked it —
 * `@mtg/decklab` and the art pipeline have no symlink in the current install.
 *
 * `@mtg/sim/bot` is named before the general rule because it is a module rather
 * than a package: the catch-all would send it to a `packages/sim/bot/src/`
 * directory that does not exist, and every suite that transitively imports the
 * lab's play surface would fail to collect. The subpath exists so the browser
 * takes the tier-1 bot without the `@mtg/sim` barrel, which reaches
 * `node:worker_threads` and `node:fs`; `packages/ui/vite.config.ts` carries the
 * same pair in the same order for the same reason.
 */
const resolveLocalPackages = {
  alias: [
    {
      find: /^@mtg\/sim\/bot$/,
      replacement: new URL('./packages/sim/src/greedy-bot.ts', import.meta.url).pathname,
    },
    {
      find: /^@mtg\/(.*)$/,
      replacement: new URL('./packages/$1/src/index.ts', import.meta.url).pathname,
    },
  ],
};

/**
 * Where the load-attribution reporter lives, as one string so the config and
 * `packages/slice/test/test-load-reporter.test.ts` cannot disagree about it.
 *
 * It sits under `packages/` rather than beside this file because a repo-root
 * directory is outside `eslint packages`, outside the prettier glob and outside
 * the root tsconfig's `include` — three gates a diagnostic would escape, which
 * is the last thing a diagnostic should do.
 */
export const TEST_LOAD_REPORTER = './packages/slice/tools/test-load/reporter.ts';

/**
 * Where the reporting-channel verdict lives, named here for the same reason.
 *
 * It is a second reporter rather than more of the first because the two make
 * different kinds of claim, and the first one's whole contract is that it makes
 * none: `reporter.ts` reports and never decides. This one decides, and it
 * decides exactly one thing — whether a birpc transport timeout, which is the
 * two processes losing each other rather than a test failing, is allowed to be
 * the exit code of a run whose every assertion passed. `rpc-timeout.ts` has the
 * mechanism, the six conditions and why the excuse is narrow.
 */
export const RPC_TIMEOUT_REPORTER = './packages/slice/tools/test-load/rpc-timeout.ts';

/**
 * Which files are the browser project, as one string for the same reason the
 * reporter path is one: it is named twice, once to include and once to exclude,
 * and two globs that must agree are two globs that will not.
 * `packages/ui/test/browser-project.test.ts` imports it and checks it against
 * every `*.browser.test.ts` on disk, so a rig written outside its reach is a
 * failure rather than a file nobody runs.
 */
export const BROWSER_TESTS = 'packages/*/test/**/*.browser.test.ts';

/**
 * Capped at half the machine, which the loaded measurements in `workers.ts`
 * found faster than twelve or fifteen workers. `maxWorkers` rather than
 * `poolOptions`, so `--maxWorkers` on the command line still wins.
 *
 * This does not replace the worker-heartbeat fix `mtg-bj9c` required. That test
 * blocked its worker's event loop for 40-odd seconds and now yields a macrotask
 * turn per card. The cap addresses queueing between workers; the yield addresses
 * one worker starving its reporting channel. Neither weakens a test budget.
 *
 * **A fixed cap was tried once before and reverted**, and the reason it was
 * reverted was that it shortened every run on every machine, the blocking
 * balance gate included, to work around one test. That objection is answered
 * rather than forgotten: the arm this cap picks was the *fastest* arm measured,
 * not merely the calmest one, so on this box the cap does not buy safety with
 * wall clock. It is answered only where it was measured. On a genuinely quiet
 * sixteen-core box, or on a machine with a different core count, half the cores
 * could still be the slower arm, and nothing here re-measures that; a run that
 * wants the old behavior sets `MTG_TEST_WORKERS`.
 *
 * The comparison's own limit, stated because a table reads more certain than it
 * is: all six arms ran on a box carrying other lanes, and the external load was
 * not held still. Two runs at the same eight workers peaked at 46.9 and 20.9,
 * so the gap between 151s and 120s is not measured against a fixed background.
 * What the arms do agree on, and what actually decides this, is the zero column:
 * every arm produced zero timeout failures, including the one that ran at 46.9
 * on sixteen cores.
 *
 * The quieter win is that the pool size no longer reads `loadavg()`. A config
 * that sizes itself from the machine's instantaneous state makes the run's
 * shape, and eventually some test's verdict, a fact about the hard drive rather
 * than about the tree. This repo has that rule written down elsewhere for
 * `verify:art`; the same rule applies here, and a fixed share obeys it.
 */
const MAX_WORKERS = testWorkerCount({
  cores: availableParallelism(),
  override: process.env.MTG_TEST_WORKERS,
});

export default defineConfig({
  test: {
    maxWorkers: MAX_WORKERS,
    // Last, so the attribution block lands under vitest's own summary, where
    // the reader is already looking when something is red, and the verdict on
    // the exit code lands under that, because it is the last question a reader
    // of a red run has.
    reporters: ['default', TEST_LOAD_REPORTER, RPC_TIMEOUT_REPORTER],
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['packages/metrics/test/balance/**', BROWSER_TESTS],
        },
        resolve: resolveLocalPackages,
      },
      {
        test: {
          name: 'browser',
          include: [BROWSER_TESTS],
        },
        resolve: resolveLocalPackages,
      },
      {
        test: {
          name: 'balance',
          include: ['packages/metrics/test/balance/**/*.test.ts'],
          testTimeout: 600_000,
          hookTimeout: 600_000,
        },
        resolve: resolveLocalPackages,
      },
    ],
  },
  resolve: resolveLocalPackages,
});
