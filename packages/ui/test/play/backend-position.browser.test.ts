// @vitest-environment node
/**
 * An observed backend position measured inside the ordinary play shell.
 *
 * This is deliberately the shared `Board`, not a Legacy Cube fixture. The
 * only format-specific input is official illustration and printed-text data; the
 * adapter has to fit that data into the same desktop and phone geometry used
 * by generated-format play without growing a parallel table.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ObjectView, TableView } from '@mtg/engine';
import { DEFAULT_AUTO_PASS } from '@mtg/kernel';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { Board } from '../../src/board/Board';
import { OFFICIAL_TOKEN_PRINTINGS } from '../../src/card/token-printings';
import { backendBoardPosition } from '../../src/routes/play/backend-position';
import { stepBar } from '../../src/routes/play/toolbar';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const PRINTED = {
  physicalId: 'legacy-cube-2021:0001:00000000-0000-0000-0000-000000000001',
  position: 1,
  sourceName: 'Observed Sentinel',
  correctedName: 'Observed Sentinel',
  name: 'Observed Sentinel',
  oracleId: '00000000-0000-0000-0000-000000000002',
  scryfallId: '00000000-0000-0000-0000-000000000001',
  forgeScript: 'observed-sentinel.txt',
  forgeScriptSha256: '0'.repeat(64),
  layout: 'normal',
  manaCost: '{2}',
  manaValue: 2,
  typeLine: 'Artifact Creature',
  oracleText: 'This deliberately long printed sentence belongs inside the ordinary shared rules box.',
  power: '2',
  toughness: '3',
  loyalty: null,
  colors: [],
  colorIdentity: [],
  faces: [
    {
      name: 'Observed Sentinel',
      manaCost: '{2}',
      typeLine: 'Artifact Creature',
      oracleText: 'This deliberately long printed sentence belongs inside the ordinary shared rules box.',
      power: '2',
      toughness: '3',
      loyalty: null,
      colors: [],
    },
  ],
  art: {
    status: 'available',
    source: 'scryfall',
    scryfallId: '00000000-0000-0000-0000-000000000001',
    images: [
      {
        face: null,
        uris: {
          normal:
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="488" height="680"%3E%3Crect width="488" height="680" rx="26" fill="%23343a40"/%3E%3C/svg%3E',
          art_crop:
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="600"%3E%3Crect width="800" height="600" fill="%23343a40"/%3E%3C/svg%3E',
        },
      },
    ],
  },
} satisfies PrintedCardCatalogEntry;

const HARBOR = {
  ...PRINTED,
  physicalId: 'legacy-cube-2021:0002:00000000-0000-0000-0000-000000000003',
  position: 2,
  sourceName: 'Hinterland Harbor',
  correctedName: 'Hinterland Harbor',
  name: 'Hinterland Harbor',
  oracleId: '00000000-0000-0000-0000-000000000004',
  scryfallId: '00000000-0000-0000-0000-000000000003',
  forgeScript: 'hinterland-harbor.txt',
  typeLine: 'Land',
  oracleText: '{T}: Add {G} or {U}.',
  power: null,
  toughness: null,
  producedMana: ['U', 'G'],
  faces: [
    {
      name: 'Hinterland Harbor',
      manaCost: null,
      typeLine: 'Land',
      oracleText: '{T}: Add {G} or {U}.',
      power: null,
      toughness: null,
      loyalty: null,
      colors: [],
    },
  ],
} satisfies PrintedCardCatalogEntry;

function object(oid: string, name = PRINTED.name): ObjectView {
  return {
    oid,
    name,
    typeLine: PRINTED.typeLine,
    power: 2,
    toughness: 3,
    tapped: oid.endsWith('2'),
    attacking: false,
    damage: oid.endsWith('3') ? 1 : 0,
    controller: oid.startsWith('north') ? 0 : 1,
    counters: oid.endsWith('1') ? { charge: 2 } : {},
  };
}

const HARBOR_OBJECT: ObjectView = {
  oid: 'south-hinterland-harbor',
  name: HARBOR.name,
  typeLine: HARBOR.typeLine,
  power: null,
  toughness: null,
  tapped: false,
  attacking: false,
  damage: 0,
  controller: 0,
  counters: {},
};

const GOBLIN_TOKEN: ObjectView = {
  oid: 'south-goblin-token',
  name: 'Goblin Token',
  typeLine: 'Creature — Goblin',
  power: 1,
  toughness: 1,
  tapped: false,
  attacking: false,
  damage: 0,
  controller: 0,
  counters: {},
};

const VIEW: TableView = {
  version: 4,
  turn: { number: 7, active: 0, phase: 'foreign phase', step: 'foreign step' },
  priority: 0,
  stack: [object('north-stack'), object('north-unknown', 'Unknown observed object')],
  seats: [
    {
      id: 0,
      name: 'North',
      life: 17,
      hand: [object('north-hand')],
      handSize: 1,
      librarySize: 31,
      graveyard: [object('north-grave')],
      exile: [object('north-exile', 'Unknown observed object')],
      battlefield: [
        HARBOR_OBJECT,
        GOBLIN_TOKEN,
        object('north-1'),
        object('north-2'),
        object('north-3', 'Unknown observed object'),
      ],
    },
    {
      id: 1,
      name: 'South',
      life: 12,
      hand: null,
      handSize: 4,
      librarySize: 28,
      graveyard: [],
      exile: [],
      battlefield: [],
    },
  ],
};

function page(): string {
  const position = backendBoardPosition(VIEW, 0, [PRINTED, HARBOR, ...OFFICIAL_TOKEN_PRINTINGS]);
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(
        'div',
        { className: 'mtg-live' },
        h(
          'div',
          { className: 'mtg-play' },
          h('div', { className: 'mtg-toolbar' }, h('button', { className: 'mtg-btn' }, 'Close game')),
          h(
            'div',
            { className: 'mtg-play__table', role: 'region', 'aria-label': 'Game table' },
            h(Board, {
              ...position,
              prompt: h('p', null, 'A backend-neutral decision appears in the ordinary ask column.'),
              steps: stepBar({
                step: 'firstStrikeDamage',
                turnText: 'Turn 7: North',
                stepText: 'foreign phase · foreign step',
                autoPass: DEFAULT_AUTO_PASS,
                onAutoPass: () => undefined,
                canYield: false,
              }),
              rail: h('p', null, 'A backend-neutral event appears in the ordinary game log.'),
            }),
          ),
        ),
      ),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Observed board</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const board = document.querySelector('.mtg-board');
  const table = document.querySelector('[aria-label="Game table"]');
  const turnBand = document.querySelector('[aria-label="Phases and stops"]');
  const printed = [...document.querySelectorAll('.mtg-card[data-presentation="printed-card"]')];
  const images = printed.flatMap((card) => [...card.querySelectorAll('[data-region="art"] > .mtg-art__image')].map((image) => {
    const cardBox = card.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    return {
      width: imageBox.width,
      height: imageBox.height,
      contained:
        imageBox.left >= cardBox.left - 1 && imageBox.right <= cardBox.right + 1 &&
        imageBox.top >= cardBox.top - 1 && imageBox.bottom <= cardBox.bottom + 1,
    };
  })).filter((image) => image.width > 0 && image.height > 0);
  const box = (node) => {
    if (node === null) return null;
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  };
  return {
    viewport: [window.innerWidth, window.innerHeight],
    documentWidth: document.documentElement.scrollWidth,
    board: box(board),
    table: box(table),
    turnBand: box(turnBand),
    turnBandText: turnBand?.textContent ?? '',
    turnSteps: turnBand?.querySelectorAll('[data-step]').length ?? 0,
    currentStep: turnBand?.querySelector('[aria-current="step"]')?.textContent ?? '',
    printed: printed.length,
    framed: printed.filter((card) => card.querySelectorAll('[data-region="title"], [data-region="art"], [data-region="type"], [data-region="rules"]').length === 4).length,
    artTiles: printed.filter((card) => card.getAttribute('data-size') === 'art').length,
    wholeCardImages: document.querySelectorAll('.mtg-printed-card-image, img[src*="/normal/"]').length,
    images,
    missing: document.querySelectorAll('.mtg-card[data-presentation="printed-card"] [data-art-state="pending"]').length,
    statuses: document.querySelectorAll('.mtg-pod').length,
    opponentCards: document.querySelectorAll('[data-seat="opponent"] [data-permanent-key]').length,
    opponentFaceDown: document.querySelectorAll('[data-seat="opponent"] .mtg-cardback').length,
    harborMana: [...(document.querySelector('[data-permanent-key="south-hinterland-harbor"]')
      ?.querySelectorAll('.mtg-card__mana [data-symbol]') ?? [])]
      .map((symbol) => symbol.getAttribute('data-symbol')),
    harborLabel: document.querySelector('[data-permanent-key="south-hinterland-harbor"] .mtg-card')
      ?.getAttribute('aria-label') ?? '',
    goblinArt: document.querySelector('[data-permanent-key="south-goblin-token"] [data-region="art"] img')
      ?.getAttribute('src') ?? '',
    goblinPending: document.querySelector('[data-permanent-key="south-goblin-token"] [data-art-state="pending"]') !== null,
  };
})()`;

const VIEWPORTS = [
  [1440, 900],
  [390, 844],
] as const;

describe('an observed position on the shared play board', () => {
  browserIt(
    'keeps official art, shared frames, and explicit missing states inside the ordinary responsive table',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-backend-position-'));
      const file = join(directory, 'position.html');
      await writeFile(file, page(), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const result = await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            'observed shared board',
          );
          expect(result['viewport']).toEqual([width, height]);
          expect(result['documentWidth']).toBeLessThanOrEqual(width);
          expect(result['printed']).toBeGreaterThanOrEqual(7);
          expect(Number(result['framed']) + Number(result['artTiles'])).toBe(result['printed']);
          expect(result['artTiles']).toBe(1);
          expect(result['wholeCardImages']).toBe(0);
          expect(result['missing']).toBeGreaterThanOrEqual(1);
          expect(result['statuses']).toBe(2);
          expect(result['opponentCards']).toBe(0);
          expect(result['opponentFaceDown']).toBe(0);
          expect(result['harborMana']).toEqual(['{U}', '{G}']);
          expect(result['harborLabel']).toContain('Produces blue or green mana.');
          expect(result['goblinArt']).toBe(
            'https://cards.scryfall.io/art_crop/front/0/e/0e67efea-8a80-42ec-8e77-07d387d933d4.jpg',
          );
          expect(result['goblinPending']).toBe(false);
          expect(result['board']).not.toBeNull();
          expect(result['table']).not.toBeNull();
          expect(result['turnBand']).not.toBeNull();
          expect(result['turnBandText']).toContain('Turn 7: North');
          expect(result['turnSteps']).toBe(13);
          expect(result['currentStep']).toContain('First strike');
          const images = result['images'] as readonly {
            readonly width: number;
            readonly height: number;
            readonly contained: boolean;
          }[];
          expect(images.length).toBeGreaterThanOrEqual(4);
          for (const image of images) {
            expect(image.width).toBeGreaterThan(0);
            expect(image.height).toBeGreaterThan(0);
            expect(image.contained).toBe(true);
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
          `observed shared board Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    60_000,
  );
});
