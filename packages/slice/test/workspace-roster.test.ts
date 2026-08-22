/**
 * `CLAUDE.md` names every workspace package, and counts them correctly.
 *
 * That sentence is loaded into every agent session before any code is read, so
 * a stale roster is the first thing a contributor is told and the last thing
 * anyone checks. It went stale the moment it was written against a fixed count:
 * `mtg-bc2.19` added `@mtg/draft-export` and left the line reading "Sixteen
 * packages" over sixteen names, with seventeen directories on disk. Nothing
 * failed, because nothing looked.
 *
 * The check lives here because `@mtg/slice` is the package that composes the
 * workspace — it depends on nine of the others and its whole job is running
 * them in one line — so it is the package whose tests already fail when the
 * workspace changes shape. It reads the checkout it runs in rather than a fixed
 * root, so a worktree checks its own tree.
 *
 * The same file carries a second count that went stale the same way — the
 * `npm run play` paragraph's card total, wrong by 92 — and it is *not* checked
 * here. Naming the flagship fixture from a public package is what the
 * public-export boundary exists to refuse, so that check lives beside the
 * fixture, in `@mtg/setgen`, where naming it is allowed. Grep that package's
 * tests for the count sentence to find it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
// The count word may be hyphenated, which `\w` is not. It was `\w+` until the
// roster reached twenty-one, at which point the sentence stopped matching and
// this check would have thrown "CLAUDE.md no longer carries a roster sentence"
// rather than reporting the roster it was written to report.
const ROSTER = /^([A-Za-z-]+) packages: (.+)\.$/m;

/** English for a small count, which is how the sentence is written. */
const NUMBER_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
  'Twenty',
  'Twenty-one',
  'Twenty-two',
  'Twenty-three',
] as const;

function rosterSentence(): { readonly count: string; readonly names: readonly string[] } {
  const doc = readFileSync(new URL('CLAUDE.md', ROOT), 'utf8');
  const match = ROSTER.exec(doc);
  if (match === null) {
    throw new Error('CLAUDE.md no longer carries a "<N> packages: `a`, `b`, …." sentence to check');
  }
  const [, count = '', list = ''] = match;
  return { count, names: [...list.matchAll(/`([a-z-]+)`/g)].map(([, name = '']) => name) };
}

function packageDirectories(): readonly string[] {
  return readdirSync(new URL('packages/', ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe('the package roster in CLAUDE.md', () => {
  it('names exactly the packages that exist, in whatever order it likes', () => {
    const listed = [...rosterSentence().names].sort();
    expect(listed).toEqual([...packageDirectories()].sort());
  });

  it('counts them in the same sentence it names them', () => {
    const { count, names } = rosterSentence();
    const word = NUMBER_WORDS[names.length];
    expect(word, `this check has no English word on file for ${String(names.length)} packages`).toBeDefined();
    expect(count).toBe(word);
  });
});
