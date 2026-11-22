// @vitest-environment node
/**
 * The destinations at the foot of a phone, measured rather than described.
 *
 * `mtg-tewc.3`. the playtester's specification asks for "persistent bottom
 * navigation" on mobile with the same destinations the desktop draws, and for
 * the two breakpoints not to grow different information architecture. The
 * implementation is one `<nav>` re-laid-out by `../../src/styles/mobile.ts`
 * rather than a second bar in the markup, and that is exactly the kind of claim
 * a jsdom test cannot make: jsdom performs no layout, so "it is at the bottom"
 * has to be read off a real Chrome.
 *
 * There are four of them now: Play, Customize, Cards and Analysis
 * (`../../src/app/router.ts`'s `PRIMARY_MODES`). Draft, Decks, Replay and
 * Design used to be their own destinations; each is a section of the mode
 * that owns it now (`mtg-a982g.1`), so the bar shrank from seven names to four
 * without losing anywhere for a section to go. Four across a 390px screen
 * gives each one 97.5px, and the width assertions below stay load-bearing
 * rather than decorative regardless of which label is longest: *Customize* is
 * the nine-letter word that has to fit now, and the assertion is what proves
 * it does rather than a comment that guesses so. If the labels ever stop
 * fitting, this is where it is found.
 *
 * `mtg-dcxg.6` is the reading that made the second sentence below necessary,
 * found on the seven-item bar this replaced: the columns were always equal
 * and always inside the glass, so every box the first version of this file
 * measured was correct while the row looked broken. A label can want more
 * room than its column gives it, and a word wider than its box does not wrap
 * and does not clip — it bleeds past the padding into its neighbor. A
 * measurement of the box cannot see that. A range over the text can, so that
 * is what sentence 2 reads, whichever label is longest under whatever number
 * of columns draws it.
 *
 * Five sentences:
 *
 * 1. On a portrait phone the nav sits on the bottom edge, spans the screen, and
 *    holds all four.
 * 2. Every label is inside the column it is drawn in, and none reaches the right
 *    edge of the screen.
 * 3. Every one of the four is a finger-sized target.
 * 4. The page ends above it rather than under it — the last row of a list is
 *    reachable, not covered.
 * 5. A desktop window is unchanged: the nav is in the bar at the top.
 *
 * The route drawn is Customize, on its Decks section, which draws neither a
 * board nor a `.mtg-screen`. What happens on the two modes that do — Play's
 * own screens and Customize's deck editor — is `../play/`'s and `../deck/`'s
 * subject: the bar is hidden there and takes this with it, because the nav is
 * inside it.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PRIMARY_MODES } from '../../src/app/router';
import { uiStyleSheet } from '../../src/styles/index';
import { BOTTOM_NAV_REM } from '../../src/styles/mobile';
import { TOUCH_TARGET_PX } from '../../src/styles/touch';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/**
 * A page longer than the screen, so the foot of the content is somewhere the nav
 * could cover.
 *
 * The length is load-bearing and was measured: twenty rows came to 751px of an
 * 844px screen, the document never scrolled, and the last row sat above the nav
 * whether or not the page reserved any room for it. A claim that holds when the
 * rule under test is deleted is not a claim.
 */
function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'customize',
      sub: 'decks',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(
        'div',
        { className: 'mtg-panel' },
        ...Array.from({ length: 60 }, (_unused, index) =>
          h('p', { key: index, className: 'mtg-page-note' }, `A row of a list, number ${String(index)}.`),
        ),
        h('p', { key: 'last', id: 'last-row', className: 'mtg-page-note' }, 'The last row of the list.'),
      ),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bottom nav</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const modes = document.querySelector('.mtg-modes');
  const main = document.querySelector('.mtg-shell__main');
  const last = document.getElementById('last-row');
  if (modes === null || main === null || last === null) return null;
  const box = modes.getBoundingClientRect();
  const items = [...modes.querySelectorAll('.mtg-modes__item')];
  // Where the *word* is, not where its box is. A label wider than the content
  // box it sits in neither wraps nor clips — it bleeds past the padding — so the
  // box measurements below cannot see the defect and a range over the text can.
  const overflow = items.map((item) => {
    const style = getComputedStyle(item);
    const inner = item.getBoundingClientRect();
    const left = inner.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const right = inner.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    const range = document.createRange();
    range.selectNodeContents(item);
    const text = range.getBoundingClientRect();
    return { label: item.textContent, over: round(Math.max(left - text.left, text.right - right)) };
  });
  // The page is scrolled to its end first: the claim is that the last row can be
  // read, which is only interesting once there is nothing left to scroll.
  window.scrollTo(0, document.documentElement.scrollHeight);
  const lastBottom = round(last.getBoundingClientRect().bottom);
  const navTop = round(modes.getBoundingClientRect().top);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    position: getComputedStyle(modes).position,
    navTop: round(box.top),
    navBottom: round(box.bottom),
    navLeft: round(box.left),
    navRight: round(box.right),
    navHeight: round(box.height),
    itemCount: items.length,
    itemLabels: items.map((item) => item.textContent),
    shortestItem: round(Math.min(...items.map((item) => item.getBoundingClientRect().height))),
    narrowestItem: round(Math.min(...items.map((item) => item.getBoundingClientRect().width))),
    mainPadEnd: round(parseFloat(getComputedStyle(main).paddingBottom)),
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    lastRowCovered: lastBottom > navTop,
    worstLabelOverflow: round(Math.max(...overflow.map((entry) => entry.over))),
    widestLabel: overflow.reduce((worst, entry) => (entry.over > worst.over ? entry : worst)).label,
    labelRight: round(Math.max(...items.map((item) => {
      const range = document.createRange();
      range.selectNodeContents(item);
      return range.getBoundingClientRect().right;
    }))),
  };
})()`;

interface Reading {
  readonly viewport: readonly number[];
  readonly position: string;
  readonly navTop: number;
  readonly navBottom: number;
  readonly navLeft: number;
  readonly navRight: number;
  readonly navHeight: number;
  readonly itemCount: number;
  readonly itemLabels: readonly string[];
  readonly shortestItem: number;
  readonly narrowestItem: number;
  readonly mainPadEnd: number;
  readonly pageOverflowX: number;
  readonly lastRowCovered: boolean;
  readonly worstLabelOverflow: number;
  readonly widestLabel: string | null;
  readonly labelRight: number;
}

const SLACK_PX = 0.5;

/** The rem-to-px factor the sheet is written against. */
const REM_PX = 16;

const PHONE = { width: 390, height: 844, coarse: true } as const;
const DESKTOP = { width: 1440, height: 900, coarse: false } as const;

async function read(
  client: Parameters<typeof measurePage>[0],
  file: string,
  size: { readonly width: number; readonly height: number; readonly coarse: boolean },
): Promise<Reading> {
  const at = `${String(size.width)}x${String(size.height)}`;
  const seen = (await measurePage(
    client,
    file,
    size.width,
    size.height,
    MEASURE,
    at,
    '.mtg-modes',
    true,
    size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
  )) as unknown as Reading | null;
  if (seen === null) throw new Error(`${at}: the page drew no mode nav`);
  return seen;
}

describe('the destinations on a phone', () => {
  browserIt(
    'sit on the bottom edge, finger-sized, without covering the end of the page',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-bottom-nav-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-bottom-nav-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'nav.html');
      await writeFile(file, page(), 'utf8');
      try {
        const phone = await read(chrome.client, file, PHONE);

        // 1. On the bottom edge, spanning it, holding the four and only the four.
        expect(phone.position, 'the nav is not pinned to the viewport').toBe('fixed');
        expect(phone.navBottom, 'the nav is not on the bottom edge').toBeCloseTo(PHONE.height, 0);
        expect(phone.navLeft, 'the nav does not reach the left edge').toBeLessThanOrEqual(SLACK_PX);
        expect(phone.navRight, 'the nav does not reach the right edge').toBeCloseTo(PHONE.width, 0);
        expect(phone.itemCount, 'the phone draws a different set of destinations').toBe(PRIMARY_MODES.length);
        expect(phone.itemLabels, 'the phone draws different destinations').toEqual([
          'Play',
          'Customize',
          'Cards',
          'Analysis',
        ]);
        expect(phone.pageOverflowX, 'four across makes the page scroll sideways').toBeLessThanOrEqual(
          SLACK_PX,
        );

        // 2. Every label is inside the column it is drawn in, and the last of
        // them is not against the bezel (`mtg-dcxg.6`, found on the seven-item
        // bar this replaced: a label can outgrow its column at one text size
        // and clear it at another, and a word that does neither is the one
        // this check cannot pass by accident). This is the assertion the box
        // readings could not make: a word that outgrows its box overflows it
        // silently. No slack on this one: a label is inside its content box or
        // it is not.
        expect(
          phone.worstLabelOverflow,
          `the label ${phone.widestLabel ?? 'unknown'} is wider than its own column`,
        ).toBeLessThanOrEqual(0);
        expect(phone.labelRight, 'the last label runs past the right edge').toBeLessThanOrEqual(PHONE.width);

        // 3. Every one of them is a target, not a word.
        expect(phone.shortestItem, 'a destination is under the touch floor').toBeGreaterThanOrEqual(
          TOUCH_TARGET_PX - SLACK_PX,
        );
        expect(phone.narrowestItem, 'a destination is too narrow to press').toBeGreaterThan(
          PHONE.width / PRIMARY_MODES.length - 1,
        );

        // 4. The page ends above it. Both halves: the reserved space is at least
        // the bar, and the last row of a scrolled-to-the-end list is not under it.
        expect(phone.mainPadEnd, 'the page reserves less room than the nav takes').toBeGreaterThanOrEqual(
          BOTTOM_NAV_REM * REM_PX - SLACK_PX,
        );
        expect(phone.mainPadEnd, 'the reserved room is less than the nav is tall').toBeGreaterThanOrEqual(
          phone.navHeight - SLACK_PX,
        );
        expect(phone.lastRowCovered, 'the last row of the page is under the nav').toBe(false);

        // 5. A desktop window is the bar it always was.
        const desktop = await read(chrome.client, file, DESKTOP);
        expect(desktop.position, 'a desktop window grew a bottom bar').not.toBe('fixed');
        expect(desktop.navTop, 'the desktop nav left the top bar').toBeLessThan(DESKTOP.height / 4);
        expect(desktop.itemCount, 'the two breakpoints draw different destinations').toBe(phone.itemCount);
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
