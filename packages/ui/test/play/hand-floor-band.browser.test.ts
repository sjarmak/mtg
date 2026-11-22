// @vitest-environment node
/**
 * The band an upright tablet sits in, measured at both edges it is bounded by.
 *
 * `mtg-g52`. `../../src/styles/board/hand.ts` floors a held card at a complete
 * face, and until this bead the rule had one arm: a three-column table, 901px
 * and up. An upright tablet is under that line and is not a phone, and it drew
 * the smallest face on the table in the zone the player reads most - 48x67
 * against a 100x139.7 permanent, no rules box on any of the seven held cards,
 * 0.48 of the card being played onto, with 641px of seat column spent 95 on the
 * hand. The fix is a second arm, `TALL_NARROW_TABLE_QUERY`, and the whole of it
 * is two numbers: 48rem of width and 50rem of height.
 *
 * Numbers chosen by measurement are worth exactly what holds them in place, so
 * this file holds them:
 *
 *  1. **The band is real and it is deliberate.** Its floor sits a whole band
 *     above `../../src/styles/mobile.ts`'s `PHONE_MAX_REM` and below the
 *     three-column table's own bound, so it names a window that neither of the
 *     two arrangements either side of it claims. Read out of the emitted sheet,
 *     because `mobile.ts` imports `hand.ts` and the arrow cannot run back.
 *  2. **768x1024 is inside it**: the held face is the complete face the rule
 *     names, to the pixel, and it draws the rules box the collapsed face could
 *     not.
 *  3. **767x1024 is outside it**, and that is the reading the bead was filed
 *     on. One pixel of width, and the hand is back under its own floor.
 *  4. **768x799 is outside it too.** The height bound is what keeps a landscape
 *     phone out, and a size can only tell it apart from no bound at all by
 *     failing it.
 *  5. **The battlefield pays nothing.** A permanent is one width across the
 *     width edge and across the height edge; the room the hand took came out of
 *     the seat's slack.
 *
 * jsdom performs no layout, so none of 2 to 5 is measurable there; the harness
 * is `../support/chrome.ts`. Claim 1 is text and runs everywhere.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, GameState } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { PHONE_MAX_REM } from '../../src/styles/mobile';
import { THREE_COLUMN_MIN_WIDTH_PX } from '../../src/styles/board/geometry';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/** The neutral example set, so this file exports with the rest of the lab. */
const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [
  exampleCard('slc-plains'),
  exampleCard('slc-island'),
  exampleCard('slc-swamp'),
  exampleCard('slc-mountain'),
] as const;

/** A full hand and a modest board: the arrangement the bead was filed against. */
function board(): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) =>
    Array.from({ length: 4 }, (_unused, index) => ({
      card: SPELLS[index % SPELLS.length] ?? SPELLS[0],
      controller,
      tapped: index % 2 === 0,
      summoningSick: false,
    })),
  );
  const built = scenario({
    seed: 'ui/hand-floor-band',
    battlefield,
    hands: [
      [SPELLS[0], SPELLS[1], SPELLS[2], LANDS[0], SPELLS[3], LANDS[1], SPELLS[0]],
      [SPELLS[1], SPELLS[2], LANDS[2], SPELLS[3], LANDS[3], SPELLS[0], SPELLS[1]],
    ],
    active: 0,
    turn: 7,
  });
  const state: GameState = built.state;
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: built.events,
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function page(game: GameSession): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: game,
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hand floor band</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const drawn = (node) => node !== null && node.getBoundingClientRect().height > 0;
  const read = (face) => {
    if (face === null || face === undefined) return null;
    const box = face.getBoundingClientRect();
    return {
      w: round(box.width),
      h: round(box.height),
      rulesDrawn: drawn(face.querySelector('.mtg-card__text')),
    };
  };
  const near = document.querySelector(".mtg-board__side[data-seat='you']");
  const hand = document.querySelector(".mtg-zone[data-tone='rail'] .mtg-slot[data-slot='hand'] > .mtg-card");
  const permanent = near.querySelector(".mtg-board__spells > .mtg-attach > .mtg-slot[data-slot='play'][data-tapped='false'] > .mtg-card");
  return {
    viewport: [window.innerWidth, window.innerHeight],
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    hand: read(hand),
    permanent: read(permanent),
  };
})()`;

interface Reading {
  readonly w: number;
  readonly h: number;
  readonly rulesDrawn: boolean;
}

/**
 * The floor rule, read out of the sheet that emits it.
 *
 * Both arms and the face it floors at. Restating any of the three here would let
 * this file pass a sheet that had stopped stating them.
 */
function floorRule(): {
  readonly wideArmPx: number;
  readonly bandMinWidthRem: number;
  readonly bandMinHeightRem: number;
  readonly faceRem: number;
} {
  const block =
    /@media \(min-width: (\d+)px\), \(min-width: ([\d.]+)rem\) and \(min-height: ([\d.]+)rem\) \{\n[^@{]*\{\n\s*--hand-face-floor: ([\d.]+)rem;/.exec(
      uiStyleSheet(),
    );
  if (block === null) throw new Error('the sheet states no two-armed hand-face floor');
  return {
    wideArmPx: Number(block[1]),
    bandMinWidthRem: Number(block[2]),
    bandMinHeightRem: Number(block[3]),
    faceRem: Number(block[4]),
  };
}

/** A tenth of a pixel: two readings of one layout are equal or they are not. */
const TOLERANCE_PX = 0.1;

describe('the hand-face floor reaches the upright tablet and stops there', () => {
  it('names a band between the phone and the three-column table', () => {
    const rule = floorRule();

    // The wide arm is the three-column table's own bound, unchanged.
    expect(rule.wideArmPx).toBe(THREE_COLUMN_MIN_WIDTH_PX);

    // And the second arm sits strictly inside the gap either side of it: above
    // the phone, whose hand is unreadable at either size and whose fix is a
    // phone's, and below the table that already had the floor.
    expect(rule.bandMinWidthRem).toBeGreaterThan(PHONE_MAX_REM);
    expect(rule.bandMinWidthRem * 16).toBeLessThan(rule.wideArmPx);
  });

  browserIt(
    'floors 768x1024, and neither 767x1024 nor 768x799',
    async () => {
      const rule = floorRule();
      const directory = await mkdtemp(join(tmpdir(), 'mtg-hand-floor-band-'));
      const file = join(directory, 'board.html');
      await writeFile(file, page(board()), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const at = async (width: number, height: number): Promise<Record<string, unknown>> =>
          await measurePage(chrome!.client, file, width, height, MEASURE, 'hand floor band');
        const inside = await at(768, 1024);
        const narrower = await at(767, 1024);
        const shorter = await at(768, 799);

        const root = inside['root'] as number;
        const floorPx = rule.faceRem * root;
        const held = (reading: Record<string, unknown>): Reading => reading['hand'] as Reading;

        // Inside the band the held card is the complete face the rule names, and
        // it is complete in the sense that matters: it draws its rules box.
        expect(held(inside).w, 'held face inside the band').toBeCloseTo(floorPx, 1);
        expect(held(inside).rulesDrawn, 'held rules box inside the band').toBe(true);

        // One pixel narrower, and one pixel shorter, are both outside it. This is
        // the reading mtg-g52 was filed on, held so a later change cannot widen
        // the band without walking past the measurement that bounded it.
        for (const [label, reading] of [
          ['a pixel narrower', narrower],
          ['a pixel shorter', shorter],
        ] as const) {
          expect(held(reading).w, `held face ${label}`).toBeLessThan(floorPx - TOLERANCE_PX);
        }

        // The battlefield is one width across both edges: the floor spends the
        // seat's slack, not the far lane's room.
        for (const [label, reading] of [
          ['across the width edge', narrower],
          ['across the height edge', shorter],
        ] as const) {
          expect(
            Math.abs((reading['permanent'] as Reading).w - (inside['permanent'] as Reading).w),
            `permanent width ${label}`,
          ).toBeLessThanOrEqual(TOLERANCE_PX);
        }
      } catch (error: unknown) {
        bodyError = error;
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
      if (bodyError !== undefined) throw bodyError;
    },
    30_000,
  );
});
