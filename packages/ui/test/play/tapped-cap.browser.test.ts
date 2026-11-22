// @vitest-environment node
/**
 * A tapped face on a battlefield row that was capped on the block axis.
 *
 * `mtg-6hhr` reported a tapped slot losing parity with an upright one where the
 * well is short, and it does not reproduce at any viewport in
 * `./battlefield-geometry.browser.test.ts`: nothing in the tree shortens the
 * well far enough for the second term of `../../src/styles/board/slot.ts`'s
 * `min(71.59cqw, 100cqh)` to bind. Reaching it from the viewport side runs into
 * `mtg-t34` first, which is a different defect.
 *
 * So the cap is applied directly, which is what `../../src/styles/board/hand.ts`
 * already does to a battlefield row (`BOARD_FACE_MAX_SHARE`): the row is given a
 * stated block size, the slot's own `max-height` trims its height below what its
 * width asked for, and the rotated face is measured against the upright one
 * beside it. That is the one condition the defect needs and the rig had no case
 * for.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCard } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, GameState } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/** Plain authored cards: this regression measures slots, not set content. */
function creature(id: string, name: string, collectorNumber: number): DslCard {
  return parseCard({
    kind: 'creature',
    id,
    name,
    rarity: 'common',
    set: { code: 'SLC', collectorNumber },
    manaCost: { generic: 2 },
    colors: [],
    power: 2,
    toughness: 2,
  });
}

const SKYBORN = creature('slc-tapped-cap-skyborn', 'Skyborn Fledgling', 1);
const DRONE = creature('slc-tapped-cap-vorn', 'Vorn Flight Drone', 2);
const OSSUARY = creature('slc-tapped-cap-ossuary', 'Ossuary Gravewalker', 3);
const WARCHIEF = creature('slc-tapped-cap-warchief', 'Silver Brigand Warchief', 4);
const PLAINS = parseCard({
  kind: 'land',
  id: 'slc-tapped-cap-plains',
  name: 'Plains',
  rarity: 'common',
  set: { code: 'SLC', collectorNumber: 5 },
  supertypes: ['basic'],
  basicLandType: 'Plains',
  producesMana: ['W'],
});

/** How tall the row is told to be. Under a card's max-content width at every
 *  viewport the rig measures, which is the whole point of stating it. */
const ROW_BLOCK_PX = 110;

function cappedSession(): GameSession {
  const built = scenario({
    seed: 'ui/tapped-cap',
    battlefield: [
      { card: SKYBORN, controller: 1, tapped: true, summoningSick: false },
      { card: DRONE, controller: 1, tapped: false, summoningSick: false },
      { card: PLAINS, controller: 1, tapped: false, summoningSick: false },
      { card: WARCHIEF, controller: 0, tapped: true, summoningSick: false },
      { card: OSSUARY, controller: 0, tapped: false, summoningSick: false },
      { card: PLAINS, controller: 0, tapped: false, summoningSick: false },
    ],
    hands: [[OSSUARY], [SKYBORN]],
    active: 0,
    turn: 5,
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

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: cappedSession(),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  const cap = `.mtg-board .mtg-board__side .mtg-board__spells > .mtg-attach > .mtg-slot[data-slot='play']:not([data-empty='true']){max-block-size:${String(ROW_BLOCK_PX)}px}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tapped cap</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}${cap}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const faces = [...document.querySelectorAll(".mtg-board__spells .mtg-slot[data-slot='play'] > .mtg-card")].map((face) => {
    const slot = face.parentElement;
    const box = face.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    const tapped = slot.getAttribute('data-tapped') === 'true';
    return {
      id: face.getAttribute('data-card-id'),
      seat: slot.closest('.mtg-board__side').getAttribute('data-seat'),
      tapped,
      base: [round(tapped ? box.height : box.width), round(tapped ? box.width : box.height)],
      slot: [round(slotBox.width), round(slotBox.height)],
      insideSlot: box.left >= slotBox.left - 1 && box.right <= slotBox.right + 1
        && box.top >= slotBox.top - 1 && box.bottom <= slotBox.bottom + 1,
    };
  });
  return { faces };
})()`;

interface Reading {
  readonly id: string;
  readonly seat: string;
  readonly tapped: boolean;
  readonly base: readonly [number, number];
  readonly slot: readonly [number, number];
  readonly insideSlot: boolean;
}

function one(result: Record<string, unknown>, id: string, seat: string): Reading {
  const faces = result['faces'] as readonly Reading[];
  const match = faces.filter((face) => face.id === id && face.seat === seat);
  if (match.length !== 1 || match[0] === undefined) {
    throw new Error(`expected one ${seat} ${id}, found ${String(match.length)}`);
  }
  return match[0];
}

describe('a battlefield row capped on the block axis', () => {
  browserIt(
    'draws a tapped face the size of the upright one beside it',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-tapped-cap-'));
      const file = join(directory, 'capped.html');
      await writeFile(file, page(), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of [
          [1440, 900],
          [1280, 800],
          [1024, 768],
        ] as const) {
          const result = await measurePage(chrome.client, file, width, height, MEASURE, 'tapped cap');
          const skyborn = one(result, SKYBORN.id, 'opponent');
          const drone = one(result, DRONE.id, 'opponent');
          const warchief = one(result, WARCHIEF.id, 'you');
          const ossuary = one(result, OSSUARY.id, 'you');
          for (const [tapped, upright] of [
            [skyborn, drone],
            [warchief, ossuary],
          ] as const) {
            const detail = `${String(width)}x${String(height)} ${JSON.stringify({ tapped, upright })}`;
            expect(tapped.tapped, detail).toBe(true);
            expect(upright.tapped, detail).toBe(false);
            expect(Math.abs(tapped.base[0] - upright.base[0]), `base width ${detail}`).toBeLessThanOrEqual(1);
            expect(Math.abs(tapped.base[1] - upright.base[1]), `base height ${detail}`).toBeLessThanOrEqual(
              1,
            );
            expect(tapped.insideSlot, `inside slot ${detail}`).toBe(true);
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
          `tapped cap Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    45_000,
  );
});
