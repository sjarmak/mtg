// @vitest-environment node
/**
 * A hand of more than seven shares its row before it scrolls, measured in real
 * Chrome.
 *
 * Found on the live lab at 1440x900, on the draw: the seat pod said `Hand 8`, the
 * rail offered two `Play Plains`, and the hand row drew one Plains. All eight
 * slots were in the page; the eighth, the card just drawn, began at x=1138 in a
 * row that ended at 1134 (1056px of cards in 924px), and the only sign of it was
 * a 10px scrollbar under 180px of empty lane. A hand slot was a seventh of the
 * row whatever the hand held, so the newest card was always the one out of
 * sight. `styles/board/hand.ts`'s `HAND_FIT_CSS` divides the row by the cards
 * held instead, still floored at the complete face and capped at the hand's
 * ceiling, so where `n` faces cannot clear the floor the row scrolls as before.
 *
 * Eight held cards, chrome-headless-shell, held face width and cards in view,
 * before and after:
 *
 *     1024x768   4 a side    88px, 5 of 8   ->  88px, 5 of 8
 *     1024x768  12 a side    88px, 5 of 8   ->  88px, 5 of 8
 *     1280x800   4 a side    88px, 8 of 8   ->  88px, 8 of 8
 *     1280x800  12 a side    88px, 8 of 8   ->  88px, 8 of 8
 *     1440x900   4 a side    124px, 7 of 8  ->  107.5px, 8 of 8
 *     1440x900  12 a side    124px, 7 of 8  ->  107.5px, 8 of 8
 *
 * 1024x768 and 1280x800 do not move: both are short tables whose hand ceiling is
 * already 88px, so eight fit at 1280, and at 1024 a seven-card hand already
 * overruns the row and eight scroll as before. Without the change this file
 * fails at 1440x900 with 7 of 8 in view.
 *
 * A seven-card hand is untouched: the seventh is the parity rule's, and
 * `./hand-allocation.browser.test.ts` and `./hand-scale.test.ts` hold it.
 *
 * The neutral `@mtg/dsl` example set rather than the flagship fixture, so the
 * file exports publicly (`AGENTS.md`), and no art, so the verdict is about the
 * repository rather than about what `out/art/` holds on this machine.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { FACE_COMPLETE_REM } from '../../src/styles/board/hand';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [exampleCard('slc-plains'), exampleCard('slc-island')] as const;

function hand(size: number): readonly (typeof SPELLS)[number][] {
  return Array.from({ length: size }, (_unused, index) =>
    index % 3 === 2
      ? (LANDS[index % LANDS.length] ?? LANDS[0])
      : (SPELLS[index % SPELLS.length] ?? SPELLS[0]),
  );
}

function board(perSide: number, held: number): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) =>
    Array.from({ length: perSide }, (_unused, index) => ({
      card:
        index % 2 === 0
          ? (SPELLS[index % SPELLS.length] ?? SPELLS[0])
          : (LANDS[index % LANDS.length] ?? LANDS[0]),
      controller,
      tapped: index % 3 === 0,
      summoningSick: false,
    })),
  );
  const built = scenario({
    seed: `ui/hand-fits-${String(perSide)}-${String(held)}`,
    battlefield,
    hands: [hand(held), hand(7)],
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hand fits</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/** Boxes off a laid-out page; jsdom performs no layout, which is why this is a rig. */
const MEASURE = `(() => {
  const round = (v) => Math.round(v * 10) / 10;
  const row = document.querySelector(".mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] > .mtg-zone__body");
  const r = row.getBoundingClientRect();
  const faces = [...row.querySelectorAll(":scope > .mtg-slot[data-slot='hand']:not([data-empty='true']) > .mtg-card")];
  return {
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    widths: faces.map((f) => round(f.getBoundingClientRect().width)),
    inView: faces.filter((f) => { const b = f.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1; }).length,
    scrollX: round(row.scrollWidth - row.clientWidth),
  };
})()`;

interface Reading {
  readonly root: number;
  readonly widths: readonly number[];
  readonly inView: number;
  readonly scrollX: number;
}

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

const CROWDINGS = [4, 12] as const;

describe('a hand of more than seven shares its row before it scrolls', () => {
  browserIt(
    'shrinks an eight-card hand toward the complete face rather than hiding the card just drawn',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-hand-fits-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const perSide of CROWDINGS) {
          const seven = join(directory, `seven-${String(perSide)}.html`);
          const eight = join(directory, `eight-${String(perSide)}.html`);
          await writeFile(seven, page(board(perSide, 7)), 'utf8');
          await writeFile(eight, page(board(perSide, 8)), 'utf8');
          for (const [width, height] of VIEWPORTS) {
            const where = `${String(width)}x${String(height)}, ${String(perSide)} a side`;
            const before = (await measurePage(
              chrome.client,
              seven,
              width,
              height,
              MEASURE,
              'seven held',
            )) as unknown as Reading;
            const after = (await measurePage(
              chrome.client,
              eight,
              width,
              height,
              MEASURE,
              'eight held',
            )) as unknown as Reading;
            expect(after.widths, `${where}: held faces`).toHaveLength(8);
            const sevenFace = before.widths[0] ?? 0;
            const floorPx = FACE_COMPLETE_REM * after.root;
            for (const face of after.widths) {
              // Never wider than a seventh would draw it: an eighth card only takes room.
              expect(face, `${where}: an eight-card face against a seven-card one`).toBeLessThanOrEqual(
                sevenFace + 0.5,
              );
              // And never under the complete face where a seventh already cleared it.
              expect(
                face,
                `${where}: an eight-card face against the complete-face floor`,
              ).toBeGreaterThanOrEqual(Math.min(sevenFace, floorPx) - 0.5);
            }
            if (after.inView < 8) {
              expect(
                after.scrollX,
                `${where}: held cards out of view in a row that does not scroll`,
              ).toBeGreaterThan(0);
            }
            if (width === 1440) {
              expect(after.inView, `${where}: eight held cards in view`).toBe(8);
            }
          }
        }
      } catch (error: unknown) {
        bodyError = error;
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
      if (bodyError !== undefined) throw bodyError;
    },
    120_000,
  );
});
