// @vitest-environment node
/**
 * The fixtures page draws the board the app draws.
 *
 * `mtg-dcxg.2` was filed off `out/shots/play-dense.desk.png` reading "both
 * battlefields squeeze permanents down to roughly 33px wide while roughly 700px
 * of each battlefield row sits empty", and neither half of that was the app. The
 * sideways slivers are a tapped permanent, which `src/styles/board/slot.ts`
 * draws square and rotated on purpose. The size was real and was the rig's: the
 * dev fixtures page carried two blocks of its own above the mat — the fixture
 * picker and a page title the shipped play route does not draw — and
 * `src/styles/views.ts` gives the route the column the viewport leaves, so both
 * came out of the cards. Measured in chrome-headless-shell at 1440x900 on the
 * stated dense position, before that page was fixed: a battlefield face was
 * 101.0 x 141.1 there against 124.0 x 173.2 on the shipped `Shell` + `PlayView`
 * page, a board drawn 19% narrower than the app draws it. `src/card/type-line.ts`
 * then drops the subtypes off a face that narrow, which is the bead's second
 * symptom — the type bars all reading `Creature…` — arriving from the same 45px.
 *
 * A screenshot rig whose own furniture changes the layout it photographs is
 * evidence about the rig, and every judgment in the `mtg-dcxg` presentation
 * pass is made on these frames. So this file renders both pages over the *same*
 * session and measures the same box in each: the fixture page's board may not
 * be smaller than the app's.
 *
 * The two pages are not byte-identical and are not asserted to be. The fixtures
 * page names itself in the shell bar and the reference page does not, which is
 * a word's difference in a bar whose height is its own; measured over this rig
 * on 2026-08-23 the two faces come out 124.0 and 124.0 at 1440x900, 100.0 and
 * 100.0 at 1280x800. `TOLERANCE_PX` is the slack that keeps a re-valued header
 * from failing a claim that is about the mat.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_AUTO_PASS } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { FixturesApp } from '../../src/dev/fixtures/FixturesApp';
import { denseBoard, FIXTURE_NAMES, VIEWER } from '../../src/dev/fixtures/board';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/** The two viewports the desk frames are captured and argued at. */
const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
] as const;

/**
 * How far apart the two pages' faces may land.
 *
 * One pixel for the percentage edge every box on this mat is derived through,
 * and one more for the shell bar, which is the only chrome the two pages do not
 * share. Small enough that the 23px this file was written against is a failure
 * many times over.
 */
const TOLERANCE_PX = 2;

function document_(markup: string, title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/** The dev page, exactly as `fixtures.html` mounts it, on its default fixture. */
function fixturesPage(): string {
  return document_(renderToStaticMarkup(h(FixturesApp)), 'fixtures');
}

/**
 * And the shipped arrangement over the same session: `../../src/routes/PlayRoute.ts`
 * returns `.mtg-play-route` with the view straight inside it and no heading, so
 * that is what the reference draws.
 */
function shippedPage(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(
        'div',
        { className: 'mtg-play-route' },
        h(PlayView, {
          session: denseBoard(),
          viewer: VIEWER,
          names: FIXTURE_NAMES,
          onChoose: () => undefined,
          autoPass: DEFAULT_AUTO_PASS,
          onAutoPass: () => undefined,
          onYield: () => undefined,
        }),
      ),
    }),
  );
  return document_(markup, 'play');
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const face = document.querySelector(".mtg-board__spells > .mtg-attach > .mtg-slot[data-tapped='false'] > .mtg-card");
  const row = document.querySelector('.mtg-board__spells');
  if (face === null || row === null) return { viewport: [window.innerWidth, window.innerHeight], face: null, row: null };
  const faceBox = face.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  return {
    viewport: [window.innerWidth, window.innerHeight],
    face: [round(faceBox.width), round(faceBox.height)],
    row: [round(rowBox.width), round(rowBox.height)],
  };
})()`;

interface Reading {
  readonly viewport: readonly [number, number];
  readonly face: readonly [number, number] | null;
  readonly row: readonly [number, number] | null;
}

describe('the fixtures page costs the board nothing', () => {
  browserIt(
    'draws the same battlefield face the shipped play route draws',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-fixture-harness-'));
      const fixture = join(directory, 'fixtures.html');
      const shipped = join(directory, 'shipped.html');
      await writeFile(fixture, fixturesPage(), 'utf8');
      await writeFile(shipped, shippedPage(), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          const onFixture = (await measurePage(
            chrome.client,
            fixture,
            width,
            height,
            MEASURE,
            'fixtures page',
          )) as unknown as Reading;
          const onShipped = (await measurePage(
            chrome.client,
            shipped,
            width,
            height,
            MEASURE,
            'shipped page',
          )) as unknown as Reading;
          expect(onFixture.viewport).toEqual([width, height]);
          expect(onShipped.viewport).toEqual([width, height]);
          const drawn = onFixture.face;
          const reference = onShipped.face;
          expect(drawn, `${where}: the fixtures page drew no battlefield face`).not.toBeNull();
          expect(reference, `${where}: the shipped page drew no battlefield face`).not.toBeNull();
          if (drawn === null || reference === null) continue;
          expect(
            Math.abs(drawn[0] - reference[0]),
            `${where}: fixture face ${String(drawn[0])} against the app's ${String(reference[0])}`,
          ).toBeLessThanOrEqual(TOLERANCE_PX);
          expect(
            Math.abs(drawn[1] - reference[1]),
            `${where}: fixture face height ${String(drawn[1])} against the app's ${String(reference[1])}`,
          ).toBeLessThanOrEqual(TOLERANCE_PX);
        }
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
      }
    },
    120_000,
  );
});
