// @vitest-environment node
/**
 * `../../tools/deck-density.ts` writes a page a browser can be pointed at with
 * no network at all.
 *
 * `mtg-hznd`. The tool's job is to be measured, and the harness that measures
 * every other page in this suite is `../support/chrome-driver.ts`'s
 * `measurePage`, which settles on `document.readyState === 'complete'`. The
 * deck it renders is a deck of real printings, so its entries carry absolute
 * Scryfall URLs -- and Chrome in this harness does not fail a request it cannot
 * route, it hangs on it: an image asked for here is still `complete === false`
 * ten seconds later with neither `load` nor `error`. So `readyState` stayed
 * `interactive` for the life of a page that was fully laid out and sitting
 * there, and every driver written for this tool had to hand-roll its own settle.
 *
 * Loosening `measurePage` is the wrong end of it. `complete` is what stops the
 * other rigs measuring an unsized image mid-load, and a settle relaxed for one
 * page is relaxed for all of them. The page is the thing that has to stop
 * needing a host.
 *
 * Two claims, and the first one is why the second can be believed:
 *
 * 1. **Nothing on the emitted page points off this machine.** Read out of the
 *    file rather than out of the browser, so it is checked on a machine with no
 *    browser cache too, and so a failure names the URL that leaked rather than
 *    reporting a timeout.
 * 2. **`measurePage` drives it unchanged**, at its own settle, and the measuring
 *    function answers with the deck it was given.
 *
 * The tool is run as a subprocess rather than imported because it is a program:
 * it reads `process.argv` and writes files on import. That is the same shape as
 * every other file under `tools/`, and driving the real entry point is the point
 * -- a test that imported a helper would pass while `npx tsx …` still emitted a
 * page full of remote URLs.
 *
 * Whether the illustrations are *there* is deliberately not asserted. The tool
 * stages what the shared image cache can give it and drops the rest, so on a
 * cold checkout with no network every tile draws the pending frame and this file
 * is still green -- which is right, because the numbers the tool reports come
 * from the art box `@mtg/card-geometry` reserves rather than from the raster.
 * What is asserted is that the page asks nobody for anything.
 *
 * The third claim is that cold checkout, and it is here because it is the state
 * the bead was filed from and the state this machine is not in: the cache under
 * `data/images/` already holds every illustration the committed deck names, so
 * the first two claims never exercise the branch that drops one. It runs the
 * tool over a deck whose art points at a closed port, which fails the same way
 * an unreachable host does and fails immediately rather than hanging the suite.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/**
 * Where every host name resolves inside this rig's browser.
 *
 * 192.0.2.0/24 is TEST-NET-1 (RFC 5737): reserved for documentation, routed
 * nowhere, and answering nothing. A request to it is not refused, it is
 * *dropped* -- which is the state the bead was found in and the one that
 * matters, because a refused request still fires `error` and still lets
 * `readyState` reach `complete`. Pointing the browser here rather than trusting
 * this machine to be offline is the whole reason the second claim below is a
 * check: the machine that found `mtg-hznd` had no route to Scryfall and the one
 * writing this fix does, so a rig that merely ran here would have gone green on
 * a page still full of remote URLs.
 */
const NOWHERE = '192.0.2.1';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const TOOL = join(REPO_ROOT, 'packages', 'ui', 'tools', 'deck-density.ts');

/** Every URL the emitted HTML would make the browser go and get. */
function remoteReferences(html: string): readonly string[] {
  return [...html.matchAll(/(?:src|href)="([a-z]+:)?\/\/[^"]*"/g)].map((match) => match[0]);
}

const OUT = mkdtempSync(join(tmpdir(), 'mtg-deck-density-'));
const DECK = join(REPO_ROOT, 'packages', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');

/** Runs the program the way a person does, and returns the pages it wrote. */
function emit(into: string, deckPath: string = DECK): readonly string[] {
  execFileSync(join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), [TOOL, into, deckPath], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
  const written = readdirSync(into)
    .filter((name) => name.endsWith('.html'))
    .map((name) => join(into, name));
  expect(written.length).toBeGreaterThan(0);
  return written;
}

/**
 * The same deck with every illustration moved to a port nothing listens on.
 *
 * A closed port is refused at once, so this is the cold cache without the wait:
 * the tool's fetch fails, the entry cannot be staged, and what the page does
 * with an illustration it could not get is the thing under test.
 */
function unreachableDeck(): string {
  const artifact = JSON.parse(readFileSync(DECK, 'utf8')) as Record<string, unknown>;
  let index = 0;
  for (const field of ['spells', 'lands', 'basics'] as const) {
    for (const entry of artifact[field] as { art: { src: string } | null }[]) {
      if (entry.art !== null) {
        entry.art.src = `http://127.0.0.1:1/${String(index)}.jpg`;
        index += 1;
      }
    }
  }
  expect(index).toBeGreaterThan(0);
  const path = join(OUT, 'unreachable.deck.json');
  writeFileSync(path, JSON.stringify(artifact), 'utf8');
  return path;
}

let pages: readonly string[] = [];

beforeAll(() => {
  pages = emit(OUT);
}, 180_000);

describe('the deck-density page, driven with no network', () => {
  let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;

  beforeAll(async () => {
    chrome = await launchChrome(join(OUT, 'chrome'), [`--host-resolver-rules=MAP * ${NOWHERE}`]);
  }, 60_000);

  afterAll(async () => {
    if (chrome !== null) await shutdownChrome(chrome);
  });

  browserIt('asks no host for anything, at any density', () => {
    const leaked = pages.flatMap((file) =>
      remoteReferences(readFileSync(file, 'utf8')).map((url) => `${file}: ${url}`),
    );
    console.log(`${String(pages.length)} page(s); ${String(leaked.length)} remote reference(s)`);
    expect(leaked).toEqual([]);
    return Promise.resolve();
  });

  browserIt(
    'settles under measurePage at its own settle, and answers with the deck',
    async () => {
      if (chrome === null) throw new Error('no browser');
      for (const file of pages) {
        const reading = await measurePage(
          chrome.client,
          file,
          1280,
          800,
          'window.mtgDeckDensity()',
          `deck-density ${file}`,
          '.mtg-deck__pane',
        );
        console.log(
          `${file}: mode ${String(reading['mode'])}, ${String((reading['panes'] as unknown[]).length)} pane(s)`,
        );
        expect(String(reading['deck'])).toContain('boros-aggro.deck.json');
        expect((reading['panes'] as unknown[]).length).toBeGreaterThan(0);
      }
    },
    240_000,
  );

  browserIt(
    'drops an illustration it could not fetch rather than leaving the page pointing at it',
    async () => {
      if (chrome === null) throw new Error('no browser');
      const cold = mkdtempSync(join(tmpdir(), 'mtg-deck-density-cold-'));
      const written = emit(cold, unreachableDeck());
      const leaked = written.flatMap((file) => remoteReferences(readFileSync(file, 'utf8')));
      console.log(`cold: ${String(written.length)} page(s); ${String(leaked.length)} remote reference(s)`);
      expect(leaked).toEqual([]);
      const first = written[0];
      if (first === undefined) throw new Error('the tool wrote no page');
      const reading = await measurePage(
        chrome.client,
        first,
        1280,
        800,
        'window.mtgDeckDensity()',
        `deck-density cold ${first}`,
        '.mtg-deck__pane',
      );
      expect((reading['panes'] as unknown[]).length).toBeGreaterThan(0);
    },
    240_000,
  );
});
