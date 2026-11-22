// @vitest-environment node
/**
 * The draft screen on a phone held sideways, measured rather than described.
 *
 * `mtg-aqxi.3`. The *before* of this lane, read off a real Chrome at 844x390:
 * three of thirteen cards drawn, each one taller than the screen, the pack's own
 * identity scrolled off the top, and a single tap on any of them recording an
 * irreversible pick. The document scrolled; nothing else did.
 *
 * What is asserted here is the shape of the fix and not its pixels, for the
 * reason `../play/ask-column-phone.browser.test.ts` gives about its own numbers:
 * a card gap or a type size moves a measurement and does not move a sentence.
 * The five sentences:
 *
 * 1. The document does not scroll. The pack does.
 * 2. The status strip and the commit button are both on screen, at the same
 *    time, with the pack between them.
 * 3. Materially more of the pack is readable than the three cards it drew.
 * 4. The rail is beside the pack, not under it — a rail below the fold is a
 *    rail that costs a scroll to reach and a tap to come back from.
 * 5. Every face in the pack is a finger-sized target.
 * 6. The app's own chrome is off the screen in landscape and back on it at a
 *    desktop size. `mtg-aqxi.11`, and the playtester's sentence from a phone: when
 *    moving to landscape we should not take up space with all the top tabs, the
 *    way the game play area already does not. The tab row and the notice go,
 *    the strip keeps the draft and drops the setup, and at 1440x900 all three
 *    are drawn exactly as before.
 *
 * The fixture therefore carries a notice and a set picker, which the earlier
 * arms of this test did without: a band that is asserted absent has to be a band
 * the page would otherwise draw, and a picker asserted to be a finger-sized
 * target has to be a picker.
 *
 * **The browser is told it is a phone**, because `../../src/styles/touch.ts`'s
 * floor is what sets the height of the controls in the status strip and the
 * rail's foot, and a rig on a fine pointer measures a screen with about 40px it
 * will not have.
 *
 * **And the same page at a desktop size**, because the playtester asked for this
 * lane on the normal web version too and every rule it added is unconditional
 * or inside one `max-height` query. A tier that fired only on a phone would be a
 * 1440px window still scrolling as a document; a tier that fired everywhere
 * would be a desktop that had lost its page scroll for no reason. Both arms
 * measure the same five sentences.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { SetPicker } from '../../src/app/SetPicker';
import type { StagedSetRow } from '../../src/lab/set-index';
import { DraftRoute } from '../../src/routes/DraftRoute';
import { uiStyleSheet } from '../../src/styles/index';
import { SCREEN_QUERY } from '../../src/styles/panel';
import { TOUCH_TARGET_PX, WCAG_TARGET_PX } from '../../src/styles/touch';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/**
 * What the shell draws above the pack when a set is a reduced build, quoted from
 * the build the playtester was on when she asked for this: it is 54.69px of a 390px
 * screen, and it says nothing that changes between one pick and the next.
 */
const NOTICE =
  "Partial set: 162 of Magic 2011's 249 cards. The other 87 are missing rather than approximated.";

/** Two sets staged, which is what makes the picker a `<select>` rather than a label. */
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
      mode: 'play',
      sub: 'draft',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      notice: NOTICE,
      setPicker: h(SetPicker, { sets: STAGED, selected: 'm11', onSelect: () => undefined }),
      children: h(DraftRoute, {
        set: { status: 'ready', cards: EXAMPLE_CARDS },
        params: { seed: 'ui/draft-pack-phone' },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draft pack</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * One layout, read once.
 *
 * `readable` counts a card only when the whole of it is inside the region that
 * scrolls, which is the count the *before* number of three was taken with: a
 * card half under the fold is a card you have to scroll to before you can
 * compare it, and the whole complaint about the old screen was the scrolling.
 *
 * `railBeside` is signed, so the failure says which way it went: positive is a
 * rail that starts after the pack ends, negative is a rail sitting under it.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const scroll = document.querySelector('.mtg-work__scroll');
  const rail = document.querySelector('.mtg-rail');
  const status = document.querySelector('.mtg-strip');
  const commit = document.querySelector('.mtg-rail__foot button');
  if (scroll === null || rail === null || status === null || commit === null) return null;
  const box = scroll.getBoundingClientRect();
  const railBox = rail.getBoundingClientRect();
  const statusBox = status.getBoundingClientRect();
  const commitBox = commit.getBoundingClientRect();
  const faces = [...scroll.querySelectorAll('.mtg-card')];
  const rects = faces.map((face) => face.getBoundingClientRect());
  const drawn = (selector) => {
    const el = document.querySelector(selector);
    if (el === null) return null;
    const rect = el.getBoundingClientRect();
    return { height: round(rect.height), width: round(rect.width) };
  };
  return {
    screenTier: window.matchMedia('${SCREEN_QUERY}').matches,
    bar: drawn('.mtg-shell__bar'),
    mark: drawn('.mtg-shell__mark'),
    picker: drawn('.mtg-setpick'),
    modes: drawn('.mtg-modes'),
    notice: drawn('.mtg-shell__notice'),
    setup: drawn('.mtg-strip__setup'),
    stripHeight: round(statusBox.height),
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    pageOverflowY: round(document.documentElement.scrollHeight - document.documentElement.clientHeight),
    packScrolls: scroll.scrollHeight - scroll.clientHeight > 0.5,
    packCount: faces.length,
    readable: rects.filter((rect) => rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5).length,
    shortestFace: rects.reduce((worst, rect) => Math.min(worst, round(rect.height)), Infinity),
    statusBelowFold: round(statusBox.bottom - window.innerHeight),
    commitBelowFold: round(commitBox.bottom - window.innerHeight),
    commitHeight: round(commitBox.height),
    commitLabel: commit.textContent,
    railBeside: round(railBox.left - box.right),
    tabs: [...rail.querySelectorAll('.mtg-rail__tab')].map((tab) => tab.getAttribute('aria-pressed')),
  };
})()`;

/** A box's drawn size, or all-zero for one the tier took out of the drawing. */
interface Box {
  readonly height: number;
  readonly width: number;
}

interface Reading {
  readonly screenTier: boolean;
  readonly bar: Box | null;
  readonly mark: Box | null;
  readonly picker: Box | null;
  readonly modes: Box | null;
  readonly notice: Box | null;
  readonly setup: Box | null;
  readonly stripHeight: number;
  readonly viewport: readonly number[];
  readonly coarse: boolean;
  readonly pageOverflowY: number;
  readonly packScrolls: boolean;
  readonly packCount: number;
  readonly readable: number;
  readonly shortestFace: number;
  readonly statusBelowFold: number;
  readonly commitBelowFold: number;
  readonly commitHeight: number;
  readonly commitLabel: string;
  readonly railBeside: number;
  readonly tabs: readonly (string | null)[];
}

/**
 * An iPhone 14 sideways, a Pro Max sideways, and a laptop window.
 *
 * `screen` is what `../../src/styles/panel.ts`'s `SCREEN_QUERY` should say at
 * that size, stated here rather than derived from the height, so the tier is
 * asserted rather than assumed: a test that computed the same condition the
 * stylesheet does would agree with a stylesheet that had stopped firing.
 */
const SIZES = [
  { width: 844, height: 390, coarse: true, screen: true },
  { width: 932, height: 430, coarse: true, screen: true },
  { width: 1440, height: 900, coarse: false, screen: false },
] as const;

/**
 * What the old screen drew at 844x390: three faces, none of them whole, on a
 * document that scrolled. The fix has to beat that, not tie it. Measured after,
 * on the same 13-card pack: ten of thirteen entirely inside the region, with the
 * eleventh visible under them and the rest one flick away.
 */
const BEFORE_READABLE = 3;

const SLACK_PX = 0.5;

describe('the draft pack on a phone held sideways', () => {
  browserIt(
    'keeps the pack, the status and the commit on one screen at every size',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-draft-pack-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-draft-pack-chrome-'));
      const chrome = await launchChrome(userDataDir);
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

          // 1. The regions scroll and the document does not.
          expect(seen.pageOverflowY, `${at}: the page scrolls as a document`).toBeLessThanOrEqual(SLACK_PX);

          // 2. Both ends of the decision are on screen at once.
          expect(seen.statusBelowFold, `${at}: the status strip is under the fold`).toBeLessThanOrEqual(
            SLACK_PX,
          );
          expect(seen.commitBelowFold, `${at}: the commit button is under the fold`).toBeLessThanOrEqual(
            SLACK_PX,
          );
          expect(seen.commitLabel, `${at}: the commit says what it will do`).toBe('Pick a card');

          // 3. Materially more pack than the three faces it used to draw.
          expect(seen.packCount, `${at}: the pack is whole`).toBeGreaterThan(BEFORE_READABLE);
          expect(seen.readable, `${at}: fewer faces are readable than before the redesign`).toBeGreaterThan(
            BEFORE_READABLE,
          );

          // 4. Beside, not under.
          expect(seen.railBeside, `${at}: the rail sits under the pack instead of beside it`).toBeGreaterThan(
            -SLACK_PX,
          );

          // 5. Finger-sized, both the faces and the control that commits them.
          expect(seen.shortestFace, `${at}: a face in the pack is too small to hit`).toBeGreaterThanOrEqual(
            WCAG_TARGET_PX,
          );
          if (size.screen) {
            expect(seen.commitHeight, `${at}: the commit button is too small to hit`).toBeGreaterThanOrEqual(
              WCAG_TARGET_PX,
            );
          } else {
            // A desk is wide and tall, and there the idle commit is not drawn:
            // it is a gray control waiting under an empty viewer, and nothing
            // sits beside it that its arrival would move (`../../src/styles/printed-reading.ts`).
            expect(seen.commitHeight, `${at}: the idle commit is drawn on a desk`).toBe(0);
          }

          // The rail opens on the card it is about to be asked to describe, and
          // that is now the whole of the rail: `mtg-3apk` moved the pool out of
          // it and under the pack, where the deck editor's columns can say what
          // two 7rem columns of thumbnails could not.
          expect(seen.tabs, `${at}: the rail shows one section, showing`).toEqual(['true']);

          // 6. The app's own chrome is off a landscape phone and on at a desk.
          expect(seen.screenTier, `${at}: the screen tier did not fire as declared`).toBe(size.screen);
          if (size.screen) {
            // The whole band goes, the tab row with it. `mtg-aqxi.17` put the
            // mark and the set picker back into this band on every route that
            // can pay for them, and measured that this one cannot: the rail
            // card is `block-size: 100%` of the rail body, so 45px of chrome
            // comes off the art window and took it from 47.38px to 2.
            // `../../src/styles/panel.ts` carries the measurement.
            expect(seen.bar?.height ?? -1, `${at}: the shell bar still draws over the pack`).toBe(0);
            expect(seen.modes?.height ?? -1, `${at}: the tab row still draws over the pack`).toBe(0);
            expect(seen.notice?.height ?? -1, `${at}: the set notice still draws over the pack`).toBe(0);
            expect(seen.setup?.height ?? -1, `${at}: the strip still draws the seed and New draft`).toBe(0);
            expect(
              seen.stripHeight,
              `${at}: the strip is no thinner than a finger, so the setup came off for nothing`,
            ).toBeLessThanOrEqual(TOUCH_TARGET_PX - SLACK_PX);
          } else {
            expect(seen.bar?.height ?? 0, `${at}: a desktop window lost its shell bar`).toBeGreaterThan(0);
            expect(seen.modes?.height ?? 0, `${at}: a desktop window lost its tab row`).toBeGreaterThan(0);
            expect(seen.notice?.height ?? 0, `${at}: a desktop window lost its set notice`).toBeGreaterThan(
              0,
            );
            expect(
              seen.setup?.height ?? 0,
              `${at}: a desktop window lost the seed and New draft`,
            ).toBeGreaterThan(0);
          }
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
