// @vitest-environment node
/**
 * What the short-table bound costs after crowded rows became wrapping layouts.
 *
 * `mtg-rkld`. `styles/board/hand.ts` caps the hand and the crowded battlefield
 * on a three-column table under 50rem tall, and `mtg-2s2k` pinned that bound at
 * 800 with one condition attached: the full table drew a crowded row at two
 * sizes, so it could not have the pixel. `mtg-6hhr` fixed that at the rotated
 * face's height guard, which retired the condition and left the bound resting on
 * a single stated reading — the held card's type line. This file is the
 * re-measure that was owed, and it is a comparison rather than a sweep: the
 * shipped sheet against the same sheet with the short-table rules struck out,
 * which is what a bound lowered past every height here would draw.
 *
 * Permanent piles changed the old horizontal reading. A crowded row now wraps
 * in both arms, and its hand remains a labeled thumbnail rail whether the
 * short-table cap is present or removed. This comparison retains the claims
 * that survive that product decision:
 *
 *  1. **The full table costs nothing vertical, anywhere.** Neither arm clips a
 *     permanent out of its row, overflows the page, or sends the hand sideways,
 *     at any height from 700 to 801, at four, eight or twelve a side. The
 *     sibling file asserts this at two heights and two side counts; the worry
 *     was that twelve a side or a shorter window would find the wall, and there
 *     is no wall to find. Every cost of the full table is horizontal.
 *  2. **Crowding never escapes sideways or restores full hand cards.** Both
 *     arms wrap distinct permanents and retain thumbnail hands. The query can
 *     tune wrapped geometry, but cannot reverse either invariant.
 *  3. **At four a side the cap still costs.** Pinned
 *     the way `./short-table-boundary.browser.test.ts` pins its own condition:
 *     these are assertions about a defect rather than about a design, and the
 *     day one is fixed this file fails, which is the notice. At four a side
 *     neither arm scrolls at any height, so the cap is paid for and buys
 *     nothing. `mtg-txde`
 *     holds the fix; it is a change to `styles/board/hand.ts`, which another
 *     lane has open.
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

/** Preserve the counterfactual's physical-card density across exact-state piling. */
function distinctCard(card: (typeof SPELLS)[number], position: string): (typeof SPELLS)[number] {
  return { ...card, id: `${card.id}-${position}` };
}

function board(perSide: number): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: perSide }, (_unused, index) => ({
      card: distinctCard(
        SPELLS[index % SPELLS.length] ?? SPELLS[0],
        `${String(controller)}-${String(index)}`,
      ),
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
    seed: `ui/short-table-earns-its-keep-${String(perSide)}`,
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

/**
 * The shipped sheet with every short-table rule struck out: the counterfactual.
 *
 * The query is read out of the sheet rather than restated, so a re-valued bound
 * moves this file with it, and the count of blocks removed is asserted by the
 * caller: two rules ask that condition, and a sheet where a third started
 * asking it would be stripping something this comparison never measured.
 */
function withoutShortTable(): { readonly css: string; readonly removed: number } {
  const sheet = uiStyleSheet();
  const query = /@media (\(min-width: \d+px\) and \(max-height: [\d.]+rem\)) \{/.exec(sheet);
  if (query === null) throw new Error('the sheet states no short-table rule');
  const block = new RegExp(
    `@media ${(query[1] ?? '').replace(/[()]/g, '\\$&')} \\{\\n(?:(?:[^@]|\\n)*?)\\n\\}\\n`,
    'g',
  );
  let removed = 0;
  const css = sheet.replace(block, () => {
    removed += 1;
    return '';
  });
  return { css, removed };
}

function page(game: GameSession, css: string): string {
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Short table cost</title><style>${css}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const drawn = (node) => node !== null && node.getBoundingClientRect().height > 0;
  const near = document.querySelector(".mtg-board__side[data-seat='you']");
  const hand = document.querySelector(".mtg-zone[data-tone='rail'] .mtg-slot[data-slot='hand'] > .mtg-card");
  const row = document.querySelector(".mtg-zone[data-tone='rail'] > .mtg-zone__body[data-layout='rail']");
  const spells = near.querySelector('.mtg-board__spells');
  const spellsBox = spells.getBoundingClientRect();
  let clip = 0;
  for (const face of near.querySelectorAll(".mtg-board__spells > .mtg-attach > .mtg-slot[data-slot='play'] > .mtg-card")) {
    const box = face.getBoundingClientRect();
    clip = Math.max(clip, spellsBox.top - box.top, box.bottom - spellsBox.bottom);
  }
  return {
    handWidth: hand === null ? -1 : round(parseFloat(getComputedStyle(hand).width)),
    handTypeDrawn: hand !== null && drawn(hand.querySelector('.mtg-card__type')),
    worstClipY: round(Math.max(0, clip)),
    pageOverflowY: round(document.documentElement.scrollHeight - document.documentElement.clientHeight),
    handScrollX: row === null ? -1 : round(row.scrollWidth - row.clientWidth),
    spellsScrollX: round(spells.scrollWidth - spells.clientWidth),
  };
})()`;

interface Reading {
  readonly handWidth: number;
  readonly handTypeDrawn: boolean;
  readonly worstClipY: number;
  readonly pageOverflowY: number;
  readonly handScrollX: number;
  readonly spellsScrollX: number;
}

/** Where the caps are meant to earn their keep, and where they are measured not to. */
const HEIGHTS = [700, 768, 800, 801] as const;
const CROWDED = [8, 12] as const;
const SIDES = [4, ...CROWDED] as const;

describe('the short table is measured against not having one', () => {
  browserIt(
    'costs nothing vertical and keeps crowded rows wrapping in either arm',
    async () => {
      const lowered = withoutShortTable();
      expect(lowered.removed, 'rules asking the short-table condition').toBe(2);

      const directory = await mkdtemp(join(tmpdir(), 'mtg-short-table-keep-'));
      const pages = new Map<string, string>();
      for (const perSide of SIDES) {
        for (const [arm, css] of [
          ['stock', uiStyleSheet()],
          ['lowered', lowered.css],
        ] as const) {
          const file = join(directory, `board-${String(perSide)}-${arm}.html`);
          await writeFile(file, page(board(perSide), css), 'utf8');
          pages.set(`${String(perSide)}:${arm}`, file);
        }
      }

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const read = async (perSide: number, arm: string, height: number): Promise<Reading> =>
          (await measurePage(
            chrome!.client,
            pages.get(`${String(perSide)}:${arm}`) ?? '',
            1280,
            height,
            MEASURE,
            `short table cost ${String(perSide)} ${arm}`,
          )) as unknown as Reading;

        for (const perSide of SIDES) {
          for (const height of HEIGHTS) {
            const stock = await read(perSide, 'stock', height);
            const full = await read(perSide, 'lowered', height);
            const where = `${String(perSide)} a side at 1280x${String(height)}`;

            // 1. Nothing vertical is spent by either arm, at any of these.
            for (const [arm, reading] of [
              ['short', stock],
              ['full', full],
            ] as const) {
              expect(reading.pageOverflowY, `${where}: the ${arm} table overflows the page`).toBe(0);
              expect(reading.worstClipY, `${where}: the ${arm} table cuts a permanent out of its row`).toBe(
                0,
              );
              expect(reading.handScrollX, `${where}: the ${arm} table sends the hand sideways`).toBe(0);
            }

            if (perSide === 4) {
              // 4. A sparse row fits at every height under either sheet, so the
              // cap here is spent on a smaller hand for nothing. Fixing that
              // fails the second of these.
              expect(stock.spellsScrollX, `${where}: a sparse row scrolls`).toBe(0);
              expect(full.spellsScrollX, `${where}: a sparse row scrolls without the caps`).toBe(0);
              if (height <= 800) {
                expect(stock.handWidth, `${where}: the cap costs the hand nothing`).toBeLessThan(
                  full.handWidth,
                );
              }
              continue;
            }

            if (height > 800) {
              // Over the bound both sheets are the same sheet; asserted rather
              // than skipped, because it is what makes the rows below a cost of
              // the caps and not of the height.
              expect(full.spellsScrollX, `${where}: the arms disagree above the bound`).toBe(
                stock.spellsScrollX,
              );
              expect(full.handWidth, `${where}: the hands disagree above the bound`).toBeCloseTo(
                stock.handWidth,
                1,
              );
              continue;
            }

            // 2. Distinct permanents wrap in both counterfactuals. A later
            // retune may change their size, never their reachability.
            expect(stock.spellsScrollX, `${where}: the capped battlefield escapes sideways`).toBe(0);
            expect(full.spellsScrollX, `${where}: the uncapped battlefield escapes sideways`).toBe(0);

            // 3. A crowded battlefield makes the hand a labeled thumbnail rail
            // independently of the short-table counterfactual. Neither arm may
            // spend battlefield room to restore the held card's type line.
            expect(stock.handTypeDrawn, `${where}: the capped hand draws a type line`).toBe(false);
            expect(full.handTypeDrawn, `${where}: the uncapped hand draws a type line`).toBe(false);
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
          `short table cost Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    300_000,
  );
});
