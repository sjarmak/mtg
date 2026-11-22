// @vitest-environment node
/**
 * How much of a landscape phone the Cards tab spends before it draws a card.
 *
 * `mtg-aqxi.21`. 844x390 is a *desktop width* by every query on this sheet —
 * nothing about a phone held sideways is narrow — so the route was handed the
 * full-size page padding, the full-size margin between blocks, and a control bar
 * carrying 24px of air around its two rows of controls. Two rules answer that,
 * and they are in different files because they are about different things:
 *
 *  - `../src/styles/base.ts` compacts the shell's page padding and the margin
 *    between its blocks under `max-height: 520px`, which is the compaction the
 *    narrow query already applied, asked for on the axis that is short.
 *  - `../src/styles/views.ts` takes the air off the control bar itself: half the
 *    padding above and below its rows, and a third off the gap between them.
 *
 * What neither of them does is drop a control, and that is the half worth
 * pinning. Eight identity pills, a search box, three selects and a density
 * switch do not fit on one 844px line, the controls are the point of this route,
 * and on a coarse pointer every one of them is on `../src/styles/touch.ts`'s
 * 44px floor. So the bar is two rows of 44px whatever this sheet does, the
 * compaction is worth the 24px of air around them and not a pixel more, and a
 * rule that got the bar under that by shrinking a control would be a worse bar.
 *
 * The numbers below are therefore ratios and comparisons rather than pinned
 * pixels: the short bar against the tall one, drawn from the same markup in the
 * same browser, and a card on the screen at both.
 *
 * jsdom performs no layout, so none of this is measurable there; the harness is
 * `./support/chrome.ts`.
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
  const round = (value) => Math.round(value * 100) / 100;
  const bar = document.querySelector('.mtg-cardbar');
  const first = document.querySelector('.mtg-card');
  // The controls a person can reach, rather than every control in the markup:
  // the bar carries the phone disclosure's toggle at every width and
  // \`../src/styles/cards-mobile.ts\` draws it only under 40rem, so an
  // undrawn button is not one of this bar's rows (\`mtg-dcxg.9\`).
  const controls = [...(bar?.querySelectorAll('input, select, button') ?? [])].filter((el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  // A row is what a person sees as one, so the controls are clustered by
  // overlapping centers rather than by top: a 29px pill beside a 44px select
  // shares its line and does not share its top.
  const rows = [];
  for (const box of controls.map((el) => el.getBoundingClientRect()).sort((a, b) => a.top - b.top)) {
    const mid = box.top + box.height / 2;
    const row = rows.find((band) => mid >= band.top && mid <= band.bottom);
    if (row === undefined) rows.push({ top: box.top, bottom: box.bottom });
    else {
      row.top = Math.min(row.top, box.top);
      row.bottom = Math.max(row.bottom, box.bottom);
    }
  }
  const style = bar === null ? null : getComputedStyle(bar);
  // The page's own air, read off the shell rather than off a distance between
  // boxes: the bar pulls itself up by a negative margin.
  const main = document.querySelector('.mtg-shell__main');
  return {
    mainPadTop: main === null ? -1 : parseFloat(getComputedStyle(main).paddingTop),
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    barHeight: bar === null ? null : round(bar.getBoundingClientRect().height),
    barPadTop: style === null ? -1 : parseFloat(style.paddingTop),
    barRowGap: style === null ? -1 : parseFloat(style.rowGap),
    firstCardTop: first === null ? null : round(first.getBoundingClientRect().top),
    controls: controls.length,
    controlRows: rows.length,
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
})()`;

interface Reading {
  readonly viewport: readonly number[];
  readonly coarse: boolean;
  readonly barHeight: number | null;
  readonly mainPadTop: number;
  readonly barPadTop: number;
  readonly barRowGap: number;
  readonly firstCardTop: number | null;
  readonly controls: number;
  readonly controlRows: number;
  readonly pageOverflowX: number;
}

/**
 * The most of the window the route may spend on chrome before a card.
 *
 * A fraction rather than a pixel, because what the complaint is about is how
 * much of the window is gone. It is a loose bound on purpose: the tight one is
 * the comparison below, and this is the floor under it — a route that opened on
 * nothing but controls at any size would fail here whatever the sheet said.
 */
const CHROME_SHARE_MAX = 0.62;

/** Search, eight identity pills, three selects, and the density pair — the
 *  phone toggle is in the markup at every width and drawn at none of these. */
const CONTROLS = 14;

/**
 * A phone held sideways, the same phone given height, and a laptop.
 *
 * The middle one is the control and is the reason the pair is measured at one
 * width: what wraps the bar is width and what compacts it is height, so two
 * readings 844px wide with 510px of height between them isolate the rule from
 * the wrapping. The laptop is there because a rule keyed on height with no upper
 * bound is a rule that reaches a desktop window nobody has maximized.
 */
const SIZES = [
  { width: 844, height: 390, coarse: true, rows: 2 },
  { width: 844, height: 900, coarse: true, rows: 2 },
  { width: 1440, height: 900, coarse: false, rows: 1 },
] as const;

describe('the Cards tab on a phone held sideways', () => {
  browserIt(
    'gives the cards the air the control bar was holding, and keeps every control',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-cards-short-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-cards-short-chrome-'));
      const file = join(directory, 'cards.html');
      await writeFile(file, page(), 'utf8');
      const chrome = await launchChrome(userDataDir);
      const seen = new Map<string, Reading>();
      try {
        for (const size of SIZES) {
          const at = `${String(size.width)}x${String(size.height)}`;
          const reading = (await measurePage(
            chrome.client,
            file,
            size.width,
            size.height,
            MEASURE,
            at,
            '.mtg-cardbar',
            true,
            size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
          )) as unknown as Reading | null;
          if (reading === null) throw new Error(`${at}: the page drew no control bar`);
          seen.set(at, reading);

          // The route still works: every control is on the bar, on two rows,
          // and the page does not go sideways to hold them.
          expect(reading.coarse, `${at}: the rig emulates the wrong pointer`).toBe(size.coarse);
          expect(reading.controls, `${at}: the bar lost a control`).toBe(CONTROLS);
          expect(reading.controlRows, `${at}: the bar wraps to the wrong number of rows`).toBe(size.rows);
          expect(reading.pageOverflowX, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(0.5);

          // And the route does not open on chrome alone.
          expect(reading.firstCardTop ?? Number.POSITIVE_INFINITY, `${at}: no card is drawn`).toBeLessThan(
            size.height * CHROME_SHARE_MAX,
          );
        }

        // The compaction is the short screen's and it is real: the same bar at
        // the same width, holding the same two rows of the same controls, is
        // shorter when the window is short. Read as the air itself as well as
        // the height, because the height is two 44px rows plus that air and the
        // rows are the touch floor's rather than this sheet's.
        const short = seen.get('844x390');
        const tall = seen.get('844x900');
        const desk = seen.get('1440x900');
        if (short === undefined || tall === undefined || desk === undefined) {
          throw new Error('a size went unmeasured');
        }
        expect(short.mainPadTop, 'the page keeps its padding on a short screen').toBeLessThan(
          tall.mainPadTop,
        );
        expect(short.barPadTop, 'the bar keeps its padding on a short screen').toBeLessThan(tall.barPadTop);
        expect(short.barRowGap, 'the bar keeps the gap between its rows').toBeLessThan(tall.barRowGap);
        expect(
          (tall.barHeight ?? 0) - (short.barHeight ?? 0),
          'the short bar is no shorter than the tall one',
        ).toBeGreaterThanOrEqual(2 * (tall.barPadTop - short.barPadTop) + (tall.barRowGap - short.barRowGap));

        // The height the compaction bought goes to the cards, and it is spent
        // where it was asked for: the first tile moves up by at least as much.
        expect(
          (tall.firstCardTop ?? 0) - (short.firstCardTop ?? 0),
          'the bar gave its height back to something that is not a card',
        ).toBeGreaterThanOrEqual((tall.barHeight ?? 0) - (short.barHeight ?? 0));

        // And a laptop window is untouched by a rule that reads height.
        expect(desk.barPadTop, 'the short bar rule reaches a laptop window').toBe(tall.barPadTop);
        expect(desk.mainPadTop, 'the short page rule reaches a laptop window').toBe(tall.mainPadTop);
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
