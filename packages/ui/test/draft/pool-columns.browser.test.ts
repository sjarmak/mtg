// @vitest-environment node
/**
 * The drafted pool under the pack, measured at the depths a draft reaches.
 *
 * `mtg-3apk`. The pool was a rail section: 17rem wide, two columns of 7rem
 * thumbnails, newest first. What that arrangement cannot answer is the only
 * question a drafter asks it — what am I already in, and what is the curve of
 * it — so it moved under the pack and into `../../src/routes/deck/StripColumns.ts`,
 * the same count-headed columns the deck editor draws.
 *
 * The claim that the columns partition and count correctly is
 * `../deck/grouping.test.ts`'s and is not remeasured here. What needs a browser
 * is the arrangement's one load-bearing promise, which is about height:
 *
 * 1. The page still does not scroll as a document, at 45 picks.
 * 2. The pool is the same height at pick 15 and at pick 45. That is the whole
 *    reason `../../src/routes/deck/strips.ts` fixes the box and tightens the
 *    pitch instead of letting a column grow, and it is what keeps the pack from
 *    walking down the page as the draft fills up.
 * 3. Both ends of the decision are still on screen: the pack above it, and the
 *    commit button in the rail.
 * 4. The columns are one row that scrolls sideways, not a grid that wraps.
 * 5. The pack keeps the larger half of the column at a desk, at a full pack.
 *    The pool is a reference; the pack is the decision.
 * 6. And the room a part-drawn pack is not using goes to the pool (`mtg-v7sg`).
 *    The pack sizes to its faces now, so at pack 3 pick 11 the five cards left
 *    take five cards' worth of column instead of the whole share, and the pool
 *    under them grows into what is left rather than sitting at a constant with
 *    230px of nothing above it and its deepest column clipped.
 *
 * 7. And the pool at that floor holds a whole column (`mtg-qs2d`). The floor is
 *    a column's depth and the box it is written on is a scrollport, so the two
 *    differ by the count row and its gaps; stated as one number they did not,
 *    and a pool at its floor scrolled itself to reach a column 24px out its
 *    bottom.
 *
 * `DRAFT_POOL_COLUMN_FLOOR_PX` plus `STRIP_REGION_CHROME_PX` is what buys 5 and
 * 7 -- the pool never falls below the box its columns are drawn against, so a
 * full pack is what shrinks -- and the phone tier in `../../src/styles/panel.ts`
 * is what buys 3 on a 390px screen. All are measured here rather than asserted
 * from the constant, because a floor and a cap written against a chain of flexed
 * heights are exactly the kind of rule that resolves to nothing and fails
 * silently. 7 goes further and measures the constant's own derivation off a real
 * region, since a chrome height copied into JS is a number the sheet can walk
 * away from.
 *
 * 6 is measured the way `../deck/stack-box.browser.test.ts` measures its own
 * subject, and for its reason: nothing here mounts React, so the hook that grows
 * a column to its box never runs and the markup carries the constant. What is
 * asserted is the token the box declares and the lengths `roomOf` would read off
 * it, put through the same `boxFromRoom` the app calls.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { HumanDraftChoice, HumanDraftProgress } from '@mtg/draft-export';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { DraftPack } from '../../src/routes/draft/DraftPack';
import { uiStyleSheet } from '../../src/styles/index';
import { boxFromRoom } from '../../src/routes/deck/stack-box';
import type { StackRoom } from '../../src/routes/deck/stack-box';
import { DRAFT_STACK_BOX } from '../../src/routes/deck/strips';
import {
  STACK_BOX_FROM_PANE,
  STRIP_REGION_CHROME_PX,
  STRIP_REGION_SCROLLBAR_PX,
} from '../../src/styles/stack-box';
import { SCREEN_QUERY } from '../../src/styles/panel';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const SLACK_PX = 1;

/** A pool of `depth` cards, cycled out of the example set so the columns differ. */
function pool(depth: number): readonly DslCard[] {
  return Array.from({ length: depth }, (_, index) => {
    const card = EXAMPLE_CARDS[index % EXAMPLE_CARDS.length];
    if (card === undefined) throw new Error('the example set printed no cards');
    return card;
  });
}

function choice(taken: number): HumanDraftChoice {
  return {
    round: 1 + Math.floor(taken / 15),
    pickNumber: 1 + (taken % 15),
    packSize: 15 - (taken % 15),
    openedBy: 0,
    cards: pool(15 - (taken % 15)),
  };
}

/**
 * A draft mid-flight, built rather than run.
 *
 * `DraftPack` reads three things off the progress — how many picks are in it,
 * and the round and pick of the choice it is owed — so the seats and ratings a
 * real run carries are empty here. Running one to reach pick 45 would take a
 * minute of wall clock to produce the same two numbers.
 */
function progress(taken: number): HumanDraftProgress {
  return {
    seed: 'ui/draft-pool-columns',
    humanSeat: 0,
    picks: pool(taken).map((card) => card.id),
    seats: [],
    rounds: 3,
    directions: [],
    ratings: [],
    botPolicy: 'native-deck-conditioned/v1',
    nextPick: choice(taken),
    result: null,
  };
}

function page(taken: number): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      sub: 'draft',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(DraftPack, {
        draft: progress(taken),
        next: choice(taken),
        pool: pool(taken),
        onPick: () => undefined,
        onNewDraft: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draft pool</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * One reading of the main column.
 *
 * `headTops` is the set of distinct column-head tops, rounded: one entry is one
 * row of columns, and two is a wrap. It is read off the heads rather than off
 * the stacks because a stack's height is the thing under test and its top is
 * not.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const rect = (el) => {
    const box = el.getBoundingClientRect();
    return { top: round(box.top), bottom: round(box.bottom), height: round(box.height) };
  };
  const pack = document.querySelector('.mtg-work__scroll');
  const region = document.querySelector('.mtg-draft__pool');
  const box = document.querySelector('.mtg-draft__poolbox');
  const strips = document.querySelector('.mtg-draft__poolbox .mtg-strips');
  const commit = document.querySelector('.mtg-rail__foot button');
  if (pack === null || region === null || box === null || strips === null || commit === null) return null;
  const heads = [...strips.querySelectorAll('.mtg-strips__head')];
  const stacks = [...strips.querySelectorAll('.mtg-strips__stack')];
  const overflows = stacks.map((stack) => {
    // A clipped column is meant to run past its box; that is the behavior the
    // floor buys. What must never happen is a column that reports itself unclipped
    // and still hangs out the bottom.
    if (stack.getAttribute('data-clipped') === 'true') return 0;
    const cards = [...stack.querySelectorAll('.mtg-strips__card')];
    const last = cards[cards.length - 1];
    if (last === undefined) return 0;
    return round(last.getBoundingClientRect().bottom - stack.getBoundingClientRect().bottom);
  });
  const stack = strips.querySelector('.mtg-strips__stack');
  const stripsTop = strips.getBoundingClientRect().top;
  const boxBottom = box.getBoundingClientRect().bottom;
  return {
    boxScroll: round(box.scrollHeight - box.clientHeight),
    // What the region's own sideways scrollbar takes. Zero where the platform
    // draws an overlay one, or where the columns happen to fit.
    regionScrollbar: round(Math.max(0, strips.offsetHeight - strips.clientHeight)),
    // How far the deepest column's own box hangs out the bottom of the pool.
    // Every column, clipped or not: a clipped one scrolls itself and still has
    // to end inside the pool, which is the part \`overflow\` above does not say.
    outOfBox: stacks.length === 0 ? 0 : round(Math.max(...stacks.map((s) =>
      s.getBoundingClientRect().bottom - boxBottom))),
    token: getComputedStyle(box).getPropertyValue('--strip-box-from').trim(),
    // The count row and the gap under it, without the sideways scrollbar the
    // foot also carries: STRIP_REGION_CHROME_PX is the part CSS can reserve.
    regionChrome: stack === null ? null : round(
      (stack.getBoundingClientRect().top - stripsTop)
      + (parseFloat(getComputedStyle(strips).getPropertyValue('padding-block-end')) || 0)),
    room: stack === null ? null : {
      scrollportHeight: round(box.clientHeight),
      regionTop: round(stripsTop - box.getBoundingClientRect().top + box.scrollTop),
      stackTop: round(stack.getBoundingClientRect().top - stripsTop),
      regionFoot: round((parseFloat(getComputedStyle(strips).getPropertyValue('padding-block-end')) || 0)
        + Math.max(0, strips.offsetHeight - strips.clientHeight)),
    },
    fullHeights: [...new Set([...strips.querySelectorAll('.mtg-strips__card[data-full]')]
      .map((card) => Math.round(card.getBoundingClientRect().height)))],
    overflow: overflows.length === 0 ? 0 : round(Math.max(...overflows)),
    screenTier: window.matchMedia('${SCREEN_QUERY}').matches,
    viewport: [window.innerWidth, window.innerHeight],
    pageOverflowY: round(document.documentElement.scrollHeight - window.innerHeight),
    pack: rect(pack),
    region: rect(region),
    box: rect(box),
    stripsHeight: round(strips.getBoundingClientRect().height),
    sideways: round(strips.scrollWidth - strips.clientWidth),
    headTops: [...new Set(heads.map((head) => Math.round(head.getBoundingClientRect().top)))],
    // What a column head is doing with its width: the space between its two
    // parts, and how far the pair sits from each edge of the column.
    headSpread: heads.map((head) => {
      const what = head.querySelector('.mtg-strips__what');
      const count = head.querySelector('.mtg-strips__count');
      if (what === null || count === null) return null;
      const outer = head.getBoundingClientRect();
      const left = what.getBoundingClientRect();
      const right = count.getBoundingClientRect();
      return {
        between: round(right.left - left.right),
        margins: round(Math.abs((left.left - outer.left) - (outer.right - right.right))),
      };
    }),
    columns: heads.length,
    cards: strips.querySelectorAll('.mtg-strips__card').length,
    commitBottom: round(commit.getBoundingClientRect().bottom),
  };
})()`;

interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
}

interface Reading {
  readonly token: string;
  readonly boxScroll: number;
  readonly regionChrome: number | null;
  readonly regionScrollbar: number;
  readonly outOfBox: number;
  readonly room: StackRoom | null;
  readonly screenTier: boolean;
  readonly viewport: readonly number[];
  readonly pageOverflowY: number;
  readonly pack: Box;
  readonly region: Box;
  readonly box: Box;
  readonly stripsHeight: number;
  readonly sideways: number;
  readonly headTops: readonly number[];
  readonly headSpread: readonly ({ readonly between: number; readonly margins: number } | null)[];
  readonly columns: number;
  readonly cards: number;
  readonly fullHeights: readonly number[];
  readonly overflow: number;
  readonly commitBottom: number;
}

/**
 * The gap `.mtg-strips__head` puts between the pip and the count, which is
 * `--mtg-space-2` at this rig's root font size. Anything wider than one step of
 * the scale is the head spreading its parts out again.
 */
const HEAD_GAP_PX = 8;

/** A phone sideways and a laptop window, with the tier each one should be in. */
const SIZES = [
  { width: 844, height: 390, coarse: true, screen: true },
  { width: 1440, height: 900, coarse: false, screen: false },
] as const;

/** Deep enough to fill a column past the pitch floor, and a pick that is not. */
const DEPTHS = [15, 45] as const;

describe('the drafted pool under the pack', () => {
  browserIt(
    'is the same height at pick 15 and pick 45, and leaves the pack the larger half',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-draft-pool-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-draft-pool-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const files = new Map<number, string>();
      for (const depth of DEPTHS) {
        const file = join(directory, `pool-${String(depth)}.html`);
        await writeFile(file, page(depth), 'utf8');
        files.set(depth, file);
      }
      try {
        for (const size of SIZES) {
          const seen = new Map<number, Reading>();
          for (const depth of DEPTHS) {
            const file = files.get(depth);
            if (file === undefined) throw new Error(`no page written for ${String(depth)} picks`);
            const at = `${String(size.width)}x${String(size.height)} at pick ${String(depth)}`;
            const read = (await measurePage(
              chrome.client,
              file,
              size.width,
              size.height,
              MEASURE,
              at,
              '.mtg-draft__poolbox .mtg-strips__card',
              true,
              size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
            )) as unknown as Reading | null;
            if (read === null) throw new Error(`${at}: the page drew no pool under the pack`);
            expect(read.screenTier, `${at}: the screen tier did not fire as declared`).toBe(size.screen);
            expect(read.cards, `${at}: the pool drew a strip per card`).toBe(depth);

            // 7. A column head is one label over the middle of its column, not
            //    two things at its two ends. `mtg-keii`: `space-between` put the
            //    pip against the left edge and the count against the right, 196px
            //    apart in a 216px column on the deck screen at 1440x900, and
            //    pairing them back up was work the reader did once per column.
            //    Both halves stay -- `../../src/routes/deck/StripColumns.ts`
            //    argues the pip cannot be dropped -- so what is asserted is that
            //    they are adjacent and that the pair is centered.
            for (const spread of read.headSpread) {
              if (spread === null) continue;
              expect(spread.between, `${at}: a column head holds its parts apart`).toBeLessThanOrEqual(
                HEAD_GAP_PX + SLACK_PX,
              );
              expect(spread.margins, `${at}: a column head is not centered`).toBeLessThanOrEqual(
                SLACK_PX + 1,
              );
            }

            // 6. The bottom strip of a column is exactly the height every pitch
            //    in that column was computed against. Since mtg-mxkrk that is
            //    one name bar like every strip above it: the compact density
            //    draws no pictures, so there is no art window here whose own
            //    aspect ratio could take its height from the column's width and
            //    overflow the box by tens of pixels.
            expect(read.fullHeights, `${at}: a full strip is not one strip tall`).toEqual([
              DRAFT_STACK_BOX.stripHeight,
            ]);
            expect(
              read.overflow,
              `${at}: a column runs past the bottom of its own stack`,
            ).toBeLessThanOrEqual(SLACK_PX);

            // 1. The document does not scroll; the regions inside it do.
            expect(read.pageOverflowY, `${at}: the page scrolls as a document`).toBeLessThanOrEqual(SLACK_PX);

            // 3. The pack is above the pool, and both ends of the decision are
            //    on screen with it.
            expect(read.pack.bottom, `${at}: the pack is drawn under the pool`).toBeLessThanOrEqual(
              read.region.top + SLACK_PX,
            );
            expect(read.region.bottom, `${at}: the pool ends below the fold`).toBeLessThanOrEqual(
              size.height + SLACK_PX,
            );
            expect(read.commitBottom, `${at}: the commit button is under the fold`).toBeLessThanOrEqual(
              size.height + SLACK_PX,
            );
            expect(read.pack.height, `${at}: the pack has no height left`).toBeGreaterThan(0);

            // 4. One row of columns, scrolling sideways.
            expect(read.headTops, `${at}: the columns wrapped instead of scrolling`).toHaveLength(1);

            // 5. The pack keeps the larger half where there is a column to
            //    divide. A landscape phone is the case the pool is capped for
            //    and is asserted below rather than here.
            if (!size.screen) {
              expect(
                read.pack.height,
                `${at}: the pool takes more of the column than the pack it is chosen from`,
              ).toBeGreaterThanOrEqual(read.region.height);
            }
            seen.set(depth, read);
          }

          // 2. The promise: the same box at both depths, so nothing above it
          //    moves between one pick and the next.
          const shallow = seen.get(15);
          const deep = seen.get(45);
          if (shallow === undefined || deep === undefined) throw new Error('a depth went unmeasured');
          const at = `${String(size.width)}x${String(size.height)}`;
          expect(deep.box.height, `${at}: the pool grew between pick 15 and pick 45`).toBe(
            shallow.box.height,
          );
          expect(deep.pack.height, `${at}: the pack shrank as the pool filled`).toBe(shallow.pack.height);
          expect(deep.columns, `${at}: a deeper pool drew no more columns`).toBeGreaterThanOrEqual(
            shallow.columns,
          );

          // And on the phone the cap is what is holding the height down, which
          // is the rule most likely to resolve to nothing: 30vh of 390px is
          // 117, and the columns it is cropping are taller than that.
          if (size.screen) {
            expect(deep.box.height, `${at}: the phone cap did not apply`).toBeLessThan(deep.stripsHeight);
            expect(deep.box.height, `${at}: the phone cap is not 30vh`).toBeLessThanOrEqual(
              size.height * 0.3 + SLACK_PX,
            );
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

  browserIt(
    'gives the room a part-drawn pack is not using to the pool',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-draft-pool-room-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-draft-pool-room-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        // Pick 1 of a round and pick 11 of one: fifteen faces and five, at the
        // same pool depth, so the only thing that differs between the readings
        // is how much of the pack is left.
        const readings = new Map<number, Reading>();
        for (const taken of [30, 40] as const) {
          const file = join(directory, `pack-${String(taken)}.html`);
          await writeFile(file, page(taken), 'utf8');
          const at = `1440x900 after ${String(taken)} picks`;
          const read = (await measurePage(
            chrome.client,
            file,
            1440,
            900,
            MEASURE,
            at,
            '.mtg-draft__poolbox .mtg-strips__card',
            true,
            { mobile: false, pointer: 'fine' },
          )) as unknown as Reading | null;
          if (read === null) throw new Error(`${at}: the page drew no pool under the pack`);
          expect(read.pageOverflowY, `${at}: the page scrolls as a document`).toBeLessThanOrEqual(SLACK_PX);
          expect(read.commitBottom, `${at}: the commit button is under the fold`).toBeLessThanOrEqual(
            900 + SLACK_PX,
          );
          readings.set(taken, read);
        }
        const full = readings.get(30);
        const part = readings.get(40);
        if (full === undefined || part === undefined) throw new Error('a pack went unmeasured');

        // The pack gives the room back and the pool takes it. Both directions,
        // because a pack that shrank into empty page would satisfy the first.
        expect(part.pack.height, "a five-card pack holds a full pack's share").toBeLessThan(full.pack.height);
        expect(part.region.height, 'the pool did not take the room the pack gave back').toBeGreaterThan(
          full.region.height,
        );
        expect(part.box.height, 'the pool box stayed at its floor').toBeGreaterThan(
          DRAFT_STACK_BOX.boxHeight,
        );

        // And the pool box says the columns may be laid out against it, which is
        // what turns that room into strips rather than into empty box.
        expect(part.token, 'the pool box does not declare a height of its own').toBe(STACK_BOX_FROM_PANE);
        if (part.room === null) throw new Error('the pool drew no stack to measure');
        const grown = boxFromRoom(DRAFT_STACK_BOX, part.room);
        expect(grown.boxHeight, 'the room under a part-drawn pack buys no column').toBeGreaterThan(
          DRAFT_STACK_BOX.boxHeight,
        );
        expect(grown.boxHeight, 'the derived box is taller than the pool holding it').toBeLessThanOrEqual(
          part.room.scrollportHeight,
        );

        // A full pack is still the larger half: the floor is what the pool keeps
        // and the pack keeps the rest.
        expect(full.pack.height, 'a full pack lost the larger half of the column').toBeGreaterThanOrEqual(
          full.region.height,
        );
        expect(full.box.height, 'a full pack squeezed the pool under its floor').toBeGreaterThanOrEqual(
          DRAFT_STACK_BOX.boxHeight,
        );

        // `mtg-qs2d`. The floor is a column's and the box it is written on is a
        // scrollport's, so the pool has to be the taller of the two by exactly
        // the count row and its gaps. Three claims, because each of them was
        // separately true while the arrangement was still wrong:
        //
        //  - the constant is the two lengths the sheet actually spends, read off
        //    a real region rather than restated;
        //  - a pool at its floor has a whole column's worth of room left after
        //    that chrome, which is the sentence `../../src/styles/panel.ts`
        //    makes and did not keep;
        //  - and nothing hangs out or scrolls, which is what a reader sees.
        if (full.room === null) throw new Error('a full pack drew no stack to measure');
        expect(
          full.regionChrome,
          'STRIP_REGION_CHROME_PX is no longer what the region spends above and below its columns',
        ).toBeCloseTo(STRIP_REGION_CHROME_PX, 0);
        expect(
          full.room.scrollportHeight - full.room.regionTop - full.room.stackTop - full.room.regionFoot,
          'a pool at its floor has no room for the column it is the floor for',
        ).toBeGreaterThanOrEqual(DRAFT_STACK_BOX.boxHeight - SLACK_PX);
        expect(full.outOfBox, 'a column hangs out the bottom of the pool at a full pack').toBeLessThanOrEqual(
          SLACK_PX,
        );
        expect(full.boxScroll, 'the pool scrolls itself at a full pack').toBeLessThanOrEqual(SLACK_PX);
        // The allowance is an over-reservation on purpose and only has to cover
        // what this platform draws. Both readings, because whether a region
        // draws one at all depends on how many columns it happens to have.
        for (const [at, read] of [
          ['a full pack', full],
          ['a part-drawn pack', part],
        ] as const) {
          expect(
            read.regionScrollbar,
            `${at}: the sideways scrollbar is wider than STRIP_REGION_SCROLLBAR_PX reserves`,
          ).toBeLessThanOrEqual(STRIP_REGION_SCROLLBAR_PX);
          expect(read.boxScroll, `${at}: the pool scrolls itself`).toBeLessThanOrEqual(SLACK_PX);
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
