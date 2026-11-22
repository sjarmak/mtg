// @vitest-environment node
/**
 * The Cards gallery on a phone held upright, over a corpus any tree can build.
 *
 * `mtg-ss9o`. The reading that produced the phone sheet lives in
 * `./cards-phone.browser.test.ts`, which reads the committed flagship by path
 * and is excised from the public export for exactly that reason by the export's
 * tier manifest. The sheet it guards,
 * `../src/styles/cards-mobile.ts`, does export — so the public tree shipped the
 * fix with nothing that fails when it regresses.
 *
 * This file is the half of that reading which is about the width rather than
 * about 371 faces, taken over `EXAMPLE_CARDS`:
 *
 *  1. the chrome above the first card fits in a third of the screen, measured
 *     from the route's own box so the shell bar is not charged to this route;
 *  2. the face is within a card's gap of the gallery's inline size, which is
 *     the dead-gutter complaint stated as the thing that fixes it.
 *
 * The flagship's census — 371 faces, the document height, the relayout cost —
 * stays in the excised file, because those numbers are facts about that set.
 * Same split as `./card-text-box.flagship.test.ts` against
 * `./card-text-box.test.ts` (`mtg-mz1`).
 *
 * jsdom performs no layout, so none of this is measurable there.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { Shell } from '../src/app/Shell';
import { CardsRoute } from '../src/routes/CardsRoute';
import { uiStyleSheet } from '../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from './support/chrome';

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'cards',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: { mode: 'cards', sub: 'gallery', params: {} },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cards</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const route = document.querySelector('.mtg-shell__main > div');
  const gallery = document.querySelector('.mtg-gallery');
  const first = document.querySelector('.mtg-gallery > .mtg-card');
  const toggle = document.querySelector('.mtg-cardbar__toggle');
  const drawn = (element) => {
    if (element === null) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const routeTop = route === null ? 0 : route.getBoundingClientRect().top;
  return {
    coarse: window.matchMedia('(pointer: coarse)').matches,
    faces: document.querySelectorAll('.mtg-gallery > .mtg-card').length,
    chromeAbove: first === null ? null : round(first.getBoundingClientRect().top - routeTop),
    galleryWidth: gallery === null ? null : round(gallery.getBoundingClientRect().width),
    faceWidth: first === null ? null : round(first.getBoundingClientRect().width),
    toggleDrawn: drawn(toggle),
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
})()`;

interface Reading {
  readonly coarse: boolean;
  readonly faces: number;
  readonly chromeAbove: number | null;
  readonly galleryWidth: number | null;
  readonly faceWidth: number | null;
  readonly toggleDrawn: boolean;
  readonly pageOverflowX: number;
}

/** A third of an 844px screen, the bound the excised reading argues for. */
const CHROME_SHARE_MAX = 1 / 3;

/** The gap between two faces: a rounding residue passes, room for a second column does not. */
const GUTTER_MAX_PX = 16;

describe('the Cards gallery on a phone held upright', () => {
  browserIt(
    'opens on cards rather than filters, and spends the width it is given',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-cards-gallery-phone-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-cards-gallery-chrome-'));
      const file = join(directory, 'cards.html');
      await writeFile(file, page(), 'utf8');
      const chrome = await launchChrome(userDataDir);
      try {
        const phone = (await measurePage(
          chrome.client,
          file,
          390,
          844,
          MEASURE,
          '390x844',
          '.mtg-gallery',
          true,
          { mobile: true, pointer: 'coarse' },
        )) as unknown as Reading | null;
        if (phone === null) throw new Error('390x844: the page drew no gallery');
        expect(phone.coarse, '390x844: the rig emulates the wrong pointer').toBe(true);
        expect(phone.faces, '390x844: the gallery is not the whole corpus').toBe(EXAMPLE_CARDS.length);

        expect(
          phone.chromeAbove ?? Number.POSITIVE_INFINITY,
          `390x844: ${String(phone.chromeAbove)}px of chrome above the first card`,
        ).toBeLessThan(844 * CHROME_SHARE_MAX);
        expect(phone.toggleDrawn, '390x844: nothing opens the collapsed filters').toBe(true);

        expect(
          (phone.galleryWidth ?? 0) - (phone.faceWidth ?? 0),
          `390x844: a ${String(phone.faceWidth)}px face in a ${String(phone.galleryWidth)}px gallery`,
        ).toBeLessThanOrEqual(GUTTER_MAX_PX);
        expect(phone.pageOverflowX, '390x844: the page scrolls sideways').toBeLessThanOrEqual(0.5);

        // The desk arm, for the reason the excised file keeps one: the fix is a
        // width-scoped sheet, and its regression is a phone layout on a desk.
        const desk = (await measurePage(
          chrome.client,
          file,
          1440,
          900,
          MEASURE,
          '1440x900',
          '.mtg-gallery',
          true,
          { mobile: false, pointer: 'fine' },
        )) as unknown as Reading | null;
        if (desk === null) throw new Error('1440x900: the page drew no gallery');
        expect(desk.toggleDrawn, '1440x900: the phone disclosure escaped onto a desk').toBe(false);
        expect(
          (desk.galleryWidth ?? 0) - (desk.faceWidth ?? 0),
          '1440x900: the phone face width escaped onto a desk',
        ).toBeGreaterThan(GUTTER_MAX_PX);
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
