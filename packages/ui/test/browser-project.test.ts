/**
 * The wiring under the browser rigs, which is the half that fails quietly.
 *
 * A layout assertion that never runs is worse than no layout assertion: the
 * suite is green, the count of tests went up, and nothing was measured. There
 * are two ways to arrive there and this file closes both.
 *
 * The first is a rig the runner never sees. `vitest.config.ts` gives the
 * `browser` project one glob, `BROWSER_TESTS`, and the same string is what the
 * `unit` project excludes; the checks below take that string, turn it into the
 * matcher it means, and hold it against every `*.browser.test.ts` on disk. A
 * rig written at `packages/ui/src/…` or under a second `tests/` directory
 * matches nothing, runs nowhere, and fails here instead.
 *
 * The second is a machine with no browser. `./support/chrome.ts` skips there on
 * purpose — a checkout with no browser cache is a normal checkout — but a skip
 * is indistinguishable from a pass in a CI summary, so `MTG_REQUIRE_BROWSER=1`
 * turns it into a failure and this file holds that switch to its behavior.
 *
 * It reads the root config the way `packages/slice/test/test-load.test.ts` does,
 * and for the same reason: the tempting edit is the one made in the config, not
 * in the test. It lives in `@mtg/ui` rather than beside that one because the
 * other thing it gates, the harness, is this package's.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BROWSER_TESTS } from '../../../vitest.config';
import { browserIt, browserMode, browserPresent, chromePath, missingBrowserMessage } from './support/chrome';

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * `public/` is four gigabytes of staged art on this machine and gitignored
 * everywhere, so the walk stops at it: a gate whose cost or verdict depends on
 * what an art run left behind is a fact about the hard drive rather than about
 * the repository. `node_modules` is skipped for the ordinary reason.
 */
const SKIP = new Set(['node_modules', 'public', 'dist', 'coverage']);

function browserTestFiles(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      found.push(...browserTestFiles(join(directory, entry.name)));
      continue;
    }
    if (entry.name.endsWith('.browser.test.ts')) {
      found.push(relative(WORKSPACE_ROOT, join(directory, entry.name)));
    }
  }
  return found;
}

/**
 * What the config's glob means, spelled as the matcher vitest would build:
 * `**` crosses directory boundaries and `*` does not. Derived from the exported
 * string rather than written out beside it, so a change to the glob changes
 * this matcher instead of leaving it agreeing with a shape nobody uses.
 */
function globToRegExp(glob: string): RegExp {
  // Split on the crossing wildcard first, so the segment rule below can stay
  // the simple one: inside a segment, `*` stops at a slash.
  const source = glob
    .split('/**/')
    .map((segment) => segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('/(?:[^/]+/)*');
  return new RegExp(`^${source}$`);
}

interface ProjectShape {
  readonly name?: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

async function projectsByName(): Promise<ReadonlyMap<string, ProjectShape>> {
  const loaded: unknown = (await import('../../../vitest.config')).default;
  const root = loaded as { readonly test?: { readonly projects?: readonly unknown[] } };
  const entries = root.test?.projects ?? [];
  const found = new Map<string, ProjectShape>();
  for (const entry of entries) {
    const project = (entry as { readonly test?: ProjectShape }).test;
    if (project?.name !== undefined) found.set(project.name, project);
  }
  return found;
}

describe('the browser project runs every browser rig and only those', () => {
  it('gives the browser project the glob, and takes the same one out of unit', async () => {
    const projects = await projectsByName();
    expect([...projects.keys()]).toEqual(['unit', 'browser', 'balance']);
    expect(projects.get('browser')?.include).toEqual([BROWSER_TESTS]);
    expect(projects.get('unit')?.exclude).toContain(BROWSER_TESTS);
    // Both halves matter: without the exclude the rigs run twice, once under
    // each project, and the browser cost doubles for no measurement.
    expect(projects.get('unit')?.include).toEqual(['packages/*/test/**/*.test.ts']);
  });

  it('reaches every browser rig in the workspace, and finds rigs to reach', () => {
    const matcher = globToRegExp(BROWSER_TESTS);
    const files = browserTestFiles(join(WORKSPACE_ROOT, 'packages'));
    // A count rather than a list: the assertion is that rigs exist, and pinning
    // which ones would fail the next one somebody writes.
    expect(files.length, 'no browser rig found at all').toBeGreaterThan(0);
    const unreachable = files.filter((file) => !matcher.test(file));
    expect(unreachable, `not matched by ${BROWSER_TESTS}`).toEqual([]);
  });

  it('excludes an ordinary unit test from the browser project, so the split is a split', () => {
    const matcher = globToRegExp(BROWSER_TESTS);
    expect(matcher.test('packages/ui/test/play/fit.test.ts')).toBe(false);
    expect(matcher.test('packages/ui/test/play/hand-allocation.browser.test.ts')).toBe(true);
    expect(matcher.test('packages/slice/test/ui-phone-scroll.browser.test.ts')).toBe(true);
    // The two shapes that would run nowhere: outside `test/`, and one directory
    // too high for the package glob.
    expect(matcher.test('packages/ui/src/routes/play/view.browser.test.ts')).toBe(false);
    expect(matcher.test('packages/ui/tests/view.browser.test.ts')).toBe(false);
  });
});

describe('a run that requires a browser cannot be told nothing', () => {
  it('wires the mode it computed into the `it` the rigs actually call', () => {
    // Not "this machine has a browser": a checkout without one is a normal
    // checkout and this file has to pass there too. What is asserted is that
    // the decision above and the export below are the same decision.
    if (browserPresent) expect(browserIt).toBe(it);
    else expect(browserIt).not.toBe(it);
  });

  it('skips without a browser, and fails without one when the run said it needed one', () => {
    expect(browserMode(false, undefined)).toBe('skip');
    expect(browserMode(false, '')).toBe('skip');
    expect(browserMode(false, '1')).toBe('require');
    // A present browser is never overridden into either: MTG_REQUIRE_BROWSER
    // demands a measurement, it does not ask for a second opinion about one.
    expect(browserMode(true, '1')).toBe('run');
    expect(browserMode(true, undefined)).toBe('run');
  });

  /**
   * There is no exception list here any more, and that is the assertion.
   *
   * `packages/slice/test/ui-phone-scroll.browser.test.ts` used to be named here
   * because it carried its own copy of the default browser path and its own
   * `existsSync(...) ? it : it.skip`, written before `./support/chrome.ts`
   * existed — so `MTG_REQUIRE_BROWSER=1` could not reach it, and a CI image
   * with no binary got a loud red from every other rig and a silent skip from
   * that one. It was routed through the harness in `mtg-ymd2`. A list with one
   * name on it is a list that grows; every rig going through the one harness is
   * a rule, and the next copy fails here rather than joining a set.
   */
  it('routes every rig through the one harness', () => {
    const rigs = browserTestFiles(join(WORKSPACE_ROOT, 'packages'));
    const rogue = rigs.filter(
      (file) => !readFileSync(join(WORKSPACE_ROOT, file), 'utf8').includes('support/chrome'),
    );
    expect(rogue, 'a browser rig with its own skip rule, which MTG_REQUIRE_BROWSER cannot reach').toEqual([]);
  });

  it('names the path, the variable and the command in what it says', () => {
    const said = missingBrowserMessage();
    expect(said).toContain(chromePath);
    expect(said).toContain('MTG_CHROME_HEADLESS_SHELL');
    expect(said).toContain('npx playwright install chromium-headless-shell');
  });
});
