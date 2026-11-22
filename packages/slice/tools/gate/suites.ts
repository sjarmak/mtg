/**
 * Which projects a lane runs, and which wait for the merge.
 *
 * `mtg-wq3q8` scope item (3), ruled by the playtester 2026-09-17 after the box was
 * measured rather than guessed at. The question she asked was why this machine
 * cannot carry several lanes when she runs many more Claude and Codex sessions
 * than this on it, and the measurement answered it: six live agent sessions
 * cost 0.2 cores between them, `gc` costs 2.9, and one full test run costs 8.6
 * across ~88 OS threads. A single lane's suite saturates sixteen cores on its
 * own, and `mol-scoped-work` orders that suite twice per lane.
 *
 * The two projects cut out are not unit tests at all:
 *
 * - `balance` plays thousands of seeded games through the kernel and reads a
 *   format's health off the win rates. `vitest.config.ts` gives it a 600s
 *   per-test budget because it needs one.
 * - `calibration` is the two-seed, twenty-policy Legacy Cube pipeline, which
 *   that config's own docblock records as exceeding its budget whenever it
 *   competes with the balance simulations.
 *
 * Both answer *is the game still balanced*, which is a question about what is
 * being merged. A lane's intermediate commit is not being merged, so running
 * them at every preflight and every review buys nothing a single pre-merge run
 * does not. So they leave the per-lane path and become the merge gate:
 * `npm run gate:merge`.
 *
 * **What that saves is a worker, and the first draft of this docblock claimed a
 * large time saving instead.** The 2,655 unit files dominate; `balance` is one
 * *long* job rather than a large one, holding one of eight vitest workers for
 * its ~1800s, so cutting it returns an eighth of this box's test parallelism.
 * That is the load-independent fact and the reason to keep the split.
 *
 * No percentage in this file is trustworthy, because none of it was measured
 * under controlled load: two lane runs on 2026-09-17 gave 1734.76s (peak
 * one-minute load 51.8) and 1402.97s on a lighter box, against ~1943s for the
 * full suite at unrecorded load. That spans ~11% to ~28%, and the spread is
 * contention rather than the change. The argument above carries it; the cost
 * claim was wrong and is not load-bearing.
 *
 * **This weakens a gate, which is why it was the playtester's call and not this
 * seat's.** Balance-as-a-CI-assertion is a project conviction (`CLAUDE.md`,
 * "Balance is a CI assertion, not a vibe"), and moving it later means a change
 * that breaks format health is caught before the merge instead of at the first
 * lane step that touches it. What is kept is the property that matters: nothing
 * merges without a green balance run over the merged content.
 *
 * ## The lane's project list is derived, never typed
 *
 * The obvious spelling is `--project '!balance' --project '!calibration'`, and
 * it is wrong. vitest ORs its project filters, so a project is selected when it
 * matches *any* of them: `balance` matches `!calibration`, `calibration`
 * matches `!balance`, and the pair excludes nothing at all. Measured against a
 * four-project config on 2026-09-17 — one negation drops one project, two
 * negations run all four, and so do `!a,!b` and `!{a,b}`. A lane would have
 * silently gone on paying for the simulations while its command said otherwise,
 * which is the failure this file exists to prevent, spelled in the mechanism
 * meant to prevent it.
 *
 * So the lane names its projects positively — and reads them out of
 * `vitest.config.ts` rather than repeating them. A typed accept-list would be a
 * second copy of the project roster, and the day somebody adds a project it
 * would run in no lane and nothing would say so; that is the same class of
 * defect `vitest.config.ts` calls out one screen above `BROWSER_TESTS` ("two
 * globs that must agree are two globs that will not"). Derived, a new project is
 * in the lane path the moment it exists, and the only names written down here
 * are the two being removed.
 *
 * A name written down here that no longer exists is loud in both directions: the
 * complement quietly stays correct for the lane, but `npm run gate:merge` would
 * pass a filter matching nothing, and vitest answers that with
 * `No projects matched the filter` and exit 1 rather than an empty green run.
 * `packages/slice/test/gate.test.ts` fails on it earlier still.
 */
import config from '../../../../vitest.config';

/**
 * The projects that leave the per-lane path and run once before the merge.
 *
 * Every name here must be a project in `vitest.config.ts`; the gate test
 * enforces it, because a stale name measures nothing.
 */
export const MERGE_ONLY_PROJECTS: readonly string[] = ['balance', 'calibration'];

/** As much of a vitest project as this file reads: its name. */
interface NamedProject {
  readonly test: { readonly name: string };
}

/**
 * Every project name in `vitest.config.ts`, in the order the config lists them.
 *
 * This is the one place that knows the config is the roster's source. It refuses
 * an unreadable shape rather than returning an empty list, because an empty list
 * makes the complement empty, and a `vitest run` with no `--project` at all runs
 * everything — the exact outcome this file is here to prevent, arrived at by
 * silence.
 */
export function projectRoster(): readonly string[] {
  const shape = config as { readonly test?: { readonly projects?: readonly NamedProject[] } };
  const projects = shape.test?.projects;
  if (projects === undefined || projects.length === 0) {
    throw new Error(
      'gate: vitest.config.ts declares no projects, so the lane suite cannot be derived. ' +
        'Running every project instead would put the balance simulations back in every lane silently.',
    );
  }
  return projects.map((project) => project.test.name);
}

/** The roster minus the merge-only projects, in the config's own order. */
export function laneProjects(roster: readonly string[]): readonly string[] {
  const lane = roster.filter((name) => !MERGE_ONLY_PROJECTS.includes(name));
  if (lane.length === 0) {
    throw new Error(
      `gate: every project in vitest.config.ts (${roster.join(', ')}) is marked merge-only, ` +
        'so a lane would run no tests at all.',
    );
  }
  return lane;
}

/** `npx vitest run` naming each project a lane runs. */
export function laneTestCommand(roster: readonly string[] = projectRoster()): readonly string[] {
  return ['npx', 'vitest', 'run', ...laneProjects(roster).flatMap((name) => ['--project', name])];
}

/** `npx vitest run` restricted to exactly the projects a lane skipped. */
export function mergeTestCommand(): readonly string[] {
  return ['npx', 'vitest', 'run', ...MERGE_ONLY_PROJECTS.flatMap((name) => ['--project', name])];
}

/**
 * The text of the suite a stored verdict stands for.
 *
 * It is part of the memo's identity, so a verdict measured before the split can
 * never be read as one measured after it. That is not a nicety: the old text
 * included the balance simulations, and a lane reading it would inherit a claim
 * about games nobody played in this configuration. Because the command is
 * derived, adding a project also changes this text, and the memo separates on
 * its own rather than on somebody remembering to bump a version.
 */
export function laneSuiteText(roster: readonly string[] = projectRoster()): string {
  return `npm run typecheck && ${laneTestCommand(roster).join(' ')}`;
}
