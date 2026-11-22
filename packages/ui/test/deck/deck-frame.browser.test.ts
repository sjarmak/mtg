// @vitest-environment node
/**
 * An open deck as an app frame: a box per pane, and a header above each box.
 *
 * `mtg-nuk3` and `mtg-tz11`. The Decks route drew a deck as a long document --
 * the plan, the shared criteria, the panes and the mana-base table stacked down
 * one page that scrolled as a whole. The client this surface is being brought
 * toward does the opposite: the window is the frame, each pane is a fixed-height
 * box with its own scrollbar, and the pane's header bar sits outside that box
 * while its cards move under it.
 *
 * Neither half of that is checkable in jsdom. It performs no layout, so every
 * `getBoundingClientRect` is zeros; an assertion about which of three nested
 * boxes actually carries a scroll is an assertion about a layout a real engine
 * performs. `../lab/`'s deck suites cover which regions the route builds; this
 * covers where they land.
 *
 * Three sentences, at two desktop sizes and in both densities:
 *
 * 1. **The page itself does not scroll.** The document is exactly as tall as the
 *    window, so the deck moves inside its own box rather than the window moving
 *    under the app bar. That is the difference between a frame and a document,
 *    and it is one number.
 * 2. **The route's scrollport does not scroll either.** It is a column of its own
 *    height that the panes divide. A scroll here would mean a fixed-height pane
 *    you have to scroll the page to reach, which is the half-measure `mtg-tz11`
 *    refuses: three nested scroll regions and none of the benefit.
 * 3. **The pane is the box, and its header is not in it.** Driving the pane down
 *    moves its cards by exactly the scroll and does not move its header at all --
 *    and the header's bottom edge is above the box's top edge, so it is outside
 *    it rather than pinned to it by a compositing rule.
 *
 * # Sticky is what this replaces
 *
 * Until `mtg-tz11` the header was `position: sticky` inside the one scrollport,
 * and this file measured the offset it pinned at: the scrollport's own padding,
 * negated, because sticky measures from the padding box and `overflow` clips at
 * it. That number is gone along with the position, and sentence 3 is the same
 * promise made structurally instead -- a header outside the scrollport cannot
 * scroll away whatever the compositor decides. `headPosition` is still read, and
 * it is now asserted to be `static`: sticky reappearing would mean the header is
 * back inside a box with the cards.
 *
 * # Which density has a scroll to drive
 *
 * Compact is the mana-value columns, and a column is a fixed-height box that
 * scrolls sideways (`../../src/routes/deck/strips.ts`), so a 60-card deck fits
 * the pane at both desk sizes with nothing to scroll vertically. Full is a flat
 * run of tiles and overflows at both. `EXPECTED` states which is which rather
 * than deriving it from the reading, because a test that asks whether there is a
 * scroll and then asserts about it is green on a page with no cards on it at
 * all. The scroll claim is carried by the density that scrolls; the one that
 * does not is held to fitting, which is the same fact said forward.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { DeckRoute } from '../../src/routes/DeckRoute';
import { deckOpenParam } from '../../src/routes/deck/open';
import { readDeckArtifact } from '../../src/lab/deck-artifact';
import type { DeckArtifact, DeckArtifactEntry } from '../../src/lab/deck-artifact';
import { CARD_VIEW_MODES, deckViewStoreKey } from '../../src/routes/deck/view-mode';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed artifact the rest of the deck suite reads, so all of them agree on the subject. */
const DECK_PATH = join(HERE, '..', '..', '..', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');
const PARSED = readDeckArtifact(JSON.parse(readFileSync(DECK_PATH, 'utf8')), DECK_PATH);
if (!PARSED.ok) throw new Error(PARSED.message);

/**
 * The same deck with its illustrations dropped, because this rig has no network.
 *
 * The artifact's entries carry Scryfall URLs, and `measurePage` settles on
 * `document.readyState === 'complete'`, which is not reached until every `<img>`
 * on the page has resolved. Chrome here does not fail those requests, it hangs
 * on them: an image asked for in this harness is still `complete === false` ten
 * seconds later, with neither `load` nor `error`. So a page with one remote
 * illustration on it never settles, and the failure reads as a timeout in
 * whatever the test happened to be measuring rather than as a fetch.
 *
 * Dropping the art draws the pending frame instead, which is the same box at the
 * same size -- this file is about which box scrolls, and a picture inside one of
 * them is not part of that sentence. `art: null` is a state the schema already
 * carries and the route already draws; nothing here is a test-only shape.
 */
function unillustrated(entries: readonly DeckArtifactEntry[]): DeckArtifactEntry[] {
  return entries.map((entry) => ({ ...entry, art: null }));
}

const DECK: DeckArtifact = {
  ...PARSED.deck,
  spells: unillustrated(PARSED.deck.spells),
  lands: unillustrated(PARSED.deck.lands),
  basics: unillustrated(PARSED.deck.basics),
  ...(PARSED.deck.sideboard === undefined ? {} : { sideboard: unillustrated(PARSED.deck.sideboard) }),
};

/**
 * The page, at one density.
 *
 * The mode is read out of the preference store, and there is no store in Node,
 * so one is stood up around the render the way `../../tools/deck-density.ts`
 * does. Server-rendered rather than mounted because nothing here is about
 * behavior: the sheet and the markup are the subject, and a static file is what
 * `measurePage` navigates to.
 */
function page(mode: string): string {
  const prefix = deckViewStoreKey('');
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string): string | null => (key.startsWith(prefix) ? mode : null),
    setItem: (): void => undefined,
  };
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'customize',
      sub: 'decks',
      onSelectMode: (): void => undefined,
      children: h(DeckRoute, {
        state: { status: 'ready', deck: DECK },
        open: deckOpenParam({ kind: 'artifact' }),
      }),
    }),
  );
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Deck</title>' +
    `<style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`
  );
}

/**
 * One reading, taken across a scroll of the pane rather than of the page.
 *
 * The header and the pane body are both read twice, before and after the pane is
 * driven down, because the claim is the difference between them: one moved by the
 * scroll and one did not. `2000` is past every scrollable extent below, so the
 * box lands at its bottom and `scrolled` is what happened rather than what was
 * asked for.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const work = document.querySelector('.mtg-work__scroll');
  const pane = document.querySelector('.mtg-deck__pane-scroll');
  const head = document.querySelector('.mtg-deck__pane-head');
  // The pane's body at either density: whole cards in columns, or strips.
  // 'mtg-rgc.21' retired the flat '.mtg-deck__grid' that used to be the first
  // of these, and a selector that matched nothing returned null from the whole
  // reading rather than failing on the claim.
  const body = document.querySelector('.mtg-deck__pane-scroll .mtg-builder-curve, .mtg-deck__pane-scroll .mtg-strips');
  if (work === null || pane === null || head === null || body === null) return null;
  const headBefore = head.getBoundingClientRect();
  const bodyBefore = body.getBoundingClientRect().top;
  // What a person sees before touching anything: tiles whose whole border box
  // is inside the pane's own scrollport. Read here, because the scroll below
  // moves them.
  const port = pane.getBoundingClientRect();
  const tiles = body.querySelectorAll('.mtg-deck-card');
  let whole = 0;
  let tallest = 0;
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index].getBoundingClientRect();
    if (tile.top >= port.top - 0.5 && tile.bottom <= port.bottom + 0.5) whole += 1;
    if (tile.height > tallest) tallest = tile.height;
  }
  pane.scrollTop = 2000;
  void document.documentElement.offsetHeight;
  const paneBox = pane.getBoundingClientRect();
  return {
    viewport: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    workScrollable: round(work.scrollHeight - work.clientHeight),
    workBottom: round(work.getBoundingClientRect().bottom),
    scrolled: round(pane.scrollTop),
    scrollable: round(pane.scrollHeight - pane.clientHeight),
    paneTop: round(paneBox.top),
    paneBottom: round(paneBox.bottom),
    headBottom: round(headBefore.bottom),
    headBefore: round(headBefore.top),
    headAfter: round(head.getBoundingClientRect().top),
    bodyBefore: round(bodyBefore),
    bodyAfter: round(body.getBoundingClientRect().top),
    headPosition: getComputedStyle(head).position,
    panes: document.querySelectorAll('.mtg-deck__pane-scroll').length,
    tiles: tiles.length,
    wholeOnArrival: whole,
    tallestTile: round(tallest),
    portHeight: round(port.height),
  };
})()`;

interface Reading {
  readonly viewport: number;
  readonly documentHeight: number;
  readonly workScrollable: number;
  readonly workBottom: number;
  readonly scrolled: number;
  readonly scrollable: number;
  readonly paneTop: number;
  readonly paneBottom: number;
  readonly headBottom: number;
  readonly headBefore: number;
  readonly headAfter: number;
  readonly bodyBefore: number;
  readonly bodyAfter: number;
  readonly headPosition: string;
  readonly panes: number;
  readonly tiles: number;
  readonly wholeOnArrival: number;
  readonly tallestTile: number;
  readonly portHeight: number;
}

/** Sub-pixel slack, the same allowance the other rigs on this harness use. */
const SLACK_PX = 0.5;

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

/**
 * Which density overflows its box, stated rather than measured.
 *
 * Keyed by density alone: both desk sizes agree, and a size that stopped
 * agreeing would be a layout change worth a red rather than a table entry.
 */
const EXPECTED: Readonly<Record<string, boolean>> = { full: true, compact: false };

describe('an open deck as a frame', () => {
  browserIt('gives each pane its own scrollbar, and its header a place outside it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mtg-deck-frame-'));
    const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-deck-frame-chrome-'));
    const chrome = await launchChrome(userDataDir);
    try {
      // The modes this screen offers, which is the two card densities. An open
      // deck's panes draw faces, so `list` is not on their control (`mtg-umro`)
      // and a store holding it would read back as compact anyway.
      for (const mode of CARD_VIEW_MODES) {
        const file = join(directory, `deck-${mode}.html`);
        await writeFile(file, page(mode), 'utf8');
        for (const size of SIZES) {
          const at = `${mode} at ${String(size.width)}x${String(size.height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            size.width,
            size.height,
            MEASURE,
            at,
            '.mtg-deck__pane-scroll',
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no deck pane`);

          // 1. The window is the frame.
          expect(seen.documentHeight, `${at}: the page itself scrolls under the app bar`).toBeLessThanOrEqual(
            seen.viewport + SLACK_PX,
          );

          // 2. The route's scrollport is a column the panes divide, not a
          //    document with panes in it.
          expect(
            seen.workScrollable,
            `${at}: the workspace scrolls as well as the pane inside it`,
          ).toBeLessThanOrEqual(SLACK_PX);
          expect(seen.paneBottom, `${at}: the pane runs past the bottom of the frame`).toBeLessThanOrEqual(
            seen.workBottom + SLACK_PX,
          );

          // 3. The header is above the box rather than inside it. The position
          //    is read too: sticky coming back would mean the header is back in
          //    the scrollport with the cards, which is what this replaced.
          expect(seen.headPosition, `${at}: the pane header is positioned again`).toBe('static');
          expect(seen.headBottom, `${at}: the pane header is inside its own scrollport`).toBeLessThanOrEqual(
            seen.paneTop + SLACK_PX,
          );

          // 4. A card is on screen before anybody scrolls anything.
          //
          //    `mtg-ybrn` was filed against the document this replaced: the
          //    plan prose, the criteria panel and the mana base were stacked
          //    above the cards, the grid started at y=520, a 306px tile ended
          //    at 826 in an 800px window, and the count of whole tiles on
          //    arrival was zero at 1280x800 and at 1024x768. The frame is what
          //    fixed it -- the head chain is outside the panes' scrollport now,
          //    so the grid starts at 194 and four tiles are whole at the worst
          //    of the four sizes -- and nothing said so, which is how it would
          //    come back. A tile is counted only when its whole border box is
          //    inside the scrollport, because a tile cut by the fold is a tile
          //    you have to scroll to read.
          //
          //    Full density only: a compact pane draws strips rather than
          //    tiles and reports none of them, which is right.
          if (mode === 'full') {
            expect(seen.tiles, `${at}: the pane drew no cards to count`).toBeGreaterThan(0);
            expect(
              seen.wholeOnArrival,
              `${at}: no whole card is on screen before the pane is scrolled ` +
                `(scrollport ${String(seen.portHeight)}px, tallest tile ${String(seen.tallestTile)}px)`,
            ).toBeGreaterThanOrEqual(1);
          }

          const overflows = EXPECTED[mode];
          if (overflows === undefined) throw new Error(`${at}: no expectation recorded for this density`);
          expect(
            seen.scrollable > 0,
            `${at}: the pane overflowed ${overflows ? 'less' : 'more'} than stated`,
          ).toBe(overflows);
          if (!overflows) continue;

          // The cards moved by the scroll and the header did not: the sentence
          // the whole arrangement is there to make.
          expect(seen.scrolled, `${at}: the pane refused to scroll`).toBeGreaterThan(0);
          expect(seen.bodyAfter, `${at}: the pane body did not move with its own box`).toBeCloseTo(
            seen.bodyBefore - seen.scrolled,
            0,
          );
          expect(seen.headAfter, `${at}: the header scrolled away with the cards`).toBeCloseTo(
            seen.headBefore,
            0,
          );
        }
      }
    } finally {
      await shutdownChrome(chrome);
    }
  });
});
