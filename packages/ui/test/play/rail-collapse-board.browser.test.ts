// @vitest-environment node
/**
 * Collapsing the side panel gives the reclaimed width to the battlefield, not
 * to the hand.
 *
 * `mtg-u9uc`. The collapse is sold as regaining gameboard space
 * (`routes/play/rail-collapse.ts` quotes the ask). What it hands back is
 * `PLAY_RAIL_REM` minus the strip, 228 CSS px of lane width at every viewport,
 * and both zones on the lane were sized from that same width: `styles/board/
 * hand.ts` states a hand slot as a seventh of the hand row and the hand row is
 * as tall as one hand card, so the row grew on collapse and the growth came off
 * the battlefield row underneath it. Measured over `../../tools/board-budget.ts`
 * against the flagship set with the real route furniture above the mat, the
 * viewer's own board face came out *smaller* than the opponent's, which is the
 * one thing the table may never draw.
 *
 * The fix is a hand slot whose basis is the lane as the panel-open state would
 * have measured it (`--hand-basis-trim` in `styles/board/hand.ts`), so the
 * reclaim reaches the battlefield alone. A constant cap on the hand slot was
 * measured and rejected first (`mtg-ihss`): the widest open-panel slot is wider
 * than the narrowest shut-panel one, so no constant binds on the second without
 * shrinking a hand nobody complained about.
 *
 * **Properties, never literals.** The assertion is the inversion — the viewer's
 * face is at least the opponent's — and that shutting the panel never shortens
 * the near battlefield row. No pixel count is asserted, because every constant
 * this geometry is built from is free to move as long as those two hold.
 *
 * **Measurement, not a rect.** `getBoundingClientRect` ignores
 * `overflow: hidden`, so a face's visible box is its rect intersected with the
 * padding box of every clipping ancestor and then with the viewport, the same
 * way `./spells-row-floor.browser.test.ts` reads one.
 *
 * **The real route's furniture is above the mat**, for the reason that file
 * records: a bare `PlayView` render has the whole viewport rather than the
 * leftover of one, and this family of bugs does not reproduce in it.
 *
 * The rail's shut state is written onto the markup rather than clicked, which is
 * what `../../tools/board-budget.ts` does and why: the open state is a
 * `localStorage` preference read at render time, this page is static markup, and
 * what the sheet acts on is `data-rail` on the mat.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, Fragment } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isLand, parseCards, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, PlayerId } from '@mtg/kernel';
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
/** Three of them, so a row holds names of different lengths rather than one name. */
const creatures = cards.filter((card) => card.kind === 'creature').slice(0, 3);

function creature(index: number): DslCard {
  const card = creatures[index % creatures.length];
  if (card === undefined) throw new Error('the fixture set has no creature to fill a battlefield with');
  return card;
}

function land(index: number): DslCard {
  const card = basics[index % basics.length];
  if (card === undefined) throw new Error('the fixture set minted no basics to build a mana base from');
  return card;
}

interface Placed {
  readonly card: DslCard;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly summoningSick: boolean;
}

/** The measured median board of a combat turn, and its p75 shoulder. */
const BOARDS: readonly { readonly spells: number; readonly lands: number }[] = [
  { spells: 4, lands: 5 },
  { spells: 6, lands: 7 },
];

function side(controller: PlayerId, spells: number, lands: number): readonly Placed[] {
  return [
    ...Array.from({ length: spells }, (_unused, index) => ({
      card: creature(index),
      controller,
      tapped: false,
      summoningSick: false,
    })),
    ...Array.from({ length: lands }, (_unused, index) => ({
      card: land(index),
      controller,
      tapped: index % 2 === 1,
      summoningSick: false,
    })),
  ];
}

function session(spells: number, lands: number): GameSession {
  const hand = cards.filter((card) => !isLand(card)).slice(0, 2);
  const built = scenario({
    seed: `ui/rail-collapse-board/${String(spells)}/${String(lands)}`,
    battlefield: [...side(0, spells, lands), ...side(1, spells, lands)],
    hands: [hand, hand],
    step: 'precombatMain',
    active: 0,
    turn: 6,
  });
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: built.state,
    events: built.events,
    result: null,
    pending: pendingDecision(built.state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * The page furniture the real route draws above the mat: the page title, the
 * precon/sealed switch and the turn badge, as `./spells-row-floor.browser.test.ts`
 * reproduces them and for the reason it records.
 */
function routeFurniture(): ReactElement {
  return h(
    Fragment,
    null,
    h('h1', { className: 'mtg-page-title' }, 'Play'),
    h(
      'div',
      { className: 'mtg-toolbar', role: 'group', 'aria-label': 'How to play' },
      h(
        'button',
        { type: 'button', className: 'mtg-btn', 'aria-pressed': true, 'data-variant': 'primary' },
        'Preconstructed decks',
      ),
      h('button', { type: 'button', className: 'mtg-btn', 'aria-pressed': false }, 'Open a sealed pool'),
    ),
    h('span', { className: 'mtg-badge' }, 'Turn 6: You'),
  );
}

function page(game: GameSession, rail: 'open' | 'shut'): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      title: 'Tideglass Reach',
      children: h(
        'div',
        { className: 'mtg-play-route' },
        routeFurniture(),
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rail ${rail}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${staged}</body></html>`;
}

/** Visible face widths a seat at a time, plus the near battlefield row's height. */
const MEASURE = `(() => {
  const view = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight };
  const clipsOn = (style, axis) => (axis === 'x' ? style.overflowX : style.overflowY) !== 'visible';
  const round = (value) => Math.round(value * 10) / 10;
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clipBox = node.getBoundingClientRect();
      for (const axis of ['x', 'y']) {
        if (!clipsOn(style, axis)) continue;
        const low = axis === 'x' ? 'left' : 'top';
        const high = axis === 'x' ? 'right' : 'bottom';
        box[low] = Math.max(box[low], clipBox[low]);
        box[high] = Math.min(box[high], clipBox[high]);
      }
    }
    box.left = Math.max(box.left, view.left);
    box.top = Math.max(box.top, view.top);
    box.right = Math.min(box.right, view.right);
    box.bottom = Math.min(box.bottom, view.bottom);
    return box;
  };
  const widths = (seat) => [...document.querySelectorAll(
    "[data-seat='" + seat + "'] .mtg-board__spells .mtg-slot[data-slot='play'] > .mtg-card"
  )].map((face) => { const box = visible(face); return round(Math.max(0, box.right - box.left)); });
  const rowHeight = (seat) => {
    const row = document.querySelector("[data-seat='" + seat + "'] .mtg-board__spells");
    if (row === null) return null;
    const box = visible(row);
    return round(Math.max(0, box.bottom - box.top));
  };
  const handSlot = document.querySelector(".mtg-slot[data-slot='hand']:not([data-empty='true'])");
  const near = widths('you');
  const far = widths('opponent');
  const mat = document.querySelector('.mtg-board');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    aboveMat: mat === null ? null : round(mat.getBoundingClientRect().top),
    near,
    far,
    nearMin: near.length === 0 ? null : Math.min(...near),
    farMax: far.length === 0 ? null : Math.max(...far),
    nearRowHeight: rowHeight('you'),
    handWidth: handSlot === null ? null : round(handSlot.getBoundingClientRect().width)
  };
})()`;

interface Reading {
  readonly viewport: readonly number[];
  readonly aboveMat: number | null;
  readonly near: readonly number[];
  readonly far: readonly number[];
  readonly nearMin: number | null;
  readonly farMax: number | null;
  readonly nearRowHeight: number | null;
  readonly handWidth: number | null;
}

/**
 * Four windows, and the middle two are the ones that caught this.
 *
 * The bead's own readings are at 1280x800 and 1440x900, where the hand slot is
 * held by a ceiling in both panel states — the short-table cap at the first and
 * the plain one at the second — so the collapse could never reach the hand there
 * and neither viewport can fail this. 1280x900 and 1366x900 are where the slot
 * is between its floor and its ceiling, which is the band the bug lives in:
 * measured before the fix at 1366x900 with four permanents a side, shutting the
 * panel took the hand slot from 114px to 120 and the near battlefield row from
 * 174.7px to 170.5. A rig that only read the bead's two would have reported this
 * fixed before anything was changed.
 */
const VIEWPORTS = [
  [1280, 800],
  [1280, 900],
  [1366, 900],
  [1440, 900],
] as const;

/** Rounding slack, the same half pixel `../../tools/board-budget.ts` compares on. */
const SLACK_PX = 0.5;

describe('collapsing the side panel spends the reclaim on the battlefield', () => {
  browserIt(
    'never draws the viewer a smaller face than the opponent, and never shortens the near row',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-rail-collapse-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const board of BOARDS) {
          const game = session(board.spells, board.lands);
          const files: Record<'open' | 'shut', string> = { open: '', shut: '' };
          for (const rail of ['open', 'shut'] as const) {
            const file = join(directory, `board-${String(board.spells)}-${rail}.html`);
            await writeFile(file, page(game, rail), 'utf8');
            files[rail] = file;
          }
          for (const [width, height] of VIEWPORTS) {
            const readings: Record<'open' | 'shut', Reading> = {
              open: (await measurePage(
                chrome.client,
                files.open,
                width,
                height,
                MEASURE,
                'rail-open',
              )) as unknown as Reading,
              shut: (await measurePage(
                chrome.client,
                files.shut,
                width,
                height,
                MEASURE,
                'rail-shut',
              )) as unknown as Reading,
            };
            for (const rail of ['open', 'shut'] as const) {
              const reading = readings[rail];
              const where = `${String(board.spells)} permanents, rail ${rail}, ${String(width)}x${String(height)}`;
              console.log(
                `${where}: near ${JSON.stringify(reading.near)}, far ${JSON.stringify(reading.far)}, row ${String(reading.nearRowHeight)}, aboveMat ${String(reading.aboveMat)}, hand ${String(reading.handWidth)}`,
              );
              expect(reading.near.length, `${where}: no near-seat faces measured`).toBe(board.spells);
              expect(reading.far.length, `${where}: no far-seat faces measured`).toBe(board.spells);
              expect(
                reading.nearMin ?? 0,
                `${where}: the viewer's own face is narrower than the opponent's`,
              ).toBeGreaterThanOrEqual((reading.farMax ?? 0) - SLACK_PX);
            }
            const where = `${String(board.spells)} permanents, ${String(width)}x${String(height)}`;
            expect(
              readings.shut.nearRowHeight ?? 0,
              `${where}: shutting the panel shortened the near battlefield row`,
            ).toBeGreaterThanOrEqual((readings.open.nearRowHeight ?? 0) - SLACK_PX);
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
          `rail collapse Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    180_000,
  );
});
