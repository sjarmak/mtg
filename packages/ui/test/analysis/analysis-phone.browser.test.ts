// @vitest-environment node
/**
 * The analysis surface on a phone held upright, where its navigation was
 * larger than its answer.
 *
 * `mtg-dcxg.8`, 2026-08-23. Measured before the fix in chrome-headless-shell
 * over `./fixtures/run-a.json` at 390x844, mobile and coarse: the nine section
 * chips wrapped to four rows, each chip 27.6px tall against the 44px touch
 * floor, and the first statistic on the page — the gate census, which is the
 * answer somebody opened this tab for — began 384.7px down a 844px screen. The
 * sweep's own frame says the same thing:
 * `out/shots/route-analysis.portrait.png` spends its whole upper half on a
 * title, a run picker, a set name and four ragged rows of chips.
 *
 * So this file asks three things at that size, and each one fails on that
 * reading:
 *
 *  1. The chips are **one row**, read off their rounded tops rather than off a
 *     `flex-wrap` declaration, because a row count is the thing that was wrong
 *     and the declaration that produces it is an implementation detail. The row
 *     scrolls sideways instead of wrapping, so the population is asserted too:
 *     eleven chips, or the zero rows below would be a selector that found
 *     nothing.
 *  2. **Every chip clears 44px.** The strip is the route's primary navigation
 *     and it is pressed with a thumb.
 *  3. **The answer is above the fold.** The gate census starts within
 *     `CHROME_CEILING` of the top of the screen, which is what makes the
 *     scrolling strip a saving rather than a rearrangement.
 *
 * The desk reading is here for the reason the replay rig keeps one: the rules
 * are a width query in the route's own sheet, and the regression they could
 * cause is a phone layout escaping onto a 1440px window. Eleven chips in one row
 * there as well, and no sideways scroll on the document at either size.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { AnalysisSurface } from '../../src/routes/analysis/AnalysisView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';
import { loadRun, loadSet } from './support/fixtures';

/**
 * The tallest the chrome above the answer may be on a phone.
 *
 * 300px of an 844px screen: the shell bar, the page head, the run picker and
 * the section strip, with the gate census starting inside the top third. The
 * measured before-figure is 384.7px, and the number is a ceiling rather than a
 * fit — anything under it leaves the three headline statistics on the first
 * screen, which is the whole requirement. It reads 238.4px after the fix.
 */
const CHROME_CEILING = 300;

/** The touch floor the whole surface is built to, `styles/touch.ts`' number. */
const TOUCH_FLOOR = 44;

/** Sub-pixel layout residue, the slack every rig in this directory allows. */
const SLACK_PX = 0.5;

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'analysis',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(AnalysisSurface, {
        runs: { status: 'ready', runs: [{ run: loadRun('run-a'), set: loadSet() }] },
        games: { status: 'absent' },
        route: { mode: 'analysis', sub: 'explorer', params: {} },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Analysis</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * The strip, the first statistic, and the document's own width.
 *
 * One expression rather than a page script, the way the rigs beside this one
 * are, so the driver is a navigate and one `Runtime.evaluate`.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const chips = Array.from(document.querySelectorAll('.mtg-subnav__item'));
  const boxes = chips.map((chip) => chip.getBoundingClientRect());
  const rows = [...new Set(boxes.map((box) => Math.round(box.top)))].length;
  const strip = document.querySelector('.mtg-subnav');
  const stats = document.querySelector('.mtg-stats');
  const width = document.documentElement.clientWidth;
  return {
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    chips: chips.length,
    rows: rows,
    shortest: boxes.length === 0 ? null : round(Math.min(...boxes.map((box) => box.height))),
    stripPast: strip === null ? null : round(strip.getBoundingClientRect().right - width),
    statsTop: stats === null ? null : round(stats.getBoundingClientRect().top),
    docOverflowX: round(document.documentElement.scrollWidth - width),
  };
})()`;

interface Reading {
  readonly viewport: readonly number[];
  readonly coarse: boolean;
  readonly chips: number;
  readonly rows: number;
  readonly shortest: number | null;
  readonly stripPast: number | null;
  readonly statsTop: number | null;
  readonly docOverflowX: number;
}

/** A phone upright, and the laptop window the sweep also photographs. */
const SIZES = [
  { width: 390, height: 844, coarse: true },
  { width: 1440, height: 900, coarse: false },
] as const;

describe('the analysis surface on a phone', () => {
  browserIt(
    'keeps its sections one thumb-sized row and its answer above the fold',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-analysis-phone-'));
      const chrome = await launchChrome(join(directory, 'chrome'));
      try {
        const file = join(directory, 'analysis.html');
        await writeFile(file, page(), 'utf8');
        for (const size of SIZES) {
          const at = `${String(size.width)}x${String(size.height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            size.width,
            size.height,
            MEASURE,
            at,
            '.mtg-analysis',
            true,
            size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no analysis surface`);
          expect(seen.coarse, `${at}: the rig emulates the right pointer`).toBe(size.coarse);

          // The population, so the row count below is worth reading.
          expect(seen.chips, `${at}: the section strip is not drawn`).toBe(11);
          expect(seen.rows, `${at}: the section chips wrap to ${String(seen.rows)} rows`).toBe(1);
          expect(seen.stripPast, `${at}: the section strip is not drawn`).not.toBeNull();
          expect(
            seen.stripPast ?? 0,
            `${at}: the section strip runs past the right edge`,
          ).toBeLessThanOrEqual(SLACK_PX);

          if (size.coarse) {
            expect(
              seen.shortest ?? 0,
              `${at}: the shortest section chip is ${String(seen.shortest)}px`,
            ).toBeGreaterThanOrEqual(TOUCH_FLOOR);
          }

          expect(seen.statsTop, `${at}: the gate census is not drawn`).not.toBeNull();
          expect(
            seen.statsTop ?? 0,
            `${at}: the gate census starts ${String(seen.statsTop)}px down the screen`,
          ).toBeLessThanOrEqual(CHROME_CEILING);

          expect(seen.docOverflowX, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(SLACK_PX);
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
