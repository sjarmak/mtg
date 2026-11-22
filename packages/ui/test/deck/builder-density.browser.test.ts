// @vitest-environment node
/**
 * How much of the Limited builder is chrome, and how big a card is in each pane.
 *
 * `mtg-84703`. the playtester read a finished Innistrad draft and said the page was
 * spending its space on the wrong things: "there is a lot of information that is
 * taking up valuable UI space ... this reclaim of space to better see available
 * cards should be applied across any other similar interface. Also the cards in
 * the drafted pool should be the same size as the ones in the deck (deck size of
 * cards looks correct here, drafted pool cards are too large)."
 *
 * Both halves of that are measurements, so this rig takes them. It mounts
 * `PhysicalLimitedBuilder` on the pinned Legacy Cube catalog rather than driving
 * the route, because 42 draft picks is a slow way to arrive at a builder and the
 * chrome above the panes is the same chrome either way; `./live-builder-density-entry.ts`
 * is the composition, and it is the editor's own -- a `title` on the bar and
 * `printedPoolStatus` for the banner -- so this measures what the route draws.
 *
 * The readings, identical at 1024x768, 1280x800 and 1440x900:
 *
 *              chromePx   headPx  bannerPx  barPx   deck face/font   pool face/font
 *   before      131.44    21.75     18.84   37.84    234 / 9.62       288 / 11.39
 *   after        58.84         0         0  37.84    234 / 9.62       244 / 9.62
 *
 * Three rows of chrome became one. The page head went because `mtg-i8xl` had
 * already moved the Constructed builder's title onto its bar and this is the same
 * move; the banner went because a status line that says "Deck saved" and
 * "40 cards in deck" and "Verified full-card ... admission is installed" is three
 * facts nobody is reading in the clean state -- the count is on the deck pane's
 * own note, the admission sentence is a `GameDetails` term beside the seed, and
 * what is left is a `role="alert"` row that draws only when saving or play is
 * actually broken.
 *
 * The two faces are 234 and 244 and that is one card size, not two: both panes
 * lay out a 244px column, and the deck's faces are strips inside a column that
 * clips, so a ~10px overlay scrollbar comes off the face. Before, the pool was
 * 288px against the deck's 234 -- 23% larger, side by side, which is what she was
 * looking at. What made the pool larger was a printed 18rem override in
 * `src/styles/printed-reading.ts`; removing it drops the pool onto `views.ts`'s
 * 15.25rem, which is `@mtg/card-geometry`'s `FULL_FACE_WIDTH_REM` and the width
 * the deck pane has always used.
 *
 * The font is the reason to measure rather than to reason. A 15.25rem face has
 * about a 14.4rem content box, which is short of the `@container (min-width: 16rem)`
 * rung the printed reading ladder opens at, so its rules text is sized by
 * `--rules-type` instead of by `cqi`: 9.62px rather than 11.39px. That is not a
 * new rendering state being introduced -- it is the path the deck pane's faces
 * were already on, at the same 9.62px with no overflow across this cube's
 * positions, and the deck pane is the drawing she called correct.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect } from 'vitest';
import { livePage } from '../support/live-page';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';

/** What one pane is worth measuring for: how big its cards are and whether they fit. */
interface PaneReading {
  readonly faces: number;
  readonly facePx: number | null;
  readonly fontPx: number | null;
  readonly overflowPx: number | null;
  readonly scrollPx: number | null;
  readonly cardsPx: number | null;
}

interface Reading {
  readonly viewport: string;
  readonly chromePx: number | null;
  readonly headPx: number;
  readonly bannerPx: number;
  readonly barPx: number;
  readonly deck: PaneReading;
  readonly pool: PaneReading;
}

/**
 * The budget, stated here rather than left implicit in the numbers below.
 *
 * `CHROME_CEILING_PX` is one bar and its gaps and nothing else; the measured 58.84
 * has 11px of room, which is a font-metric wobble's worth and not a second row's.
 * `FACE_FLOOR_PX` is the 244px column, and `FACE_SPREAD_PX` is the overlay
 * scrollbar the clipped deck column takes off its faces -- the two panes draw one
 * card size, and this says how much of a difference is still one size.
 * `FONT_FLOOR_PX` is the `--rules-type` rung both panes now sit on.
 */
const CHROME_CEILING_PX = 70;
const FACE_FLOOR_PX = 234;
const FACE_SPREAD_PX = 10;
const FONT_FLOOR_PX = 9.5;

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'live-builder-density-entry.ts');

const SETTLED = `new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const check = () => {
    if (document.querySelector('[aria-label="Cards in your deck"] .mtg-card') !== null &&
        document.querySelector('[aria-label="Drafted pool"] .mtg-card') !== null) {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      return;
    }
    if (Date.now() > deadline) { reject(new Error('the builder never mounted both panes')); return; }
    setTimeout(check, 25);
  };
  check();
})`;

const READ = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const screen = document.querySelector('.mtg-builder-screen');
  const panes = document.querySelector('.mtg-builder__panes');
  const pane = (kind) => {
    const root = document.querySelector('[data-pane="' + kind + '"]');
    const scroll = root?.querySelector('.mtg-deck__pane-scroll');
    const faces = [...(root?.querySelectorAll('[data-presentation="printed-card"]') ?? [])];
    const texts = faces.map((face) => face.querySelector('.mtg-card__text')).filter((text) => text !== null);
    return {
      faces: faces.length,
      facePx: faces.length === 0 ? null : round(faces[0].getBoundingClientRect().width),
      fontPx: texts.length === 0 ? null : round(Math.min(...texts.map((text) => parseFloat(getComputedStyle(text).fontSize)))),
      overflowPx: texts.length === 0 ? null : Math.max(0, ...texts.map((text) => {
        const box = text.closest('[data-region="rules"]') ?? text;
        return Math.round(box.scrollHeight - box.clientHeight);
      })),
      scrollPx: scroll === null || scroll === undefined ? null : round(scroll.getBoundingClientRect().height),
      cardsPx: scroll === null || scroll === undefined ? null : scroll.scrollHeight
    };
  };
  const band = (selector) => {
    const found = document.querySelector(selector);
    return found === null ? 0 : round(found.getBoundingClientRect().height);
  };
  return {
    viewport: window.innerWidth + 'x' + window.innerHeight,
    chromePx: screen === null || panes === null
      ? null
      : round(panes.getBoundingClientRect().top - screen.getBoundingClientRect().top),
    headPx: band('.mtg-page-head'),
    bannerPx: band('.mtg-printed-pool-status'),
    barPx: band('.mtg-builder__bar'),
    deck: pane('deck'),
    pool: pane('pool')
  };
})()`;

describe('how much of the Limited builder is chrome', () => {
  browserIt(
    'measures the bands above the panes and the face width in each pane',
    async () => {
      const page = await livePage(ENTRY, 'Limited builder density');
      const directory = await mkdtemp(join(tmpdir(), 'mtg-builder-density-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-builder-density-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'density.html');
      await writeFile(file, page, 'utf8');
      let targetId = '';
      let sessionId = '';
      const evaluate = async (expression: string): Promise<unknown> => {
        const answer = await chrome.client.call(
          'Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise: true },
          sessionId,
          30_000,
        );
        if (answer['exceptionDetails'] !== undefined) {
          throw new Error(`the density page threw: ${JSON.stringify(answer['exceptionDetails'])}`);
        }
        return (answer['result'] as { readonly value?: unknown } | undefined)?.value;
      };
      try {
        const target = await chrome.client.call('Target.createTarget', { url: 'about:blank' });
        targetId = String(target['targetId']);
        const attached = await chrome.client.call('Target.attachToTarget', { targetId, flatten: true });
        sessionId = String(attached['sessionId']);
        await chrome.client.call('Page.enable', {}, sessionId);
        await chrome.client.call('Runtime.enable', {}, sessionId);
        await chrome.client.call(
          'Emulation.setDeviceMetricsOverride',
          { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
          sessionId,
        );
        await chrome.client.call('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
        await evaluate(SETTLED);
        const readings: Reading[] = [];
        for (const [width, height] of [
          [1024, 768],
          [1280, 800],
          [1440, 900],
        ]) {
          await chrome.client.call(
            'Emulation.setDeviceMetricsOverride',
            { width, height, deviceScaleFactor: 1, mobile: false },
            sessionId,
          );
          await evaluate(
            'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
          );
          readings.push((await evaluate(READ)) as Reading);
        }
        console.log(JSON.stringify(readings, null, 2));
        expect(readings).toHaveLength(3);
        for (const reading of readings) {
          // One bar above the panes, and the page head and the clean-state
          // banner drawing nothing at all.
          expect(reading.chromePx).toBeLessThanOrEqual(CHROME_CEILING_PX);
          expect(reading.headPx).toBe(0);
          expect(reading.bannerPx).toBe(0);
          expect(reading.barPx).toBeGreaterThan(0);
          for (const pane of [reading.deck, reading.pool]) {
            expect(pane.faces).toBeGreaterThan(0);
            expect(pane.facePx).toBeGreaterThanOrEqual(FACE_FLOOR_PX);
            expect(pane.fontPx).toBeGreaterThanOrEqual(FONT_FLOOR_PX);
            expect(pane.overflowPx).toBe(0);
          }
          // The half of the bead that is about the pool: one card size across
          // the two panes, to within the deck column's scrollbar.
          expect(Math.abs((reading.pool.facePx ?? 0) - (reading.deck.facePx ?? 0))).toBeLessThanOrEqual(
            FACE_SPREAD_PX,
          );
        }
      } finally {
        if (targetId !== '' && sessionId !== '') {
          await cleanupTarget(chrome.client, targetId, sessionId).catch(() => undefined);
        }
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
