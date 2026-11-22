/**
 * The turn label on an upright phone reads whole (mtg-lab issue 186).
 *
 * The head of the step bar was capped at 3.5rem on a phone, which left its
 * label 28px of the 63 that `Turn 1: You` wants and the 70 that `Turn 12: You`
 * wants, so every turn read `Tu…`. `styles/mobile.ts`'s `PHONE_HEAD_MAX_REM`
 * carries the sweep behind the fix: on a phone tall enough for the steps to
 * wrap, the head now wraps with them as the first item of one row, so its width
 * costs line one alone and no longer a line of steps; on a short phone the
 * steps are a sideways scroller and the head's width costs the bar no height.
 *
 * Measured in chrome-headless-shell as a coarse-pointer phone, label
 * clientWidth / scrollWidth in px, and the bar's height:
 *
 *   viewport   turn   before     after
 *   390x844    1      28 / 63    63 / 63
 *   390x844    12     28 / 70    70 / 70
 *   375x553    1      28 / 63    63 / 63
 *   375x553    12     28 / 70    70 / 70
 *   360x780    12     28 / 70    70 / 70
 *   bar at 360x780 and 390x844    136        136
 *
 * The bar's height is asserted beside the label, because the cheap fix — lift
 * the cap and leave the head beside the steps — reads the label whole and pays
 * for it with a line of steps: a 182px bar at 360x780, 23px off the opponent's
 * battlefield. 360x780 is in the sweep for that reason; at 390x844 the cheap
 * fix only pays once the seat name is longer than `You`.
 *
 * The sideways phone (844x390) is not under the phone cap and is
 * `landscape-phone.browser.test.ts`'s to measure.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { basicLand } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

// A neutral basic: the label measured here reads the turn and the seat, and no
// card on the board changes its width.
const PLAINS = basicLand('Plains', 'TST', 250);

function session(turn: number): GameSession {
  const built = scenario({
    seed: 'ui/phone-turn-label',
    battlefield: [
      { card: PLAINS, controller: 0 },
      { card: PLAINS, controller: 1 },
    ],
    hands: [[], []],
    active: 0,
    turn,
  });
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: built.state,
    events: built.events,
    result: null,
    pending: pendingDecision(built.state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function page(game: GameSession): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: game,
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
        onBeats: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Phone turn label</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const label = document.querySelector('.mtg-phasebar .mtg-turnstops__label');
  const bar = document.querySelector('.mtg-phasebar');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    coarse: matchMedia('(pointer: coarse)').matches,
    text: label?.textContent ?? null,
    clientWidth: label?.clientWidth ?? null,
    scrollWidth: label?.scrollWidth ?? null,
    barHeight: bar === null ? null : Math.round(bar.getBoundingClientRect().height * 10) / 10,
  };
})()`;

interface Reading {
  readonly viewport: readonly [number, number];
  readonly coarse: boolean;
  readonly text: string | null;
  readonly clientWidth: number | null;
  readonly scrollWidth: number | null;
  readonly barHeight: number | null;
}

/**
 * Upright phones: the issue's tall one, its short one, and the narrowest tall
 * one. A tall phone wraps the steps, so it is where a wider head could cost a
 * line; a short one scrolls them on one line.
 */
const UPRIGHT = [
  [390, 844, 'tall'],
  [375, 553, 'short'],
  [360, 780, 'tall'],
] as const;

/** The bar on a tall upright phone before the fix, which the fix may not exceed. */
const TALL_BAR_PX = 136;

const SLACK_PX = 0.5;

describe('an upright phone draws the turn label whole', () => {
  browserIt(
    'fits `Turn 1: You` and `Turn 12: You` without a taller bar',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-phone-turn-label-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const turn of [1, 12]) {
          const file = join(directory, `turn-${String(turn)}.html`);
          await writeFile(file, page(session(turn)), 'utf8');
          for (const [width, height, tier] of UPRIGHT) {
            const where = `${String(width)}x${String(height)} turn ${String(turn)}`;
            const reading = (await measurePage(
              chrome.client,
              file,
              width,
              height,
              MEASURE,
              'phone turn label',
              ".mtg-slot[data-slot='play'] > .mtg-card",
              true,
              { mobile: true, pointer: 'coarse' },
            )) as unknown as Reading;
            console.log(
              `${where}: "${String(reading.text)}" ${String(reading.clientWidth)}/${String(reading.scrollWidth)}, bar ${String(reading.barHeight)}`,
            );
            expect(reading.viewport, where).toEqual([width, height]);
            expect(reading.coarse, `${where}: the browser was not told it was a touch device`).toBe(true);
            expect(reading.text, where).toBe(`Turn ${String(turn)}: You`);
            expect(reading.clientWidth, `${where}: the label was not drawn`).toBeGreaterThan(0);
            expect(
              reading.scrollWidth ?? Infinity,
              `${where}: the turn label is clipped`,
            ).toBeLessThanOrEqual(reading.clientWidth ?? 0);
            if (tier === 'tall') {
              expect(
                reading.barHeight ?? Infinity,
                `${where}: the whole label cost the bar a line of steps`,
              ).toBeLessThanOrEqual(TALL_BAR_PX + SLACK_PX);
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
        cleanupErrors.push(new Error(`could not remove Chrome fixture ${directory}: ${reason(error)}`));
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          `phone turn label Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});
