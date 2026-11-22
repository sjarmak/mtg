// @vitest-environment node
/**
 * The replay viewer on a phone held upright, which is where it was still a
 * desktop table.
 *
 * `mtg-dcxg.1`, 2026-08-23. Measured before the fix in chrome-headless-shell
 * over `./support/log-fixture.ts` at seq 0, 390x844, mobile and coarse:
 * `.mtg-board`'s `grid-template-columns` read `88px 0px 272px`. The pods held
 * 88, the rail took 272 and ran to x=397 on a 390px screen, and the lanes — both
 * battlefields, both hands, every card in the game being watched — were a track
 * zero pixels wide whose children painted over the two columns beside it. What
 * a reader saw is the 2026-08-23 sweep's `out/shots/route-replay.portrait.png`:
 * "Side panel" and "What happened" over the seat pods and the mat, "no
 * permanents" through the event list, a `<select>` off the right-hand edge.
 *
 * So this file asks three things of the route at that size, and each one fails
 * on that reading:
 *
 *  1. The board is **one column**. Read off `grid-template-columns` rather than
 *     inferred from boxes, because a track list is the thing that was wrong and
 *     a layout that happened to look stacked for another reason is not the fix.
 *  2. **Nothing is painted over anything.** Nine named regions, compared
 *     pairwise, with containment excluded — the decision panel sits inside the
 *     pod column and the two history panels inside the rail, and a block drawn
 *     inside its own column is a layout rather than a collision. The population
 *     is asserted as well as the overlaps, so a zero cannot be a zero because a
 *     selector found nothing.
 *  3. **Nothing runs off the side.** The document has no horizontal overflow,
 *     every region's right edge is inside the viewport, and the game picker in
 *     particular is, since it is the one control whose width is a sentence
 *     somebody else wrote (two deck names and a turn count).
 *
 * The desktop reading is here too, at 1440x900, and it is not decoration: the
 * whole of the fix is a scope change in `../../src/styles/mobile.ts`, so the
 * regression it could cause is a phone layout escaping onto a desk. Three tracks
 * there, and the same nine regions with nothing over anything.
 *
 * **The browser is told it is a phone.** `../../src/styles/mobile.ts`'s block is
 * a width query, but the touch floor beside it is a pointer query, and the
 * transport's buttons are 44px because of it.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { ReplayViewer } from '../../src/routes/replay/ReplayViewer';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';
import { fixtureLog } from './support/log-fixture';

/**
 * The opening frame and a frame mid-game. The first is what the sweep
 * photographed — two empty battlefields, a decision panel saying there is no
 * decision — and the second is the one with permanents, hands and a longer event
 * list, which is where a bounded panel has something to hide.
 */
const FRAMES = ['0', '120'] as const;

function page(seq: string): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'analysis',
      sub: 'replay',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(ReplayViewer, {
        state: { status: 'ready', log: fixtureLog() },
        route: { mode: 'analysis', sub: 'replay', params: { seq } },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Replay</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * The route's regions, named, plus the two pairs whose nesting is the layout.
 *
 * Written as one expression rather than a page script, the way the rigs beside
 * this one are, so the driver is a navigate and one `Runtime.evaluate`.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const REGIONS = [
    ['toolbar', '.mtg-replay > .mtg-toolbar:not(.mtg-transport)'],
    ['transport', '.mtg-transport'],
    ['caption', '.mtg-replay > .mtg-page-head'],
    ['pods', '.mtg-board__pods'],
    ['lanes', '.mtg-board__lanes'],
    ['rail', '.mtg-board__rail'],
    ['decision', '.mtg-prompt'],
    ['events', '.mtg-panel[aria-label="What happened"]'],
    ['turns', '.mtg-panel[aria-label="Turns"]'],
  ];
  // A block drawn inside the column it belongs to. Named rather than derived
  // from the rectangles, so a panel that escaped its column and happened to
  // stay inside another one is still counted as the collision it is.
  const NESTED = [['pods', 'decision'], ['rail', 'events'], ['rail', 'turns']];
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: round(rect.left), top: round(rect.top),
      right: round(rect.right), bottom: round(rect.bottom),
      width: round(rect.width), height: round(rect.height),
    };
  };
  const drawn = [];
  const missing = [];
  for (const [name, selector] of REGIONS) {
    const element = document.querySelector(selector);
    if (element === null) { missing.push(name); continue; }
    const rect = box(element);
    if (rect.width <= 0 || rect.height <= 0) { missing.push(name); continue; }
    drawn.push({ name: name, ...rect });
  }

  const EPS = 1;
  const meets = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > EPS &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > EPS;
  const nested = (a, b) => NESTED.some((pair) => (pair[0] === a && pair[1] === b) || (pair[0] === b && pair[1] === a));
  const overlaps = [];
  for (let i = 0; i < drawn.length; i += 1) {
    for (let j = i + 1; j < drawn.length; j += 1) {
      const one = drawn[i];
      const two = drawn[j];
      if (nested(one.name, two.name)) continue;
      if (!meets(one, two)) continue;
      overlaps.push({
        a: one.name, b: two.name,
        x: round(Math.min(one.right, two.right) - Math.max(one.left, two.left)),
        y: round(Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top)),
      });
    }
  }

  const width = document.documentElement.clientWidth;
  const picker = document.querySelector('.mtg-replay > .mtg-toolbar .mtg-select');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    columns: getComputedStyle(document.querySelector('.mtg-board')).gridTemplateColumns,
    drawn: drawn.map((region) => region.name),
    missing: missing,
    widest: drawn.map((region) => ({ name: region.name, past: round(region.right - width) })).sort((a, b) => b.past - a.past),
    overlaps: overlaps,
    pickerPast: picker === null ? null : round(box(picker).right - width),
    docOverflowX: round(document.documentElement.scrollWidth - width),
  };
})()`;

interface Overlap {
  readonly a: string;
  readonly b: string;
  readonly x: number;
  readonly y: number;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly coarse: boolean;
  readonly columns: string;
  readonly drawn: readonly string[];
  readonly missing: readonly string[];
  readonly widest: readonly { readonly name: string; readonly past: number }[];
  readonly overlaps: readonly Overlap[];
  readonly pickerPast: number | null;
  readonly docOverflowX: number;
}

/** A phone upright, and the laptop window the sweep also photographs. */
const SIZES = [
  { width: 390, height: 844, coarse: true, tracks: 1 },
  { width: 1440, height: 900, coarse: false, tracks: 3 },
] as const;

/** Sub-pixel layout residue, the slack every rig in this directory allows. */
const SLACK_PX = 0.5;

describe('the replay viewer on a phone', () => {
  browserIt(
    'draws one column, nothing over anything, and nothing off the side',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-replay-phone-'));
      const chrome = await launchChrome(join(directory, 'chrome'));
      try {
        for (const seq of FRAMES) {
          const file = join(directory, `seq-${seq}.html`);
          await writeFile(file, page(seq), 'utf8');
          for (const size of SIZES) {
            const at = `seq ${seq} at ${String(size.width)}x${String(size.height)}`;
            const seen = (await measurePage(
              chrome.client,
              file,
              size.width,
              size.height,
              MEASURE,
              at,
              '.mtg-replay',
              true,
              size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
            )) as unknown as Reading | null;
            if (seen === null) throw new Error(`${at}: the page drew no replay`);
            expect(seen.coarse, `${at}: the rig emulates the right pointer`).toBe(size.coarse);

            // The population, so the zeros below are worth reading.
            expect(seen.missing, `${at}: a region of the route was never drawn`).toEqual([]);
            expect(seen.drawn.length, `${at}: too few regions to compare`).toBe(9);

            // One column on a phone, three on a desk.
            expect(seen.columns.split(' ').length, `${at}: the board's tracks are ${seen.columns}`).toBe(
              size.tracks,
            );

            // Nothing painted over anything.
            expect(seen.overlaps, `${at}: regions overlap ${JSON.stringify(seen.overlaps)}`).toEqual([]);

            // And nothing off the side of the screen.
            expect(seen.docOverflowX, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(SLACK_PX);
            const worst = seen.widest[0];
            expect(
              worst?.past ?? 0,
              `${at}: ${String(worst?.name)} runs past the right edge`,
            ).toBeLessThanOrEqual(SLACK_PX);
            expect(seen.pickerPast, `${at}: the game picker is not drawn`).not.toBeNull();
            expect(
              seen.pickerPast ?? 0,
              `${at}: the game picker runs past the right edge`,
            ).toBeLessThanOrEqual(SLACK_PX);
          }
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
