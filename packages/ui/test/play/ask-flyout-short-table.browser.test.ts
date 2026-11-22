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
import type { AskSlot } from '../../src/routes/play/ask-flyout';
import { askAlert, askFlyout } from '../../src/routes/play/ask-flyout';
import { backendBoardPosition } from '../../src/routes/play/backend-position';
import type { PlayChoice, PlayPrompt } from '../../src/routes/play/prompt';
import { promptPanel } from '../../src/routes/play/rail';
import { stepBar } from '../../src/routes/play/toolbar';
import { FLYOUT_MAX_PERCENT } from '../../src/styles/board/ask-flyout';
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

function seat(id: SeatId, extra: Partial<SeatView> = {}): SeatView {
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
    commandZone: [],
    commanderCasts: {},
    commanderDamage: {},
    poison: 0,
    ...extra,
  };
}

function view(): TableView {
  return {
    version: 4,
    turn: { number: 3, active: 0, phase: 'precombatMain', step: 'precombatMain' },
    priority: 0,
    stack: [],
    seats: [seat(0 as SeatId), seat(1 as SeatId)],
    commanderDamageMatrix: [
      [0, 0],
      [0, 0],
    ],
  } as TableView;
}

const CHOICE_COUNT = 10;

function choice(index: number): PlayChoice {
  return { index, label: `Move ${String(index)}`, detail: null, kind: 'other', oids: [] };
}

const PROMPT: PlayPrompt = {
  headline: 'Choose a move',
  explain: 'Ten moves are legal.',
  choices: Array.from({ length: CHOICE_COUNT }, (_, index) => choice(index)),
  textInput: null,
  truncated: false,
};

const SLOT: AskSlot = { kind: 'decision', count: CHOICE_COUNT };

function noop(): void {
  return undefined;
}

function page(): string {
  const position = backendBoardPosition(view(), 0);
  const panel = promptPanel(PROMPT, noop, 1);
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
              askCollapsed: true,
              prompt: askAlert(SLOT, true, noop, true),
              askFlyout: askFlyout(true, SLOT, panel),
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Ask flyout on a short table</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const rect = (node) => {
    if (node === null) return null;
    const r = node.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  const flyout = document.querySelector('.mtg-board__lanes > .mtg-ask-flyout');
  const body = flyout === null ? null : flyout.querySelector('.mtg-panel__body');
  const mine = document.querySelector(".mtg-board__side[data-seat='you']");
  const zones = mine === null ? [] : Array.from(mine.querySelectorAll('.mtg-zone'));
  const hand = zones.find((zone) => (zone.getAttribute('aria-label') || '').toLowerCase().includes('hand')) || null;
  const choiceRects = () =>
    Array.from(document.querySelectorAll('.mtg-ask-flyout .mtg-choice')).map(rect);
  const before = choiceRects();
  let after = null;
  if (body !== null) {
    body.scrollTop = body.scrollHeight;
    after = choiceRects();
  }
  return {
    flyout: rect(flyout),
    body: rect(body),
    lanes: rect(document.querySelector('.mtg-board__lanes')),
    steps: rect(document.querySelector('.mtg-phasebar')),
    hand: rect(hand),
    before,
    after,
  };
})()`;

interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

interface Reading {
  readonly flyout: Rect | null;
  readonly body: Rect | null;
  readonly lanes: Rect | null;
  readonly steps: Rect | null;
  readonly hand: Rect | null;
  readonly before: readonly Rect[];
  readonly after: readonly Rect[] | null;
}

const NOTCHED_SIDEWAYS: SafeAreaInsets = { top: 0, right: 47, bottom: 21, left: 47 };
const NOTCHED_UPRIGHT: SafeAreaInsets = { top: 47, right: 0, bottom: 34, left: 0 };
const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

type Cap = 'above-the-step-bar' | 'share-of-the-lanes';

interface Table {
  readonly width: number;
  readonly height: number;
  readonly device: EmulatedDevice;
  readonly label: string;
  readonly cap: Cap;
  readonly wholeMovesFloor: number;
}

function table(
  width: number,
  height: number,
  pointer: 'coarse' | 'fine',
  safeArea: SafeAreaInsets,
  cap: Cap,
  wholeMovesFloor: number,
): Table {
  return {
    width,
    height,
    device: { mobile: pointer === 'coarse', pointer, safeArea },
    label: `${String(width)}x${String(height)} ${pointer}`,
    cap,
    wholeMovesFloor,
  };
}

const TABLES: readonly Table[] = [
  table(844, 390, 'coarse', NOTCHED_SIDEWAYS, 'above-the-step-bar', 2),
  table(667, 375, 'coarse', NOTCHED_SIDEWAYS, 'above-the-step-bar', 2),
  table(932, 430, 'coarse', NOTCHED_SIDEWAYS, 'above-the-step-bar', 3),
  table(844, 290, 'coarse', NOTCHED_SIDEWAYS, 'above-the-step-bar', 0),
  table(1280, 560, 'fine', NO_INSETS, 'above-the-step-bar', 2),
  table(568, 320, 'coarse', NO_INSETS, 'share-of-the-lanes', 1),
  table(375, 553, 'coarse', NOTCHED_UPRIGHT, 'share-of-the-lanes', 1),
];

const ROW_FLOOR_PX = 44;
const SUBPIXEL = 0.5;
const STEP_BAR_CLEARANCE_PX = 6;

function overlaps(one: Rect, two: Rect): boolean {
  return (
    one.left < two.right - 1 &&
    one.right > two.left + 1 &&
    one.top < two.bottom - 1 &&
    one.bottom > two.top + 1
  );
}

describe('the ask flyout on a short table shows more moves and still clears the hand and the step bar', () => {
  browserIt(
    'grows down to the step bar on a short rail table, keeps its share of the lanes elsewhere, and reaches every move by scroll',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-ask-flyout-short-table-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const file = join(directory, 'page.html');
        await writeFile(file, page(), 'utf8');
        for (const at of TABLES) {
          const reading = (await measurePage(
            chrome.client,
            file,
            at.width,
            at.height,
            MEASURE,
            at.label,
            '.mtg-ask-flyout',
            true,
            at.device,
          )) as unknown as Reading;
          const { flyout, body, lanes, steps, hand } = reading;

          expect(flyout, `${at.label}: flyout`).not.toBeNull();
          expect(body, `${at.label}: flyout body`).not.toBeNull();
          expect(lanes, `${at.label}: lanes`).not.toBeNull();
          expect(steps, `${at.label}: step bar`).not.toBeNull();
          expect(hand, `${at.label}: the viewer's hand`).not.toBeNull();
          expect(reading.before.length, `${at.label}: moves drawn`).toBe(CHOICE_COUNT);
          if (flyout === null || body === null || lanes === null || steps === null || hand === null) continue;

          const oldCap = (lanes.height * FLYOUT_MAX_PERCENT) / 100;

          expect(
            overlaps(flyout, steps),
            `${at.label}: the flyout's foot at ${String(flyout.bottom)} is over the step bar's head at ${String(steps.top)}`,
          ).toBe(false);
          expect(
            overlaps(flyout, hand),
            `${at.label}: the flyout's foot at ${String(flyout.bottom)} is over the hand's head at ${String(hand.top)}`,
          ).toBe(false);
          expect(flyout.top, `${at.label}: flyout top inside the lanes`).toBeGreaterThanOrEqual(
            lanes.top - 1,
          );
          expect(flyout.bottom, `${at.label}: flyout bottom inside the lanes`).toBeLessThanOrEqual(
            lanes.bottom + 1,
          );

          if (at.cap === 'above-the-step-bar') {
            expect(flyout.bottom, `${at.label}: flyout bottom above the step bar's head`).toBeLessThanOrEqual(
              steps.top - STEP_BAR_CLEARANCE_PX,
            );
            expect(flyout.height, `${at.label}: flyout height against the old cap`).toBeGreaterThanOrEqual(
              oldCap - SUBPIXEL,
            );
          } else {
            expect(
              flyout.height,
              `${at.label}: flyout height against its share of the lanes`,
            ).toBeLessThanOrEqual(oldCap + SUBPIXEL);
          }

          const whole = reading.before.filter(
            (move) => move.top >= body.top - SUBPIXEL && move.bottom <= body.bottom + SUBPIXEL,
          );
          expect(
            whole.length,
            `${at.label}: whole moves visible without scrolling (body ${String(body.height)}px)`,
          ).toBeGreaterThanOrEqual(at.wholeMovesFloor);
          if (at.device.pointer === 'coarse') {
            for (const move of whole) {
              expect(move.height, `${at.label}: a visible move's own height`).toBeGreaterThanOrEqual(
                ROW_FLOOR_PX - 1,
              );
            }
          }

          expect(reading.after, `${at.label}: moves after scrolling to the end`).not.toBeNull();
          if (reading.after === null) continue;
          const last = reading.after[reading.after.length - 1];
          expect(last, `${at.label}: last move exists after scrolling`).toBeDefined();
          if (last === undefined) continue;
          expect(last.top, `${at.label}: last move top reachable by scroll`).toBeGreaterThanOrEqual(
            body.top - SUBPIXEL,
          );
          expect(last.bottom, `${at.label}: last move bottom reachable by scroll`).toBeLessThanOrEqual(
            body.bottom + SUBPIXEL,
          );
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
          `ask flyout short-table Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    420_000,
  );
});
