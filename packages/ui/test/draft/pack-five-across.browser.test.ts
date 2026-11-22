// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { HumanDraftChoice, HumanDraftProgress } from '@mtg/draft-export';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { DraftPack } from '../../src/routes/draft/DraftPack';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

function page(size: number, taken: number): string {
  const cards = Array.from(
    { length: size },
    (_, index) => EXAMPLE_CARDS[(index * 3) % EXAMPLE_CARDS.length] as Card,
  );
  const pool = Array.from(
    { length: taken },
    (_, index) => EXAMPLE_CARDS[(index * 5) % EXAMPLE_CARDS.length] as Card,
  );
  const next: HumanDraftChoice = {
    round: 1,
    pickNumber: 16 - size,
    packSize: size,
    openedBy: 0,
    cards,
  };
  const draft: HumanDraftProgress = {
    seed: 'ui/draft-pack-five-across',
    humanSeat: 0,
    picks: pool.map((card) => card.id),
    seats: [],
    rounds: 3,
    directions: [],
    ratings: [],
    botPolicy: 'native-deck-conditioned/v1',
    nextPick: next,
    result: null,
  };
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      sub: 'draft',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(DraftPack, {
        draft,
        next,
        pool,
        onPick: () => undefined,
        onNewDraft: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draft pack five across</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const faces = [...document.querySelectorAll('.mtg-card')];
  const rects = faces.map((face) => face.getBoundingClientRect());
  const firstTop = rects[0]?.top ?? 0;
  const columns = rects.filter((r) => Math.abs(r.top - firstTop) < 0.5).length;
  const tops = [];
  for (const rect of rects) {
    if (!tops.some((top) => Math.abs(top - rect.top) < 0.5)) tops.push(rect.top);
  }
  return {
    faceCount: faces.length,
    columns,
    rows: tops.length,
    faceWidth: rects.length === 0 ? null : round(rects[0]?.width ?? 0),
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    facesWithRulesText: faces.filter((face) => (face.querySelector('.mtg-card__text')?.textContent ?? '').trim() !== '').length,
  };
})()`;

interface Reading {
  readonly faceCount: number;
  readonly columns: number;
  readonly rows: number;
  readonly faceWidth: number | null;
  readonly pageOverflowX: number;
  readonly facesWithRulesText: number;
}

const PAGE_OVERFLOW_SLACK_PX = 0.5;
const FACE_WIDTH_MIN_PX = 214;
const FACE_WIDTH_MAX_PX = 220;
const FACE_WIDTH_MAX_PX_NARROW = 244;

const VIEWPORTS = [
  { width: 1380, height: 820, fiveAcross: false },
  { width: 1880, height: 966, fiveAcross: true },
] as const;

const FULL_PACK = 15;
const SHORT_PACK = 6;

describe('the draft pack sizes its columns to the desk', () => {
  browserIt(
    'is five across only on the wide desk, fewer and larger on the narrow one, for a full pack and a short one',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-pack-five-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-pack-five-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        for (const size of [FULL_PACK, SHORT_PACK] as const) {
          const file = join(directory, `pack-${String(size)}.html`);
          await writeFile(file, page(size, 30 - size), 'utf8');
          for (const viewport of VIEWPORTS) {
            const at = `${String(viewport.width)}x${String(viewport.height)}, pack of ${String(size)}`;
            const seen = (await measurePage(
              chrome.client,
              file,
              viewport.width,
              viewport.height,
              MEASURE,
              at,
              '.mtg-work__scroll',
            )) as unknown as Reading;
            expect(seen.faceCount, `${at}: the pack drew the wrong number of faces`).toBe(size);
            if (viewport.fiveAcross) {
              expect(seen.columns, `${at}: the wide desk is not five across`).toBe(5);
              if (size === FULL_PACK) {
                expect(seen.rows, `${at}: a full pack is not three rows deep`).toBe(3);
              }
            } else {
              expect(seen.columns, `${at}: the narrow desk forced five across`).toBeLessThan(5);
            }
            expect(seen.rows, `${at}: rows does not match the full pack wrapped at this column count`).toBe(
              Math.ceil(size / seen.columns),
            );
            expect(seen.faceWidth, `${at}: no face width was measured`).not.toBeNull();
            expect(
              seen.faceWidth as number,
              `${at}: a face is narrower than the ruled floor`,
            ).toBeGreaterThanOrEqual(FACE_WIDTH_MIN_PX);
            expect(
              seen.faceWidth as number,
              `${at}: a face is wider than the layout allows at this desk`,
            ).toBeLessThanOrEqual(viewport.fiveAcross ? FACE_WIDTH_MAX_PX : FACE_WIDTH_MAX_PX_NARROW);
            expect(seen.pageOverflowX, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(
              PAGE_OVERFLOW_SLACK_PX,
            );
            expect(seen.facesWithRulesText, `${at}: no face rendered rules text`).toBeGreaterThan(0);
          }
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
