// @vitest-environment node
/**
 * Exact-state piles buy real battlefield room in the browser.
 *
 * The first two places are exact copies and the rest have distinct card
 * identities. The matrix straddles the row threshold: Chrome must lay out all
 * nine direct faces, then one two-object pile plus every other representative,
 * without a horizontal escape hatch or a cut name at every supported table
 * shape.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const SUBJECT = exampleCard('slc-skywatch-sentinel');
const LAND = exampleCard('slc-plains');
const COUNTS = [9, 10, 12] as const;
const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [810, 1080],
] as const;

function game(count: number): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: count }, (_unused, index) => ({
      card: index < 2 ? SUBJECT : { ...SUBJECT, id: `${SUBJECT.id}-${String(index)}` },
      controller: controller as PlayerId,
      tapped: index > 1 && index % 2 === 1,
      summoningSick: false,
    })),
    { card: LAND, controller: controller as PlayerId, tapped: false, summoningSick: false },
  ]);
  const built = scenario({
    seed: `ui/permanent-piles/${String(count)}`,
    battlefield,
    hands: [
      [SUBJECT, LAND],
      [SUBJECT, LAND],
    ],
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

function page(count: number): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: game(count),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Permanent piles</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const row = document.querySelector(".mtg-board__side[data-seat='you'] .mtg-board__spells");
  const rowBox = row.getBoundingClientRect();
  const faces = [...row.querySelectorAll(":scope > .mtg-attach > .mtg-slot[data-slot='play'] > .mtg-card")];
  const readings = faces.map((face) => {
    const box = face.getBoundingClientRect();
    const name = face.querySelector('.mtg-card__name');
    return {
      width: round(box.width),
      outside: round(Math.max(0, rowBox.left - box.left, box.right - rowBox.right, rowBox.top - box.top, box.bottom - rowBox.bottom)),
      nameCut: name === null ? -1 : round(Math.max(0, name.scrollHeight - name.clientHeight)),
    };
  });
  return {
    places: row.children.length,
    faces: readings,
    badges: [...row.querySelectorAll('.mtg-permanent-pile__count')].map((badge) => Number(badge.textContent)),
    scrollX: round(Math.max(0, row.scrollWidth - row.clientWidth)),
    pageOverflowY: round(Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight)),
  };
})()`;

interface FaceReading {
  readonly width: number;
  readonly outside: number;
  readonly nameCut: number;
}

interface Reading {
  readonly places: number;
  readonly faces: readonly FaceReading[];
  readonly badges: readonly number[];
  readonly scrollX: number;
  readonly pageOverflowY: number;
}

describe('exact-state permanent piles in a crowded played table', () => {
  browserIt(
    'keeps duplicates separate through nine row places and compacts them at ten or more',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-permanent-piles-'));
      const files = new Map<number, string>();
      for (const count of COUNTS) {
        const file = join(directory, `${String(count)}.html`);
        await writeFile(file, page(count), 'utf8');
        files.set(count, file);
      }
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const count of COUNTS) {
          const file = files.get(count);
          if (file === undefined) throw new Error(`no fixture for ${String(count)} permanents`);
          for (const [width, height] of VIEWPORTS) {
            const reading = (await measurePage(
              chrome.client,
              file,
              width,
              height,
              MEASURE,
              'permanent piles',
            )) as unknown as Reading;
            const at = `${String(width)}x${String(height)}, ${String(count)} a side: ${JSON.stringify(reading)}`;
            const expectedPlaces = count < 10 ? count : count - 1;
            expect(reading.places, `places at ${at}`).toBe(expectedPlaces);
            expect(reading.faces, `faces at ${at}`).toHaveLength(expectedPlaces);
            expect(reading.badges, `pile counts at ${at}`).toEqual(count < 10 ? [] : [2]);
            expect(reading.scrollX, `horizontal row escape at ${at}`).toBeLessThanOrEqual(1);
            expect(reading.pageOverflowY, `page overflow at ${at}`).toBeLessThanOrEqual(1);
            for (const face of reading.faces) {
              expect(face.width, `zero-size representative at ${at}`).toBeGreaterThan(0);
              expect(face.outside, `representative outside row at ${at}`).toBeLessThanOrEqual(1);
              expect(face.nameCut, `representative name cut at ${at}`).toBeLessThanOrEqual(1);
            }
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
        cleanupErrors.push(new Error(`could not remove pile fixtures ${directory}: ${reason(error)}`));
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length > 0)
        throw new AggregateError(cleanupErrors, 'permanent pile browser gate failed');
    },
    90_000,
  );
});
