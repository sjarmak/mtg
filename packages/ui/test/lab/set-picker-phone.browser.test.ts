// @vitest-environment node
/**
 * The one control that changes which set the lab is showing, measured on a
 * phone rather than described.
 *
 * `mtg-aqxi.11`, second half. the playtester, after asking for the app's chrome to
 * come off a landscape screen: "And need an easy way to swap between available
 * sets (e.g XMP and M11 currently)." The control for that already exists —
 * `../../src/app/SetPicker.ts` draws a `<select>` in the shell bar as soon as
 * the launcher has staged more than one set, and every tab reads the staged
 * set — so this is not a new affordance. What it was, on a phone, was 30px
 * tall inside a 100px bar made almost entirely of two decorative labels.
 *
 * Two sentences, on a route that draws no board and no `.mtg-screen`, which is
 * where a set is actually chosen:
 *
 * 1. The bar is a row of controls and not a page header: measured, not more
 *    than the tallest control in it plus its own padding.
 * 2. The picker is in it, drawn, and a finger-sized target.
 *
 * Amended for `mtg-aqxi.17`: the mark is no longer the set's name, it is the
 * word `MTG Lab` and a link to Play, so it is a control and is drawn at every
 * size. Amended again by the UI pass, which is why there is no third sentence
 * about a desktop window keeping its labels: the subtitle and the analysis
 * aside are off every viewport now, not hidden on the short ones. A header that
 * reads `PLAY, ANALYZE, REPLAY` and `XMP · 2,700 games analyzed` describes the
 * application to somebody already inside it.
 *
 * The set list is two builds of two different sets, because one staged set
 * renders as a label rather than a select and would measure a control that is
 * not the one under test.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { SetPicker } from '../../src/app/SetPicker';
import { Shell } from '../../src/app/Shell';
import type { StagedSetRow } from '../../src/lab/set-index';
import { uiStyleSheet } from '../../src/styles/index';
import { TOUCH_TARGET_PX } from '../../src/styles/touch';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/** What `npm run play` stages on this checkout, minus the two it also finds. */
const STAGED: readonly StagedSetRow[] = [
  {
    stem: 'xmp',
    name: 'the flagship set',
    code: 'XMP',
    what: 'the committed flagship set',
    cardCount: 371,
    reduced: false,
    origin: 'custom',
    setUrl: 'sets/xmp/set.json',
  },
  {
    stem: 'm11',
    name: 'Magic 2011 (reduced)',
    code: 'M11',
    what: 'the reduced reference build in out/reference/m11',
    cardCount: 162,
    reduced: true,
    origin: 'official',
    setUrl: 'sets/m11/set.json',
  },
];

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'customize',
      sub: 'decks',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      setPicker: h(SetPicker, { sets: STAGED, selected: 'm11', onSelect: () => undefined }),
      children: h('div', { className: 'mtg-panel' }, 'A route with neither a board nor a screen.'),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Set picker</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const bar = document.querySelector('.mtg-shell__bar');
  const select = document.querySelector('.mtg-setpick__select');
  const modes = document.querySelector('.mtg-modes');
  const mark = document.querySelector('.mtg-shell__mark');
  if (bar === null || select === null || modes === null || mark === null) return null;
  const height = (el) => round(el.getBoundingClientRect().height);
  const width = (el) => round(el.getBoundingClientRect().width);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    barHeight: height(bar),
    barOverflowX: round(bar.scrollWidth - bar.clientWidth),
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    selectHeight: height(select),
    selectWidth: width(select),
    optionCount: select.querySelectorAll('option').length,
    options: [...select.querySelectorAll('option')].map((option) => option.textContent ?? ''),
    modesHeight: height(modes),
    markHeight: height(mark),
    markHref: mark.getAttribute('href'),
    markWidth: width(mark),
    markClip: getComputedStyle(mark).clipPath,
  };
})()`;

interface Reading {
  readonly viewport: readonly number[];
  readonly barHeight: number;
  readonly barOverflowX: number;
  readonly pageOverflowX: number;
  readonly selectHeight: number;
  readonly selectWidth: number;
  readonly optionCount: number;
  readonly options: readonly string[];
  readonly modesHeight: number;
  readonly markHeight: number;
  readonly markHref: string | null;
  readonly markWidth: number;
  readonly markClip: string;
}

/**
 * `short` is whether the viewport is one of the two the compressed bar is for.
 * A desktop window is measured too, and for the assertions that hold
 * everywhere: the bar does not scroll sideways, the picker is a real control,
 * and the mark is a drawn link to Play.
 */
const SIZES = [
  { width: 844, height: 390, coarse: true, short: true },
  { width: 932, height: 430, coarse: true, short: true },
  { width: 1440, height: 900, coarse: false, short: false },
] as const;

/**
 * What the bar measured before this tier existed, at 844x390 with four sets
 * staged: 100.38px of a 390px screen, none of it a control. The fix has to beat
 * that by a wide margin rather than shave it, so the assertion is against the
 * height of what is left standing in the row and not against the old number.
 */
const BEFORE_BAR_PX = 100.38;

const SLACK_PX = 0.5;

/**
 * What a box hidden the way `../../src/styles/base.ts` hides a spoken-not-drawn
 * one measures: it is clipped to a single pixel and left in the accessibility
 * tree rather than removed from the layout, so the assertion is "one pixel" and
 * not "zero". A band that came back 20px tall failed it either way.
 */
const SPOKEN_PX = 1;

describe('the set picker on a phone', () => {
  browserIt(
    'is a finger-sized control in a bar made of controls',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-set-picker-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-set-picker-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'picker.html');
      await writeFile(file, page(), 'utf8');
      try {
        for (const size of SIZES) {
          const at = `${String(size.width)}x${String(size.height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            size.width,
            size.height,
            MEASURE,
            at,
            '.mtg-shell__bar',
            true,
            size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no bar, or no picker in it`);

          // The control is the one under test: a select over every staged set.
          expect(seen.optionCount, `${at}: the picker is not a choice between sets`).toBe(STAGED.length);
          expect(seen.options, `${at}: the retired prototype returned to the picker`).not.toContain(
            'Tideglass Reach',
          );
          expect(seen.selectWidth, `${at}: the picker has no width to press`).toBeGreaterThan(
            TOUCH_TARGET_PX,
          );

          // Nothing overflows sideways to make room for it.
          expect(seen.barOverflowX, `${at}: the bar scrolls sideways`).toBeLessThanOrEqual(SLACK_PX);
          expect(seen.pageOverflowX, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(SLACK_PX);

          // The mark is the way back to Play at every size (`mtg-aqxi.17`, and
          // the UI pass repointed it), so it is drawn on the phone arms too and
          // this assertion is outside the branch.
          expect(seen.markHref, `${at}: the mark is not a link to Play`).toBe('#/play');
          expect(seen.markHeight, `${at}: there is no way back to Play`).toBeGreaterThanOrEqual(
            size.coarse ? TOUCH_TARGET_PX - SLACK_PX : SPOKEN_PX,
          );
          // Height alone cannot tell a drawn control from a hidden one here:
          // `../../src/styles/touch.ts` floors this element at 44px on a coarse
          // pointer, and that floor beats the 1px a spoken-not-drawn box is
          // given. The clip and the width are what actually differ.
          expect(seen.markClip, `${at}: the mark is clipped out of the drawing`).toBe('none');
          expect(seen.markWidth, `${at}: the mark is clipped to a line`).toBeGreaterThan(TOUCH_TARGET_PX);

          if (!size.short) continue;

          // 1. A row of controls, not a page header. The subtitle and the
          // analysis aside used to be hidden here and drawn on a desktop; they
          // are gone at every size now, so what is left to measure is that the
          // row costs no more than the controls in it.
          expect(seen.barHeight, `${at}: the bar is no shorter than it was before the tier`).toBeLessThan(
            BEFORE_BAR_PX,
          );
          expect(
            seen.barHeight,
            `${at}: the bar is taller than the tallest control it holds`,
          ).toBeLessThanOrEqual(Math.max(seen.modesHeight, seen.selectHeight) + TOUCH_TARGET_PX / 4);

          // 2. And the picker is a target rather than a desktop select.
          expect(seen.selectHeight, `${at}: the set picker is too small to hit`).toBeGreaterThanOrEqual(
            TOUCH_TARGET_PX - SLACK_PX,
          );
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
