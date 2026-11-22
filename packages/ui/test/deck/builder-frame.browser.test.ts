// @vitest-environment node
/**
 * The Constructed builder as an app frame, and as a document where it has to be.
 *
 * `mtg-pmpu`. An open deck became a frame of boxes in `mtg-tz11` and the screen
 * you build a deck on did not, so the two halves of one activity had two
 * arrangements: reading a finished list held still while the pane scrolled, and
 * building one scrolled the whole page. Measured on the flagship at 1440x900 the
 * builder was a 13,436px document, which put the pool most of a page below the
 * deck it was being cut into.
 *
 * The same three sentences `./deck-frame.browser.test.ts` makes about an open
 * deck, plus the one that is only true here:
 *
 * 1. **The page does not scroll.** The document is exactly the height of the
 *    window.
 * 2. **The route's scrollport does not scroll either**, and both panes end
 *    inside it. A pane you scroll the page to reach is the half-measure the
 *    frame refuses.
 * 3. **A pane's header is above its box**, so the density and grouping controls
 *    stay where they were left however far the cards are driven.
 * 4. **Where the pool runs past its box sideways, the scroll is the pane's**,
 *    not the column strip's. `.mtg-builder-curve` (full density) and
 *    `.mtg-strips` (compact, since `mtg-eeqnj`) both carry their own
 *    `overflow-x`, which inside a pane is the same offer twice: the strip is
 *    as tall as the pool, so its scrollbar sat 12,924px down and the columns
 *    past the pane's right edge were reachable only after scrolling to the end
 *    of the pool.
 *
 *    Conditional since `mtg-8osf`, and read from the pane rather than assumed:
 *    the panes stack inside the frame now, so the pool has the whole window and
 *    at 1440x900 its columns fit with nothing left over. The half that holds at
 *    every size is the strip keeping no scroll of its own; the pane scrolling is
 *    asserted where there is an extent to scroll, and an unconditional
 *    expectation here was a claim about how wide this fixture's pool happens to
 *    be.
 *
 * # And the sizes where the frame is the wrong answer
 *
 * A frame divides what the chrome above the panes leaves, and a pane spends
 * what it gets before it draws a card: its header, and then the curve and the
 * basics on one side and the filters on the other, about 180px of apparatus.
 * Framed at 844x390 the panes came to 162px and every scrollport inside them
 * measured zero; at 390x844, 397px and the same zero. A deckbuilder with no
 * cards in it is worse than one that scrolls.
 *
 * So the frame has a gate of its own, `../../src/styles/deck.ts`'s
 * `BUILDER_FRAME_QUERY`, and it is not the query that puts the panes side by
 * side. Two panes abreast and enough height to divide between them are two
 * claims, and the split query says yes to a landscape phone on purpose. Below
 * the frame the screen still fills the viewport once while the column inside it
 * scrolls, which is what this route did everywhere until now.
 *
 * `SIZES` is both queries restated as a table, and the unframed rows are
 * asserted the other way round rather than skipped, because the failure they
 * guard is a frame quietly coming back. 1024x640 is the interesting one: wide
 * enough, and 128px short.
 *
 * The narrow rows also draw one pane at a time since `mtg-nqms`, so the rig
 * names the pool before it measures it. That is a fact about the arrangement
 * rather than about this file's claims: below the frame the column scrolls and
 * the pane is not a box, whichever of the two panes is on the screen.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { Shell } from '../../src/app/Shell';
import { DeckRoute } from '../../src/routes/DeckRoute';
import { deckOpenParam } from '../../src/routes/deck/open';
import { deckViewStoreKey } from '../../src/routes/deck/view-mode';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

/**
 * The route rather than `ConstructedBuilder` on its own, because the frame is
 * the route's: `DeckRoute` is what puts the builder inside `.mtg-builder-screen`
 * and decides that a live game gets the document instead. A test that mounted
 * the builder alone would be green on a sheet with the frame rules deleted.
 *
 * Compact throughout. Both densities grouped the pool into mana-value columns
 * since `mtg-rgc.21`, and since `mtg-eeqnj` compact draws those groups as name
 * strips (`.mtg-strips`) rather than card-shaped tiles (`.mtg-builder-curve`) --
 * the grouping, and so the sideways extent sentence 4 is about, survives the
 * change either way. Compact is the density a pane opens in, and it is the
 * narrower of the two, which is the harder case for a claim that the columns
 * run past the pane.
 */
function page(cards: readonly Card[]): string {
  const prefix = deckViewStoreKey('');
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string): string | null => (key.startsWith(prefix) ? 'compact' : null),
    setItem: (): void => undefined,
  };
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'customize',
      sub: 'decks',
      onSelectMode: (): void => undefined,
      children: h(DeckRoute, {
        state: { status: 'absent' },
        cards,
        open: deckOpenParam({ kind: 'build' }),
      }),
    }),
  );
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Builder</title>' +
    `<style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`
  );
}

/**
 * One reading. The pool pane is the one with a scroll to drive: the deck starts
 * empty, which is the state the builder opens in.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  // Below the split query the builder shows one pane at a time (\`mtg-nqms\`),
  // and every sentence here is about the pool, so name it before measuring. At
  // the framed sizes this changes nothing: both panes are drawn there whatever
  // the attribute says, which is the point of restoring them in the media query
  // rather than in the component.
  const workbench = document.querySelector('.mtg-builder__panes');
  if (workbench !== null) workbench.setAttribute('data-showing', 'pool');
  void document.documentElement.offsetHeight;
  const work = document.querySelector('.mtg-work__scroll');
  const panes = [...document.querySelectorAll('.mtg-deck__pane-scroll')];
  const pool = document.querySelector('[data-pane="pool"] .mtg-deck__pane-scroll');
  const head = document.querySelector('[data-pane="pool"] .mtg-deck__pane-head');
  // Full density draws the columns as ".mtg-builder-curve"; compact draws them
  // as ".mtg-strips" since \`mtg-eeqnj\`. Either is the element sentence 4 is
  // about: the one that carries its own "overflow-x" and has to hand it up to
  // the pane rather than keep a buried scrollbar of its own.
  const curve = document.querySelector('[data-pane="pool"] .mtg-builder-curve, [data-pane="pool"] .mtg-strips');
  if (work === null || pool === null || head === null || curve === null) return null;
  const headBefore = head.getBoundingClientRect();
  curve.scrollLeft = 4000;
  pool.scrollLeft = 4000;
  pool.scrollTop = 4000;
  void document.documentElement.offsetHeight;
  const poolBox = pool.getBoundingClientRect();
  return {
    viewport: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    workScrollable: round(work.scrollHeight - work.clientHeight),
    workBottom: round(work.getBoundingClientRect().bottom),
    paneBottoms: panes.map((pane) => round(pane.getBoundingClientRect().bottom)),
    panes: panes.length,
    scrolled: round(pool.scrollTop),
    scrollable: round(pool.scrollHeight - pool.clientHeight),
    sideways: round(pool.scrollLeft),
    sidewaysExtent: round(pool.scrollWidth - pool.clientWidth),
    curveSideways: round(curve.scrollLeft),
    poolTop: round(poolBox.top),
    headBottom: round(headBefore.bottom),
    headAfter: round(head.getBoundingClientRect().top),
    headBefore: round(headBefore.top),
    headPosition: getComputedStyle(head).position,
  };
})()`;

interface Reading {
  readonly viewport: number;
  readonly documentHeight: number;
  readonly workScrollable: number;
  readonly workBottom: number;
  readonly paneBottoms: readonly number[];
  readonly panes: number;
  readonly scrolled: number;
  readonly scrollable: number;
  readonly sideways: number;
  readonly sidewaysExtent: number;
  readonly curveSideways: number;
  readonly poolTop: number;
  readonly headBottom: number;
  readonly headAfter: number;
  readonly headBefore: number;
  readonly headPosition: string;
}

/** Sub-pixel slack, the same allowance the other rigs on this harness use. */
const SLACK_PX = 0.5;

/**
 * The sizes, and whether each one is a frame.
 *
 * 1024x768 is `BUILDER_FRAME_QUERY` at both its edges at once, and it is where
 * the floor was measured: the panes are 151px and 177px there and 74 and 100 one
 * step down. The three unframed rows fail it three different ways — too short,
 * too short and too narrow, too narrow.
 */
const SIZES = [
  { width: 1024, height: 768, framed: true },
  { width: 1440, height: 900, framed: true },
  { width: 1024, height: 640, framed: false },
  { width: 844, height: 390, framed: false },
  { width: 390, height: 844, framed: false },
] as const;

describe('the Constructed builder as a frame', () => {
  browserIt('gives each pane its own scrollbars where the panes sit side by side', async () => {
    const cards = loadSet();
    const directory = await mkdtemp(join(tmpdir(), 'mtg-builder-frame-'));
    const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-builder-frame-chrome-'));
    const chrome = await launchChrome(userDataDir);
    try {
      const file = join(directory, 'builder.html');
      await writeFile(file, page(cards), 'utf8');
      for (const size of SIZES) {
        const at = `${String(size.width)}x${String(size.height)}`;
        const seen = (await measurePage(
          chrome.client,
          file,
          size.width,
          size.height,
          MEASURE,
          at,
          '.mtg-deck__pane-scroll',
        )) as unknown as Reading | null;
        if (seen === null) throw new Error(`${at}: the page drew no builder pane`);
        expect(seen.panes, `${at}: the builder drew something other than two panes`).toBe(2);

        // The screen fills the window once at every size: that is `.mtg-screen`,
        // and it is what both arrangements are built inside.
        expect(seen.documentHeight, `${at}: the page itself scrolls under the app bar`).toBeLessThanOrEqual(
          seen.viewport + SLACK_PX,
        );

        if (!size.framed) {
          // Below the gate the column scrolls and the panes are as tall as
          // their cards. Asserted rather than skipped: a frame here is two
          // zero-height panes, which is what these sizes measured before the
          // gate was split off the two-column one.
          expect(seen.workScrollable, `${at}: the column refuses to scroll`).toBeGreaterThan(0);
          expect(seen.scrollable, `${at}: the pool is a box below the frame`).toBeLessThanOrEqual(SLACK_PX);
          continue;
        }

        // The panes divide the frame; none of them runs past its bottom edge.
        expect(
          seen.workScrollable,
          `${at}: the workspace scrolls as well as the panes inside it`,
        ).toBeLessThanOrEqual(SLACK_PX);
        for (const bottom of seen.paneBottoms) {
          expect(bottom, `${at}: a pane runs past the bottom of the frame`).toBeLessThanOrEqual(
            seen.workBottom + SLACK_PX,
          );
        }

        // The header is a bar above the box rather than a layer inside it.
        expect(seen.headPosition, `${at}: the pool header is positioned again`).toBe('static');
        expect(seen.headBottom, `${at}: the pool header is inside its own scrollport`).toBeLessThanOrEqual(
          seen.poolTop + SLACK_PX,
        );

        // The cards moved by the scroll and the header did not, wherever the
        // pool still overflows its box vertically. Since `mtg-eeqnj` compact
        // draws `.mtg-strips`, and a strips region fills the room the pane
        // hands it and scrolls sideways rather than down
        // (`../../src/routes/deck/StripColumns.ts`'s `useStackRoom`) -- the same "fits rather than
        // scrolls" contract `./deck-frame.browser.test.ts`'s `EXPECTED.compact`
        // states for the deck pane's own compact density. An unconditional
        // expectation here would be a claim about how tall this fixture's pool
        // happens to run at this size, not about the frame.
        if (seen.scrollable > SLACK_PX) {
          expect(seen.scrolled, `${at}: the pool refused to scroll`).toBeGreaterThan(0);
          expect(seen.headAfter, `${at}: the header scrolled away with the cards`).toBeCloseTo(
            seen.headBefore,
            0,
          );
        } else {
          expect(seen.scrolled, `${at}: the pool scrolled with nothing to scroll`).toBeLessThanOrEqual(
            SLACK_PX,
          );
        }

        // Sentence 4: the sideways extent is the pane's, so its scrollbar is on
        // the edge of the box a reader can see rather than at the foot of the
        // whole pool.
        expect(
          seen.curveSideways,
          `${at}: the column strip kept a sideways scroll of its own`,
        ).toBeLessThanOrEqual(SLACK_PX);
        if (seen.sidewaysExtent > SLACK_PX) {
          expect(seen.sideways, `${at}: the pool pane refused to scroll sideways`).toBeGreaterThan(0);
        }
      }
    } finally {
      await shutdownChrome(chrome);
    }
  });
});
