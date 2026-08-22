/**
 * One committed copy per generated set.
 *
 * `tideglass-reach.set.json` was committed three times — `@mtg/setgen`'s fixture
 * tree, `@mtg/metrics`' balance fixtures and `@mtg/ui`'s analysis fixtures — and
 * byte-different, because `.prettierignore` exempts the setgen tree from the
 * format gate and the other two were reformatted by it. Nothing failed while
 * they agreed, and nothing would have failed when they stopped. `mtg-bc2.52`
 * regenerated the set from its replay and then hand-copied the result into all
 * three; miss that step once and the balance gate, the parity sweep and four
 * derived analysis documents are grading a set the generator no longer emits,
 * all of them green.
 *
 * `mtg-bc2.86` collapsed them onto the setgen fixture, which is the only one of
 * the three with provenance: it is the byte-exact deterministic replay of the
 * one recorded claude-cli generation, and the other two were reformattings of
 * it with nothing of their own to say. This test is the part that holds.
 *
 * Three choices in what it reads. **Git's index rather than the tree**, for the
 * reason `spelling.test.ts` gives: `npm run play` stages a set at
 * `packages/ui/public/set.json` and `npm run slice` writes another under `out/`,
 * and a gate that goes red because somebody played a game is a gate that gets
 * deleted. **Content rather than filename**, because a second copy under a new
 * name is the same defect and a name check would miss it. **`canonicalJson`
 * rather than bytes**, because indentation is precisely what the three copies
 * differed by; it is `@mtg/dsl`'s existing comparator rather than a second one
 * written here, for the same reason `DUPLICATE_EFFECT` reuses it.
 *
 * It lives with `@mtg/slice` beside `workspace-roster.test.ts` and
 * `spelling.test.ts`, because this is a fact about the whole workspace and
 * `@mtg/slice` is the package that composes it. It reads the checkout it runs
 * in, so a worktree checks its own tree.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Every tracked `.json` path, relative to the repository root. */
function trackedJson(): readonly string[] {
  const listed = execFileSync('git', ['ls-files', '--', '*.json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return listed.split('\n').filter((entry) => entry.length > 0);
}

/**
 * The shape `@mtg/setgen` writes: a format version, the set's metadata, and the
 * card array. Structural only — a document that parses as this is a generated
 * set whatever it is called and wherever it sits.
 */
function isSetDocument(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document['formatVersion'] === 'number' &&
    typeof document['set'] === 'object' &&
    document['set'] !== null &&
    Array.isArray(document['cards'])
  );
}

/** Tracked set documents, keyed by their content with key order and whitespace removed. */
function committedSets(): ReadonlyMap<string, readonly string[]> {
  const byContent = new Map<string, string[]>();
  for (const path of trackedJson()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
    } catch {
      continue;
    }
    if (!isSetDocument(parsed)) continue;
    const key = canonicalJson(parsed);
    const paths = byContent.get(key);
    if (paths === undefined) byContent.set(key, [path]);
    else paths.push(path);
  }
  return byContent;
}

describe('committed generated sets', () => {
  it('holds each set exactly once, so regenerating one cannot leave a copy behind', () => {
    const duplicated = [...committedSets().values()]
      .filter((paths) => paths.length > 1)
      .map((paths) => [...paths].sort());
    expect(duplicated).toEqual([]);
  });

  it('still finds the set the gates measure, so the check cannot pass by finding nothing', () => {
    const found = [...committedSets().values()].flat();
    expect(found).toContain('packages/setgen/fixtures/sets/tideglass-reach.set.json');
  });
});
