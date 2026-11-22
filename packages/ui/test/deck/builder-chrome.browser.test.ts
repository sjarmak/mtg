// @vitest-environment node
/**
 * What the builder spends on its own chrome, measured rather than read.
 *
 * `mtg-564j`. A frame divides a fixed window between the apparatus and the
 * cards, so every pixel one band keeps is a pixel of deck nobody sees. Measured
 * on the sealed builder at 1440x900 before this: 306px of the 900 went to
 * chrome and the pool pane was left 198px holding 604px of cards. None of it was
 * control height. Every band measured its tallest child at 29 or 30px and then
 * put 16px of block padding around it, and each pane put 12px between its bands.
 *
 * Two claims:
 *
 * 1. **No band spends more than one step of the space scale on an edge.** Each
 *    edge separately rather than the pair, because two of these bands are
 *    padded on one side only and a budget on the total would let those double
 *    without failing. The budget is `--mtg-space-1`, 4px; a band that goes back
 *    to `--mtg-space-2` measures 8 and fails. It binds a band added later that
 *    nobody thought to compact, which is the rule this is here to hold rather
 *    than the four readings it takes today.
 * 2. **The boxes of cards hold their share of the frame.** This one is a
 *    fixture reading and is stated as a floor with its margin written down: on
 *    Tideglass with an empty deck the scrollports measure 0.32 of the frame at
 *    1024x768 and 0.50 at 1440x900, against 0.25 and 0.44 before the padding
 *    came off. The floor is 0.30, which the padding cannot come back under.
 *
 * The unframed sizes are not here. Below `BUILDER_FRAME_QUERY` the screen is a
 * document, the panes are as tall as their cards, and a band's padding is what
 * makes the page readable rather than what costs the deck a row;
 * `./builder-frame.browser.test.ts` is what asserts that gate.
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

/** The route, for `./builder-frame.browser.test.ts`'s reason: the frame is the route's. */
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
 * Each band's block padding, edge by edge, and the frame beside the boxes of
 * cards inside it.
 *
 * The padding rather than the drawn height: these bands wrap, so at 1024x768 the
 * counts bar is four rows of controls and its height says more about the fixture
 * than about what the band spends. Inline padding is not read. It is what keeps
 * the first pip off the pane's edge, and horizontal room is not what a frame is
 * short of.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const work = document.querySelector('.mtg-work__scroll');
  if (work === null) return null;
  const band = (node) => {
    const style = getComputedStyle(node);
    return {
      cls: node.className,
      top: round(parseFloat(style.paddingTop)),
      bottom: round(parseFloat(style.paddingBottom)),
    };
  };
  const bands = [
    ...document.querySelectorAll('.mtg-builder__bar, .mtg-deck__pane-head, .mtg-manabar'),
  ].map(band);
  const scrollports = [...document.querySelectorAll('.mtg-deck__pane-scroll')].map((pane) =>
    round(pane.getBoundingClientRect().height),
  );
  return {
    bands,
    scrollports,
    frame: round(work.getBoundingClientRect().height),
  };
})()`;

interface Band {
  readonly cls: string;
  readonly top: number;
  readonly bottom: number;
}

interface Reading {
  readonly bands: readonly Band[];
  readonly scrollports: readonly number[];
  readonly frame: number;
}

/** One step of the space scale, plus the half pixel of slack this harness allows. */
const BAND_EDGE_PX = 4.5;

/** The floor for the share of the frame the boxes of cards hold. Measured at 0.32 and 0.50. */
const CARD_SHARE = 0.3;

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

describe('what the builder spends on chrome', () => {
  browserIt('keeps its bands at the height of what is in them', async () => {
    const cards = loadSet();
    const directory = await mkdtemp(join(tmpdir(), 'mtg-builder-chrome-'));
    const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-builder-chrome-chrome-'));
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
        if (seen === null) throw new Error(`${at}: the page drew no builder`);
        expect(seen.bands.length, `${at}: the builder drew none of its chrome bands`).toBeGreaterThan(0);

        for (const found of seen.bands) {
          expect(
            Math.max(found.top, found.bottom),
            `${at}: "${found.cls}" is padded ${String(found.top)}/${String(found.bottom)}`,
          ).toBeLessThanOrEqual(BAND_EDGE_PX);
        }

        const cardRoom = seen.scrollports.reduce((total, height) => total + height, 0);
        expect(
          cardRoom / seen.frame,
          `${at}: ${String(cardRoom)}px of cards in a ${String(seen.frame)}px frame`,
        ).toBeGreaterThanOrEqual(CARD_SHARE);
      }
    } finally {
      await shutdownChrome(chrome);
    }
  });
});
