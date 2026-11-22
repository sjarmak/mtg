// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ObjectView, SeatId, SeatView, TableView } from '@mtg/engine';
import { DEFAULT_AUTO_PASS } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { Board } from '../../src/board/Board';
import { CARD_TRIM_MM } from '../../src/card/anatomy';
import { backendBoardPosition } from '../../src/routes/play/backend-position';
import { stepBar } from '../../src/routes/play/toolbar';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';
import type { EmulatedDevice, SafeAreaInsets } from '../support/chrome';

function permanent(oid: string, controller: SeatId, extra: Partial<ObjectView> = {}): ObjectView {
  return {
    oid,
    name: `Creature ${oid}`,
    typeLine: 'Creature — Bear',
    power: 2,
    toughness: 3,
    tapped: false,
    attacking: false,
    damage: 0,
    controller,
    counters: {},
    ...extra,
  };
}

const COMMANDER = permanent('cmd-0', 0 as SeatId, {
  name: 'Atraxa, Grand Unifier',
  typeLine: 'Legendary Creature — Phyrexian Angel',
  characteristics: { colors: ['G', 'W', 'U', 'B'], manaCost: '{4}{G}{W}{U}{B}', token: false },
});

const OPPONENT_COMMANDER = permanent('cmd-1', 1 as SeatId, {
  name: 'Kenrith, the Returned King',
  typeLine: 'Legendary Creature — Human Noble',
  characteristics: { colors: ['W', 'U', 'B', 'R', 'G'], manaCost: '{W}{U}{B}{R}{G}', token: false },
});

function seat(id: SeatId, extra: Partial<SeatView>): SeatView {
  const commander = id === 0 ? COMMANDER : OPPONENT_COMMANDER;
  return {
    id,
    name: id === 0 ? 'You' : 'Bot',
    life: 40,
    hand: id === 0 ? [permanent('s0-hand-0', 0), permanent('s0-hand-1', 0)] : null,
    handSize: id === 0 ? 2 : 7,
    librarySize: 90,
    graveyard: [],
    exile: [],
    battlefield: [],
    commandZone: [commander],
    commanderCasts: { [commander.oid]: 0 },
    commanderDamage: {},
    poison: 0,
    ...extra,
  };
}

const VIEW: TableView = {
  version: 4,
  turn: { number: 3, active: 0, phase: 'precombatMain', step: 'precombatMain' },
  priority: 0,
  stack: [],
  seats: [seat(0, {}), seat(1, {})],
  commanderDamageMatrix: [
    [0, 0],
    [0, 0],
  ],
} as TableView;

function page(): string {
  const position = backendBoardPosition(VIEW, 0);
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
              prompt: h('p', null, 'Main phase.'),
              steps: stepBar({
                step: 'precombatMain',
                turnText: 'Turn 3: You',
                stepText: 'main phase',
                autoPass: DEFAULT_AUTO_PASS,
                onAutoPass: () => undefined,
                canYield: false,
              }),
              combat: null,
              rail: h('p', null, 'The game log.'),
            }),
          ),
        ),
      ),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Command zone mobile</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const clipped = (node) => {
    const rect = node.getBoundingClientRect();
    const seen = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();
      if (style.overflowX !== 'visible') {
        seen.left = Math.max(seen.left, clip.left);
        seen.right = Math.min(seen.right, clip.right);
      }
      if (style.overflowY !== 'visible') {
        seen.top = Math.max(seen.top, clip.top);
        seen.bottom = Math.min(seen.bottom, clip.bottom);
      }
    }
    return {
      left: seen.left, top: seen.top, right: seen.right, bottom: seen.bottom,
      width: Math.round(seen.right - seen.left), height: Math.round(seen.bottom - seen.top),
    };
  };
  const box = (node) => {
    if (node === null || node === undefined) return null;
    const rect = node.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  };
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const side = (seat) => {
    const root = document.querySelector(\`.mtg-board__side[data-seat='\${seat}']\`);
    const command = root === null ? null : root.querySelector('.mtg-command');
    const body = command === null ? null : command.querySelector('.mtg-zone__body');
    const slot = command === null ? null : command.querySelector('.mtg-slot[data-slot="hand"]');
    const card = slot === null ? null : slot.querySelector('.mtg-card');
    const ledger = command === null ? null : command.querySelector('.mtg-command__ledger');
    const casts = command === null ? null : command.querySelector('.mtg-command__casts');
    const cost = command === null ? null : command.querySelector('.mtg-command__cost');
    const cardRect = card === null ? null : card.getBoundingClientRect();
    const cardClip = card === null ? null : clipped(card);
    const ledgerClip = ledger === null ? null : clipped(ledger);
    return {
      slotBox: box(slot),
      cardBox: box(card),
      cardClippedBox: cardClip === null ? null : { width: cardClip.width, height: cardClip.height },
      cardRatio: cardRect === null ? null : cardRect.width / cardRect.height,
      bodySpill: body === null ? null : body.scrollHeight - body.clientHeight,
      castsBox: box(casts),
      costBox: box(cost),
      ledgerOverlapsCard: cardClip === null || ledgerClip === null ? null : overlaps(cardClip, ledgerClip),
    };
  };
  return { you: side('you'), opponent: side('opponent') };
})()`;

interface SafeViewport {
  readonly width: number;
  readonly height: number;
  readonly device: EmulatedDevice;
  readonly label: string;
}

const NOTCHED_PHONE: SafeAreaInsets = { top: 0, right: 47, bottom: 21, left: 47 };

function landscape(width: number, height: number, safeArea?: SafeAreaInsets): SafeViewport {
  const device: EmulatedDevice = {
    mobile: true,
    pointer: 'coarse',
    ...(safeArea === undefined ? {} : { safeArea }),
  };
  const label =
    safeArea === undefined
      ? `${String(width)}x${String(height)}`
      : `${String(width)}x${String(height)} notched`;
  return { width, height, device, label };
}

const VIEWPORTS: readonly SafeViewport[] = [
  { width: 1440, height: 900, device: {}, label: '1440x900' },
  { width: 1880, height: 966, device: {}, label: '1880x966' },
  { width: 390, height: 844, device: { mobile: true, pointer: 'coarse' }, label: '390x844' },
  { width: 390, height: 664, device: { mobile: true, pointer: 'coarse' }, label: '390x664' },
  { width: 375, height: 553, device: { mobile: true, pointer: 'coarse' }, label: '375x553' },
  landscape(844, 390),
  landscape(844, 390, NOTCHED_PHONE),
  landscape(844, 340),
  landscape(844, 340, NOTCHED_PHONE),
  landscape(932, 430),
  landscape(932, 430, NOTCHED_PHONE),
  landscape(667, 375),
  landscape(667, 375, NOTCHED_PHONE),
  landscape(667, 310),
];

const DESKTOP_CARD_BOX = { width: 100, height: 140 } as const;

const SHORT_FACE_WIDTH_FLOOR_PX = 43.5;

const TRUE_RATIO = CARD_TRIM_MM.width / CARD_TRIM_MM.height;

interface Box {
  readonly width: number;
  readonly height: number;
}

interface Side {
  readonly slotBox: Box | null;
  readonly cardBox: Box | null;
  readonly cardClippedBox: Box | null;
  readonly cardRatio: number | null;
  readonly bodySpill: number | null;
  readonly castsBox: Box | null;
  readonly costBox: Box | null;
  readonly ledgerOverlapsCard: boolean | null;
}

describe('the command zone on a phone', () => {
  browserIt(
    'draws the commander whole, never stretched, never cut by its own slot, at every held viewport',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-command-zone-mobile-'));
      const file = join(directory, 'page.html');
      await writeFile(file, page(), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const { width, height, device, label } of VIEWPORTS) {
          const short = height <= 576;
          const result = (await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            label,
            ".mtg-command .mtg-slot[data-slot='hand'] > .mtg-card",
            true,
            device,
          )) as unknown as { you: Side; opponent: Side };

          for (const [seat, reading] of [
            ['you', result.you],
            ['opponent', result.opponent],
          ] as const) {
            const where = `${label} ${seat}`;
            expect(reading.slotBox, `${where} slot`).not.toBeNull();
            expect(reading.cardBox, `${where} card`).not.toBeNull();

            expect(reading.cardBox?.width, `${where} card width vs slot`).toBeLessThanOrEqual(
              (reading.slotBox?.width ?? 0) + 1,
            );
            expect(reading.cardBox?.height, `${where} card height vs slot`).toBeLessThanOrEqual(
              (reading.slotBox?.height ?? 0) + 1,
            );
            expect(reading.cardRatio, `${where} card ratio`).toBeCloseTo(TRUE_RATIO, 2);
            expect(reading.bodySpill, `${where} zone body spill`).toBeLessThanOrEqual(1);
            expect(reading.castsBox, `${where} commander tax ledger`).not.toBeNull();
            expect(reading.castsBox?.width, `${where} commander tax ledger width`).toBeGreaterThan(0);
            expect(reading.costBox, `${where} next-cast ledger`).not.toBeNull();
            expect(reading.costBox?.width, `${where} next-cast ledger width`).toBeGreaterThan(0);
            expect(reading.ledgerOverlapsCard, `${where} ledger drawn over the card`).toBe(false);

            if (short) {
              expect(
                reading.cardClippedBox?.width,
                `${where} commander face width under ${String(SHORT_FACE_WIDTH_FLOOR_PX)}px`,
              ).toBeGreaterThanOrEqual(SHORT_FACE_WIDTH_FLOOR_PX);
              expect(
                reading.cardClippedBox?.height,
                `${where} commander face clipped by the zone`,
              ).toBeGreaterThanOrEqual((reading.cardBox?.height ?? 0) - 1);
            }
          }
        }

        const desktop = (await measurePage(
          chrome.client,
          file,
          1440,
          900,
          MEASURE,
          'command zone mobile desktop',
          ".mtg-command .mtg-slot[data-slot='hand'] > .mtg-card",
          true,
          {},
        )) as unknown as { you: Side; opponent: Side };
        expect(desktop.you.cardBox, '1440x900 card unchanged').toEqual(DESKTOP_CARD_BOX);
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
          `command zone mobile Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});
