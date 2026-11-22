// @vitest-environment node
/**
 * What collapsing the side panel returns to the mana band.
 *
 * `mtg-0iy`. `LAND_TILE_HEIGHT_REM` went 3 -> 3.5 in `mtg-l7q` so a viewer
 * could tell a land from a spell at a glance, and a tile went 73 x 48 to
 * 85.2 x 56. Fewer of those fit on the band's one line, so the horizontal
 * scroll starts a land or two earlier than it used to: measured over
 * `tools/board-crowding.ts` at 4/7/10/14 lands a side, 1280x800 began
 * scrolling at 10 lands where it had begun at 14, and 1024x768 at 7 where it
 * had begun at 10.
 *
 * That bead's acceptance was to re-run the table after the rail work and
 * either restore those onsets or record why the band keeps them. This file is
 * the record, and the answer turns on one piece of viewer state. With the
 * panel **open** every onset the bead recorded still holds, at every cell.
 * With it **shut** the band is handed the whole of the rail — a flat 228px at
 * all four viewports — worth three more tiles at 1280x800, 1024x768 and
 * 810x1080 and two at 1440x900. The tile grew by twelve pixels, so what the
 * collapse returns is more than the growth took at the lower three viewports
 * and exactly what it took at 1440x900. In the bead's 4/7/10/14 steps that
 * reads as one step at each of the lower three: 1280x800 back to 14,
 * 1024x768 back to 10, 810x1080 from 4 to 7. Re-measured art-less, and the
 * tile came out 85.2 x 56 exactly as the bead states, so the picture is not
 * what moved.
 *
 * # Why the band keeps them with the panel open
 *
 * The two levers the bead names are spent. `BOARD_FACE_MAX_SHARE` is where
 * `mtg-l7q` already bought the tile's pixels — 85% -> 96% of the row, leaving
 * four points of reserved mat — and walking `LAND_TILE_HEIGHT_REM` back down
 * is undoing the thing the bead was opened about. What is left is the scroll,
 * and a scrolling land row is the one scroll `docs/research/prior-art-board-layout.md`
 * finds precedented: Arena scrolls its own. So the band keeps the onsets, and
 * the panel is the control that buys them back.
 *
 * # What this holds
 *
 * Capacity in tiles, not the onset in lands, because `CROWDING_LANDS` steps
 * 4/7/10/14 and a step that coarse hides a move until it crosses one. The
 * onset is a floor over this number, so holding capacity holds the onset and
 * says by how much it is held.
 *
 * Three claims. The collapse never costs the band a tile, which is the
 * monotone rule `mtg-crw` promised the battlefield and nothing had checked
 * for the band. The shut band holds at least what the band held before the
 * tile grew, computed against the 73px tile the bead records rather than
 * asserted from a remembered onset. And both tables, pinned, because a
 * regression that spends the reclaim on something else leaves the first two
 * claims true and these numbers wrong.
 *
 * The open column is `./band-edge.browser.test.ts`'s `CAPACITY` reproduced.
 * That one reads a four-land board and this one a fourteen-land board, so the
 * two agreeing is the evidence that a band's capacity is its geometry and not
 * what happens to be standing in it.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isLand, parseCards, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const setPath = fileURLToPath(
  new URL('../../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);
const setDocument = JSON.parse(readFileSync(setPath, 'utf8')) as { readonly cards: readonly unknown[] };
const cards = parseCards(setDocument.cards);
const basics = setBasics(cards);
const spells = cards.filter((card) => !isLand(card));

/** The board the bead measured: four permanents a side over a fourteen-land base. */
const SPELLS_A_SIDE = 4;
const LANDS_A_SIDE = 14;

function spell(index: number): DslCard {
  const card = spells[index % spells.length];
  if (card === undefined) throw new Error('the fixture set has no spell to crowd the board with');
  return card;
}

function land(index: number): DslCard {
  const card = basics[index % basics.length];
  if (card === undefined) throw new Error('the fixture set minted no basics to build a mana base from');
  return card;
}

/**
 * A main-phase board with the band overflowing at every viewport under test,
 * so the reading is taken on a band that is actually scrolling rather than one
 * whose capacity is arithmetic about a case it never reaches.
 */
function board(): GameSession {
  const creature = spell(0);
  const built = scenario({
    seed: 'ui/band-rail-capacity',
    battlefield: [0, 1].flatMap((controller) => [
      ...Array.from({ length: SPELLS_A_SIDE }, () => ({
        card: creature,
        controller: controller as PlayerId,
        summoningSick: false,
      })),
      ...Array.from({ length: LANDS_A_SIDE }, (_unused, index) => ({
        card: land(index),
        controller: controller as PlayerId,
        summoningSick: false,
        tapped: index % 2 === 1,
      })),
    ]),
    hands: [spells.slice(0, 2), spells.slice(0, 2)],
    step: 'precombatMain',
    active: 0,
    turn: 8,
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
 * The page, with the rail state written onto the mat rather than clicked.
 *
 * `./rail-collapse-board.browser.test.ts` records why: the sheet acts on
 * `data-rail` and a static render has no click, so substituting the attribute
 * is the whole of the shut state. It throws when the attribute is missing, so
 * a rename turns into a failure rather than two identical measurements.
 */
function page(game: GameSession, rail: 'open' | 'shut'): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      title: 'Tideglass Reach',
      children: h(
        'div',
        { className: 'mtg-play-route' },
        h(PlayView, {
          session: game,
          viewer: 0,
          names: ['You', 'Bot'],
          onChoose: () => undefined,
          autoPass: DEFAULT_AUTO_PASS,
          onAutoPass: () => undefined,
          onYield: () => undefined,
        }),
      ),
    }),
  );
  const staged = rail === 'shut' ? markup.replace('data-rail="open"', 'data-rail="shut"') : markup;
  if (rail === 'shut' && staged === markup) {
    throw new Error('the mat did not carry data-rail="open", so the shut state cannot be written onto it');
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Band rail ${rail}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${staged}</body></html>`;
}

/**
 * Per seat: how many tiles the band holds before it scrolls, and whether it is
 * scrolling.
 *
 * The capacity arithmetic is `./band-edge.browser.test.ts`'s, character for
 * character, so the two tables are the same reading in two rail states and can
 * be compared without a conversion.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const seats = ['you', 'opponent'].map((seat) => {
    const band = document.querySelector("[data-seat='" + seat + "'] .mtg-lands");
    if (band === null) return { seat, tiles: 0, fits: 0, scrolls: false, clientWidth: 0, tileWidth: 0 };
    const tiles = [...band.querySelectorAll(".mtg-slot[data-slot='play']")];
    const style = getComputedStyle(band);
    const first = tiles[0];
    const gap = parseFloat(style.columnGap) || 0;
    const tileWidth = first === undefined ? 0 : first.getBoundingClientRect().width;
    return {
      seat,
      tiles: tiles.length,
      clientWidth: round(band.clientWidth),
      gap: round(gap),
      tileWidth: round(tileWidth),
      tileHeight: first === undefined ? 0 : round(first.getBoundingClientRect().height),
      scrolls: band.scrollWidth - band.clientWidth > 1,
      fits: tileWidth === 0 ? 0 : Math.floor((band.clientWidth + gap) / (tileWidth + gap)),
    };
  });
  return { viewport: [window.innerWidth, window.innerHeight], seats };
})()`;

interface Seat {
  readonly seat: string;
  readonly tiles: number;
  readonly clientWidth: number;
  readonly gap: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly scrolls: boolean;
  readonly fits: number;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly seats: readonly Seat[];
}

const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [810, 1080],
] as const;

/**
 * How wide a tile was before `mtg-l7q` grew it, from the bead: 73 x 48 against
 * today's 85.2 x 56.
 *
 * Here so the shut band can be held against the band a viewer had before the
 * growth rather than against a remembered onset. What it reconstructs is
 * today's band at the old tile width, not the band as it actually stood:
 * `mtg-7i50` moved the band's own inline padding in between, so the two differ
 * by a couple of pixels and the reconstruction is the conservative of them.
 * Even so it clears by two tiles at 1280x800, 1024x768 and 810x1080, and meets
 * it exactly at 1440x900.
 *
 * It is history and it does not move. If the tile changes again the live half
 * of the comparison moves and this stays the mark it was.
 */
const TILE_WIDTH_BEFORE_GROWTH = 73;

/**
 * Tiles the band holds before it scrolls, per viewport width, panel open.
 *
 * `./band-edge.browser.test.ts`'s `CAPACITY`, reproduced off a fourteen-land
 * board where that one reads four. The two agreeing is the point.
 */
const OPEN_CAPACITY: Readonly<Record<number, number>> = { 810: 3, 1024: 5, 1280: 8, 1440: 10 };

/**
 * The same, panel shut. The rail is a flat 228px at every viewport and the band
 * is given all of it, so these are `OPEN_CAPACITY` plus what 228px buys at a
 * tile width of 85.2 and a 2px gap: three tiles, except at 1440x900 where the
 * open band's slack absorbs one of them.
 */
const SHUT_CAPACITY: Readonly<Record<number, number>> = { 810: 6, 1024: 8, 1280: 11, 1440: 12 };

describe('collapsing the side panel gives the mana band its width back', () => {
  browserIt(
    'never costs the band a tile, and returns enough to carry the pre-growth mana base',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-band-rail-'));
      const game = board();
      const files: Record<'open' | 'shut', string> = {
        open: join(directory, 'band-open.html'),
        shut: join(directory, 'band-shut.html'),
      };
      await writeFile(files.open, page(game, 'open'), 'utf8');
      await writeFile(files.shut, page(game, 'shut'), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const readings: Record<'open' | 'shut', Reading> = {
            open: (await measurePage(
              chrome.client,
              files.open,
              width,
              height,
              MEASURE,
              'band-rail-open',
            )) as unknown as Reading,
            shut: (await measurePage(
              chrome.client,
              files.shut,
              width,
              height,
              MEASURE,
              'band-rail-shut',
            )) as unknown as Reading,
          };
          console.log(
            `${String(width)}x${String(height)}: open ${JSON.stringify(readings.open.seats)} shut ${JSON.stringify(readings.shut.seats)}`,
          );
          for (const [index, open] of readings.open.seats.entries()) {
            const shut = readings.shut.seats[index];
            if (shut === undefined) throw new Error(`the shut page drew no ${open.seat} band`);
            const at = `${String(width)}x${String(height)} ${open.seat}`;

            expect(open.tiles, `${at}: the open band drew no mana base`).toBe(LANDS_A_SIDE);
            expect(shut.tiles, `${at}: the shut band drew no mana base`).toBe(LANDS_A_SIDE);
            expect(open.tileWidth, `${at}: the tile is not the size the bead measured`).toBeCloseTo(85.2, 1);
            expect(open.tileHeight, `${at}: the tile is not the height the bead measured`).toBe(56);

            // Fourteen a side is the count at which a one-line band has to prove
            // it scrolls rather than growing, and it has to prove it in both
            // states: the reclaim is worth three tiles and the gap is eleven.
            expect(open.scrolls, `${at}: fourteen lands did not scroll the open band`).toBe(true);
            expect(shut.scrolls, `${at}: fourteen lands did not scroll the shut band`).toBe(true);

            expect(shut.fits, `${at}: collapsing the panel cost the band a tile`).toBeGreaterThanOrEqual(
              open.fits,
            );
            const beforeGrowth = Math.floor(
              (open.clientWidth + open.gap) / (TILE_WIDTH_BEFORE_GROWTH + open.gap),
            );
            expect(
              shut.fits,
              `${at}: shut, the band holds ${String(shut.fits)} where the ${String(TILE_WIDTH_BEFORE_GROWTH)}px tile held ${String(beforeGrowth)}`,
            ).toBeGreaterThanOrEqual(beforeGrowth);

            expect(open.fits, `${at}: the open band's capacity moved`).toBe(OPEN_CAPACITY[width]);
            expect(shut.fits, `${at}: the shut band's capacity moved`).toBe(SHUT_CAPACITY[width]);
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
          `band rail Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    180_000,
  );
});
