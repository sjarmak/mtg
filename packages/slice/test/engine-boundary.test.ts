/**
 * ADR-0001 §5.4's guard, which asserted itself into existence and was never
 * written.
 *
 * §5.4 says, in the imperative: "A check in the standard test gate scans tracked
 * files for vendored-engine path fragments … and for GPL and AGPL license
 * headers anywhere in our own tree, and fails the build on a hit. It also
 * asserts that `tools/forge/` is gitignored. This check is not optional and is
 * not to be skipped with an inline suppression; if it fires, the tree is wrong."
 * When ADR-0001 §9 was written, no such test existed. The `.gitignore` entries
 * were there and nothing read them, and nothing anywhere looked for a vendored
 * path or a copied license header.
 *
 * That was survivable while Forge was a parity oracle a test starts and reaps.
 * §9 makes it a play backend, which is what turns the process boundary from a
 * developer-tooling detail into the property that keeps this lab's core
 * distributable, and §5 is explicit that the obligation triggers on distribution
 * and that one careless vendoring event removes the option permanently. A
 * condition of a decision that nothing checks is a sentence.
 *
 * Three things are checked and they are three different failures:
 *
 *  1. **A vendored engine path.** Somebody copied a tree in. The fragments are
 *     the ones §5.4 names, matched against tracked paths.
 *  2. **A copied license header.** Somebody copied a file in without its tree.
 *     Matched against tracked file *contents*, because a GPL header in our tree
 *     is the artifact whether or not the path gives it away.
 *  3. **`tools/forge/` is ignored.** The distribution is a downloaded artifact
 *     and must stay untracked, so the ignore rules are asserted rather than
 *     assumed.
 *
 * It reads git's index rather than the directory tree, for the reason
 * `spelling.test.ts` argues at length: the working tree holds downloaded and
 * staged artifacts that are not the repo's own bytes, `.gitignore` already names
 * them, and a gate that goes red because somebody installed Forge is a gate that
 * gets deleted.
 *
 * It lives in `@mtg/slice` beside `workspace-roster.test.ts` and
 * `spelling.test.ts` because it is a fact about the whole workspace, and
 * `@mtg/slice` is the package that composes the workspace.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);

/**
 * Path fragments that mean a third-party engine's source is in this tree.
 *
 * Named in ADR-0001 §5.4. Each is a directory a checkout of that project puts at
 * its own root, so a fragment match is a copied tree rather than a coincidence.
 */
const VENDORED_PATHS: readonly { readonly fragment: string; readonly engine: string }[] = [
  { fragment: 'forge-game/', engine: 'Forge (GPL-3.0)' },
  { fragment: 'forge-gui/', engine: 'Forge (GPL-3.0)' },
  { fragment: 'Mage.Sets/', engine: 'XMage' },
  { fragment: 'magarena/', engine: 'Magarena' },
  { fragment: 'manabrew/', engine: 'Manabrew (AGPL)' },
];

/**
 * License-header phrases that no file we wrote can contain.
 *
 * Deliberately the full formal titles rather than the short spdx tags. This
 * repository discusses GPL and AGPL constantly — the ADR, `AGENTS.md`,
 * `CLAUDE.md` and `@mtg/forge-export`'s docblocks all name them, and must be
 * able to — so a check keyed on the abbreviation would fail on the documents
 * that state the policy. What no file of ours contains is the license text
 * itself, which is what arrives attached to copied code.
 */
const LICENSE_HEADERS: readonly string[] = [
  'GNU GENERAL PUBLIC LICENSE',
  'GNU AFFERO GENERAL PUBLIC LICENSE',
  'GNU LESSER GENERAL PUBLIC LICENSE',
];

/** Extensions worth reading for a header. Everything else is bytes or lockfile. */
const SCANNED = ['.ts', '.js', '.java', '.py', '.md', '.txt', '.json', '.yml', '.yaml'];

/**
 * Files that quote a license title on purpose, each with its reason.
 *
 * A ledger rather than a looser pattern, and a ledger whose entries are checked:
 * an exemption that stops matching fails a test rather than sitting there
 * forever, which is the rule `spelling.test.ts` already keeps for its own two
 * ledgers. The distinction being drawn is between *quoting* a license, which is
 * what a prior-art survey does when it records what a project is licensed under,
 * and *carrying* one, which is what a copied file does.
 */
const QUOTED: readonly { readonly path: string; readonly why: string }[] = [
  {
    path: 'docs/research/prior-art-engines.md',
    why: 'the engines survey records each project’s license and quotes the opening line of two LICENSE files as evidence of what it found; that is the report doing its job, and it is the document ADR-0001 §5 is argued from',
  },
  {
    path: 'packages/slice/test/engine-boundary.test.ts',
    why: 'the ledger itself, which has to spell what it looks for',
  },
];

function trackedFiles(): readonly string[] {
  let listed: string;
  try {
    listed = execFileSync('git', ['ls-files', '-z'], {
      cwd: fileURLToPath(ROOT),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (cause) {
    throw new Error('the engine-boundary check reads git’s index and `git ls-files` failed', {
      cause,
    });
  }
  const paths = listed.split('\0').filter((path) => path.length > 0);
  if (paths.length === 0) {
    throw new Error('`git ls-files` listed nothing, so this check would pass vacuously');
  }
  return paths;
}

/** Whether git would ignore a path, asked of git rather than parsed out of the file. */
function isIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], {
      cwd: fileURLToPath(ROOT),
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

describe('the third-party engine boundary', () => {
  const tracked = trackedFiles();

  it('tracks no vendored engine path', () => {
    const found = tracked.flatMap((path) =>
      VENDORED_PATHS.filter((entry) => path.includes(entry.fragment)).map(
        (entry) => `${path} looks like vendored ${entry.engine} (matched "${entry.fragment}")`,
      ),
    );
    expect(found, 'ADR-0001 §5.2: no third-party engine source in this tree, in any form').toEqual([]);
  });

  const quoting = new Set<string>();
  const readable = tracked.filter((path) => SCANNED.some((extension) => path.endsWith(extension)));
  const hits: string[] = [];
  for (const path of readable) {
    const text = readFileSync(new URL(path, ROOT), 'utf8');
    for (const header of LICENSE_HEADERS) {
      if (!text.includes(header)) continue;
      if (QUOTED.some((entry) => entry.path === path)) quoting.add(path);
      else hits.push(`${path} contains "${header}"`);
    }
  }

  it('carries no copied license text', () => {
    expect(
      hits,
      'ADR-0001 §5.2 and §5.3: a copyleft license header in our own tree means copied code',
    ).toEqual([]);
  });

  it('keeps no stale quotation exemption', () => {
    const unused = QUOTED.filter((entry) => !quoting.has(entry.path)).map((entry) => entry.path);
    expect(unused, 'an exemption that no longer matches anything should be deleted').toEqual([]);
  });

  it('keeps the Forge distribution untracked', () => {
    const inside = tracked.filter(
      (path) => path.startsWith('tools/forge/') && path !== 'tools/forge/README.md',
    );
    expect(inside, 'ADR-0001 §5.1: Forge lives under tools/forge/ as a gitignored artifact').toEqual([]);
    expect(isIgnored('tools/forge/dist/forge.jar'), 'tools/forge/dist/ must be gitignored').toBe(true);
  });

  it('names fragments that could still match something', () => {
    // A ledger nobody can trip is a ledger that has stopped meaning anything.
    // This does not assert a hit; it asserts the entries are well-formed, so a
    // typo in a fragment cannot silently retire a rule.
    for (const entry of VENDORED_PATHS) {
      expect(entry.fragment.endsWith('/'), `${entry.fragment} should name a directory`).toBe(true);
      expect(entry.engine.length).toBeGreaterThan(0);
    }
  });
});
