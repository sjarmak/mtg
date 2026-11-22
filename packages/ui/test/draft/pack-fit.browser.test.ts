// @vitest-environment node
/**
 * Every card in the pack at a readable, undistorted size throughout a round.
 *
 * `mtg-rgc.18`. the playtester: "the cards should be sized while drafting so they're
 * all easily seen on one screen." What the pack did instead was declare one
 * column width whatever was in it: measured at 1440x900 on a fifteen-card pack,
 * five faces across in three rows of 569.5px inside a 445px box, so a third of
 * the pack was under the fold of the pane that exists to show what there is to
 * pick from.
 *
 * The current decision reverses that older contact-sheet trade: on a roomy
 * screen the cards stay at the deckbuilder's readable scale and the pack pane
 * scrolls vertically when a full pack needs more rows. The claim is measured
 * for every pack size, because the first and last picks exercise opposite ends
 * of the grid.
 *
 * Pack sizes rather than one pack, because the fit is a division: fifteen cards
 * go three rows deep and one card goes in a track the other six collapse into,
 * and the arrangement that gets one of those right can get the other wrong. The
 * fifteen is the flagship's own pack; the rest are what is left of it as the
 * round is picked out. Each is dealt over a pool of thirty less its own size --
 * a third-round pack, which is the one the pool is competing with hardest.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CARD_TRIM_MM } from '@mtg/card-geometry';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { HumanDraftChoice, HumanDraftProgress } from '@mtg/draft-export';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { DraftPack } from '../../src/routes/draft/DraftPack';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/**
 * A pack of `size`, over a pool of `taken`.
 *
 * The pool is what the pack is competing with for the column, so it is dealt
 * rather than left empty: a fit measured against an empty pool is a fit measured
 * against a box no draft ever has.
 */
function page(size: number, taken: number): string {
  const cards = Array.from(
    { length: size },
    (_, index) => EXAMPLE_CARDS[(index * 3) % EXAMPLE_CARDS.length] as Card,
  );
  const pool = Array.from(
    { length: taken },
    (_, index) => EXAMPLE_CARDS[(index * 5) % EXAMPLE_CARDS.length] as Card,
  );
  const next: HumanDraftChoice = {
    round: 1,
    pickNumber: 16 - size,
    packSize: size,
    openedBy: 0,
    cards,
  };
  const draft: HumanDraftProgress = {
    seed: 'ui/draft-pack-fit',
    humanSeat: 0,
    picks: pool.map((card) => card.id),
    seats: [],
    rounds: 3,
    directions: [],
    ratings: [],
    botPolicy: 'native-deck-conditioned/v1',
    nextPick: next,
    result: null,
  };
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      sub: 'draft',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(DraftPack, {
        draft,
        next,
        pool,
        onPick: () => undefined,
        onNewDraft: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draft pack fit</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * `inside` counts a face only when the whole of it is within the region, which
 * is the count that matters: a face whose bottom row of type is under the fold
 * is a face you cannot pick from.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const scroll = document.querySelector('.mtg-work__scroll');
  if (scroll === null) return null;
  const box = scroll.getBoundingClientRect();
  const faces = [...scroll.querySelectorAll('.mtg-card')];
  const rects = faces.map((face) => face.getBoundingClientRect());
  const pool = document.querySelector('.mtg-draft__pool');
  const stacks = [...document.querySelectorAll('.mtg-strips__stack')];
  return {
    drawn: faces.length,
    inside: rects.filter((rect) => rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5).length,
    packHeight: round(box.height),
    packScroll: round(scroll.scrollHeight - scroll.clientHeight),
    poolHeight: pool === null ? 0 : round(pool.getBoundingClientRect().height),
    poolContentHeight:
      stacks.length === 0 ? 0 : round(Math.max(...stacks.map((stack) => stack.getBoundingClientRect().height))),
    poolScroll: (() => {
      const poolbox = document.querySelector('.mtg-draft__poolbox');
      return poolbox === null ? 0 : round(poolbox.scrollHeight - poolbox.clientHeight);
    })(),
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    narrowest: rects.length === 0 ? 0 : round(Math.min(...rects.map((rect) => rect.width))),
    shortest: rects.length === 0 ? 0 : round(Math.min(...rects.map((rect) => rect.height))),
    tallestRatio: rects.length === 0 ? 0 : Math.max(...rects.map((rect) => rect.height / rect.width)),
    shortestRatio: rects.length === 0 ? 0 : Math.min(...rects.map((rect) => rect.height / rect.width)),
  };
})()`;

interface Reading {
  readonly drawn: number;
  readonly inside: number;
  readonly packHeight: number;
  readonly packScroll: number;
  readonly poolHeight: number;
  readonly poolContentHeight: number;
  readonly poolScroll: number;
  readonly pageOverflowX: number;
  readonly narrowest: number;
  readonly shortest: number;
  readonly tallestRatio: number;
  readonly shortestRatio: number;
}

const SLACK_PX = 0.5;

/**
 * A card's own proportions, and how close a face has to come to them.
 *
 * `mtg-2rmf`. The fit above says every face is inside the box; it says nothing
 * about what shape the face is, and until that bead the answer was whatever the
 * row floor left. Measured at 1440x900 on the fixture's pack, faces at 152x140,
 * a ratio of 0.92 where a card is 1.397 -- a fit bought by squashing every card
 * in the pack into the smallest row the division allows, with 482px of the
 * workspace below it holding nothing.
 *
 * So the shape is asserted from both ends. No face is ever taller than a card of
 * its width, which is what keeps `../../src/styles/panel.ts`'s `aspect-ratio`
 * from becoming a demand that pushes the pack out of its own box; and on a desk
 * with room to spare no face is shorter either. In between -- 1440x900 with
 * fifteen cards, 1024x768 with anything -- the face gives height back to the
 * fit, which is the trade this rig has always been about, and only the ceiling
 * is claimed.
 *
 * The tolerance is a hundredth. The ratios measured here are 1.397 where a face
 * is whole and 0.83 to 1.38 where the division has taken some of it back, so
 * nothing sits near enough the line for a looser one to matter.
 */
const CARD_ASPECT = CARD_TRIM_MM.height / CARD_TRIM_MM.width;
const RATIO_SLACK = 0.01;

/**
 * The desk width above which the pack is claimed to draw whole cards.
 *
 * 1600 rather than 1440 because 1440x900 is where the deepest pack still has to
 * divide: fifteen faces over seven tracks is three rows, and three whole cards
 * at 152px across want 638px of a box that has 445. The acceptance criterion
 * names 1440-1600 for the fit, and the fit is what it gets there.
 */
/** The 214px full-card column floor used by the desktop draft and fit census. */
const FACE_MIN_PX = 214;

/**
 * The desks the fit query covers, and which of them the pack is claimed to fit.
 *
 * `fits` is the acceptance criterion's own range -- "at 1440-1600px desktop
 * width" -- and not a measurement that came out convenient. 1024x768 is in the
 * sweep because it is the corner of the query and its arrangement is the one
 * that goes wrong quietly; what is asserted there is the weaker claim, that
 * nothing is drawn too small to read.
 */
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1600, height: 1000 },
  { width: 1024, height: 768 },
] as const;

/** A round's worth: the opened pack, the middle of it, and its last few picks. */
const PACKS = [15, 11, 8, 6, 3, 1] as const;

describe('the pack keeps readable card geometry throughout a round', () => {
  browserIt(
    'keeps every desktop pack at deckbuilder scale and scrolls the pane when needed',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-draft-fit-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-draft-fit-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        for (const size of PACKS) {
          const file = join(directory, `pack-${String(size)}.html`);
          await writeFile(file, page(size, 30 - size), 'utf8');
          for (const viewport of SIZES) {
            const at = `${String(viewport.width)}x${String(viewport.height)}, pack of ${String(size)}`;
            const seen = (await measurePage(
              chrome.client,
              file,
              viewport.width,
              viewport.height,
              MEASURE,
              at,
              '.mtg-work__scroll',
            )) as unknown as Reading | null;
            if (seen === null) throw new Error(`${at}: the page drew no draft workspace`);
            expect(seen.drawn, `${at}: the pack drew the wrong number of faces`).toBe(size);
            expect(seen.pageOverflowX, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(SLACK_PX);
            expect(seen.poolScroll, `${at}: the pool scrolls`).toBeLessThanOrEqual(SLACK_PX);
            expect(seen.narrowest, `${at}: the pack fitted by drawing postage stamps`).toBeGreaterThanOrEqual(
              FACE_MIN_PX,
            );
            expect(seen.shortest, `${at}: a face was divided down to a strip`).toBeGreaterThanOrEqual(
              FACE_MIN_PX,
            );
            // Every face is a card's actual shape, and every face in one pack
            // is the same shape as the others.
            expect(seen.tallestRatio, `${at}: a face is taller than a card of its width`).toBeLessThanOrEqual(
              CARD_ASPECT + RATIO_SLACK,
            );
            expect(
              seen.tallestRatio - seen.shortestRatio,
              `${at}: the pack drew faces of two different shapes`,
            ).toBeLessThanOrEqual(RATIO_SLACK);
            expect(seen.shortestRatio, `${at}: a face is squashed to avoid scrolling`).toBeGreaterThanOrEqual(
              CARD_ASPECT - RATIO_SLACK,
            );
            if (seen.packScroll <= SLACK_PX) {
              expect(seen.inside, `${at}: a face is not wholly inside the pack's box`).toBe(size);
            }
          }
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    600_000,
  );

  const ONE_PICK_SIZES = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ] as const;

  browserIt(
    'hands the pack the room a shallow pool is not using',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-draft-fit-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-draft-fit-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        const file = join(directory, 'pack-after-one-pick.html');
        await writeFile(file, page(14, 1), 'utf8');
        for (const viewport of ONE_PICK_SIZES) {
          const at = `${String(viewport.width)}x${String(viewport.height)}, one card drafted`;
          const seen = (await measurePage(
            chrome.client,
            file,
            viewport.width,
            viewport.height,
            MEASURE,
            at,
            '.mtg-work__scroll',
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no draft workspace`);
          const poolUnusedRoom = Math.max(0, seen.poolHeight - seen.poolContentHeight);
          expect(
            seen.packHeight,
            `${at}: the pack did not get the room the pool left unused`,
          ).toBeGreaterThanOrEqual(poolUnusedRoom);
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
