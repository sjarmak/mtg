// @vitest-environment node
/**
 * The replay viewer on a phone held sideways, which is where its hands were cut
 * in half.
 *
 * `mtg-dcxg.11`, 2026-08-23. `./replay-phone.browser.test.ts` fitted this route
 * to a phone held upright, and every rule it measures is inside a
 * `max-width: 40rem` block. A landscape phone is 844px wide, so none of it
 * fires: what draws is `../../src/styles/replay.ts`'s desk arrangement, where a
 * seat's hand row is a stated 28% of its side. Measured in chrome-headless-shell
 * at 844x390 over `./support/log-fixture.ts` at seq 120, before the fix:
 *
 *  - Each side came out 132.8px and 28% of it made the hand row 37.2px.
 *  - The cards in that row are 67px tall, because a card cannot be drawn
 *    shorter than its own contents. The row's body had 20px of overflow it did
 *    not scroll, and every face in it started 20px above the top of the row.
 *  - Both seats, on every frame, which is what the 2026-08-23 sweep's
 *    `out/shots/route-replay.landscape.png` shows: two rows of cards with their
 *    titles cut off.
 *
 * So the two sentences this rig holds at 844x390:
 *
 * 1. **Nothing in either hand is clipped.** Every face is inside the row it is
 *    drawn in, and the row has nothing hidden in it.
 * 2. **The battlefield is not paid for out of the hand.** Each seat's permanent
 *    row stays above `../../src/styles/board/hand.ts`'s readable floor, which is
 *    the thing a share of a short lane would have taken to buy the row above.
 *
 * The reading at 1280x800 is here as well, and it is the regression this could
 * cause rather than decoration: the fix is a `max-height` query, and 800px is
 * inside it. There the sides are 282.3px on their own, so the floor does not
 * bind and the route is the desk layout it has always been.
 *
 * **The browser is told it is a phone** for the landscape reading, because the
 * transport's controls are sized by a pointer query and they are part of what
 * the height is spent on.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { ReplayViewer } from '../../src/routes/replay/ReplayViewer';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';
import { fixtureLog } from './support/log-fixture';

/** The frame with permanents and a hand in both seats, which is the subject. */
const SEQ = '120';

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'analysis',
      sub: 'replay',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(ReplayViewer, {
        state: { status: 'ready', log: fixtureLog() },
        route: { mode: 'analysis', sub: 'replay', params: { seq: SEQ } },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Replay</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * One reading per seat.
 *
 * `clipAbove` is the distance from the top of the row's own body down to the
 * topmost face in it: positive means a card starts above the box that holds it,
 * which is the defect. Read off the faces rather than off the row's height,
 * because the row was the right height for its declaration and the wrong height
 * for its contents, and only the cards can say so.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const sides = [...document.querySelectorAll('.mtg-board__side[data-seat]')];
  if (sides.length === 0) return null;
  return {
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    seats: sides.map((side) => {
      const row = side.querySelector(':scope > .mtg-zone[data-tone="rail"]');
      const body = row === null ? null : row.querySelector('.mtg-zone__body');
      const spells = side.querySelector('.mtg-board__spells');
      const faces = row === null ? [] : [...row.querySelectorAll('.mtg-card')]
        .map((face) => face.getBoundingClientRect())
        .filter((rect) => rect.height > 0);
      const bodyBox = body === null ? null : body.getBoundingClientRect();
      return {
        faces: faces.length,
        faceHeight: faces.length === 0 ? 0 : round(Math.max(...faces.map((rect) => rect.height))),
        clipAbove: faces.length === 0 || bodyBox === null
          ? 0
          : round(bodyBox.top - Math.min(...faces.map((rect) => rect.top))),
        clipBelow: faces.length === 0 || bodyBox === null
          ? 0
          : round(Math.max(...faces.map((rect) => rect.bottom)) - bodyBox.bottom),
        hidden: body === null ? 0 : round(body.scrollHeight - body.clientHeight),
        handHeight: row === null ? 0 : round(row.getBoundingClientRect().height),
        spellsHeight: spells === null ? 0 : round(spells.getBoundingClientRect().height),
      };
    }),
  };
})()`;

interface Seat {
  readonly faces: number;
  readonly faceHeight: number;
  readonly clipAbove: number;
  readonly clipBelow: number;
  readonly hidden: number;
  readonly handHeight: number;
  readonly spellsHeight: number;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly coarse: boolean;
  readonly seats: readonly Seat[];
}

const SLACK_PX = 0.5;

/**
 * The shortest a battlefield row may be and still draw a readable face.
 *
 * `../../src/styles/board/hand.ts`'s `BOARD_FACE_MIN_REM` is 4.5rem and states
 * the measurement behind it: under roughly 65-67px of width, flagship names
 * start clipping. The row is the face plus the zone's own padding, and it came
 * out 77px at 844x390 after the fix against 73.6px before it, so this floor is
 * stated at the face rather than at the reading.
 */
const BOARD_ROW_MIN_PX = 72;

const PHONE_LANDSCAPE = { width: 844, height: 390, coarse: true } as const;
const SHORT_DESKTOP = { width: 1280, height: 800, coarse: false } as const;

async function read(
  client: Parameters<typeof measurePage>[0],
  file: string,
  size: { readonly width: number; readonly height: number; readonly coarse: boolean },
): Promise<Reading> {
  const at = `${String(size.width)}x${String(size.height)}`;
  const seen = (await measurePage(
    client,
    file,
    size.width,
    size.height,
    MEASURE,
    at,
    '.mtg-board__side[data-seat]',
    true,
    size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
  )) as unknown as Reading | null;
  if (seen === null) throw new Error(`${at}: the page drew no seats`);
  return seen;
}

describe('the replay viewer on a phone held sideways', () => {
  browserIt(
    'draws both hands whole, without taking the battlefield to pay for them',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-replay-landscape-'));
      const chrome = await launchChrome(join(directory, 'chrome'));
      const file = join(directory, 'replay.html');
      await writeFile(file, page(), 'utf8');
      try {
        const phone = await read(chrome.client, file, PHONE_LANDSCAPE);
        expect(phone.coarse, 'the rig emulates the right pointer').toBe(true);
        expect(phone.seats.length, 'a replay draws two seats').toBe(2);

        for (const [index, seat] of phone.seats.entries()) {
          const who = `seat ${String(index)} at 844x390`;
          // The population, so the two claims below cannot pass on an empty row.
          expect(seat.faces, `${who}: the hand is empty, so nothing was measured`).toBeGreaterThan(0);

          // 1. Nothing in the hand is clipped, at either end, or hidden.
          expect(seat.clipAbove, `${who}: the hand is cut off across the top`).toBeLessThanOrEqual(SLACK_PX);
          expect(seat.clipBelow, `${who}: the hand runs past the bottom of its row`).toBeLessThanOrEqual(
            SLACK_PX,
          );
          expect(
            seat.hidden,
            `${who}: the hand row holds ${String(seat.hidden)}px it does not show`,
          ).toBeLessThanOrEqual(SLACK_PX);
          expect(seat.handHeight, `${who}: the row is shorter than the cards in it`).toBeGreaterThanOrEqual(
            seat.faceHeight - SLACK_PX,
          );

          // 2. And the permanents were not what paid for it.
          expect(
            seat.spellsHeight,
            `${who}: the battlefield row is ${String(seat.spellsHeight)}px`,
          ).toBeGreaterThanOrEqual(BOARD_ROW_MIN_PX);
        }

        // The desk inside the same height query, unchanged: the floor does not
        // bind, and neither hand is clipped there either.
        const desk = await read(chrome.client, file, SHORT_DESKTOP);
        for (const [index, seat] of desk.seats.entries()) {
          const who = `seat ${String(index)} at 1280x800`;
          expect(seat.clipAbove, `${who}: the hand is cut off across the top`).toBeLessThanOrEqual(SLACK_PX);
          expect(seat.spellsHeight, `${who}: the battlefield row is short`).toBeGreaterThanOrEqual(
            BOARD_ROW_MIN_PX,
          );
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
