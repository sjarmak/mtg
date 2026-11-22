// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCard } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/** Plain authored cards: this regression measures places, not set content. */
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

const CREATURES = Array.from({ length: 8 }, (_unused, index) =>
  creature(
    `slc-attach-place-creature-${String(index + 1)}`,
    `Battlefield Creature ${String(index + 1)}`,
    index + 1,
  ),
);
const FIRST_CREATURE = CREATURES[0]!;

/** The one card that makes a tray. Its equip ability is never activated here:
 *  the attachment is staged on the object, so what is measured is the drawn
 *  arrangement rather than the kernel's route to it. */
const EDGE = parseCard({
  kind: 'artifact',
  id: 'slc-attach-place-edge',
  name: 'Brigand Edge',
  rarity: 'rare',
  set: { code: 'SLC', collectorNumber: 5 },
  colors: [],
  subtypes: ['Equipment'],
  manaCost: { generic: 4 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      effects: [],
      attach: { modifications: [{ kind: 'statBonus', power: 3, toughness: 3 }] },
    },
  ],
});

const PLAINS = parseCard({
  kind: 'land',
  id: 'slc-attach-place-plains',
  name: 'Plains',
  rarity: 'common',
  set: { code: 'SLC', collectorNumber: 6 },
  supertypes: ['basic'],
  basicLandType: 'Plains',
  producesMana: ['W'],
});

/** How many nonland places the near row draws. Eight is the count every
 *  crowded rule on the row is written against. */
const PLACES = 8;

/** The crowded-board name legibility floor, measured at the rendered face. */
const FACE_FLOOR_PX = 72;

type Eighth = 'bare' | 'tray';

function boardSession(eighth: Eighth): GameSession {
  const near = Array.from({ length: PLACES }, (_unused, index) => ({
    card: CREATURES[index % CREATURES.length] ?? FIRST_CREATURE,
    controller: 0 as PlayerId,
    tapped: false,
    summoningSick: false,
  }));
  const far = Array.from({ length: 3 }, (_unused, index) => ({
    card: CREATURES[index % CREATURES.length] ?? FIRST_CREATURE,
    controller: 1 as PlayerId,
    tapped: false,
    summoningSick: false,
  }));
  const lands = ([0, 1] as const).map((controller) => ({
    card: PLAINS,
    controller: controller as PlayerId,
    tapped: false,
    summoningSick: false,
  }));
  const built = scenario({
    seed: `ui/attached-place/${eighth}`,
    battlefield: [
      ...near,
      ...(eighth === 'tray'
        ? [{ card: EDGE, controller: 0 as PlayerId, tapped: false, summoningSick: false }]
        : []),
      ...far,
      ...lands,
      ...lands,
    ],
    hands: [
      [FIRST_CREATURE, PLAINS],
      [CREATURES[1] ?? FIRST_CREATURE, PLAINS],
    ],
    active: 0,
    turn: 5,
  });
  let state: GameState = built.state;
  if (eighth === 'tray') {
    const mine = state.battlefield.filter((oid) => state.objects[oid]?.controller === 0);
    const equipment = mine.find((oid) => state.objects[oid]?.card.id === EDGE.id);
    const hosts = mine.filter((oid) => state.objects[oid]?.card.kind === 'creature');
    const host = hosts[PLACES - 1];
    const object = equipment === undefined ? undefined : state.objects[equipment];
    if (equipment === undefined || host === undefined || object === undefined) {
      throw new Error('the tray arm could not find its Equipment and its eighth creature');
    }
    state = {
      ...state,
      objects: { ...state.objects, [equipment]: { ...object, attachedTo: host as ObjectId } },
    };
  }
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

function page(eighth: Eighth): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: boardSession(eighth),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Attached place</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (element) => {
    if (element === null) return null;
    const rect = element.getBoundingClientRect();
    return { width: round(rect.width), height: round(rect.height), left: round(rect.left), right: round(rect.right) };
  };
  const board = document.querySelector('.mtg-board');
  const row = document.querySelector(".mtg-board__side[data-seat='you'] .mtg-board__spells");
  const tray = row.querySelector(":scope > .mtg-attach[data-holds='true']");
  return {
    cap: getComputedStyle(board).getPropertyValue('--hand-face-cap').trim(),
    faceMax: getComputedStyle(row).getPropertyValue('--board-face-max').trim(),
    places: row.children.length,
    bare: box(row.querySelector(":scope > .mtg-attach[data-holds='false'] > .mtg-slot")),
    bareFace: box(row.querySelector(":scope > .mtg-attach[data-holds='false'] > .mtg-slot > .mtg-card")),
    tray: box(tray),
    host: box(tray === null ? null : tray.querySelector(':scope > .mtg-slot')),
    hostFace: box(tray === null ? null : tray.querySelector(':scope > .mtg-slot > .mtg-card')),
    held: box(tray === null ? null : tray.querySelector('.mtg-attach__held > .mtg-slot')),
  };
})()`;

interface Box {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
}

interface Reading {
  readonly cap: string;
  readonly faceMax: string;
  readonly places: number;
  readonly bare: Box;
  readonly bareFace: Box;
  readonly tray: Box | null;
  readonly host: Box | null;
  readonly hostFace: Box | null;
  readonly held: Box | null;
}

function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`the tray arm drew no ${what}`);
  return value;
}

describe('a battlefield row whose eighth place is holding an Equipment', () => {
  browserIt(
    'counts the tray as a place and draws its host the size of a bare neighbor',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-attached-place-'));
      const files: Record<Eighth, string> = {
        bare: join(directory, 'bare.html'),
        tray: join(directory, 'tray.html'),
      };
      await writeFile(files.bare, page('bare'), 'utf8');
      await writeFile(files.tray, page('tray'), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        const launched = await launchChrome(join(directory, 'chrome'));
        chrome = launched;
        for (const [width, height] of [
          [1440, 900],
          [1280, 800],
          [1024, 768],
        ] as const) {
          const read = async (eighth: Eighth): Promise<Reading> =>
            (await measurePage(
              launched.client,
              files[eighth],
              width,
              height,
              MEASURE,
              `attached place ${eighth}`,
            )) as unknown as Reading;
          const bare = await read('bare');
          const tray = await read('tray');
          const at = `${String(width)}x${String(height)}`;
          const detail = `${at} ${JSON.stringify({ bare, tray })}`;

          // Both arms draw the same number of places, which is what makes the
          // rest of these comparable at all.
          expect(bare.places, `bare places ${detail}`).toBe(PLACES);
          expect(tray.places, `tray places ${detail}`).toBe(PLACES);
          expect(tray.tray, `tray element ${detail}`).not.toBeNull();

          // The crowded ceilings are about how many places are on the row, and
          // a tray is one of them.
          expect(tray.cap, `hand cap ${detail}`).toBe(bare.cap);
          expect(tray.faceMax, `board ceiling ${detail}`).toBe(bare.faceMax);
          // The held card adds real width pressure, so the tray arm may choose
          // a smaller fit than the bare control. It may not take that pressure
          // out of the host below the battlefield legibility floor.
          const host = present(tray.host, 'host slot');
          const hostFace = present(tray.hostFace, 'host face');
          const held = present(tray.held, 'held slot');
          const trayBox = present(tray.tray, 'tray');
          // Face against face rather than face against slot box: a bare slot is
          // stated at `--board-face` wide and lets its card letterbox inside it
          // when the row's height share is the tighter bound, so its box is the
          // wrong subject on exactly the viewport this comparison is hardest on.
          expect(hostFace.width, `host face width ${detail}`).toBeGreaterThanOrEqual(FACE_FLOOR_PX);
          expect(host.left, `host inside tray ${detail}`).toBeGreaterThanOrEqual(trayBox.left - 1);
          expect(held.right, `held inside tray ${detail}`).toBeLessThanOrEqual(trayBox.right + 1);
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
          `attached place Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    60_000,
  );
});
