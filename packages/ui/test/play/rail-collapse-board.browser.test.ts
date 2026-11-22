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
import { createElement as h } from 'react';
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
  return { ...card, id: `${card.id}-position-${String(index)}` };
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
  const faces = (seat) => [...document.querySelectorAll(
    "[data-seat='" + seat + "'] .mtg-board__spells .mtg-slot[data-slot='play'] > .mtg-card"
  )];
  const widths = (seat) => faces(seat).map((face) => { const box = visible(face); return round(Math.max(0, box.right - box.left)); });
  /* The drawn face rather than its visible box, twice over: a face clipped by
     the row's scroller is still drawn at the row's size and is still
     card-shaped, so both the trim and "did the card get smaller" are claims
     about the drawing rather than about how much of it is on screen. */
  const drawn = (seat) => faces(seat).map((face) => round(face.getBoundingClientRect().width));
  const trims = (seat) => faces(seat).map((face) => {
    const rect = face.getBoundingClientRect();
    return rect.height === 0 ? null : Math.round((rect.width / rect.height) * 1000) / 1000;
  });
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
    nearDrawn: drawn('you'),
    nearTrims: trims('you'),
    farTrims: trims('opponent'),
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
  readonly nearDrawn: readonly number[];
  readonly nearTrims: readonly (number | null)[];
  readonly farTrims: readonly (number | null)[];
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

/**
 * The other half of the collapse, and the one `mtg-u9uc`'s two properties do
 * not reach.
 *
 * That bug was an *inversion* — the viewer's face came out under the
 * opponent's — and the assertion above is that inversion plus the near row
 * never getting shorter. Both compare two things measured in the same page.
 * `mtg-t34` is the comparison across the two pages: shutting the panel is sold
 * as buying board, so a face may not come back smaller than the one the open
 * panel drew. It measured a reading that went backwards — 1280x800 with four
 * permanents a side, where the board face fell 82.6px to 77.0 on collapse,
 * because the whole 228px reclaim went to the hand row's height and the row
 * under it paid for it.
 *
 * Those two properties can hold while this one fails, which is why it is a
 * second assertion rather than a stronger form of the first: a collapse that
 * shrinks *both* seats' faces equally keeps near at or above far, and a row
 * that keeps its height while its slot count grows still draws a smaller card.
 *
 * **The drawn face, not its visible box.** The assertion above compares
 * clipped boxes because a face the scroller has taken off screen is not a face
 * the viewer can compare to the opponent's. This one compares
 * `getBoundingClientRect` widths, because "the card got smaller" is a claim
 * about what was drawn and a face scrolled half out of the row is drawn at the
 * row's size. Reading the clipped box here would let a scroll position that
 * moved by a pixel read as a shrunken card. Both are printed, and the pair is
 * the more useful record anyway: at 1024x768 with twelve a side, collapsing
 * takes the row from six faces and a sliver to nine and a sliver at the same
 * 64.4px, which is the reclaim doing the other thing it can do with the width.
 *
 * The viewports are the bead's four plus two more, and the two are why the
 * outcome half of this is measured rather than asserted. Zeroing
 * `--hand-basis-trim` — the pre-`mtg-u9uc` behavior, where the hand is sized
 * from the widened lane — moves no battlefield face by a pixel at any of the
 * bead's four: at 1440x900, 1280x800 and 1024x768 the hand slot is held by a
 * ceiling in both rail states (7.5rem, then the short-table 5.5, then the
 * crowded 5.25), and 810x1080 is under `THREE_COLUMN_MIN_WIDTH_PX`, where the
 * mat is the narrow arrangement and its battlefield is not sized against the
 * hand at all — the hand there goes 48px to 74.2 under the neuter and the
 * board does not move. A rig reading only those four would report the fix
 * holding a property the clamps are holding.
 *
 * 1280x900 and 1366x900 are where the slot sits between its floor and its
 * ceiling, which is the band `./rail-collapse-board`'s first assertion already
 * chose for the same reason. Zeroing the trim there moves the hand 101.1px to
 * 120 and costs the near battlefield row 13.1px and its face 9.0px — so the
 * constant is load-bearing, and worth naming in pixels rather than in prose.
 *
 * **What still cannot go red, and why that is the finding.** Even with the
 * trim zeroed, no face comes back *smaller* than the open panel drew it:
 * 101.1 open against 111.2 shut at 1280x900. The collapse hands the lane 228px
 * and the widest the hand can take of that is about 33, so the second
 * assertion below is now structurally unfailable from `styles/board/hand.ts`
 * alone. It was failable when `mtg-t34` was written — 1280x800 with four a
 * side read 82.6 open against 77.0 shut — and the geometry moved out from
 * under it: the spells row became a size container (`6141773`), so a
 * battlefield face is the largest card that fits its row rather than what is
 * left of the column's height after the hand has taken its share.
 *
 * So the first assertion is the one that bites and the second is the bead's
 * own words held to. They are both kept: the first is about the mechanism and
 * would go red the moment the hand starts taking the reclaim again, the second
 * is about the outcome and is what anybody actually cares about, and a
 * mechanism assertion alone is how a guard ends up defending a constant
 * instead of a card.
 */
const FACE_DENSITIES = [4, 8, 12] as const;
const FACE_LANDS = 5;
const FACE_VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [810, 1080],
  [1280, 900],
  [1366, 900],
] as const;

/** The printed trim, `CARD_TRIM_MM.width / CARD_TRIM_MM.height`, and its slack. */
const PRINTED_TRIM = 63 / 88;
const TRIM_SLACK = 0.01;

/**
 * One browser, one temp directory, and the cleanup written once.
 *
 * Both assertions below need the same four steps in the same order — make a
 * directory, start Chrome, do the work, put both back whichever way the work
 * ended — and the failure mode of writing that twice is not a longer file: it
 * is one copy that reports the body's error and swallows the cleanup's, or the
 * reverse. `AggregateError` with the body first is what keeps a Chrome that
 * would not shut down from hiding the assertion that failed.
 */
async function withChrome(
  body: (chrome: Awaited<ReturnType<typeof launchChrome>>, directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mtg-rail-collapse-'));
  let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
  let bodyError: unknown;
  try {
    chrome = await launchChrome(join(directory, 'chrome'));
    await body(chrome, directory);
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
}

/** Both rail states of one board, at one viewport, measured through one page each. */
async function readBoth(
  chrome: Awaited<ReturnType<typeof launchChrome>>,
  files: Record<'open' | 'shut', string>,
  width: number,
  height: number,
): Promise<Record<'open' | 'shut', Reading>> {
  return {
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
}

/** The two pages one board is measured through, written once per board. */
async function pagesFor(
  directory: string,
  game: GameSession,
  tag: string,
): Promise<Record<'open' | 'shut', string>> {
  const files: Record<'open' | 'shut', string> = { open: '', shut: '' };
  for (const rail of ['open', 'shut'] as const) {
    const file = join(directory, `board-${tag}-${rail}.html`);
    await writeFile(file, page(game, rail), 'utf8');
    files[rail] = file;
  }
  return files;
}

describe('collapsing the side panel spends the reclaim on the battlefield', () => {
  browserIt(
    'never draws the viewer a smaller face than the opponent, and never shortens the near row',
    async () => {
      await withChrome(async (chrome, directory) => {
        for (const board of BOARDS) {
          const game = session(board.spells, board.lands);
          const files = await pagesFor(directory, game, String(board.spells));
          for (const [width, height] of VIEWPORTS) {
            const readings = await readBoth(chrome, files, width, height);
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
      });
    },
    180_000,
  );

  browserIt(
    'gives the hand slot none of the reclaim, and never draws a face smaller than the open panel drew',
    async () => {
      await withChrome(async (chrome, directory) => {
        for (const spells of FACE_DENSITIES) {
          const game = session(spells, FACE_LANDS);
          const files = await pagesFor(directory, game, `face-${String(spells)}`);
          for (const [width, height] of FACE_VIEWPORTS) {
            const readings = await readBoth(chrome, files, width, height);
            const where = `${String(spells)} permanents, ${String(width)}x${String(height)}`;
            console.log(
              `${where}: drawn open ${String(readings.open.nearDrawn[0])} shut ${String(readings.shut.nearDrawn[0])}, ` +
                `visible open ${JSON.stringify(readings.open.near)} shut ${JSON.stringify(readings.shut.near)}, ` +
                `hand open ${String(readings.open.handWidth)} shut ${String(readings.shut.handWidth)}, ` +
                `trims ${JSON.stringify(readings.shut.nearTrims)}`,
            );
            // Index by index rather than min against min: the row is ordered
            // and a collapse that shrank one face while growing another would
            // pass a comparison of the two extremes.
            expect(
              readings.shut.nearDrawn.length,
              `${where}: the two states drew a different number of faces`,
            ).toBe(readings.open.nearDrawn.length);
            for (const [index, open] of readings.open.nearDrawn.entries()) {
              expect(
                readings.shut.nearDrawn[index] ?? 0,
                `${where}: face ${String(index)} shrank on collapse, ${String(open)} to ${String(readings.shut.nearDrawn[index])}`,
              ).toBeGreaterThanOrEqual(open - SLACK_PX);
            }
            for (const rail of ['open', 'shut'] as const) {
              for (const [index, trim] of readings[rail].nearTrims.entries()) {
                expect(trim, `${where}, rail ${rail}: face ${String(index)} was not drawn`).not.toBeNull();
                expect(
                  Math.abs((trim ?? 0) - PRINTED_TRIM),
                  `${where}, rail ${rail}: face ${String(index)} reads ${String(trim)} against the printed ${PRINTED_TRIM.toFixed(3)}`,
                ).toBeLessThanOrEqual(TRIM_SLACK);
              }
            }
            // Equal, not merely no smaller. `--hand-basis-trim` sizes the hand
            // from the lane as the open state would have measured it, so the
            // two readings are the same number by construction and either
            // direction of drift is the fix coming undone: smaller is a hand
            // paying for the board, larger is the board paying for the hand,
            // which is the bead.
            expect(
              Math.abs((readings.shut.handWidth ?? 0) - (readings.open.handWidth ?? 0)),
              `${where}: the collapse moved the hand slot, ${String(readings.open.handWidth)} to ${String(readings.shut.handWidth)}`,
            ).toBeLessThanOrEqual(SLACK_PX);
          }
        }
      });
    },
    300_000,
  );
});
