// @vitest-environment node
/**
 * Where the short table begins, pinned at the pixel it begins on.
 *
 * `mtg-2s2k`. `styles/board/hand.ts` caps the hand and the crowded battlefield
 * on a three-column table that is short, and the bound it reads is 50rem. It was
 * read by `max-height`, which is inclusive, so a window exactly 800px tall — one
 * of the three every play rig measures — took the short caps. Measured at 1280
 * wide, that was a 15px narrower hand face at four a side and the type line gone
 * from the held card and from every permanent the viewer owned at eight, decided
 * by one pixel of viewport against a bound fitted to a 766px capture.
 *
 * Nothing moved. 800 stays short, and this file is the measurement that decided
 * it, held where a later change has to walk past it:
 *
 *  1. **799 and 800 are short.** The hand face is the short cap the sheet
 *     states, at both, to the pixel.
 *  2. **801 is a full table**, and the hand face there is a clear step above the
 *     cap rather than a rounding of it.
 *  3. **The rule is written inclusively**, `max-height` rather than `height <`.
 *     A size can tell the two apart at 800 and nowhere else, so the comparison
 *     is read out of the emitted sheet as well as measured.
 *  4. **The full table at eight a side draws a crowded row at two sizes**, and
 *     that is what holds the line at 800. The row asks for more width than it
 *     has, `styles/board/fit.ts` lets a battlefield slot shrink, and the two
 *     kinds of slot do not shrink alike: the upright permanents come out about
 *     6px under the tapped ones. Pinned here because it is the condition on this
 *     bound rather than a fact about it — fix it and this assertion fails, which
 *     is the notice that 800 can move up.
 *
 * Everything here is read off the page or out of the emitted sheet. The hand cap
 * is not restated: it is parsed from the rule that sets it, so a re-valued cap
 * moves this file with it and a re-valued *bound* fails it.
 *
 * jsdom performs no layout, so none of this is measurable there; the harness is
 * `../support/chrome.ts`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, GameState } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

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

function board(perSide: number): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: perSide }, (_unused, index) => ({
      card: SPELLS[index % SPELLS.length] ?? SPELLS[0],
      controller,
      tapped: index % 2 === 0,
      summoningSick: false,
    })),
    ...Array.from({ length: 5 }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller,
      tapped: index % 3 === 0,
      summoningSick: false,
    })),
  ]);
  const built = scenario({
    seed: `ui/short-table-boundary-${String(perSide)}`,
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Short table boundary</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const drawn = (node) => node !== null && node.getBoundingClientRect().height > 0;
  const read = (face) => {
    if (face === null || face === undefined) return null;
    const style = getComputedStyle(face);
    const chrome =
      parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const box = parseFloat(style.width);
    return {
      w: round(box),
      content: round(box - chrome),
      typeDrawn: drawn(face.querySelector('.mtg-card__type')),
      rulesDrawn: drawn(face.querySelector('.mtg-card__text')),
    };
  };
  const near = document.querySelector(".mtg-board__side[data-seat='you']");
  const hand = document.querySelector(".mtg-zone[data-tone='rail'] .mtg-slot[data-slot='hand'] > .mtg-card");
  const permanent = near.querySelector(".mtg-board__spells > .mtg-slot[data-slot='play'][data-tapped='false'] > .mtg-card");
  const tapped = near.querySelector(".mtg-board__spells > .mtg-slot[data-slot='play'][data-tapped='true'] > .mtg-card");
  const row = document.querySelector(".mtg-zone[data-tone='rail'] > .mtg-zone__body[data-layout='rail']");
  const spells = near.querySelector('.mtg-board__spells');
  const spellsBox = spells.getBoundingClientRect();
  let clip = 0;
  for (const face of near.querySelectorAll(".mtg-board__spells > .mtg-slot[data-slot='play'] > .mtg-card")) {
    const box = face.getBoundingClientRect();
    clip = Math.max(clip, spellsBox.top - box.top, box.bottom - spellsBox.bottom);
  }
  return {
    viewport: [window.innerWidth, window.innerHeight],
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    hand: read(hand),
    permanent: read(permanent),
    tapped: read(tapped),
    worstClipY: round(Math.max(0, clip)),
    pageOverflowY: round(document.documentElement.scrollHeight - document.documentElement.clientHeight),
    handScrollX: row === null ? -1 : round(row.scrollWidth - row.clientWidth),
  };
})()`;

interface Reading {
  readonly w: number;
  readonly content: number;
  readonly typeDrawn: boolean;
  readonly rulesDrawn: boolean;
}

/**
 * The short table's own rule, read out of the sheet that emits it.
 *
 * Three things the claims need: the comparison the bound is written with, and
 * the two hand caps the rule sets — a sparse row's and, for a row of eight or
 * more, the crowded one that follows it in the same block. Restating either cap
 * here would let this file pass a sheet that had stopped stating it.
 */
function shortTableHandCaps(): {
  readonly comparison: string;
  readonly sparseRem: number;
  readonly crowdedRem: number;
} {
  const block =
    /@media \(min-width: \d+px\) and \((max-height:|height <) ([\d.]+)rem\) \{\n((?:[^@]|\n)*?)\n\}/.exec(
      uiStyleSheet(),
    );
  if (block === null) throw new Error('the sheet states no short-table rule');
  const caps = [...(block[3] ?? '').matchAll(/--hand-face-cap: ([\d.]+)rem;/g)].map((hit) => Number(hit[1]));
  const [sparseRem, crowdedRem] = caps;
  if (sparseRem === undefined || crowdedRem === undefined) {
    throw new Error(`the short-table rule states ${String(caps.length)} hand caps, not two`);
  }
  return { comparison: block[1] ?? '', sparseRem, crowdedRem };
}

/** A tenth of a pixel: two readings of one layout are equal or they are not. */
const TOLERANCE_PX = 0.1;

describe('the short table begins at a viewport height it was measured against', () => {
  browserIt(
    'reads 1280x800 as a short table and 1280x801 as a full one, and says so inclusively',
    async () => {
      const caps = shortTableHandCaps();

      // The bound is a ceiling for the short table, so the pixel it names is
      // the short table's. `height <` would give that pixel away, and no
      // measurement can tell the two rules apart at any height but 800 — which
      // is why the comparison is asserted as text beside the sizes.
      expect(caps.comparison, 'the short table is bounded exclusively').toBe('max-height:');

      const directory = await mkdtemp(join(tmpdir(), 'mtg-short-table-boundary-'));
      const pages = new Map<number, string>();
      for (const perSide of [4, 8]) {
        const file = join(directory, `board-${String(perSide)}.html`);
        await writeFile(file, page(board(perSide)), 'utf8');
        pages.set(perSide, file);
      }

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [perSide, file] of pages) {
          const at = async (height: number): Promise<Record<string, unknown>> =>
            await measurePage(chrome!.client, file, 1280, height, MEASURE, 'short table boundary');
          const under = await at(799);
          const bound = await at(800);
          const over = await at(801);
          const where = `${String(perSide)} a side`;

          const root = bound['root'] as number;
          const capRem = perSide >= 8 ? caps.crowdedRem : caps.sparseRem;
          const underHand = under['hand'] as Reading;
          const boundHand = bound['hand'] as Reading;
          const overHand = over['hand'] as Reading;

          // 799 and 800 are both short: the hand takes the cap the rule states.
          for (const [label, reading] of [
            ['under', underHand],
            ['at', boundHand],
          ] as const) {
            expect(reading.w, `${where}: hand face ${label} the bound`).toBeCloseTo(capRem * root, 1);
          }

          // 801 is not, and the step is a step rather than a rounding.
          expect(overHand.w, `${where}: hand face one pixel over the bound`).toBeGreaterThan(
            capRem * root + TOLERANCE_PX,
          );

          // Neither arm is paid for with a scrollbar, a permanent cut out of its
          // row, or a hand row sent sideways, at the bound or over it. That is
          // the half of the case for the tall arm that survived: it reads better
          // at 800 and costs none of these.
          for (const [label, reading] of [
            ['at', bound],
            ['over', over],
          ] as const) {
            expect(reading['pageOverflowY'], `${where}: page overflows ${label} the bound`).toBe(0);
            expect(reading['worstClipY'], `${where}: permanent cut by its row ${label} the bound`).toBe(0);
            expect(reading['handScrollX'], `${where}: hand row scrolls sideways ${label} the bound`).toBe(
              under['handScrollX'],
            );
          }

          if (perSide === 8) {
            // What the pixel is worth at eight a side, and it is not nothing:
            // the type line, on the card in hand and on the permanent beside it.
            // Its threshold is a content box in ../../src/styles/card.ts, so
            // this reads the drawn region rather than a width.
            expect(boundHand.typeDrawn, `${where}: held type line at the bound`).toBe(false);
            expect(overHand.typeDrawn, `${where}: held type line one pixel over the bound`).toBe(true);
            expect(
              (over['permanent'] as Reading).typeDrawn,
              `${where}: battlefield type line over the bound`,
            ).toBe(true);

            // And what it buys, which is the reason the bound did not move. A
            // crowded row on the short table draws one size of permanent; one
            // pixel higher it draws two, the upright ones about 6px under the
            // tapped ones. Fixing that is what releases 800.
            expect(
              Math.abs((bound['tapped'] as Reading).w - (bound['permanent'] as Reading).w),
              `${where}: crowded row draws two sizes of permanent at the bound`,
            ).toBeLessThanOrEqual(1);
            expect(
              (over['tapped'] as Reading).w - (over['permanent'] as Reading).w,
              `${where}: crowded row draws one size of permanent over the bound, so this bound can move`,
            ).toBeGreaterThan(1);
          }

          // The rules box never depended on this bound and still does not.
          for (const [label, reading] of [
            ['under', underHand],
            ['at', boundHand],
            ['over', overHand],
          ] as const) {
            expect(reading.rulesDrawn, `${where}: held rules box ${label} the bound`).toBe(true);
          }
        }
      } catch (error) {
        bodyError = error;
      }

      const cleanupErrors: Error[] = [];
      if (chrome !== null) {
        try {
          await shutdownChrome(chrome);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(new Error(`could not remove Chrome fixture ${directory}: ${reason(error)}`));
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          `short table boundary Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    180_000,
  );
});
