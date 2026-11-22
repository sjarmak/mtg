// @vitest-environment node
/**
 * Distinct permanents stay on the table after exact-state piling has done all
 * it can.
 *
 * The fixture deliberately defeats piling: card identity, tap state and
 * summoning-sickness state form twelve different fingerprints. Half of each
 * crowded row is tapped, so a fit that counts every place as one card-width is
 * short by the 88/63 reserve a rotated face actually occupies. The supported
 * table matrix must apply the decided order: reduce the hand to a labeled
 * thumbnail rail, shrink faces no lower than the readable floor, then wrap the
 * residual places. Horizontal scrolling and hidden permanents are failures.
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

const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LAND = exampleCard('slc-plains');
const COUNTS = [4, 8, 12] as const;
const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [810, 1080],
] as const;

function game(count: number): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: count }, (_unused, index) => ({
      card: {
        ...(SPELLS[index % SPELLS.length] ?? SPELLS[0]),
        id: `${(SPELLS[index % SPELLS.length] ?? SPELLS[0]).id}-distinct-${String(index)}`,
      },
      controller: controller as PlayerId,
      tapped: Math.floor(index / SPELLS.length) % 2 === 1,
      summoningSick: Math.floor(index / (SPELLS.length * 2)) % 2 === 1,
    })),
    { card: LAND, controller: controller as PlayerId, tapped: false, summoningSick: false },
  ]);
  const built = scenario({
    seed: `ui/crowded-board-layout/${String(count)}`,
    battlefield,
    hands: [SPELLS, SPELLS],
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Crowded battlefield layout</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const near = document.querySelector(".mtg-board__side[data-seat='you']");
  const far = document.querySelector(".mtg-board__side[data-seat='opponent']");
  const readRow = (row) => {
    const rowBox = row.getBoundingClientRect();
    const faces = [...row.querySelectorAll(":scope > .mtg-attach > .mtg-slot[data-slot='play'] > .mtg-card")];
    const faceBoxes = faces.map((face) => face.getBoundingClientRect());
    const readings = faces.map((face, index) => {
      const box = face.getBoundingClientRect();
      const slotBox = face.parentElement.getBoundingClientRect();
      const name = face.querySelector('.mtg-card__name');
      const fanName = face.parentElement.querySelector('.mtg-slot__fan-name');
      const visibleName = fanName !== null && getComputedStyle(fanName).display !== 'none' ? fanName : name;
      return {
        // Rotation swaps the painted axes; the short painted side is the face
        // width in either orientation.
        width: round(Math.min(box.width, box.height)),
        slot: [round(slotBox.left - rowBox.left), round(slotBox.top - rowBox.top), round(slotBox.width), round(slotBox.height)],
        outside: round(Math.max(0, rowBox.left - box.left, box.right - rowBox.right, rowBox.top - box.top, box.bottom - rowBox.bottom)),
        nameCut: name === null ? -1 : round(Math.max(0, name.scrollHeight - name.clientHeight)),
        nameCovered: visibleName === null ? -1 : faceBoxes.slice(index + 1).filter((later) => {
          const nameBox = visibleName.getBoundingClientRect();
          return later.left < nameBox.right && later.right > nameBox.left && later.top < nameBox.bottom && later.bottom > nameBox.top;
        }).length,
      };
    });
    const style = getComputedStyle(row);
    return {
      places: row.children.length,
      faces: readings,
      rowScrollX: round(Math.max(0, row.scrollWidth - row.clientWidth)),
      rowScrollY: round(Math.max(0, row.scrollHeight - row.clientHeight)),
      rowStyle: { gap: style.gap, rowGap: style.rowGap, paddingBlock: style.paddingBlock, alignContent: style.alignContent },
    };
  };
  const nearRow = near.querySelector('.mtg-board__spells');
  const farRow = far.querySelector('.mtg-board__spells');
  const handZone = near.querySelector(".mtg-zone[data-tone='rail']");
  const handFace = handZone.querySelector(".mtg-slot[data-slot='hand'] > .mtg-card");
  const box = (node) => { const rect = node.getBoundingClientRect(); return [round(rect.width), round(rect.height)]; };
  return {
    seats: [readRow(farRow), readRow(nearRow)],
    handLabel: handZone.querySelector('.mtg-zone__note')?.textContent ?? '',
    handWidth: handFace === null ? 0 : round(handFace.getBoundingClientRect().width),
    boxes: { near: box(near), far: box(far), farRow: box(farRow), nearRow: box(nearRow), hand: box(handZone), phase: box(near.querySelector('.mtg-phasebar')) },
    pageOverflowX: round(Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)),
    pageOverflowY: round(Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight)),
  };
})()`;

interface FaceReading {
  readonly width: number;
  readonly slot: readonly [number, number, number, number];
  readonly outside: number;
  readonly nameCut: number;
  readonly nameCovered: number;
}

interface SeatReading {
  readonly places: number;
  readonly faces: readonly FaceReading[];
  readonly rowScrollX: number;
  readonly rowScrollY: number;
  readonly rowStyle: Readonly<Record<string, string>>;
}

interface Reading {
  readonly seats: readonly [SeatReading, SeatReading];
  readonly handLabel: string;
  readonly handWidth: number;
  readonly boxes: Readonly<Record<string, readonly [number, number]>>;
  readonly pageOverflowX: number;
  readonly pageOverflowY: number;
}

describe('crowded battlefield layout', () => {
  browserIt(
    'keeps hostile all-distinct mixed-tap rows wholly visible throughout the table matrix',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-crowded-board-'));
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
              'crowded battlefield',
            )) as unknown as Reading;
            const at = `${String(width)}x${String(height)}, ${String(count)} a side: ${JSON.stringify(reading)}`;
            expect(reading.pageOverflowX, `page inline overflow at ${at}`).toBeLessThanOrEqual(1);
            expect(reading.pageOverflowY, `page block overflow at ${at}`).toBeLessThanOrEqual(1);
            for (const [seat, row] of reading.seats.entries()) {
              const seatAt = `seat ${String(seat)} at ${at}`;
              expect(row.places, `distinct places at ${seatAt}`).toBe(count);
              expect(row.faces, `faces at ${seatAt}`).toHaveLength(count);
              expect(row.rowScrollX, `horizontal row escape at ${seatAt}`).toBeLessThanOrEqual(1);
              expect(row.rowScrollY, `vertical row escape at ${seatAt}`).toBeLessThanOrEqual(1);
              for (const face of row.faces) {
                expect(
                  face.width,
                  `face below the 72px legibility floor at ${seatAt}`,
                ).toBeGreaterThanOrEqual(71);
                expect(face.outside, `permanent outside its row at ${seatAt}`).toBeLessThanOrEqual(1);
                expect(face.nameCut, `permanent name cut at ${seatAt}`).toBeLessThanOrEqual(1);
                expect(face.nameCovered, `permanent name covered by a later row at ${seatAt}`).toBe(0);
              }
            }
            if (count >= 8) {
              expect(reading.handLabel, `thumbnail hand label at ${at}`).toBe('thumbnails');
              expect(reading.handWidth, `crowded hand cap at ${at}`).toBeLessThanOrEqual(57);
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
        cleanupErrors.push(
          new Error(`could not remove crowded-board fixtures ${directory}: ${reason(error)}`),
        );
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      if (cleanupErrors.length > 1)
        throw new AggregateError(cleanupErrors, 'crowded battlefield browser gate failed');
    },
    90_000,
  );
});
