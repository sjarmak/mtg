// @vitest-environment node
/**
 * What a land tile draws, measured on a page that has art and on a page that
 * has none. It draws the same thing on both, and that thing is not type.
 *
 * `mtg-dgv3`. The mana band draws each land at `data-size='art'`, and
 * `../src/styles/card.ts` hid the title region at that size and re-enabled it
 * only under `:has([data-art-state='pending'])`. That made one visible fact
 * about the table — whether a land is labeled — a consequence of whether an art
 * run happened to cover the basics. It did not, for most of this set's life, so
 * every reading ever taken of the tile was taken on a board of pending frames
 * and the labeled state was the only one anybody saw. The flagship's basics are
 * covered now, and the tiles went wordless without a decision being made.
 *
 * **The tile is wordless on purpose, which is the decision.** The playtester,
 * 2026-08-13, recorded verbatim in `mtg-ghv`: "I want the lands to show up a
 * little nicer so they are in a row below the cards in play and that they just
 * show their art no thick border and no text". The name was never a design
 * choice competing with that sentence; it was the degenerate case leaking
 * through a selector. The measurements agree with her: a name in this box is
 * about 8px upright and about 6.7px on a tapped tile, which
 * `board/lands.ts`'s `TAPPED_TILE_SCALE` shrinks to 0.658 of its untapped self.
 * A word nobody can read is not identification, and it was taking 15.2px of a
 * 56px tile away from the picture that is.
 *
 * So the tile states what it is through its art, its identity keyline and its
 * mana pip — and, when there is no art, through the pending frame's own pill.
 * That last one is why this file measures the pill as well: a hatched square
 * with nothing on it at all would be worse than either version of the name, and
 * with the flagship at 368/368 covered it is a rare state rather than a gone
 * one, so it has to be right without being loud.
 *
 * **Only a browser can hold any of it.** jsdom lays nothing out, so the name
 * element is in the markup either way and `getBoundingClientRect` is zeros on
 * both pages: the two states are indistinguishable there, which is why
 * `../test/land-tile.test.ts` was green through the whole defect. `display: none`
 * is a fact about a box, so it is read off a box.
 *
 * **Two pages, one position.** The same land-only battlefield is rendered twice
 * through the real `PlayView`: once with a resolver that answers every card with
 * a data-URI raster, once with no resolver at all. The raster is inline rather
 * than a file so the page reaches nothing and decodes regardless of what any art
 * run left on this machine — a broken `src` falls back to the pending frame, so
 * the run asserts the covered page really did reach `data-art-state='ready'`
 * before it asserts anything about what that page draws.
 *
 * **What is asserted.** No tile draws a name with a box on it, at any viewport,
 * on either page — which is the acceptance criterion stated directly, since the
 * outcome is now the same whether the raster resolved or not and a state-keyed
 * rule reintroduced in either direction fails here. The picture takes the whole
 * tile. And the pending page draws its pill, inside the window rather than
 * clipped by it, while the covered page draws neither pill nor name.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { BASIC_LANDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { ART_PENDING_LABEL } from '../src/card/ArtSlot';
import type { ArtResolver } from '../src/lab/art-manifest';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from './support/chrome';

/**
 * A 1x1 raster, inline. The tile's window is `object-fit: cover`, so one pixel
 * fills it exactly as a real illustration would, and what is under test is the
 * `ready` state rather than the picture.
 */
const RASTER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const COVERED: ArtResolver = (card) => ({ src: RASTER, alt: `an illustration for ${card.id}` });

/** Two of each basic a seat, so a tile's neighbors are on the row beside it. */
const COPIES = 2;

function seatLands(seat: PlayerId): readonly DslCard[] {
  const half = Math.ceil(BASIC_LANDS.length / 2);
  const mine = seat === 0 ? BASIC_LANDS.slice(0, half) : BASIC_LANDS.slice(half);
  return mine.flatMap((card) => Array.from({ length: COPIES }, () => card));
}

/** A table that is nothing but lands, so every tile measured is the subject. */
function landSession(): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) =>
    seatLands(controller).map((card) => ({ card, controller, summoningSick: false })),
  );
  const built = scenario({ seed: 'land-tile-name', battlefield, active: 0, turn: 6 });
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

function pageHtml(artFor: ArtResolver | null): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: landSession(),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        artFor,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Land tile name</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/** One read of every land tile on the page. It mutates nothing. */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const rect = (element) => {
    if (element === null) return { width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0 };
    const box = element.getBoundingClientRect();
    return {
      width: round(box.width), height: round(box.height),
      left: round(box.left), right: round(box.right),
      top: round(box.top), bottom: round(box.bottom),
    };
  };
  const tiles = [];
  for (const slot of document.querySelectorAll('.mtg-lands > .mtg-slot')) {
    const face = slot.querySelector(".mtg-card[data-size='art']");
    if (face === null) continue;
    const window_ = face.querySelector('.mtg-art');
    tiles.push({
      cardId: face.getAttribute('data-card-id'),
      artState: window_ === null ? null : window_.getAttribute('data-art-state'),
      naturalWidth: face.querySelector('img.mtg-art__image')?.naturalWidth ?? 0,
      text: face.querySelector('.mtg-card__name')?.textContent ?? null,
      name: rect(face.querySelector('.mtg-card__name')),
      pill: rect(face.querySelector('.mtg-art__pending-label')),
      pillText: face.querySelector('.mtg-art__pending-label')?.textContent ?? null,
      note: rect(face.querySelector('.mtg-art__pending-note')),
      window: rect(window_),
      face: rect(face),
    });
  }
  return { viewport: [window.innerWidth, window.innerHeight], tiles };
})()`;

interface Box {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface TileReading {
  readonly cardId: string | null;
  readonly artState: string | null;
  readonly naturalWidth: number;
  readonly text: string | null;
  readonly name: Box;
  readonly pill: Box;
  readonly pillText: string | null;
  readonly note: Box;
  readonly window: Box;
  readonly face: Box;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly tiles: readonly TileReading[];
}

/**
 * Half a pixel, and it is rounding rather than tolerance: every box here is
 * measured off a fractional layout and compared against another box from the
 * same layout. What this file exists to catch is a whole line box on one side
 * and a clipped word on the other, neither of which fits inside it.
 */
const EPS = 0.5;

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

const NAMES: ReadonlyMap<string, string> = new Map(BASIC_LANDS.map((card) => [card.id, card.name]));
const TILES = BASIC_LANDS.length * COPIES;

/**
 * How much of the tile the picture takes now that nothing is laid out under it.
 *
 * Not 1.0: the face carries a 1px identity keyline a side, so the window is two
 * pixels shorter than the tile and always will be. Anything that took a *row*
 * would cost a whole line box, which is an order of magnitude more than this.
 */
const PICTURE_SHARE = 0.95;

describe('a land tile in the mana band', () => {
  browserIt(
    'draws no name, whether or not the set it is played with has art for it',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-land-tile-name-'));
      const pages = {
        covered: join(directory, 'covered.html'),
        bare: join(directory, 'bare.html'),
      } as const;
      await writeFile(pages.covered, pageHtml(COVERED), 'utf8');
      await writeFile(pages.bare, pageHtml(null), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          for (const [state, file] of Object.entries(pages)) {
            const reading = (await measurePage(
              chrome.client,
              file,
              width,
              height,
              MEASURE,
              `the ${state} mana band at ${where}`,
            )) as unknown as Reading;
            const at = `${where} ${state}`;
            expect(reading.viewport, at).toEqual([width, height]);
            expect(reading.tiles.length, `${at}: land tiles measured`).toBe(TILES);

            for (const tile of reading.tiles) {
              const expected = NAMES.get(tile.cardId ?? '');
              if (expected === undefined) {
                throw new Error(`${at}: the band drew an unknown tile ${String(tile.cardId)}`);
              }
              // The covered page has to have actually resolved a picture, or the
              // whole run measures the pending state twice and proves nothing.
              const wanted = state === 'covered' ? 'ready' : 'pending';
              expect(tile.artState, `${at} ${expected}: art state`).toBe(wanted);
              if (state === 'covered') {
                expect(tile.naturalWidth, `${at} ${expected}: the raster did not decode`).toBeGreaterThan(0);
              }

              // The defect and its fix, in one pair of numbers that must be the
              // same pair on both pages. The element stays in the markup and in
              // the accessible name; what it may not have is a box.
              expect(tile.text, `${at}: the name is no longer in the markup at all`).toBe(expected);
              expect(tile.name.height, `${at} ${expected}: the name's drawn height`).toBe(0);
              expect(tile.name.width, `${at} ${expected}: the name's drawn width`).toBe(0);

              // So the picture is the tile, less the keyline round it.
              expect(
                tile.window.height,
                `${at} ${expected}: the picture's share of a ${String(tile.face.height)}px tile`,
              ).toBeGreaterThan(tile.face.height * PICTURE_SHARE);

              // And the one state that has no picture says so, in the frame's
              // own words rather than in the card's. Inside the window, because
              // the window clips: a pill wider than the tile is a pill with its
              // last letters cut off.
              if (state === 'bare') {
                expect(tile.pill.height, `${at} ${expected}: the pending pill's height`).toBeGreaterThan(0);
                expect(tile.pillText, `${at} ${expected}: the pending pill's words`).toBe(ART_PENDING_LABEL);
                expect(
                  tile.pill.left,
                  `${at} ${expected}: the pill is clipped on the left`,
                ).toBeGreaterThanOrEqual(tile.window.left - EPS);
                expect(
                  tile.pill.right,
                  `${at} ${expected}: the pill is ${String(tile.pill.width)}px in a ${String(tile.window.width)}px window`,
                ).toBeLessThanOrEqual(tile.window.right + EPS);
                // Strictly narrower, not merely contained. Left to its full-face
                // typography the chip is wider than this window, so it clamps to
                // exactly the window's width and breaks "ART PENDING" across two
                // stretched lines — inside the box by the measure above, and the
                // wrong drawing. `../src/styles/card.ts` sizes it to its own
                // content instead, and this is what holds that.
                expect(
                  tile.pill.width,
                  `${at} ${expected}: the pill is stretched to the full window`,
                ).toBeLessThan(tile.window.width);
                expect(
                  tile.pill.top,
                  `${at} ${expected}: the pill is clipped at the top`,
                ).toBeGreaterThanOrEqual(tile.window.top - EPS);
                expect(
                  tile.pill.bottom,
                  `${at} ${expected}: the pill is clipped at the bottom`,
                ).toBeLessThanOrEqual(tile.window.bottom + EPS);
                // The card id goes: two labels do not fit in this box, and the
                // pill is the one that says what the state is.
                expect(tile.note.height, `${at} ${expected}: the pending note's height`).toBe(0);
              } else {
                expect(tile.pill.height, `${at} ${expected}: a covered tile drew a pending pill`).toBe(0);
              }
            }
            const first = reading.tiles[0];
            if (first === undefined) throw new Error(`${at}: no tile to report`);
            console.log(
              `${at}: ${String(reading.tiles.length)} tiles, ` +
                `face ${String(first.face.width)}x${String(first.face.height)}, ` +
                `window ${String(first.window.width)}x${String(first.window.height)}, ` +
                `name 0x0, pill ${String(first.pill.width)}x${String(first.pill.height)}`,
            );
          }
        }
      } catch (error) {
        bodyError = error;
      }

      // Cleanup after the catch rather than in a `finally`, which is
      // `./card-loyalty.browser.test.ts`'s arrangement and for its reason: a
      // throw inside a `finally` discards whatever the body was failing on, so
      // the browser is torn down first and every error the run produced is
      // reported together.
      const cleanupErrors: Error[] = [];
      if (chrome !== null) {
        try {
          await shutdownChrome(chrome);
        } catch (error) {
          cleanupErrors.push(new Error(`Chrome shutdown failed: ${reason(error)}`));
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
          `the land tile name gate failed on ${String(cleanupErrors.length)} count(s):\n${cleanupErrors.map((error) => error.message).join('\n')}`,
        );
      }
    },
    30_000,
  );
});
