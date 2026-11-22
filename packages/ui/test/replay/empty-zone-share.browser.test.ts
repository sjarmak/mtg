// @vitest-environment node
/**
 * A zone holding nothing does not take a seat's share of the mat.
 *
 * `mtg-aqxi.21`. `../../src/styles/board/fit.ts` gives every zone on a side
 * `flex: 1 1 auto`, so a side's leftover height goes to the battlefield whether
 * or not anything is on it. The opening position of a game is the case where
 * nothing is: a replay opened on turn 0 drew two boxes of about 230px each, a
 * quarter of a 900px window apiece, to say "no permanents" twice.
 *
 * The rule is one selector wide: an empty battlefield is `flex: 0 0 auto` and is
 * worth its sentence. Everything else on the mat keeps the share it had — the
 * hand and rail are content-sized and measure the same in both arms below, so
 * what the collapse frees is leftover space inside the seat rather than height
 * taken off the cards.
 *
 * The counter-arm is taken by clearing the marker on the same layout rather than
 * by finding a frame with permanents on it, so what is measured is the rule and
 * not the difference between two positions. It is the test `stillPage`
 * (`../support/chrome-driver.ts`) was written for: without it, clearing the
 * marker started a 1ms transition and this expression, which is synchronous,
 * read the flex-grow back at t=0 — the collapsed value — so the rule looked
 * like a no-op for an afternoon.
 *
 * jsdom performs no layout, so none of this is measurable there; the harness is
 * `../support/chrome.ts`.
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
import { browserIt, launchChrome, measurePage, shutdownChrome, stillPage } from '../support/chrome';
import { fixtureLog } from './support/log-fixture';

/** The opening position: shuffles, opening hands, nothing in play either side. */
const SEQ = '0';

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Empty zones</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = stillPage(`(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const sideZones = ".mtg-board__side > .mtg-zone";
  const empties = [...document.querySelectorAll(sideZones + "[data-empty='true']")];
  const held = [...document.querySelectorAll(sideZones)].filter((zone) => !empties.includes(zone));

  const heights = (zones) => zones.map((zone) => round(zone.getBoundingClientRect().height));
  const read = () => ({ empty: heights(empties), hands: heights(held) });
  const collapsed = read();
  const named = empties.map((zone) => {
    const label = zone.querySelector('.mtg-zone__label');
    const sentence = zone.querySelector('.mtg-zone__empty');
    if (label === null || sentence === null) return null;
    const a = label.getBoundingClientRect();
    const b = sentence.getBoundingClientRect();
    return {
      label: (label.textContent ?? '').trim(),
      sentence: (sentence.textContent ?? '').trim(),
      labelDrawn: a.width > 0 && a.height > 0,
      count: zone.querySelectorAll('.mtg-zone__count').length,
      sameRow: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 4,
    };
  });
  for (const zone of empties) zone.removeAttribute('data-empty');
  void document.body.getBoundingClientRect();
  const shared = read();
  return {
    viewport: [window.innerWidth, window.innerHeight],
    boards: document.querySelectorAll('.mtg-board').length,
    collapsed,
    named,
    shared,
  };
})()`);

interface Arm {
  readonly empty: readonly number[];
  readonly hands: readonly number[];
}

interface Named {
  readonly label: string;
  readonly sentence: string;
  readonly labelDrawn: boolean;
  readonly count: number;
  readonly sameRow: boolean;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly boards: number;
  readonly collapsed: Arm;
  readonly named: readonly (Named | null)[];
  readonly shared: Arm;
}

/**
 * The most of a window an empty battlefield may take.
 *
 * A fraction, because what is wrong with the even split is proportional: two
 * boxes saying nothing, taking more than half the screen. A tenth is well above
 * the sentence's own height and well below a seat's share of the mat.
 */
const EMPTY_SHARE_MAX = 0.1;

const SIZES = [
  { width: 1440, height: 900, coarse: false },
  { width: 844, height: 390, coarse: true },
] as const;

describe('an empty battlefield', () => {
  browserIt(
    'is worth its sentence rather than half the mat',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-empty-zone-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-empty-zone-chrome-'));
      const file = join(directory, 'replay.html');
      await writeFile(file, page(), 'utf8');
      const chrome = await launchChrome(userDataDir);
      try {
        for (const size of SIZES) {
          const at = `${String(size.width)}x${String(size.height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            size.width,
            size.height,
            MEASURE,
            at,
            '.mtg-board',
            true,
            size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no board`);

          // The opening position has one of these a side, and the frame is the
          // reason: a test that found none would pass every assertion below.
          expect(seen.boards, `${at}: the page drew no table`).toBe(1);
          expect(seen.collapsed.empty.length, `${at}: no side of the mat is empty`).toBe(2);

          for (const [index, height] of seen.collapsed.empty.entries()) {
            expect(height, `${at}: empty battlefield ${String(index)} is drawn at all`).toBeGreaterThan(0);
            expect(
              height,
              `${at}: empty battlefield ${String(index)} takes a seat's share of the mat`,
            ).toBeLessThan(size.height * EMPTY_SHARE_MAX);
          }

          // And it is the marker doing it. Cleared, the same zones take the even
          // split the sheet gives every other side of the mat.
          for (const [index, height] of seen.shared.empty.entries()) {
            expect(
              height,
              `${at}: battlefield ${String(index)} is collapsed by something other than the marker`,
            ).toBeGreaterThan(seen.collapsed.empty[index] ?? 0);
          }

          // And the share it takes without the marker is the share the bound
          // above forbids, so the bound is a bound on this rule rather than on
          // a layout that would have passed it anyway.
          for (const [index, height] of seen.shared.empty.entries()) {
            expect(
              height,
              `${at}: battlefield ${String(index)} is inside the bound without the marker too`,
            ).toBeGreaterThanOrEqual(size.height * EMPTY_SHARE_MAX);
          }

          // And the sentence has a subject. `../../src/styles/board/fit.ts`
          // hides every zone head on the mat, which is right for a row of cards
          // — the cards are the zone — and wrong for a row with none: the sweep
          // photographed a bare "no permanents" floating directly above a hand
          // holding seven cards, with nothing on the strip to say which zone it
          // was about (`mtg-dcxg.10`). An empty zone gets its name back, on the
          // same line as its sentence and still without the `0` chip.
          for (const [index, name] of seen.named.entries()) {
            if (name === null) throw new Error(`${at}: empty zone ${String(index)} draws no sentence`);
            expect(name.labelDrawn, `${at}: empty zone ${String(index)} draws no name`).toBe(true);
            expect(
              name.label.length,
              `${at}: empty zone ${String(index)} is named by nothing`,
            ).toBeGreaterThan(0);
            expect(name.sameRow, `${at}: "${name.label}" and "${name.sentence}" are on different lines`).toBe(
              true,
            );
            expect(name.count, `${at}: empty zone ${String(index)} still counts itself at zero`).toBe(0);
          }

          // The zones that hold something are drawn either way and keep their
          // height: they are content-sized, so what the collapse frees is
          // leftover space inside the seat, not height taken off the cards.
          expect(seen.collapsed.hands.length, `${at}: the seats were dealt nothing`).toBeGreaterThan(0);
          expect(seen.shared.hands, `${at}: clearing the marker moved a zone that holds cards`).toEqual(
            seen.collapsed.hands,
          );
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
