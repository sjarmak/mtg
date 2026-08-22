// @vitest-environment node
/**
 * A board face draws the whole of the type line it decided to draw.
 *
 * `mtg-mq81`. The played face had two rules about one bar and they disagreed:
 * `BOARD_TYPE_LINE_MIN_REM` in `src/styles/card.ts` said an 80px content box was
 * room enough for a type line, and the bar it then drew cut the line inside it
 * with `text-overflow: ellipsis`. Measured here before the fix, over the
 * `@mtg/dsl` example set: 8 of 40 type lines cut at four permanents a side and
 * 1280x800, worst 42px of the 109px `Creature — Goblin Warrior` wants; 22 of 64
 * and 32 of 88 at ten and sixteen a side at 1440x900, worst 33px. The wider
 * viewport did not resolve it, because the bar's font grows with the face and
 * the capacity in characters barely moves between a 104px face and a 144px one.
 *
 * **The measurement the page-overlap rig deliberately does not make.** That file
 * excludes an element's own clip, because the command rail ellipsizes on purpose
 * and a gate that failed on it would be measuring a decision. This one is about
 * one element and asks the question that file cannot: `scrollWidth` against
 * `clientWidth` on the type line itself, which is the inline axis and is a cut
 * whatever the block axis is doing. Both are needed and neither subsumes the
 * other.
 *
 * What is asserted, at every built position and both viewports: the viewport
 * read back is the one requested, the number of drawn type lines clears a floor
 * so a zero cannot come from a selector that found nothing, and no drawn type
 * line is cut in the inline axis. What is also asserted, over the run, is that
 * the ladder in `src/card/type-line.ts` is working rather than hiding
 * everything: some faces draw their subtypes and some have dropped them, so a
 * green run cannot be a run with nothing in its type bars.
 *
 * The example set rather than the flagship, because `@mtg/ui` is a public
 * package and its tests may not name a private card.
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

const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
  exampleCard('slc-ironclad-golem'),
  exampleCard('slc-graveblade-stalker'),
] as const;
const LANDS = [
  exampleCard('slc-plains'),
  exampleCard('slc-island'),
  exampleCard('slc-swamp'),
  exampleCard('slc-mountain'),
] as const;

function sessionOn(state: GameState, events: GameSession['events']): GameSession {
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events,
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

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
    seed: `ui/type-line-${String(perSide)}`,
    battlefield,
    hands: [
      [SPELLS[0], SPELLS[1], SPELLS[2], LANDS[0], SPELLS[3], LANDS[1], SPELLS[4]],
      [SPELLS[1], SPELLS[2], LANDS[2], SPELLS[3], LANDS[3], SPELLS[0], SPELLS[5]],
    ],
    active: 0,
    turn: 7,
  });
  return sessionOn(built.state, built.events);
}

function page(game: GameSession, title: string): string {
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * A pixel of slack, and it is rounding rather than tolerance: a fractional
 * layout width rounds into `clientWidth` and `scrollWidth` separately, so an
 * uncut line can read back a pixel short on a face whose width is not a whole
 * number. Every cut this file was written for is 13px or more.
 */
const EPS = 1;

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const drawn = [];
  let subtypesDrawn = 0;
  let subtypesDropped = 0;
  let barsHidden = 0;
  for (const element of document.querySelectorAll('.mtg-card__type')) {
    const face = element.closest('.mtg-card');
    if (face === null || face.getAttribute('data-size') !== 'board') continue;
    if (element.clientWidth === 0) { barsHidden += 1; continue; }
    const sub = element.querySelector('.mtg-card__type-sub');
    if (sub !== null) {
      if (sub.getClientRects().length > 0) subtypesDrawn += 1;
      else subtypesDropped += 1;
    }
    drawn.push({
      text: element.textContent,
      chars: element.textContent.length,
      client: round(element.clientWidth),
      scroll: round(element.scrollWidth),
      cut: round(element.scrollWidth - element.clientWidth),
      font: round(parseFloat(getComputedStyle(element).fontSize)),
      face: round(face.getBoundingClientRect().width),
    });
  }
  const cut = drawn.filter((entry) => entry.cut > ${String(EPS)});
  cut.sort((a, b) => b.cut - a.cut);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    drawn: drawn.length,
    barsHidden: barsHidden,
    subtypesDrawn: subtypesDrawn,
    subtypesDropped: subtypesDropped,
    cutCount: cut.length,
    worstCut: cut.slice(0, 5),
    faces: document.querySelectorAll(".mtg-slot[data-slot='play'] > .mtg-card").length,
  };
})()`;

interface Entry {
  readonly text: string;
  readonly chars: number;
  readonly client: number;
  readonly scroll: number;
  readonly cut: number;
  readonly font: number;
  readonly face: number;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly drawn: number;
  readonly barsHidden: number;
  readonly subtypesDrawn: number;
  readonly subtypesDropped: number;
  readonly cutCount: number;
  readonly worstCut: readonly Entry[];
  readonly faces: number;
}

const VIEWPORTS = [
  [1280, 800],
  [1440, 900],
] as const;

/**
 * The floor under the population over the whole run, so a green run is a run
 * that measured something. It is a run total rather than a per-position one
 * because a position can legitimately draw no type bar at all: at ten a side and
 * 1280x800 the face's content box is 68px, under `BOARD_TYPE_LINE_MIN_REM`, and
 * every bar on the table is correctly not drawn.
 */
const MIN_DRAWN = 40;

describe('the board type line', () => {
  browserIt(
    'draws no type line it then cuts, at every built position',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-type-line-'));
      const positions: { readonly label: string; readonly file: string }[] = [];
      const write = async (label: string, html: string): Promise<void> => {
        const file = join(directory, `${label}.html`);
        await writeFile(file, html, 'utf8');
        positions.push({ label, file });
      };
      await write('board-4', page(board(4), 'Four a side'));
      await write('board-10', page(board(10), 'Ten a side'));
      await write('board-16', page(board(16), 'Sixteen a side'));

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      let drawnTotal = 0;
      let subtypesDrawn = 0;
      let subtypesDropped = 0;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const position of positions) {
          for (const [width, height] of VIEWPORTS) {
            const where = `${position.label} at ${String(width)}x${String(height)}`;
            const result = (await measurePage(
              chrome.client,
              position.file,
              width,
              height,
              MEASURE,
              position.label,
            )) as unknown as Reading;
            expect(result.viewport, where).toEqual([width, height]);
            // A board face either draws a type bar or has decided not to, and
            // both are a measurement; a position with neither is a position the
            // selector missed.
            expect(result.drawn + result.barsHidden, `${where}: board type bars found`).toBeGreaterThan(0);
            expect(
              result.cutCount,
              `${where}: type lines cut in the inline axis: ${JSON.stringify(result.worstCut)}`,
            ).toBe(0);
            console.log(
              `${where}: drawn ${String(result.drawn)}, hidden ${String(result.barsHidden)}, subtypes drawn ${String(result.subtypesDrawn)} dropped ${String(result.subtypesDropped)}, cut ${String(result.cutCount)}`,
            );
            drawnTotal += result.drawn;
            subtypesDrawn += result.subtypesDrawn;
            subtypesDropped += result.subtypesDropped;
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
        throw new AggregateError(cleanupErrors, `the board type line was not measured`);
      }

      // Both ends of the ladder, over the run rather than per position: a bar
      // that always dropped its subtypes would pass the cut assertion by drawing
      // almost nothing, and a bar that never dropped them would mean these
      // positions never reach the width the defect lived at.
      expect(drawnTotal, 'no type line was drawn anywhere in the run').toBeGreaterThanOrEqual(MIN_DRAWN);
      expect(subtypesDrawn, 'no board face drew its subtypes anywhere in the run').toBeGreaterThan(0);
      expect(subtypesDropped, 'no board face dropped its subtypes anywhere in the run').toBeGreaterThan(0);
    },
    120_000,
  );
});
