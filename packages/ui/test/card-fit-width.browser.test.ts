/**
 * The rules box fits the same way at every face width.
 *
 * `mtg-dcxg.13`. The Cards route hands a phone gallery the full column width,
 * so `--card-w` is whatever the viewport gave it rather than the 15.25rem the
 * fit ladder was calibrated at. Everything else on the face is a share of that
 * width — the frame band, the art window, the loyalty shield — so a wider face
 * is a proportionally taller rules box; the rules text was the one thing set
 * off a fixed token, so it stayed 13px inside a box that grew. Measured on
 * 2026-08-24 before the fix: 191.2px of box holding 41.7px of text at a 366px
 * face, which is 149.5px of slack under three lines of type.
 *
 * What is asserted is the invariant rather than a number: the share of the box
 * a card's text takes does not fall as the face widens. That is what makes the
 * ladder's px calibration (`@mtg/card-geometry`'s `RULES_BOX_BUDGET_PX`, read
 * at the reference width) still true at a width nobody calibrated, and it is
 * the same rule the printed face has always obeyed — `@mtg/card-render` sets
 * its type in user units, so a printed card scales whole.
 *
 * The clip assertion travels with it. Proportional type at a wider face is only
 * safe if the box grows at least as fast, and it does: both are the same
 * multiple of `--card-w`.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import type { Card as DslCard } from '@mtg/dsl';
import { parseCards } from '@mtg/dsl';
import { FULL_FACE_WIDTH_REM } from '@mtg/card-geometry';
import { Shell } from '../src/app/Shell';
import { CardsRoute } from '../src/routes/CardsRoute';
import { uiStyleSheet } from '../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from './support/chrome';

const FLAGSHIP = new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url);

function flagship(): readonly DslCard[] {
  const document: unknown = JSON.parse(readFileSync(FLAGSHIP, 'utf8'));
  const { cards } = document as { readonly cards: unknown };
  if (!Array.isArray(cards)) throw new Error('the flagship fixture has no cards array');
  return parseCards(cards);
}

/** The width the ladder was calibrated at, and the width a 390px phone column gives. */
const REFERENCE_PX = FULL_FACE_WIDTH_REM * 16;
const WIDE_PX = 366;

const GALLERY_FACE = ".mtg-gallery > .mtg-card[data-size='full']";

function pageHtml(faceWidthPx: number): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'cards',
      onSelectMode: () => undefined,
      children: h(CardsRoute, {
        cards: flagship(),
        route: { mode: 'cards', sub: 'gallery', params: {} },
        onSetParams: () => undefined,
      }),
    }),
  );
  // The face width is forced rather than reached through a viewport, because
  // what is under test is the face at a width and not the route's breakpoints.
  const force = `${GALLERY_FACE} { --card-w: ${String(faceWidthPx)}px; }`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rules box fit by width</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}${force}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const faces = [];
  for (const card of document.querySelectorAll(${JSON.stringify(GALLERY_FACE)})) {
    const box = card.querySelector('.mtg-card__text');
    if (box === null) continue;
    const rects = [...box.querySelectorAll('.mtg-card__line')].map((line) => line.getBoundingClientRect());
    const first = rects[0];
    const last = rects[rects.length - 1];
    faces.push({
      id: card.getAttribute('data-card-id'),
      width: round(card.getBoundingClientRect().width),
      blocks: rects.length,
      clientHeight: box.clientHeight,
      scrollHeight: box.scrollHeight,
      content: first === undefined || last === undefined ? 0 : round(last.bottom - first.top),
    });
  }
  return { faces: faces };
})()`;

interface FaceReading {
  readonly id: string | null;
  readonly width: number;
  readonly blocks: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly content: number;
}

/**
 * How much of the box the text fills, which is the quantity that must not fall
 * with width. A share rather than the slack in pixels: the box itself grows, so
 * the same fit reads as more pixels of slack and less would still be the bug.
 */
function fill(face: FaceReading): number {
  return face.content / face.clientHeight;
}

/**
 * Half a rung. The ladder's rungs are ~8% of the box apart, so a fill that falls
 * by less than this is rounding rather than a face left at the wrong size.
 */
const TOLERANCE = 0.04;

describe('the rules box at a width nobody calibrated', () => {
  browserIt(
    'fills as much of its box at a 366px face as at the reference one, and clips neither',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-card-width-'));
      const reference = join(directory, 'reference.html');
      const wide = join(directory, 'wide.html');
      await writeFile(reference, pageHtml(REFERENCE_PX), 'utf8');
      await writeFile(wide, pageHtml(WIDE_PX), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const read = async (file: string, label: string): Promise<readonly FaceReading[]> => {
          const reading = (await measurePage(
            chrome!.client,
            file,
            1280,
            900,
            MEASURE,
            label,
            GALLERY_FACE,
          )) as unknown as { readonly faces: readonly FaceReading[] };
          expect(reading.faces.length, `${label}: faces measured`).toBeGreaterThan(50);
          return reading.faces;
        };
        const at244 = await read(reference, 'the reference face');
        const at366 = await read(wide, 'a 366px face');
        expect(at366[0]?.width, 'the forced width did not take').toBeCloseTo(WIDE_PX, 0);

        const shrank: string[] = [];
        const clipped: string[] = [];
        const byId = new Map(at244.map((face) => [face.id ?? '', face]));
        for (const face of at366) {
          if (face.blocks === 0) continue;
          const before = byId.get(face.id ?? '');
          if (before === undefined) throw new Error(`the wide page drew an unknown face ${String(face.id)}`);
          if (fill(face) < fill(before) - TOLERANCE) {
            shrank.push(
              `${String(face.id)}: ${(fill(before) * 100).toFixed(1)}% of the box at ${String(REFERENCE_PX)}px, ${(fill(face) * 100).toFixed(1)}% at ${String(WIDE_PX)}px`,
            );
          }
          if (face.scrollHeight > face.clientHeight + 0.5) {
            clipped.push(
              `${String(face.id)}: ${String(face.scrollHeight)}px of content in a ${String(face.clientHeight)}px box`,
            );
          }
        }
        expect(
          clipped,
          `a wide face cut ${String(clipped.length)} rules boxes: ${clipped.slice(0, 5).join(' | ')}`,
        ).toEqual([]);
        expect(
          shrank,
          `${String(shrank.length)} faces left slack a wider box did not earn: ${shrank.slice(0, 5).join(' | ')}`,
        ).toEqual([]);
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
      }
    },
    120_000,
  );
});
