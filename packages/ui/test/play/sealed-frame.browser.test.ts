// @vitest-environment node
/**
 * The sealed builder as an app frame, and as a document where it has to be.
 *
 * `mtg-sk1c`, and it is `../deck/builder-frame.browser.test.ts` again over the
 * other builder. The Constructed screen became a frame of boxes in `mtg-pmpu`
 * and this one did not, although the two share `../../src/routes/deck/DeckPane.ts`
 * and every rule in `../../src/styles/deck.ts` that dresses it: what the sealed
 * screen was missing is a host that puts it inside `.mtg-screen`, so the frame
 * rules matched nothing and the sticky counts bar was working against the page
 * scroll on the one screen whose whole activity is moving cards between two
 * panes.
 *
 * The three sentences, plus the one this screen adds:
 *
 * 1. **The page does not scroll.** The document is exactly the height of the
 *    window.
 * 2. **The route's scrollport does not scroll either**, and both panes end
 *    inside it.
 * 3. **A pane's header is above its box**, so the density and grouping controls
 *    stay put however far the cards are driven.
 * 4. **The counts bar sticks against the box above the panes**, not against the
 *    page. That box is capped at two fifths of the frame and scrolls inside
 *    that, and on this screen it holds the whole of what a host has to say --
 *    a room's invite, the poll's last word -- as well as the counts and the
 *    buttons that start the game.
 *
 * `SIZES` is `BUILDER_FRAME_QUERY` restated as a table, and the unframed rows
 * are asserted the other way round rather than skipped: the gate exists because
 * a pane spends about 180px on its own header and filters before it draws a
 * card, so a frame that leaves it less than that is an empty box, and the
 * failure to guard is a frame quietly coming back at those sizes.
 *
 * The narrow rows also draw one pane at a time (`mtg-nqms`, landed alongside
 * this screen's own frame in `c9bde018`), the same switch
 * `../deck/builder-frame.browser.test.ts` names in its own docblock, so the rig
 * names the pool before it measures it here too. Left to the default the deck
 * pane draws first, and a sealed build's deck is about forty cards in the
 * compact strips layout, which is short enough to fit 390x844 with nothing left
 * to scroll -- not a box scrolling, a box that never had to. The pool, holding
 * the rest of the seventy-two-card pool, is the one guaranteed to overflow.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { SealedBuilder } from '../../src/routes/play/SealedBuilder';
import { deckFor, openSealed } from '../../src/routes/play/sealed';
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
 * The builder inside the shell, which is the whole of what a host supplies.
 *
 * `../deck/builder-frame.browser.test.ts` mounts its route rather than its
 * builder, because there the frame belongs to the route. Here it does not: the
 * three hosts that draw this screen carry no frame of their own since
 * `mtg-sk1c`, and `../play/sealed-screen.test.ts` is the file that checks each
 * of them still hands it a shell to fill.
 *
 * A `banner` on purpose. It is the room's half of `RemoteSealed`, it is the
 * tallest thing any host puts on this screen, and the claim in sentence 4 is
 * about the box that has to absorb it.
 *
 * Compact throughout, for the reason the Constructed rig gives: full density is
 * a flat run of faces, and the claim is about which box scrolls.
 */
function page(cards: readonly Card[]): string {
  const prefix = deckViewStoreKey('');
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string): string | null => (key.startsWith(prefix) ? 'compact' : null),
    setItem: (): void => undefined,
  };
  const build = openSealed(cards, 'lab/test/sealed-frame');
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: (): void => undefined,
      title: 'MTG Lab',
      children: h(SealedBuilder, {
        build,
        deck: deckFor(build),
        onToggle: (): void => undefined,
        onSuggest: (): void => undefined,
        onClear: (): void => undefined,
        onAdjustBasics: (): void => undefined,
        onSuggestBasics: (): void => undefined,
        onPlay: (): void => undefined,
        seed: 'lab/test/sealed-frame',
        source: 'sealed' as const,
        contextNote: 'A sealed pool, mounted by the frame rig.',
        banner: h(
          'p',
          { className: 'mtg-page-note' },
          'Anyone on this network can join at http://192.168.0.10:8787/#/table/abcdefgh',
        ),
      }),
    }),
  );
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Sealed</title>' +
    `<style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`
  );
}

/**
 * One reading. The pool pane is the one with a scroll to drive: the sealed
 * screen opens on a suggested build, so the deck pane holds about forty cards
 * and the pool the rest of seventy-two.
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
  const above = document.querySelector('.mtg-builder__above');
  const bar = document.querySelector('.mtg-builder__bar');
  if (work === null || pool === null || head === null || above === null || bar === null) return null;
  const headBefore = head.getBoundingClientRect();
  const barBefore = round(bar.getBoundingClientRect().top);
  above.scrollTop = 4000;
  pool.scrollTop = 4000;
  void document.documentElement.offsetHeight;
  return {
    viewport: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    workScrollable: round(work.scrollHeight - work.clientHeight),
    workBottom: round(work.getBoundingClientRect().bottom),
    paneBottoms: panes.map((pane) => round(pane.getBoundingClientRect().bottom)),
    panes: panes.length,
    scrolled: round(pool.scrollTop),
    scrollable: round(pool.scrollHeight - pool.clientHeight),
    poolTop: round(pool.getBoundingClientRect().top),
    headBottom: round(headBefore.bottom),
    headAfter: round(head.getBoundingClientRect().top),
    headBefore: round(headBefore.top),
    headPosition: getComputedStyle(head).position,
    aboveHeight: round(above.getBoundingClientRect().height),
    aboveScrolled: round(above.scrollTop),
    aboveScrollable: round(above.scrollHeight - above.clientHeight),
    barBefore,
    barAfter: round(bar.getBoundingClientRect().top),
    aboveTop: round(above.getBoundingClientRect().top),
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
  readonly poolTop: number;
  readonly headBottom: number;
  readonly headAfter: number;
  readonly headBefore: number;
  readonly headPosition: string;
  readonly aboveHeight: number;
  readonly aboveScrolled: number;
  readonly aboveScrollable: number;
  readonly barBefore: number;
  readonly barAfter: number;
  readonly aboveTop: number;
}

/** Sub-pixel slack, the same allowance the other rigs on this harness use. */
const SLACK_PX = 0.5;

/** The same table `../deck/builder-frame.browser.test.ts` reads, for one gate. */
const SIZES = [
  { width: 1024, height: 768, framed: true },
  { width: 1440, height: 900, framed: true },
  { width: 1024, height: 640, framed: false },
  { width: 844, height: 390, framed: false },
  { width: 390, height: 844, framed: false },
] as const;

describe('the sealed builder as a frame', () => {
  browserIt(
    'gives each pane its own scrollbars wherever there is room to divide',
    async () => {
      const cards = loadSet();
      const directory = await mkdtemp(join(tmpdir(), 'mtg-sealed-frame-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-sealed-frame-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        const file = join(directory, 'sealed.html');
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
          if (seen === null) throw new Error(`${at}: the page drew no sealed pane`);
          expect(seen.panes, `${at}: the sealed screen drew something other than two panes`).toBe(2);

          // Sentence 1, at every size: `.mtg-screen` fills the window once, and
          // it is what both arrangements are built inside. This is the sentence
          // the three hosts were failing before `mtg-sk1c`.
          expect(seen.documentHeight, `${at}: the page itself scrolls under the app bar`).toBeLessThanOrEqual(
            seen.viewport + SLACK_PX,
          );

          if (!size.framed) {
            // Below the gate the column scrolls and the panes are as tall as
            // their cards. Asserted rather than skipped: a frame here is two
            // panes with no room to draw a card in.
            expect(seen.workScrollable, `${at}: the column refuses to scroll`).toBeGreaterThan(0);
            expect(seen.scrollable, `${at}: the pool is a box below the frame`).toBeLessThanOrEqual(SLACK_PX);
            continue;
          }

          // Sentence 2.
          expect(
            seen.workScrollable,
            `${at}: the workspace scrolls as well as the panes inside it`,
          ).toBeLessThanOrEqual(SLACK_PX);
          for (const bottom of seen.paneBottoms) {
            expect(bottom, `${at}: a pane runs past the bottom of the frame`).toBeLessThanOrEqual(
              seen.workBottom + SLACK_PX,
            );
          }

          // Sentence 3.
          expect(seen.headPosition, `${at}: the pool header is positioned again`).toBe('static');
          expect(seen.headBottom, `${at}: the pool header is inside its own scrollport`).toBeLessThanOrEqual(
            seen.poolTop + SLACK_PX,
          );
          expect(seen.scrollable, `${at}: the pool did not overflow its box`).toBeGreaterThan(0);
          expect(seen.scrolled, `${at}: the pool refused to scroll`).toBeGreaterThan(0);
          expect(seen.headAfter, `${at}: the header scrolled away with the cards`).toBeCloseTo(
            seen.headBefore,
            0,
          );

          // Sentence 4. The chrome takes no more than two fifths of what the
          // frame has, and the counts bar is still at the top of it after the
          // banner above it has been scrolled away.
          expect(
            seen.aboveHeight,
            `${at}: the box above the panes took more than two fifths of the frame`,
          ).toBeLessThanOrEqual(seen.viewport * 0.4 + 1);
          if (seen.aboveScrollable > SLACK_PX) {
            expect(seen.aboveScrolled, `${at}: the chrome box refused to scroll`).toBeGreaterThan(0);
            expect(seen.barAfter, `${at}: the counts bar scrolled off the top of its box`).toBeCloseTo(
              seen.aboveTop,
              0,
            );
          } else {
            expect(seen.barAfter, `${at}: the counts bar moved with nothing to scroll`).toBeCloseTo(
              seen.barBefore,
              0,
            );
          }
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
