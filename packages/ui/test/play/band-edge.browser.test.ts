// @vitest-environment node
/**
 * The mana band gives its tiles room on the inline axis.
 *
 * `mtg-7i50`, third of the family after `mtg-3oy` (the hand) and `mtg-e3n` (the
 * battlefield row). `styles/board/lands.ts` makes `.mtg-lands` a scroll
 * container with `padding-block: 2px` and nothing inline, and a scroll container
 * clips at its padding box, so the first tile sat flush against the clip edge
 * and every mark a tile paints outside its border box was cut there: an
 * interactive tile wears `styles/board/slot.ts`'s castable ring (2px of amber
 * over 3px of seam, plus a 14px halo) exactly as a card does, and a tapped tile
 * carries its own hover scale on top.
 *
 * Smaller than the row's loss and still a loss: a tile has no rules box and no
 * name bar, so what a cut edge costs is recognition rather than reading.
 *
 * **Measured rather than asserted from the constant**, which is the whole reason
 * this is a browser test and not a cascade test in jsdom: `--mtg-space-1` is a
 * custom property, jsdom substitutes none and lays nothing out, so a rule that
 * wins the cascade there can still be worth zero pixels on screen. The reading
 * is the first tile's left edge against the band's own padding-box left edge,
 * which is where a scroller clips, at four viewports and on both seats.
 *
 * **And the price, which had to be nothing.** The tile is a stated
 * `LAND_TILE_HEIGHT_REM` rather than a share of its row, so unlike `mtg-e3n`
 * there is no face-size cost to trade against; what could still move is how many
 * tiles fit before the band scrolls, so that is read at the same time and held.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCards, setBasics } from '@mtg/dsl';
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

function named(name: string): DslCard {
  const card = cards.find((candidate) => candidate.name === name);
  if (card === undefined) throw new Error(`the fixture set is missing ${name}`);
  return card;
}

function basicNamed(name: string): DslCard {
  const card = basics.find((candidate) => candidate.name === name);
  if (card === undefined) throw new Error(`the fixture set did not mint ${name}`);
  return card;
}

const HARROWER = named('Harrower of the Deep Shelf');
const LANDS = ['Plains', 'Island', 'Swamp', 'Mountain'].map(basicNamed);

/** Four lands and a creature a side, so both bands are drawn and neither scrolls. */
function board(): GameSession {
  const built = scenario({
    seed: 'ui/band-edge',
    battlefield: [0, 1].flatMap((controller) => [
      { card: HARROWER, controller: controller as PlayerId, summoningSick: false },
      ...LANDS.map((card) => ({ card, controller: controller as PlayerId, summoningSick: false })),
    ]),
    active: 0,
    turn: 6,
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
      title: 'Tideglass Reach',
      children: h(
        'div',
        { className: 'mtg-play-route' },
        h(PlayView, {
          session: game,
          viewer: 1,
          names: ['Bot', 'You'],
          onChoose: () => undefined,
          autoPass: DEFAULT_AUTO_PASS,
          onAutoPass: () => undefined,
          onYield: () => undefined,
        }),
      ),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Band edge</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Per seat: the first tile's clearance inside the band's padding box, and how
 * many tiles the band holds before it scrolls.
 *
 * The clip edge of a scroller is its padding box, so the reading subtracts the
 * band's own border and padding from its client rect rather than using the rect
 * itself, which is what makes the number the thing a viewer loses.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const seats = ['you', 'opponent'].map((seat) => {
    const band = document.querySelector("[data-seat='" + seat + "'] .mtg-lands");
    if (band === null) return { seat, tiles: 0, startClearance: -1, fits: 0 };
    const tiles = [...band.querySelectorAll(".mtg-slot[data-slot='play']")];
    const style = getComputedStyle(band);
    const box = band.getBoundingClientRect();
    const clipLeft = box.left + parseFloat(style.borderLeftWidth);
    const first = tiles[0];
    const gap = parseFloat(style.columnGap) || 0;
    const tileWidth = first === undefined ? 0 : first.getBoundingClientRect().width;
    return {
      seat,
      tiles: tiles.length,
      startClearance: first === undefined ? -1 : round(first.getBoundingClientRect().left - clipLeft),
      padStart: round(parseFloat(style.paddingLeft)),
      tileWidth: round(tileWidth),
      fits: tileWidth === 0 ? 0 : Math.floor((band.clientWidth + gap) / (tileWidth + gap)),
    };
  });
  return { viewport: [window.innerWidth, window.innerHeight], seats };
})()`;

interface Seat {
  readonly seat: string;
  readonly tiles: number;
  readonly startClearance: number;
  readonly padStart: number;
  readonly tileWidth: number;
  readonly fits: number;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly seats: readonly Seat[];
}

/**
 * How many tiles the band held before it scrolled, read before the fix and
 * unchanged by it. The negative margin pays for the padding out of the row's
 * own gutter, so nothing the viewer counts moves; if one of these numbers
 * drops, the band bought its clearance with a tile.
 */
const CAPACITY: Readonly<Record<number, number>> = { 810: 3, 1024: 5, 1280: 8, 1440: 10 };

const VIEWPORTS = [
  [810, 1080],
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

describe('the mana band does not clip its first tile', () => {
  browserIt(
    'reserves inline padding on .mtg-lands, paid for by a negative margin, at both seats',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-band-edge-'));
      const file = join(directory, 'band.html');
      await writeFile(file, page(board()), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const result = (await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            'band-edge',
          )) as unknown as Reading;
          console.log(`${String(width)}x${String(height)}: ${JSON.stringify(result.seats)}`);
          for (const seat of result.seats) {
            const at = `${String(width)}x${String(height)} ${seat.seat}`;

            // The mark a tile paints outside its border box is 2px of ring over
            // 3px of seam, so anything under 4px is still cutting some of it.
            expect(seat.tiles, `${at}: no mana tiles measured`).toBe(4);
            // The mark a tile paints outside its border box is 2px of ring over
            // 3px of seam, so anything under 4px is still cutting some of it.
            expect(
              seat.startClearance,
              `${at}: first tile flush against the clip edge`,
            ).toBeGreaterThanOrEqual(4);
            expect(seat.fits, `${at}: the band's tile capacity moved`).toBe(CAPACITY[width]);
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
          `band edge Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});
