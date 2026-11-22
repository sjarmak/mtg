// @vitest-environment node
/**
 * The draft screen on a phone held upright, which is the orientation the
 * redesign of this route never measured.
 *
 * `mtg-dcxg.5`, 2026-08-23. `./pack-phone.browser.test.ts` fitted this screen to
 * a phone held *sideways*, and every rule it is measuring lives inside
 * `../../src/styles/panel.ts`'s `SCREEN_QUERY`, a `max-height: 34rem` tier. A
 * phone held upright is 844px tall, so none of it fires and what draws instead
 * is the desktop screen with its rail stacked under its workspace. Read off a
 * real Chrome at 390x844 before the fix, and off the 2026-08-23 sweep's
 * `out/shots/route-draft.portrait.png`:
 *
 *  - The pack column stayed the desktop's `--thumb-w: 13rem`, which at 390px of
 *    screen resolves to a single 348px track. One card per row, thirteen rows,
 *    and a grid 1993.84px long over the pack this rig deals — longer on the
 *    flagship set the sweep photographs, whose faces carry art.
 *  - That grid scrolled inside `.mtg-work__scroll`, a 517.56px pane with
 *    1494px of overflow, inside a main region that scrolls too — two scrollers
 *    on one axis, the inner one holding the whole subject of the page.
 *  - The rail's foot, which carries the only irreversible control on the route,
 *    ran from y=770 to y=831 against a bottom navigation that starts at y=799.
 *    The button that takes the pick was 32px under the tab row.
 *
 * So the four sentences this rig holds at 390x844:
 *
 * 1. **The pack is a grid.** More than one column, and the whole pack is a
 *    couple of screens rather than a dozen.
 * 2. **One scroller.** The pack does not scroll inside itself; the region that
 *    scrolls is the shell's main, which is what every other route on this phone
 *    scrolls.
 * 3. **The commit is clear of the tab row**, whole, and finger-sized.
 * 4. **Nothing is drawn as chosen before anything is chosen.** The pack used to
 *    autofocus its first face on the very first paint, which paints a ring that
 *    reads as a selection while the rail beside it says to choose a card.
 *
 * The desktop window is measured too, because the fix is a phone-width tier
 * added under sheets that are unconditional: a rule that leaked would be a
 * 1440px draft that had lost its fitted screen. There the pack keeps its own
 * scroller, the rail stays beside it, and the document does not scroll.
 *
 * **The browser is told it is a phone**: `../../src/styles/touch.ts`'s 44px
 * floor is a pointer query, and it is what sizes the control this rig measures
 * against the tab row.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { DraftRoute } from '../../src/routes/DraftRoute';
import { uiStyleSheet } from '../../src/styles/index';
import { WCAG_TARGET_PX } from '../../src/styles/touch';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      sub: 'draft',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(DraftRoute, {
        set: { status: 'ready', cards: EXAMPLE_CARDS },
        params: { seed: 'ui/draft-pack-portrait' },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draft pack</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * One reading of the screen.
 *
 * `columns` is counted off the faces' own left edges rather than read from
 * `grid-template-columns`, because `auto-fill` over `1fr` tracks reports the
 * resolved list either way and what the complaint is about is how many cards a
 * row actually holds.
 *
 * `packRun` is the length of the pack in screens: the scrolling extent of the
 * whole grid divided by the viewport, which is the number a person feels.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const scroll = document.querySelector('.mtg-work__scroll');
  const grid = document.querySelector('.mtg-work__scroll .mtg-thumbs');
  const main = document.querySelector('.mtg-shell__main');
  const rail = document.querySelector('.mtg-rail');
  const commit = document.querySelector('.mtg-rail__foot button');
  const nav = document.querySelector('.mtg-modes');
  if (scroll === null || grid === null || main === null || rail === null || commit === null) return null;
  const scrolls = (element) => element.scrollHeight - element.clientHeight > 0.5;
  const faces = [...grid.querySelectorAll('.mtg-card')];
  const rects = faces.map((face) => face.getBoundingClientRect());
  const first = rects[0];
  const commitBox = commit.getBoundingClientRect();
  const navBox = nav === null ? null : nav.getBoundingClientRect();
  const active = document.activeElement;
  return {
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    packCount: faces.length,
    columns: first === undefined ? 0 : rects.filter((rect) => Math.abs(rect.top - first.top) < 1).length,
    faceWidth: first === undefined ? 0 : round(first.width),
    faceHeight: first === undefined ? 0 : round(first.height),
    packRun: round(grid.getBoundingClientRect().height / window.innerHeight),
    packScrolls: scrolls(scroll),
    mainScrolls: scrolls(main),
    docScrolls: round(document.documentElement.scrollHeight - document.documentElement.clientHeight) > 0.5,
    railBeside: round(rail.getBoundingClientRect().left - scroll.getBoundingClientRect().right),
    commitHeight: round(commitBox.height),
    commitLabel: commit.textContent,
    commitPastNav: navBox === null ? null : round(commitBox.bottom - navBox.top),
    commitBelowFold: round(commitBox.bottom - window.innerHeight),
    selectedFaces: faces.filter((face) => face.getAttribute('data-selected') === 'true').length,
    activeIsFace: active === null ? false : faces.some((face) => face === active || face.contains(active)),
  };
})()`;

interface Reading {
  readonly viewport: readonly number[];
  readonly coarse: boolean;
  readonly packCount: number;
  readonly columns: number;
  readonly faceWidth: number;
  readonly faceHeight: number;
  readonly packRun: number;
  readonly packScrolls: boolean;
  readonly mainScrolls: boolean;
  readonly docScrolls: boolean;
  readonly railBeside: number;
  readonly commitHeight: number;
  readonly commitLabel: string;
  readonly commitPastNav: number | null;
  readonly commitBelowFold: number;
  readonly selectedFaces: number;
  readonly activeIsFace: boolean;
}

/** An iPhone 14 upright, and the laptop window the sweep also photographs. */
const SIZES = [
  { width: 390, height: 844, coarse: true, phone: true },
  { width: 1440, height: 900, coarse: false, phone: false },
] as const;

/**
 * The most of the pack a phone may ask a thumb to travel, in screens.
 *
 * Before the fix the grid measured 1993.84px against an 844px viewport — 2.36
 * screens for thirteen faces that carry no art, and more than twice that for a
 * set whose faces do. After it, three columns put the same pack in five rows,
 * 657.42px, which is 0.78. The ceiling is stated well above that so a gap or a
 * type step does not move the sentence, and well under the reading it replaces.
 */
const PACK_RUN_MAX = 1.5;

const SLACK_PX = 0.5;

describe('the draft pack on a phone held upright', () => {
  browserIt(
    'draws the pack as a grid, scrolls once, and keeps the pick clear of the tab row',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-draft-portrait-'));
      const chrome = await launchChrome(join(directory, 'chrome'));
      const file = join(directory, 'draft.html');
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
            '.mtg-work__scroll',
            true,
            size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no draft workspace`);
          expect(seen.coarse, `${at}: the rig emulates the right pointer`).toBe(size.coarse);
          expect(seen.packCount, `${at}: the pack is not whole`).toBeGreaterThan(3);

          // 4. Nothing is chosen, and nothing is drawn as chosen, before a tap.
          expect(seen.selectedFaces, `${at}: a face is drawn selected before anything was chosen`).toBe(0);
          expect(seen.activeIsFace, `${at}: the pack took focus on its own first paint`).toBe(false);
          expect(seen.commitLabel, `${at}: the commit says what it will do`).toBe('Pick a card');

          if (!size.phone) {
            // The fitted screen a desk has had since `mtg-aqxi`, unchanged.
            expect(seen.docScrolls, `${at}: a desktop draft scrolls as a document`).toBe(false);
            expect(seen.railBeside, `${at}: a desktop rail sits under the pack`).toBeGreaterThan(-SLACK_PX);
            // The idle commit is not drawn on a desk (`../../src/styles/printed-reading.ts`),
            // so its box is empty and therefore above the fold.
            expect(seen.commitHeight, `${at}: the idle commit is drawn on a desk`).toBe(0);
            expect(seen.commitBelowFold, `${at}: the commit is under the fold`).toBeLessThanOrEqual(SLACK_PX);
            continue;
          }

          // 1. A grid, and a pack a thumb can cross.
          expect(seen.columns, `${at}: the pack draws ${String(seen.columns)} card per row`).toBeGreaterThan(
            1,
          );
          expect(
            seen.packRun,
            `${at}: the pack is ${String(seen.packRun)} screens of scrolling`,
          ).toBeLessThanOrEqual(PACK_RUN_MAX);

          // 2. One scroller, and it is the one the rest of this phone scrolls.
          expect(seen.packScrolls, `${at}: the pack scrolls inside its own pane`).toBe(false);
          expect(seen.mainScrolls, `${at}: nothing scrolls, so the pack is cut off`).toBe(true);

          // 3. The commit is whole, above the tab row, and finger-sized.
          expect(seen.commitPastNav, `${at}: the page draws no bottom navigation`).not.toBeNull();
          expect(
            seen.commitPastNav ?? 0,
            `${at}: the commit button is under the bottom navigation`,
          ).toBeLessThanOrEqual(SLACK_PX);
          expect(seen.commitHeight, `${at}: the commit button is too small to hit`).toBeGreaterThanOrEqual(
            WCAG_TARGET_PX,
          );
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
