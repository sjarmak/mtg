// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';
import type { SafeAreaInsets } from '../support/chrome';

const SPELLS = [exampleCard('slc-skywatch-sentinel'), exampleCard('slc-windrider-drake')] as const;
const LANDS = [exampleCard('slc-plains'), exampleCard('slc-island')] as const;

const NOTCHED_PHONE: SafeAreaInsets = { top: 0, right: 47, bottom: 21, left: 47 };
const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const SIDEWAYS = [
  [844, 390],
  [844, 340],
  [932, 430],
] as const;
const SLACK_PX = 0.5;

function table(): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) =>
    [...SPELLS, ...LANDS].map((card) => ({ card, controller, tapped: false, summoningSick: false })),
  );
  const built = scenario({
    seed: 'ui/landscape-safe-area',
    battlefield,
    hands: [
      [SPELLS[0], SPELLS[1], LANDS[0], LANDS[1], SPELLS[0], SPELLS[1], LANDS[0]],
      [SPELLS[1], SPELLS[0], LANDS[1], LANDS[0], SPELLS[1], SPELLS[0], LANDS[1]],
    ],
    active: 0,
    turn: 5,
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

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(
        'div',
        { className: 'mtg-play-route' },
        h(PlayView, {
          session: table(),
          viewer: 0,
          names: ['You', 'Bot'],
          onChoose: () => undefined,
          autoPass: DEFAULT_AUTO_PASS,
          onAutoPass: () => undefined,
          onYield: () => undefined,
        }),
      ),
    }),
  );
  const staged = markup
    .replace('data-rail="open"', 'data-rail="shut"')
    .replace('data-ask="open"', 'data-ask="shut"');
  if (staged === markup || staged.includes('="open"')) {
    throw new Error('the mat did not carry both columns open, so the shut state cannot be written onto it');
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Landscape safe area</title><style>${uiStyleSheet()}</style></head><body><div id="root">${staged}</div></body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const probe = document.createElement('div');
  probe.style.cssText = 'position: fixed; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
  document.body.append(probe);
  const read = getComputedStyle(probe);
  const insets = {
    top: parseFloat(read.paddingTop),
    right: parseFloat(read.paddingRight),
    bottom: parseFloat(read.paddingBottom),
    left: parseFloat(read.paddingLeft),
  };
  probe.remove();
  const box = (node) => {
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
    return { left: round(seen.left), top: round(seen.top), right: round(seen.right), bottom: round(seen.bottom) };
  };
  const mat = document.querySelector('.mtg-board');
  const drawn = (node) => {
    const seen = box(node);
    return seen.right > seen.left && seen.bottom > seen.top && getComputedStyle(node).visibility !== 'hidden';
  };
  const named = (node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 40);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    insets,
    textSizeAdjust: getComputedStyle(document.documentElement).getPropertyValue('text-size-adjust'),
    mat: mat === null ? null : box(mat),
    controls: mat === null ? [] : [...mat.querySelectorAll('button, [role="button"], select, .mtg-pod__life')]
      .filter(drawn)
      .map((node) => ({ name: named(node), ...box(node) })),
    hand: [...document.querySelectorAll(".mtg-board__side[data-seat='you'] .mtg-slot[data-slot='hand'] > .mtg-card")]
      .map((node) => box(node)),
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    pageOverflowY: round(document.documentElement.scrollHeight - document.documentElement.clientHeight),
  };
})()`;

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface Reading {
  readonly viewport: readonly [number, number];
  readonly insets: SafeAreaInsets;
  readonly textSizeAdjust: string;
  readonly mat: Box | null;
  readonly controls: readonly (Box & { readonly name: string })[];
  readonly hand: readonly Box[];
  readonly pageOverflowX: number;
  readonly pageOverflowY: number;
}

describe('a phone held sideways keeps the table clear of its notch and its home bar', () => {
  browserIt(
    'draws the mat and every control on it inside the safe area, and costs a phone without one nothing',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-landscape-safe-area-'));
      const file = join(directory, 'board.html');
      await writeFile(file, page(), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const at = async (width: number, height: number, safeArea: SafeAreaInsets): Promise<Reading> =>
          (await measurePage(
            chrome!.client,
            file,
            width,
            height,
            MEASURE,
            'landscape safe area',
            ".mtg-slot[data-slot='play'] > .mtg-card",
            true,
            { mobile: true, pointer: 'coarse', safeArea },
          )) as unknown as Reading;

        for (const [width, height] of SIDEWAYS) {
          const where = `${String(width)}x${String(height)}`;
          const notched = await at(width, height, NOTCHED_PHONE);
          const plain = await at(width, height, NO_INSETS);
          console.log(
            `${where}: insets ${JSON.stringify(notched.insets)}, mat ${JSON.stringify(notched.mat)} against ${JSON.stringify(plain.mat)}, controls ${String(notched.controls.length)}, hand ${String(notched.hand.length)}`,
          );

          expect(notched.insets, `${where}: the browser was not told it had a notch`).toEqual(NOTCHED_PHONE);
          expect(plain.insets, `${where}: the control still reports insets`).toEqual(NO_INSETS);
          expect(notched.textSizeAdjust, `${where}: the page lets the browser resize its text`).toBe('100%');

          const safe = {
            left: NOTCHED_PHONE.left - SLACK_PX,
            right: width - NOTCHED_PHONE.right + SLACK_PX,
            bottom: height - NOTCHED_PHONE.bottom + SLACK_PX,
          };
          if (notched.mat === null || plain.mat === null) throw new Error(`${where}: the page drew no mat`);
          expect(notched.mat.left, `${where}: the mat starts under the notch`).toBeGreaterThanOrEqual(
            safe.left,
          );
          expect(notched.mat.right, `${where}: the mat ends under the far corner`).toBeLessThanOrEqual(
            safe.right,
          );
          expect(notched.mat.bottom, `${where}: the mat ends under the home bar`).toBeLessThanOrEqual(
            safe.bottom,
          );

          expect(notched.controls.length, `${where}: the mat drew no control to check`).toBeGreaterThan(3);
          for (const control of notched.controls) {
            expect(control.left, `${where}: ${control.name} starts under the notch`).toBeGreaterThanOrEqual(
              safe.left,
            );
            expect(control.right, `${where}: ${control.name} ends under the far corner`).toBeLessThanOrEqual(
              safe.right,
            );
          }
          expect(notched.hand.length, `${where}: the hand drew no card`).toBeGreaterThan(0);
          for (const card of notched.hand) {
            expect(card.left, `${where}: a hand card starts under the notch`).toBeGreaterThanOrEqual(
              safe.left,
            );
            expect(card.bottom, `${where}: a hand card ends under the home bar`).toBeLessThanOrEqual(
              safe.bottom,
            );
          }
          expect(notched.pageOverflowX, `${where}: the page scrolls sideways`).toBeLessThanOrEqual(SLACK_PX);
          expect(notched.pageOverflowY, `${where}: the page scrolls past the home bar`).toBeLessThanOrEqual(
            SLACK_PX,
          );

          expect(plain.mat.left, `${where}: a phone without a notch lost width on the left`).toBeLessThan(
            NOTCHED_PHONE.left / 2,
          );
          expect(
            width - plain.mat.right,
            `${where}: a phone without a notch lost width on the right`,
          ).toBeLessThan(NOTCHED_PHONE.right / 2);
          expect(height - plain.mat.bottom, `${where}: a phone without a home bar lost height`).toBeLessThan(
            NOTCHED_PHONE.bottom,
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
          `landscape safe area Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});
